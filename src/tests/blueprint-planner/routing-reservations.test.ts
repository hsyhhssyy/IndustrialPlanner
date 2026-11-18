// @vitest-environment node
// 2026-10-21：系统胶囊图的八个桥接格位于其他线路端点，端点预留不能封锁垂直直穿。
// 依据：.docs/common/eda/算法探索/算法探索20261021-系统胶囊蓝图与生产网络搜索空间.md
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { PlannerRouter } from "@/blueprint-planner/router";
import { findLogisticsDevice, type PlannerPort } from "@/blueprint-planner/geometry";

const registry = createRegistryContract();
const bounds = { minimumX: 0, minimumY: 0, maximumX: 4, maximumY: 4, escapeLength: 0 };
const horizontalSource: PlannerPort = { entityId: "horizontal-source", groupIndex: 0, portIndex: 0,
  direction: "output", kind: "belt", cell: { x: -1, y: 2 }, outside: { x: 0, y: 2 }, edge: "EAST" };
const horizontalTarget: PlannerPort = { ...horizontalSource, entityId: "horizontal-target", direction: "input",
  cell: { x: 5, y: 2 }, outside: { x: 4, y: 2 }, edge: "WEST" };
const verticalSource: PlannerPort = { ...horizontalSource, entityId: "vertical-source",
  cell: { x: 2, y: 1 }, outside: { x: 2, y: 2 }, edge: "SOUTH" };
const verticalTarget: PlannerPort = { ...horizontalTarget, entityId: "vertical-target",
  cell: { x: 2, y: 4 }, outside: { x: 2, y: 3 }, edge: "NORTH" };
const horizontalCells = [0, 1, 2, 3, 4].map(x => ({ x, y: 2 }));
const verticalCells = [{ x: 2, y: 2 }, { x: 2, y: 3 }];

for (const kind of ["belt", "pipe"] as const) {
  it.each([false, true])(`${kind} 允许直线通过另一线路端点，反向提交顺序为 %s`, async reversed => {
    const [from, to, crossFrom, crossTo] = [horizontalSource, horizontalTarget, verticalSource, verticalTarget]
      .map(port => ({ ...port, kind })) as [PlannerPort, PlannerPort, PlannerPort, PlannerPort];
    const pairs = [{ source: from, target: to, cells: horizontalCells }, { source: crossFrom, target: crossTo, cells: verticalCells }];
    if (reversed) pairs.reverse();
    const replay = new PlannerRouter(registry, [], [from, to, crossFrom, crossTo], bounds);
    const search = new PlannerRouter(registry, [], [from, to, crossFrom, crossTo], bounds);
    for (const pair of pairs) {
      expect(replay.reuse(pair.source, pair.target, pair.cells)).toBe(true);
      expect(await search.connect(pair.source, pair.target, () => {})).toBe(pair.cells.length);
    }
    for (const router of [replay, search]) {
      expect(router.routes).toHaveLength(2);
      expect(router.entities.find(entity => entity.position.x === 2 && entity.position.y === 2)?.definitionId)
        .toBe(findLogisticsDevice(registry, kind, "connector").id);
    }
  });
}

it("预留轴不能被其他线路顺向占用，垂直经过也不能在该格转弯", () => {
  const parallelPin: PlannerPort = { ...horizontalSource, entityId: "reserved-parallel",
    cell: { x: 1, y: 2 }, outside: { x: 2, y: 2 } };
  const parallel = new PlannerRouter(registry, [], [horizontalSource, horizontalTarget, parallelPin], bounds);
  expect(parallel.reuse(horizontalSource, horizontalTarget, horizontalCells)).toBe(false);
  expect(parallel.entities).toHaveLength(0);
  const turnTarget: PlannerPort = { ...verticalTarget, entityId: "turn-target",
    cell: { x: 2, y: -1 }, outside: { x: 2, y: 0 }, edge: "SOUTH" };
  const corner = new PlannerRouter(registry, [], [horizontalSource, turnTarget, verticalSource], bounds);
  expect(corner.reuse(horizontalSource, turnTarget, [
    { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 0 },
  ])).toBe(false);
  expect(corner.entities).toHaveLength(0);
});

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/tests/blueprint-planner/routing-reservations.test.ts 第 8 行：
// import { allowsPlannerReservationTransit, ROUTE_RESERVED, ROUTE_RESERVED_AXIS_SHIFT } from "@/blueprint-planner/routing-grid";
// 原文件 src/tests/blueprint-planner/routing-reservations.test.ts 第 22 行：
//
// // 2026-11-16：失败人工用例中两条线路共享端点外侧格，旧实现整格豁免，先布线路会转弯抢占另一轴。
// for (const kind of ["belt", "pipe"] as const) {
//   it.each([false, true])(`${kind} 共享端点仅释放本线路轴，共享点为终点 %s`, async atTarget => {
//     const start: PlannerPort = { ...verticalSource, kind };
//     const end: PlannerPort = { ...horizontalTarget, kind };
//     const pin: PlannerPort = { ...horizontalSource, kind, entityId: "crossing-pin",
//       cell: { x: 1, y: 2 }, outside: { x: 2, y: 2 } };
//     const from: PlannerPort = atTarget ? { ...end, direction: "output" } : start;
//     const to: PlannerPort = atTarget ? { ...start, direction: "input" } : end;
//     const illegal = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }];
//     if (atTarget) illegal.reverse();
//     const replay = new PlannerRouter(registry, [], [from, to, pin], bounds);
//     expect(replay.reuse(from, to, illegal)).toBe(false);
//     expect(replay.entities).toHaveLength(0);
//     const search = new PlannerRouter(registry, [], [from, to, pin], bounds);
//     await search.connect(from, to, () => {});
//     const route = search.routes[0]!.cells;
//     // 共享格必须沿竖轴直穿，允许离开该格后再拐弯。
//     expect(atTarget ? route.at(-2) : route[1]).toEqual({ x: 2, y: 3 });
//     expect(replay.reuse(from, to, route)).toBe(true);
//   });
//
//   it(`${kind} 同格两端属于同一线路时允许使用两端轴`, async () => {
//     const from: PlannerPort = { ...verticalSource, kind };
//     const to: PlannerPort = { ...horizontalTarget, kind,
//       cell: { x: 3, y: 2 }, outside: { x: 2, y: 2 } };
//     const router = new PlannerRouter(registry, [], [from, to], bounds);
//     expect(await router.connect(from, to, () => {})).toBe(1);
//     const replay = new PlannerRouter(registry, [], [from, to], bounds);
//     expect(replay.reuse(from, to, [{ x: 2, y: 2 }])).toBe(true);
//   });
// }
//
// it("端点豁免不能解除无轴信息预留，也不能解除正交线路的预留", () => {
//   expect(allowsPlannerReservationTransit(ROUTE_RESERVED, 0, 0, 3)).toBe(false);
//   const bothAxes = ROUTE_RESERVED | (3 << ROUTE_RESERVED_AXIS_SHIFT);
//   expect(allowsPlannerReservationTransit(bothAxes, 0, 0, 1)).toBe(true);
//   expect(allowsPlannerReservationTransit(bothAxes, 0, 1, 1)).toBe(false);
//   expect(allowsPlannerReservationTransit(bothAxes, 1, 1, 1)).toBe(false);
// });
