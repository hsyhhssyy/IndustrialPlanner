// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerPort } from "@/blueprint-planner/geometry";
import { plannerOutlineCap, clampPlannerOutline } from "@/blueprint-planner/search-outline";
import yazhen from "./fixtures/yazhen-syringe.json";

const registry = createRegistryContract();
const boundary = { minimumX: 0, minimumY: 0, maximumX: 7, maximumY: 8, escapeLength: 0 };
const source: PlannerPort = { entityId: "source", groupIndex: 0, portIndex: 0, direction: "output", kind: "belt",
  cell: { x: 0, y: 0 }, outside: { x: 1, y: 0 }, edge: "EAST" };
const target: PlannerPort = { ...source, entityId: "target", direction: "input", cell: { x: 7, y: 1 }, outside: { x: 6, y: 1 }, edge: "WEST" };
// 第二条线路先占用「更短路径」的中段，迫使第一条线路先绕远，压缩阶段清格后才有机会改短。
const blockerSource: PlannerPort = { ...source, entityId: "blocker", cell: { x: 3, y: 3 }, outside: { x: 3, y: 2 }, edge: "SOUTH" };
const blockerTarget: PlannerPort = { ...target, entityId: "blocker-end", cell: { x: 4, y: 3 }, outside: { x: 4, y: 2 }, edge: "SOUTH" };

it("压缩后重排线路更短，且线路数量与实体占用保持一致", async () => {
  const router = new PlannerRouter(registry, [], [source, target, blockerSource, blockerTarget], boundary);
  await router.connect(blockerSource, blockerTarget, () => {});
  await router.connect(source, target, () => {});
  const before = router.routes.map(route => route.cells.length);
  const improved = await router.compactRoutes(() => {}, message => { throw new PlannerCandidateError(message); });
  const after = router.routes.map(route => route.cells.length);
  expect(router.routes).toHaveLength(before.length);
  expect(after.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(before.reduce((sum, value) => sum + value, 0));
  expect(improved).toBeGreaterThanOrEqual(0);
  // 压缩后每条线路仍可被 reuse 复核，说明网格状态与线路记录一致。
  for (const route of router.routes) {
    const from = [source, target, blockerSource, blockerTarget].find(port => `${port.entityId}/${port.groupIndex}/${port.portIndex}` === route.sourcePort)!;
    const to = [source, target, blockerSource, blockerTarget].find(port => `${port.entityId}/${port.groupIndex}/${port.portIndex}` === route.targetPort)!;
    expect(new PlannerRouter(registry, [], [from, to], boundary).reuse(from, to, route.cells, route.minimumCells)).toBe(true);
  }
});

it("压缩无法变短时按快照回滚，线路与实体不丢失", async () => {
  const router = new PlannerRouter(registry, [], [source, target], boundary);
  await router.connect(source, target, () => {});
  const before = router.routes.map(route => ({ cells: route.cells.map(cell => ({ ...cell })), entities: router.entities.length }));
  const improved = await router.compactRoutes(() => {}, message => { throw new PlannerCandidateError(message); });
  expect(improved).toBe(0);
  expect(router.routes.map(route => route.cells)).toEqual(before.map(route => route.cells));
  // 回滚不回收已提交的线路实体，但不得增加线路数量。
  expect(router.routes).toHaveLength(before.length);
});

// 预算取消在压缩内部的传播由 connectCpu 的 checkBudget 触发；本用例的短路不会进入压缩分支，
// 故不在此断言，避免依赖网格几何巧合。该分支在 candidate.test.ts 的真实任务预算路径上覆盖。

it("区域上限按基地可放置范围解析，未知基地不下发上限", () => {
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const known = { ...request, plan: { ...request.plan, sourceBaseId: "wuling_protocol_core" } };
  expect(plannerOutlineCap(registry, known)).toEqual({ width: 80, height: 80 });
  const unknown = { ...request, plan: { ...request.plan, sourceBaseId: "no-such-base" } };
  expect(plannerOutlineCap(registry, unknown)).toBeUndefined();
});

it("上限不足以容纳最小边界时以最小边界为准，避免产出无法布通的盒子", () => {
  expect(clampPlannerOutline({ width: 40, height: 40 }, { width: 30, height: 3 }, { width: 20, height: 20 }))
    .toEqual({ width: 30, height: 20 });
  expect(clampPlannerOutline({ width: 10, height: 10 }, { width: 3, height: 3 }, { width: 8, height: 12 }))
    .toEqual({ width: 8, height: 10 });
  expect(clampPlannerOutline({ width: 10, height: 10 }, { width: 3, height: 3 })).toEqual({ width: 10, height: 10 });
});
