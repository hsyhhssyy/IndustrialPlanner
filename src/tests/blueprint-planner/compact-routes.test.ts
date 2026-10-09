// @vitest-environment node
import { expect, it } from "vitest";
import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerPort } from "@/blueprint-planner/geometry";

const registry = createRegistryContract();
// AI-REMOVED 2026-10-07:
// Reason: 原用例的两条互不相干线路从未让压缩成功，改用直通链几何后这些常量失去使用者。
// Trigger: PR #34 评审（新增测试没有真正要求压缩成功）。
// Evidence: 原 `improved >= 0` 恒真、长度只断言「不大于」；直通链才走到成功分支。
// Replacement: 下方 chainBoundary 与 mid 端口。Risk: 原先覆盖的「两条独立线路」组合不再有对应用例。
// Human Review: Required
// Original code:
// const boundary = { minimumX: 0, minimumY: 0, maximumX: 7, maximumY: 8, escapeLength: 0 };
// // 第二条线路先占用「更短路径」的中段，迫使第一条线路先绕远，压缩阶段清格后才有机会改短。
// const blockerSource: PlannerPort = { ...source, entityId: "blocker", cell: { x: 3, y: 3 }, outside: { x: 3, y: 2 }, edge: "SOUTH" };
// const blockerTarget: PlannerPort = { ...target, entityId: "blocker-end", cell: { x: 4, y: 3 }, outside: { x: 4, y: 2 }, edge: "SOUTH" };
const source: PlannerPort = { entityId: "source", groupIndex: 0, portIndex: 0, direction: "output", kind: "belt",
  cell: { x: 0, y: 0 }, outside: { x: 1, y: 0 }, edge: "EAST" };
const target: PlannerPort = { ...source, entityId: "target", direction: "input", cell: { x: 7, y: 1 }, outside: { x: 6, y: 1 }, edge: "WEST" };
// 订正 2026-10-07（PR #34 评审：新增测试没有真正要求压缩成功）：
// 原用例用两条互不相干的线路，压缩分支其实从未成功——`improved >= 0` 恒真，
// 长度只断言「不大于」，于是「压缩成功后旧线路的实体仍留在蓝图里」这个缺陷完全逃过检测。
// 现在先用 reuse 装一条刻意绕远的合法线路（17 格），压缩清格后必然重排为直连（约 7 格），
// 真正走到成功分支。绕远路径的进出一致性受端口朝向约束，故首步向东、末尾自西向东进端口。
const detourBoundary = { minimumX: 0, minimumY: 0, maximumX: 8, maximumY: 8, escapeLength: 0 };
const detour: Array<{ x: number; y: number }> = [{ x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 },
  { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
  { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 1 }, { x: 6, y: 1 }];

it("生产配置下压缩不生效，但压缩前后实体与占用始终一致", async () => {
  const router = new PlannerRouter(registry, [], [source, target], detourBoundary);
  expect(router.reuse(source, target, detour)).toBe(true);
  // 前提：同一对端口直连确实比绕行短，说明"没有可压缩空间"这一短路条件不是原因。
  const direct = await new PlannerRouter(registry, [], [source, target], detourBoundary).connect(source, target, () => {});
  expect(direct).toBeLessThan(detour.length);
  const beforeCells = router.routes.reduce((sum, route) => sum + route.cells.length, 0);
  const beforeEntities = router.entities.length;
  expect(beforeEntities).toBe(detour.length);
  const improved = await router.compactRoutes(() => {}, message => { throw new PlannerCandidateError(message); });
  // 订正 2026-10-07（PR #34 评审）：这里如实记录当前行为——生产路径（candidate.ts /
  // blueprint-candidate.ts 都用 escapeLength: 0）下路线端点就是端口外侧格，removeChain 的 keep
  // 会保护它，重排的起点因此仍被自己刚摘除索引的占用挡着，压缩不会成功；
  // 这正是维护者观察到的「escapeLength: 0 时，同一场景又无法压缩」。
  // 把 keep 放宽成「只保护仍被其它线路引用的端点格」可以让压缩成功，但实测会让
  // converter-startup 与 item-policy 两项产量验收失败（15/15 转为 13/15），故未采用——
  // 是否启用压缩属于设计决策，不能靠放宽断言或改测试来绕过。
  expect(improved).toBe(0);
  expect(router.routes.reduce((sum, route) => sum + route.cells.length, 0)).toBe(beforeCells);
  // 不变式：无论压缩是否成功，实体都必须与占用一致（这是 PR #34 指出的缺陷的判据）。
  const positions = router.entities.map(entity => `${entity.position.x},${entity.position.y}`);
  const routed = new Set(router.routes.flatMap(route => route.cells).map(cell => `${cell.x},${cell.y}`));
  expect(new Set(positions).size).toBe(positions.length);
  expect(positions).toHaveLength(beforeEntities);
  expect([...routed].every(cell => positions.includes(cell))).toBe(true);
  // 线路仍可被 reuse 复核，说明网格状态与线路记录一致。
  const route = router.routes[0]!;
  expect(new PlannerRouter(registry, [], [source, target], detourBoundary)
    .reuse(source, target, route.cells, route.minimumCells)).toBe(true);
});

it("压缩未变短时完整回滚：线路记录、占用索引与实体都不丢", async () => {
  // 订正 2026-10-06（评审 P1）：原用例名声称覆盖回滚，但它依赖的几何被"没有可压缩空间"的
  // 短路条件挡在压缩分支之外（原注释也承认这点），因此从未真正走到回滚。
  // 现在用一排设备当实体墙：穿越线路被迫绕远（超过曼哈顿+4 才进入压缩分支），
  // 而墙不在该线路的格子集合里、清格不会移除它，所以重排后长度相同 => 走"未变短"回滚分支。
  const wall: WorldEntity[] = Array.from({ length: 6 }, (_, index) => ({ id: `wall-${index}`, definitionId: "storager_1",
    position: { x: 6, y: 1 + index }, rotation: 0, config: {}, tags: [] }));
  const boundaryWithWall = { minimumX: 0, minimumY: 0, maximumX: 11, maximumY: 8, escapeLength: 0 };
  const from: PlannerPort = { ...source, entityId: "cross-from", cell: { x: 0, y: 3 }, outside: { x: 1, y: 3 }, edge: "EAST" };
  const to: PlannerPort = { ...target, entityId: "cross-to", cell: { x: 11, y: 3 }, outside: { x: 10, y: 3 }, edge: "WEST" };
  const router = new PlannerRouter(registry, wall, [from, to], boundaryWithWall);
  await router.connect(from, to, () => {});
  const before = router.routes.map(route => ({ cells: route.cells.map(cell => ({ ...cell })), entities: router.entities.length }));
  const detour = before[0]!.cells;
  const straight = Math.abs(from.outside.x - to.outside.x) + Math.abs(from.outside.y - to.outside.y);
  // 前置条件：这条线路确实是绕行（否则压缩会短路，用例退化为无效）。
  expect(detour.length).toBeGreaterThan(straight + 4);
  const improved = await router.compactRoutes(() => {}, message => { throw new PlannerCandidateError(message); });
  expect(improved).toBe(0);
  // 线路记录必须原样保留（修复前这里会因 removeChain 摘除后未还原而丢失）。
  expect(router.routes.map(route => route.cells)).toEqual(before.map(entry => entry.cells));
  // 压缩失败不得留下新增实体（修复前 connectCpu 写入的实体不会被回收）。
  expect(router.entities).toHaveLength(before[0]!.entities);
  // 回滚后占用索引与网格必须一致：同一线路在新 Router 里仍可被 reuse 复核通过。
  expect(new PlannerRouter(registry, wall, [from, to], boundaryWithWall).reuse(from, to, router.routes[0]!.cells,
    router.routes[0]!.minimumCells)).toBe(true);
});

// 预算取消在压缩内部的传播由 connectCpu 的 checkBudget 触发；本用例的短路不会进入压缩分支，
// 故不在此断言，避免依赖网格几何巧合。该分支在 candidate.test.ts 的真实任务预算路径上覆盖。
