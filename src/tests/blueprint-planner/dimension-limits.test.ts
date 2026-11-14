// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createRegistryContract } from "@/registry";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { resolvePlannerDimensionConstraint, matchesPlannerDimensionConstraint } from "@/shared/planner-dimension-limits";
import { partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { createPlainNode } from "@/blueprint-planner/placement";
import { validatePlannerTaskOptions, parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { PlannerWizardState } from "@/app/shell/blueprint-planner-wizard-state";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import fixture from "./fixtures/power-no-space.json";

const registry = createRegistryContract();
const base = fixture.request as BlueprintPlannerRequest;

it("边长和面积只接受正安全整数；停止阈值不改变约束身份，尺寸限制会改变", () => {
  for (const value of [0, -1, 0.5, Infinity, NaN, "12", null]) {
    expect(() => validatePlannerTaskOptions({ ...base.options, stopAreaBelow: value } as never)).toThrow();
    expect(() => validatePlannerTaskOptions({ ...base.options, dimensionLimits: { shortest: value } } as never)).toThrow();
    expect(() => validatePlannerTaskOptions({ ...base.options, dimensionLimits: { uShaped: { side: value } } } as never)).toThrow();
  }
  expect(plannerRequestKey({ ...base, options: { ...base.options, stopAreaBelow: 100 } })).toBe(plannerRequestKey(base));
  expect(plannerRequestKey({ ...base, options: { ...base.options, dimensionLimits: { shortest: 10 } } })).not.toBe(plannerRequestKey(base));
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

it("U 型限制约束完整边组合，不能把两种合法朝向的并集误当第三种方向", () => {
  const request = { ...base, options: { ...base.options, warehouseBus: "u-shaped" as const, dimensionLimits: { uShaped: { edge: 12, side: 30 } } } };
  expect(resolvePlannerDimensionConstraint(registry, request)).toEqual({ mode: "u-shaped", edge: 12, side: 30 });
  const nodes = Array.from({ length: 3 }, (_, index) => createPlainNode(registry, "unloader_1", `dock-${index}`, "supply"));
  const boundary = new PlannerBoundary(registry, { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 }, { width: 12, height: 30 });
  const north = boundary.proposals(0).find(pose => pose.y === 0 && pose.x === 3)!;
  const east = boundary.proposals(1).find(pose => pose.x === 11 && pose.y === 8)!;
  const south = boundary.proposals(2).find(pose => pose.y === 29 && pose.x === 3)!;
  const west = boundary.proposals(2).find(pose => pose.x === 0 && pose.y === 8)!;
  expect(boundary.resolve([north, east, west]).violations).toBe(0);
  expect(boundary.resolve([north, east, south]).violations).toBeGreaterThan(0);
  expect(boundary.resolve([north, east, south]).busMask).toBeNull();
});

it("界面各组尺寸与面积阈值进入任务选项，重开和复制任务恢复原值", () => {
  let options = base.options;
  const state = new PlannerWizardState(update => { options = { ...options, ...update }; });
  state.createDraft();
  state.draft.setDimension("straight", "edge", "12");
  state.draft.setDimension("u-shaped", "side", "28");
  state.draft.setDimension("shortest", "edge", "9");
  state.draft.setAreaBelow("280"); state.draft.setStopOnArea(true);
  const reopened = new PlannerWizardState(); reopened.selectTask("copy", JSON.parse(JSON.stringify(options)));
  expect(reopened.draft.dimensions).toEqual(state.draft.dimensions);
  expect(reopened.draft.stopOnArea).toBe(true); expect(reopened.draft.areaBelow).toBe("280");
  state.draft.setStopOnArea(false); expect(options.stopAreaBelow).toBeUndefined();
});

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
