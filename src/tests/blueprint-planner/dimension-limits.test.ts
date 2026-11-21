// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createRegistryContract } from "@/registry";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { canContainPlannerSpan, resolvePlannerDimensionConstraint, matchesPlannerDimensionConstraint } from "@/shared/planner-dimension-limits";
import { assertPlannerDimensionSchedule, plannerDimensionIdentity, PLANNER_DIMENSION_ATTEMPTS, partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { createPlainNode } from "@/blueprint-planner/placement";
import { validatePlannerTaskOptions, parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { capturePlannerSeed, restorePlannerSeed, plannerRequestKey } from "@/blueprint-planner/search-seed";
import { PlannerWizardState } from "@/app/shell/blueprint-planner-wizard-state";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import { manualLayoutSpace } from "@/blueprint-planner/manual-constraints";
import fixture from "./fixtures/power-no-space.json";

const registry = createRegistryContract();
const base = fixture.request as BlueprintPlannerRequest;

it("边长和面积只接受正安全整数；停止阈值不改变约束身份，尺寸限制会改变", () => {
  for (const value of [0, -1, 0.5, Infinity, NaN, "12", null]) {
    expect(() => validatePlannerTaskOptions({ ...base.options, stopAreaBelow: value } as never)).toThrow();
    // AI-REMOVED 2026-11-21:
    // Reason: 生产旧字段被明确忽略，不能再用其验证有效新轴的输入保护。
    // Trigger: 取消生产旧形态尺寸限制。Evidence: production normalization。
    // Replacement: 下方四轴非法值及旧值忽略断言。Risk: Low。Human Review: Required
    // Original code:
    // expect(() => validatePlannerTaskOptions({ ...base.options, dimensionLimits: { shortest: value } } as never)).toThrow();
    // expect(() => validatePlannerTaskOptions({ ...base.options, dimensionLimits: { uShaped: { side: value } } } as never)).toThrow();
    for (const key of ["maxBaseLength", "maxSideLength", "exactBaseLength", "exactSideLength"]) {
      expect(() => validatePlannerTaskOptions({ ...base.options, dimensionLimits: { [key]: value } } as never)).toThrow();
    }
    expect(() => validatePlannerTaskOptions({ ...base.options, dimensionLimits: { shortest: value, uShaped: { side: value } } } as never)).not.toThrow();
  }
  expect(plannerRequestKey({ ...base, options: { ...base.options, stopAreaBelow: 100 } })).toBe(plannerRequestKey(base));
// AI-REMOVED 2026-11-21:
// Reason: 生产约束身份由有效新轴改变，旧shortest不能继续改变身份。
// Trigger: 用户取消生产旧形态限制，生产仅使用当前四个轴字段。
// Evidence: shared production dimension normalization与新UI契约。
// Replacement: 下方新轴/旧值忽略断言；原图低层数学支持保持。Risk: Low。Human Review: Required
// Original code:
//   expect(plannerRequestKey({ ...base, options: { ...base.options, dimensionLimits: { shortest: 10 } } })).not.toBe(plannerRequestKey(base));
  expect(plannerRequestKey({ ...base, options: { ...base.options, dimensionLimits: { maxBaseLength: 10 } } })).not.toBe(plannerRequestKey(base));
  expect(plannerRequestKey({ ...base, options: { ...base.options, dimensionLimits: { shortest: 10 } } })).toBe(plannerRequestKey(base));
});

it("尺寸分片在合法边界生成，保留旋转后的方向，等于上限允许通过", () => {
  const limits = { mode: "straight" as const, edge: 10, side: 20 };
  const sizes = partitionPlannerDimensions(1000, { width: 3, height: 3 }, undefined, true, 0, limits).flat();
  expect(sizes.some(size => size.width === 10 && size.height === 20)).toBe(true);
  expect(sizes.some(size => size.width === 20 && size.height === 10)).toBe(true);
  expect(sizes.every(size => matchesPlannerDimensionConstraint(limits, size.width, size.height))).toBe(true);
  const short = partitionPlannerDimensions(4900, { width: 3, height: 3 }, undefined, true, 0, { mode: "shortest", edge: 8 }).flat();
  expect(short.some(size => size.width === 8 && size.height === 70)).toBe(true);
  expect(short.some(size => size.width === 70 && size.height === 8)).toBe(true);
  expect(short.every(size => Math.min(size.width, size.height) <= 8)).toBe(true);
  expect(partitionPlannerDimensions(1000, { width: 11, height: 11 }, undefined, true, 0, limits).flat()).toEqual([]);
});

it("U型布局底边固定南：南东西组合合法，北侧不能混入", () => {
// AI-REMOVED 2026-11-21:
// Reason: U形物理边组合继续受有效两轴限制，不能再使用已退休uShaped生产字段。
// Trigger: 用户取消生产旧形态限制，生产仅使用当前四个轴字段。
// Evidence: shared production dimension normalization与新UI契约。
// Replacement: 下方新轴/旧值忽略断言；原图低层数学支持保持。Risk: Low。Human Review: Required
// Original code:
//   const request = { ...base, options: { ...base.options, warehouseBus: "u-shaped" as const, dimensionLimits: { uShaped: { edge: 12, side: 30 } } } };
//   expect(resolvePlannerDimensionConstraint(registry, request)).toEqual({ mode: "u-shaped", edge: 12, side: 30 });
  const request = { ...base, options: { ...base.options, warehouseBus: "u-shaped" as const, dimensionLimits: { maxBaseLength: 12, maxSideLength: 30 } } };
  expect(resolvePlannerDimensionConstraint(registry, request)).toEqual({ mode: "axes", baseSide: 2, maxBaseLength: 12, maxSideLength: 30 });
  const nodes = Array.from({ length: 3 }, (_, index) => createPlainNode(registry, "unloader_1", `dock-${index}`, "supply"));
  const boundary = new PlannerBoundary(registry, { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 }, { width: 12, height: 30 });
  // 自动生成端已经剪掉北侧；用显式非法姿态独立复核最终拒绝，不能从合法提案里取北侧。
  expect(boundary.allowedSides(0)).toBe(14);
  expect(boundary.proposals(0).some(pose => pose.y === 0 && pose.x === 3)).toBe(false);
  const north = { x: 3, y: 0, rotation: 0 as const };
  const east = boundary.proposals(1).find(pose => pose.x === 11 && pose.y === 8)!;
  const south = boundary.proposals(2).find(pose => pose.y === 29 && pose.x === 3)!;
  const west = boundary.proposals(2).find(pose => pose.x === 0 && pose.y === 8)!;
  expect(boundary.resolve([south, east, west]).violations).toBe(0);
  expect(boundary.resolve([north, east, south]).violations).toBeGreaterThan(0);
  expect(boundary.resolve([north, east, south]).busMask).toBeNull();
});

it("生产两轴与面积阈值重开恢复，旧形态值仅原图草稿保留", () => {
  let options = base.options;
  const state = new PlannerWizardState(update => { options = { ...options, ...update }; });
  state.createDraft();
  state.draft.setAxisMode("base", "max"); state.draft.setAxisValue("base", "12");
  state.draft.setAxisMode("side", "max"); state.draft.setAxisValue("side", "28");
  state.draft.setAreaBelow("280"); state.draft.setStopOnArea(true);
  const reopened = new PlannerWizardState(); reopened.selectTask("copy", JSON.parse(JSON.stringify(options)));
  expect(reopened.draft.axisValue("base")).toBe("12"); expect(reopened.draft.axisValue("side")).toBe("28");
  expect(reopened.draft.stopOnArea).toBe(true); expect(reopened.draft.areaBelow).toBe("280");
  state.draft.setStopOnArea(false); expect(options.stopAreaBelow).toBeUndefined();
  const legacy = { ...base.options, dimensionLimits: { straight: { edge: 9 } } };
  reopened.draft.loadOptions(legacy); expect(reopened.draft.dimensions.straight.edge).toBe("");
  reopened.draft.loadOptions(legacy, true); expect(reopened.draft.dimensions.straight.edge).toBe("9");
});
// AI-REMOVED 2026-11-21: Reason: 生产旧形态限制视为未填写，仅原图保留。Trigger: 用户订正。
// Evidence: loadOptions生产默认忽略旧值。Replacement: 上方两轴及原图隔离用例。
// Risk: Low。Human Review: Required
// Original code:
// it("界面各组尺寸与面积阈值进入任务选项，重开和复制任务恢复原值", () => {
//   let options = base.options;
//   const state = new PlannerWizardState(update => { options = { ...options, ...update }; });
//   state.createDraft();
//   state.draft.setDimension("straight", "edge", "12");
//   state.draft.setDimension("u-shaped", "side", "28");
//   state.draft.setDimension("shortest", "edge", "9");
//   state.draft.setAreaBelow("280"); state.draft.setStopOnArea(true);
//   const reopened = new PlannerWizardState(); reopened.selectTask("copy", JSON.parse(JSON.stringify(options)));
//   expect(reopened.draft.dimensions).toEqual(state.draft.dimensions);
//   expect(reopened.draft.stopOnArea).toBe(true); expect(reopened.draft.areaBelow).toBe("280");
//   state.draft.setStopOnArea(false); expect(options.stopAreaBelow).toBeUndefined();
// });

it("真实 Host 在正式验收面积严格低于阈值后停止，导出恢复不再派发搜索", async () => {
  const session = new PlannerBatchSession(), clients: NodePlannerClient[] = [];
  const factory: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
    const client = new NodePlannerClient(); clients.push(client);
    return { build: (request, variant, budgetMs, evaluations, signal, update, seed,
      continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      void [originSeed, sessionKey];
      return client.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, attemptStrategy }, update, signal);
    }, dispose: () => { void client.dispose(); } };
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: factory(), workerFactory: factory });
  try {
    const request = { ...structuredClone(base), options: { ...base.options, concurrency: 2, gpu: false,
      randomSeed: 1928356741, initialArea: 200, evaluationsPerRound: 100_000, deterministicSearch: true,
      stopAfterFirstSolution: false, stopAreaBelow: 201 } };
    const id = await host.actions.importTask(host.queries.exportDraft(request));
    host.actions.continuePlanning(id, 100_000);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 60_000, interval: 20 });
    const file = parsePlannerTaskFile(host.queries.exportTask(id), registry);
    expect(file.checkpoint.result).not.toBeNull();
    expect(file.checkpoint.result!.metrics.area).toBeLessThan(201);
    expect(file.progress.evaluatedProposals).toBeLessThan(100_000);
    expect(file.progress.message).toContain("面积小于 201");
    const count = file.progress.evaluatedProposals;
    const restored = await host.actions.importTask(file);
    host.actions.continuePlanning(restored, 100_000);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 60_000, interval: 20 });
    expect(host.queries.getTask(restored)!.evaluatedProposals).toBe(count);
    const equal = { ...file, request: { ...file.request, options: { ...file.request.options, stopAreaBelow: file.checkpoint.result!.metrics.area } } };
    const equalId = await host.actions.importTask(equal);
    host.actions.continuePlanning(equalId, 10_000);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 60_000, interval: 20 });
    const completed = host.queries.getTask(equalId)!;
    // 检查点中已有的候选可直接进入正式验收，继续计算不保证新增布局提案。
    expect(completed.evaluatedProposals).toBeGreaterThanOrEqual(count);
    expect(completed.validatedCandidateCount).toBeGreaterThan(file.progress.validatedCandidateCount);
    expect(completed.bestArea).toBeLessThan(equal.request.options.stopAreaBelow);
  } finally {
    host.dispose(); await Promise.all(clients.map(client => client.dispose()));
    await host.whenSettled(); await session.dispose();
  }
}, 90_000);

it("生产L形只遵守新轴，原图低层U边/侧数学仍不能拿另一轴冒充方向", () => {
// AI-REMOVED 2026-11-21:
// Reason: 原shortest8不再约束生产，使用显式新maxSide8保持原硬边界正反验证，并证明极严旧shortest1被忽略。
// Trigger: 用户取消生产旧形态限制，生产仅使用当前四个轴字段。
// Evidence: shared production dimension normalization与新UI契约。
// Replacement: 下方新轴/旧值忽略断言；原图低层数学支持保持。Risk: Low。Human Review: Required
// Original code:
//   const corner = { ...base, options: { ...base.options, warehouseBus: "corner" as const,
//     dimensionLimits: { shortest: 8, exactBaseLength: 24 } } };
//   const shortest = resolvePlannerDimensionConstraint(registry, corner)!;
//   expect(shortest).toMatchObject({ mode: "shortest", edge: 8, exactBaseLength: 24 });
  const corner = { ...base, options: { ...base.options, warehouseBus: "corner" as const,
    dimensionLimits: { shortest: 1, exactBaseLength: 24, maxSideLength: 8 } } };
  const shortest = resolvePlannerDimensionConstraint(registry, corner)!;
  expect(shortest).toEqual({ mode: "axes", baseSide: 2, maxSideLength: 8, exactBaseLength: 24 });
  const retiredOnly = { ...corner, options: { ...corner.options, dimensionLimits: { shortest: 1 } } };
  expect(resolvePlannerDimensionConstraint(registry, retiredOnly)).toEqual({ mode: "axes", baseSide: 2 });
  expect(matchesPlannerDimensionConstraint(shortest, 24, 8, 2)).toBe(true);
  expect(matchesPlannerDimensionConstraint(shortest, 24, 9, 2)).toBe(false);
  expect(matchesPlannerDimensionConstraint(shortest, 8, 24, 2)).toBe(false);
  expect(matchesPlannerDimensionConstraint(shortest, 8, 24, 1)).toBe(false);
  const limits = { mode: "u-shaped" as const, edge: 30, side: 12, exactBaseLength: 24 };
  expect(matchesPlannerDimensionConstraint(limits, 24, 12, 2)).toBe(true);
  expect(matchesPlannerDimensionConstraint(limits, 24, 13, 2)).toBe(false);
  expect(matchesPlannerDimensionConstraint(limits, 12, 24, 1)).toBe(true);
  expect(matchesPlannerDimensionConstraint(limits, 12, 24, 2)).toBe(false);
  expect(partitionPlannerDimensions(1000, { width: 3, height: 3 }, undefined, true, 0,
    { ...limits, edge: 20 }).flat()).toHaveLength(0);
});

it("精确底边分片方向有独立单元身份，JSON恢复与校验保留baseSide", () => {
  const limits = { mode: "shortest" as const, edge: 8, exactBaseLength: 24 };
  const dimensions = partitionPlannerDimensions(192, { width: 3, height: 3 }, undefined, true, 0, limits);
  const shapes = dimensions.flat();
  expect(shapes.length).toBeGreaterThan(0);
  expect(shapes.every(shape => shape.baseSide !== undefined
    && matchesPlannerDimensionConstraint(limits, shape.width, shape.height, shape.baseSide))).toBe(true);
  expect(new Set(shapes.map(shape => shape.baseSide))).toEqual(new Set([0, 1, 2, 3]));
  const north = shapes.find(shape => shape.baseSide === 0)!, south = shapes.find(shape => shape.baseSide === 2)!;
  expect(plannerDimensionIdentity(north)).not.toBe(plannerDimensionIdentity(south));
  const saved = JSON.parse(JSON.stringify({ schedule: { targetArea: 192, minimum: { width: 3, height: 3 }, inclusive: true,
    limits, generation: 0, attemptsPerTask: PLANNER_DIMENSION_ATTEMPTS }, shards: dimensions.map(values => ({ dimensions: values, dimensionCursor: 0 })) }));
  expect(() => assertPlannerDimensionSchedule(saved.schedule, saved.shards)).not.toThrow();
  saved.shards[0].dimensions[0].baseSide = (saved.shards[0].dimensions[0].baseSide + 1) % 4;
  expect(() => assertPlannerDimensionSchedule(saved.schedule, saved.shards)).toThrow("分片尺寸");
});

it("全自动种子持久化精确底边方向，篡改为另一轴方向时拒绝恢复", () => {
  const request = { ...base, options: { ...base.options, dimensionLimits: { exactBaseLength: 24 } } };
  const network: PlannerNetwork = { request, nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: 0, baseSide: 2 };
  const seed = JSON.parse(JSON.stringify(capturePlannerSeed(request, network, [], [], 24, 12)));
  expect(restorePlannerSeed(registry, request, seed).network.baseSide).toBe(2);
  seed.network.baseSide = 1;
  expect(() => restorePlannerSeed(registry, request, seed)).toThrow("布局底边必须位于下方");
});

it("单侧位置与全局精确长度派生真实对侧，纵深保持开放且不改位置草稿", () => {
  const manualLayout = { enabled: true, mode: "recipe" as const, orientation: "fixed" as const,
    boundary: { rotation: 90 as const, position: { base: 16, left: 0, right: null }, assignments: [] }, facilities: [], placements: [],
    preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
  const request = { ...base, manualLayout, options: { ...base.options, dimensionLimits: { exactBaseLength: 24 } } };
  expect(manualLayoutSpace(request).areas[0]!.bounds).toEqual({ minX: -16, maxX: null, minY: 0, maxY: 24 });
  expect(request.manualLayout.boundary.position.right).toBeNull();
});


it("人工设备跨度只作可扩展外框下界，不要求本身达到精确底边", () => {
  const limits = { mode: "straight" as const, exactBaseLength: 24, edge: 28, side: 30 };
  expect(canContainPlannerSpan(limits, 6, 4, 2)).toBe(true);
  expect(canContainPlannerSpan(limits, 4, 6, 1)).toBe(true);
  expect(canContainPlannerSpan(limits, 25, 4, 2)).toBe(false);
  expect(canContainPlannerSpan(limits, 4, 25, 1)).toBe(false);
  expect(canContainPlannerSpan(limits, 6, 31, 2)).toBe(false);
});
