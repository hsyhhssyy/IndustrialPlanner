// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { validatePlannerTaskOptions, validateTaskRequest, parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { assertPlannerDimensionSchedule, partitionPlannerDimensions, plannerDimensionIdentity, PLANNER_DIMENSION_ATTEMPTS, findNextPlannerDimensionIndex } from "@/blueprint-planner/dimension-schedule";
import { resolvePlannerDimensionConstraint, matchesPlannerDimensionConstraint } from "@/shared/planner-dimension-limits";
import { manualLayoutSpace } from "@/blueprint-planner/manual-constraints";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

const registry = createRegistryContract(), source = structuredClone(separator.request) as BlueprintPlannerRequest;
type Limits = NonNullable<BlueprintPlannerRequest["options"]["dimensionLimits"]>;
const request = (limits: Limits): BlueprintPlannerRequest => ({ ...source, manualLayout: undefined,
  options: { ...source.options, warehouseBus: "corner", evaluationsPerRound: 5_000, dimensionLimits: limits } });

it.each(["maxBaseLength", "maxSideLength", "exactBaseLength", "exactSideLength"] as const)("%s只接受正安全整数，精确尺寸不能超过现有70格能力", field => {
  for (const value of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "12", null]) {
    expect(() => validatePlannerTaskOptions({ ...source.options, dimensionLimits: { [field]: value } } as never)).toThrow();
  }
  expect(() => validatePlannerTaskOptions(request({ [field]: 12 }).options)).not.toThrow();
  if (field.startsWith("exact")) expect(() => validatePlannerTaskOptions(request({ [field]: 71 }).options)).toThrow();
});

it.each([
  {}, { maxBaseLength: 24 }, { maxSideLength: 12 }, { exactBaseLength: 24 }, { exactSideLength: 12 },
  { maxBaseLength: 24, maxSideLength: 12 }, { maxBaseLength: 24, exactSideLength: 12 }, { exactBaseLength: 24, maxSideLength: 12 },
])("八个合法模式可以经过真实任务请求校验：%j", limits => {
  expect(() => validatePlannerTaskOptions(request(limits).options)).not.toThrow();
  expect(() => validateTaskRequest(registry, request(limits))).not.toThrow();
});

it.each([
  { exactBaseLength: 24, exactSideLength: 12 },
  { maxBaseLength: 24, exactBaseLength: 24 },
  { maxSideLength: 12, exactSideLength: 12 },
])("双精确或同轴双重模式在任务选项入口明确拒绝：%j", limits => {
  expect(() => validatePlannerTaskOptions(request(limits).options)).toThrow(/精确|最大/);
});

it("绝对双侧位置隐含精确底边，不能借不填exactBase字段绕过双精确拒绝", () => {
  const current: BlueprintPlannerRequest = { ...request({ exactSideLength: 12 }), manualLayout: { enabled: true, mode: "recipe", orientation: "fixed",
    boundary: { rotation: 0, position: { base: 16, left: 0, right: 24 }, assignments: [] }, placements: [], facilities: [],
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  expect(() => validateTaskRequest(registry, current)).toThrow(/双侧|精确/);
  expect(() => validateTaskRequest(registry, { ...current, manualLayout: { ...current.manualLayout!, enabled: false } })).not.toThrow();
});

it("新直角独立轴不再用shortest，24×10/24×13/10×24按固定实际轴正反判断", () => {
  const current = request({ exactBaseLength: 24, maxSideLength: 12 });
  const limits = resolvePlannerDimensionConstraint(registry, current)!;
  expect(limits).toMatchObject({ exactBaseLength: 24, maxSideLength: 12 });
  expect(limits.mode).toBe("axes");
  expect(matchesPlannerDimensionConstraint(limits, 24, 10, 2)).toBe(true);
  expect(matchesPlannerDimensionConstraint(limits, 24, 13, 2)).toBe(false);
  expect(matchesPlannerDimensionConstraint(limits, 10, 24, 2)).toBe(false);
  expect(matchesPlannerDimensionConstraint(limits, 10, 24, 1)).toBe(false);
});

it.each([
  { rotation: 0, bounds: { minX: 0, maxX: null, minY: 4, maxY: 16 } },
  { rotation: 90, bounds: { minX: -16, maxX: -4, minY: 0, maxY: null } },
  { rotation: 180, bounds: { minX: null, maxX: -0, minY: -16, maxY: -4 } },
  { rotation: 270, bounds: { minX: 4, maxX: 16, minY: null, maxY: -0 } },
] as const)("侧边精确12在$rotation方向生成真实对边，max12不冒充精确边", ({ rotation, bounds }) => {
  const manualLayout: NonNullable<BlueprintPlannerRequest["manualLayout"]> = { enabled: true, mode: "recipe", orientation: "fixed",
    boundary: { rotation, position: { base: 16, left: 0, right: null }, assignments: [] }, placements: [], facilities: [],
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
  const exact = { ...request({ exactSideLength: 12 }), manualLayout };
  expect(manualLayoutSpace(exact).areas[0]!.bounds).toEqual(bounds);
  const maximum = manualLayoutSpace({ ...request({ maxSideLength: 12 }), manualLayout }).areas[0]!.bounds;
  expect(Object.values(maximum).filter(value => value !== null)).toHaveLength(2);
  expect(manualLayout.boundary.position).toEqual({ base: 16, left: 0, right: null });
});

it.each([
  { name: "exactSide", limits: { mode: "axes", maxBaseLength: 10, exactSideLength: 12 }, depth: 12 },
  { name: "maxSide", limits: { mode: "axes", maxBaseLength: 10, maxSideLength: 9 }, depth: 9 },
] as const)("straight+full-side/$name：面积允许更深仍派发横纵两个方向的合规较小纵深", ({ limits, depth }) => {
  // 6格取货口+1个2格存货口使整边精确8格，面积800可容纳70格纵深，必须按独立side约束降到12/9。
  const ports = { pickupLength: 6, storageLength: 2, fixedStorageCount: 1, automatic: [] };
  const shards = partitionPlannerDimensions(800, { width: 3, height: 3 }, ports, true, 0, limits);
  const shapes = shards.flat(); expect(shapes.length).toBeGreaterThan(0);
  expect(new Set(shapes.map(shape => shape.warehouseSide))).toEqual(new Set([0, 1, 2, 3]));
  for (const shape of shapes) {
    expect(shape.baseSide).toBe(shape.warehouseSide);
    expect(shape.baseSide! % 2 === 0 ? shape.width : shape.height).toBe(8);
    expect(shape.baseSide! % 2 === 0 ? shape.height : shape.width).toBe(depth);
  }
  const schedule = { targetArea: 800, minimum: { width: 3, height: 3 }, warehousePorts: ports, inclusive: true,
    limits, generation: 0, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS };
  expect(() => assertPlannerDimensionSchedule(schedule, shards.map(dimensions => ({ dimensions, dimensionCursor: 0 })))).not.toThrow();
});

it("生产布局底边固定南：侧边精确12只保留横向前沿，不派发旋转轴，身份唯一", () => {
  const limits = resolvePlannerDimensionConstraint(registry, request({ maxBaseLength: 28, exactSideLength: 12 }))!;
  const shards = partitionPlannerDimensions(1000, { width: 3, height: 3 }, undefined, true, 0, limits), dimensions = shards.flat();
  expect(dimensions.some(shape => shape.width === 12 && shape.height === 12 && shape.baseSide === 2)).toBe(true);
  expect(dimensions.length).toBeGreaterThan(0);
  expect(dimensions.every(shape => shape.height === 12 && shape.width <= 28 && shape.baseSide === 2)).toBe(true);
  for (const shard of shards) expect(new Set(shard.map(plannerDimensionIdentity)).size).toBe(shard.length);
  const saved = JSON.parse(JSON.stringify({ schedule: { targetArea: 1000, minimum: { width: 3, height: 3 }, inclusive: true,
    limits, generation: 0, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS }, shards: shards.map(dimensions => ({ dimensions, dimensionCursor: 0 })) }));
  expect(() => assertPlannerDimensionSchedule(saved.schedule, saved.shards)).not.toThrow();
});

it("side-exact与max-only种子恢复按实际轴校验，另一轴碰巧满足不能冒充", () => {
  for (const limits of [{ maxBaseLength: 28, exactSideLength: 12 }, { maxBaseLength: 28, maxSideLength: 12 }]) {
    const current = request(limits), network: PlannerNetwork = { request: current, nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: 0, baseSide: 2 };
    const seed = JSON.parse(JSON.stringify(capturePlannerSeed(current, network, [], [], 24, 12)));
    expect(restorePlannerSeed(registry, current, seed).network.baseSide).toBe(2);
    seed.network.baseSide = 1;
    expect(() => restorePlannerSeed(registry, current, seed)).toThrow();
  }
});

// AI-REMOVED 2026-11-21:
// Reason: 旧生产限制已明确取消，历史原文进入真实import后不能继续按交集限轴；新字段硬上限仍保留。
// Trigger: 用户取消生产旧形态限制，生产仅使用当前四个轴字段。
// Evidence: shared production dimension normalization与新UI契约。
// Replacement: 下方新轴/旧值忽略断言；原图低层数学支持保持。Risk: Low。Human Review: Required
// Original code:
// it("旧straight/U/shortest尺寸数据经真实Host导入解析不丢失、不猜轴，新旧并存按交集执行", async () => {
//   const batch = new PlannerBatchSession(), host = createBlueprintPlannerHost(batch.workspace, { storage: null, gpuLayout: false });
//   const legacy: readonly { shape: BlueprintPlannerRequest["options"]["warehouseBus"]; limits: Limits; expected: unknown }[] = [
//     { shape: "straight", limits: { straight: { edge: 24, side: 12 } }, expected: { mode: "straight", edge: 24, side: 12 } },
//     { shape: "u-shaped", limits: { uShaped: { edge: 24, side: 12 } }, expected: { mode: "u-shaped", edge: 24, side: 12 } },
//     { shape: "corner", limits: { shortest: 9 }, expected: { mode: "shortest", edge: 9 } },
//   ];
//   try {
//     await host.whenSettled();
//     for (const item of legacy) {
//       const old: BlueprintPlannerRequest = { ...request(item.limits), options: { ...request(item.limits).options, warehouseBus: item.shape } };
//       const raw = host.queries.exportDraft(old), id = await host.actions.importTask(JSON.parse(JSON.stringify(raw)));
//       const restored = parsePlannerTaskFile(JSON.parse(JSON.stringify(host.queries.exportTask(id))), registry);
//       expect(restored.request.options.dimensionLimits).toEqual(item.limits);
//       expect(resolvePlannerDimensionConstraint(registry, restored.request)).toEqual(item.expected);
//     }
//     const intersected = resolvePlannerDimensionConstraint(registry, request({ shortest: 9, maxBaseLength: 24, maxSideLength: 12 }))!;
//     expect(matchesPlannerDimensionConstraint(intersected, 24, 9, 2)).toBe(true);
//     expect(matchesPlannerDimensionConstraint(intersected, 24, 10, 2)).toBe(false);
//   } finally { host.dispose(); await host.whenSettled(); await batch.dispose(); }
// });
it("生产旧straight/U/shortest经真实原始任务导入全部忽略，仅有效四轴保留", async () => {
  const batch = new PlannerBatchSession(), host = createBlueprintPlannerHost(batch.workspace, { storage: null, gpuLayout: false });
  const legacy: readonly { shape: BlueprintPlannerRequest["options"]["warehouseBus"]; limits: Limits }[] = [
    { shape: "straight", limits: { straight: { edge: 1, side: 1 } } },
    { shape: "u-shaped", limits: { uShaped: { edge: 1, side: 1 } } },
    { shape: "corner", limits: { shortest: 1 } },
  ];
  try {
    await host.whenSettled();
    for (const item of legacy) {
      const clean: BlueprintPlannerRequest = { ...request({}), options: { ...request({}).options, warehouseBus: item.shape } };
      // 在导出当前文件后填入历史原始字段，避免exportDraft已规范化导致假通过。
      const draft = host.queries.exportDraft(clean);
      if (!("plan" in draft.request)) throw new Error("此夹具必须是生产任务。");
      const raw = { ...draft, request: { ...draft.request, options: { ...draft.request.options, dimensionLimits: item.limits } } };
      const id = await host.actions.importTask(JSON.parse(JSON.stringify(raw)));
      const restored = parsePlannerTaskFile(JSON.parse(JSON.stringify(host.queries.exportTask(id))), registry);
      expect(restored.request.options.dimensionLimits).toBeUndefined();
      expect(resolvePlannerDimensionConstraint(registry, restored.request)).toEqual({ mode: "axes", baseSide: 2 });
    }
    const mixed = resolvePlannerDimensionConstraint(registry, request({ shortest: 1, maxBaseLength: 24, maxSideLength: 12 }))!;
    expect(mixed).toEqual({ mode: "axes", baseSide: 2, maxBaseLength: 24, maxSideLength: 12 });
    expect(matchesPlannerDimensionConstraint(mixed, 24, 10, 2)).toBe(true);
    expect(matchesPlannerDimensionConstraint(mixed, 24, 13, 2)).toBe(false);
  } finally { host.dispose(); await host.whenSettled(); await batch.dispose(); }
});


it("生产claim的环形查找跳过B到C，不回0饿死后继；C之后才回A，全拒绝正常返回空", () => {
  const dimensions = [{ width: 9, height: 12 }, { width: 8, height: 12 }, { width: 10, height: 12 }];
  const visits: number[] = [];
  const accepts = (dimension: typeof dimensions[number]) => { visits.push(dimension.width); return dimension.width >= 9; };
  expect(findNextPlannerDimensionIndex(dimensions, 1, accepts)).toBe(2);
  expect(visits).toEqual([8, 10]);
  visits.length = 0;
  expect(findNextPlannerDimensionIndex(dimensions, 3, accepts)).toBe(0);
  expect(visits).toEqual([9]);
  visits.length = 0;
  expect(findNextPlannerDimensionIndex(dimensions, 1, dimension => { visits.push(dimension.width); return false; })).toBeUndefined();
  expect(visits).toEqual([8, 10, 9]);
  expect(findNextPlannerDimensionIndex([], 0, accepts)).toBeUndefined();
});
