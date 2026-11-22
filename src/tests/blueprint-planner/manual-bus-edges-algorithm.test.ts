// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { prepareManualLayout } from "@/blueprint-planner/manual-layout";
import { restorePlannerSeed, plannerRequestKey } from "@/blueprint-planner/search-seed";
import { parsePlannerTaskFile, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts, meetsProductionTargets } from "@/blueprint-planner/verification";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

const execution = new PlannerBatchSession();
afterAll(() => execution.dispose());
type Edge = "top" | "right" | "bottom" | "left";
type BusEdges = Readonly<Partial<Record<"base" | "left" | "right", Edge>>>;

async function requestFor(shape: "straight" | "corner" | "u-shaped", busEdges: BusEdges, free = false, assigned = true, absolute = false): Promise<BlueprintPlannerRequest> {
  const base = structuredClone(separator.request) as BlueprintPlannerRequest;
  const draft: BlueprintPlannerRequest = { ...base, options: { ...base.options, warehouseBus: shape,
    solidOutput: "warehouse", concurrency: 1, deterministicSearch: true, randomSeed: 85196838,
    evaluationsPerRound: 5_000, dimensionLimits: { exactBaseLength: 24, maxSideLength: 30 } },
    manualLayout: { enabled: true, mode: "recipe", orientation: free ? "free" : "fixed",
      boundary: { rotation: 0, position: absolute ? { base: 24, left: 0, right: null } : null, assignments: [], busEdges },
      facilities: [], placements: [], preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  const preparation = await prepareManualLayout(execution.workspace.registry, draft);
  const production = preparation.nodes.find(node => node.purpose === "production")!;
  const ports = preparation.nodes.filter(node => ["loader_1", "unloader_1"].includes(node.definitionId));
  expect(ports.length).toBeGreaterThanOrEqual(3);
  const current: BlueprintPlannerRequest = { ...draft, manualLayout: { ...draft.manualLayout!, preparation,
    placements: [{ referenceNode: production, position: { x: 9, y: 17 }, rotation: 0 }],
    boundary: { ...draft.manualLayout!.boundary, assignments: assigned ? ports.map((referenceNode, index) => ({ referenceNode,
      side: shape === "straight" || index === 0 ? "base" : shape === "corner" || index === 1 ? "left" : "right" })) : [] } } };
  return { ...current, manualLayout: { ...current.manualLayout!, preparation: await prepareManualLayout(execution.workspace.registry, current) } };
}

/** 从交付实体完整占地和实际物流端口朝向测量，不使用存取线角色解析函数。 */
function measure(candidate: PlannerCandidate) {
  const origin = candidate.outlineOrigin ?? { x: 0, y: 0 };
  return candidate.execution.blueprint.entityOrder.map(id => candidate.execution.blueprint.entities[id]!)
    .filter(entity => ["loader_1", "unloader_1"].includes(entity.definitionId)).map(entity => {
      const definition = execution.workspace.registry.queries.findEntityDefinition(entity.definitionId)!;
      const rect = resolveEntityGridRect({ entity, definition });
      const port = getPlannerPorts(execution.workspace.registry, entity, definition, entity.definitionId === "loader_1" ? "input" : "output")[0]!;
      const edge: Edge = ({ NORTH: "bottom", EAST: "left", SOUTH: "top", WEST: "right" } as const)[port.edge];
      expect(edge === "top" ? rect.y === origin.y : edge === "bottom" ? rect.y + rect.height === origin.y + candidate.metrics.height
        : edge === "left" ? rect.x === origin.x : rect.x + rect.width === origin.x + candidate.metrics.width).toBe(true);
      return { id: entity.id, edge };
    });
}

async function buildAndVerify(request: BlueprintPlannerRequest) {
  const candidate = await execution.planner.build(request, 0, 20_000,
    { targetOutline: { width: 24, height: 28 }, maxEvaluations: 5_000 });
  expect(execution.planner.threadId).toBeGreaterThan(0);
  expect(candidate.metrics).toMatchObject({ width: 24, height: 28 });
  assertPlannerCandidateBounds(execution.workspace.registry, candidate);
  assertPlannerWarehousePorts(execution.workspace.registry, request, candidate);
  const docks = measure(candidate);
  const manual = request.manualLayout!;
  const expected = { base: manual.boundary.busEdges?.base ?? "bottom", left: manual.boundary.busEdges?.left ?? "left", right: "right" };
  for (const assignment of manual.boundary.assignments) expect(docks.find(d => d.id === assignment.referenceNode.id)?.edge).toBe(expected[assignment.side]);
  const report = await execution.simulation.actions.runBlueprint(candidate.execution);
  expect(report.status).toBe("completed");
  expect(meetsProductionTargets(request, report), JSON.stringify(report.diagnostics)).toBe(true);
  const reloaded = JSON.parse(JSON.stringify(candidate)) as PlannerCandidate;
  assertPlannerWarehousePorts(execution.workspace.registry, request, reloaded);
  expect(measure(reloaded)).toEqual(docks);
  expect(() => restorePlannerSeed(execution.workspace.registry, request, reloaded.seed!)).not.toThrow();
  if (manual.boundary.assignments.length) {
    const seed = reloaded.seed!;
    const bad = { ...seed, network: { ...seed.network, nodes: seed.network.nodes.map(node => node.manualBoundaryReference
      ? { ...node, entity: { ...node.entity, definitionId: manual.placements[0]!.referenceNode.definitionId } } : node) } };
    expect(() => restorePlannerSeed(execution.workspace.registry, request, bad)).toThrow();
  }
  return { candidate, docks };
}

it.each(["top", "right", "bottom", "left"] as const)("直线%s：真实Worker交付保持世界24×28，横向精确24不转轴", async base => {
  const { docks } = await buildAndVerify(await requestFor("straight", { base }));
  expect(docks.every(d => d.edge === base)).toBe(true);
}, 30_000);

it.each(["top", "bottom"] as const)("L形横段%s：切换支段左右保持横段和逐口身份", async base => {
  const first = await requestFor("corner", { base, left: "left" });
  const second = await requestFor("corner", { base, left: "right" });
  expect(first.manualLayout!.boundary.assignments).toEqual(second.manualLayout!.boundary.assignments);
  const a = await buildAndVerify(first), b = await buildAndVerify(second);
  const baseIds = first.manualLayout!.boundary.assignments.filter(p => p.side === "base").map(p => p.referenceNode.id);
  for (const id of baseIds) expect([a.docks.find(d => d.id === id)!.edge, b.docks.find(d => d.id === id)!.edge]).toEqual([base, base]);
}, 60_000);

it("U形横段改顶：支段仍固定左右，绝对设备仍距世界底边3格", async () => {
  const request = await requestFor("u-shaped", { base: "top" }, false, true, true);
  const { candidate } = await buildAndVerify(request);
  const placement = request.manualLayout!.placements[0]!;
  const entity = candidate.execution.blueprint.entities[placement.referenceNode.id]!;
  const rect = resolveEntityGridRect({ entity, definition: execution.workspace.registry.queries.findEntityDefinition(entity.definitionId)! });
  expect((candidate.outlineOrigin?.y ?? 0) + candidate.metrics.height - rect.y - rect.height).toBe(3);
}, 30_000);

it.each([false, true])("直线右边且未指定口位，自由旋转%s：非默认方向保存种子保持语义", async free => {
  const request = await requestFor("straight", { base: "right" }, free, false);
  const { candidate, docks } = await buildAndVerify(request);
  expect(docks.every(d => d.edge === "right")).toBe(true);
  const changed = { ...request, manualLayout: { ...request.manualLayout!, boundary: { ...request.manualLayout!.boundary, busEdges: { base: "left" as const } } } };
  expect(plannerRequestKey(changed)).not.toBe(plannerRequestKey(request));
  expect(() => restorePlannerSeed(execution.workspace.registry, changed, candidate.seed!)).toThrow();
}, 30_000);


it("非南直线full-side：真实Host创建/调度、导入保持世界南baseSide及独立方向", async () => {
  const base = await requestFor("straight", { base: "right" });
  const draft = { ...base, options: { ...base.options, warehousePortPlacement: "full-side" as const,
    initialArea: 672, stopAfterFirstSolution: true } };
  const request = { ...draft, manualLayout: { ...draft.manualLayout!, preparation: await prepareManualLayout(execution.workspace.registry, draft) } };
  const files = new Map<string, BlueprintPlannerTaskFile>();
  const outlines: unknown[] = [];
  const worker: NonNullable<PlannerHostOptions["worker"]> = { build: async (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
    outlines.push(targetOutline);
    return execution.planner.build(input, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep,
      maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
  }, dispose: () => { /* 共享真实Worker由afterAll统一释放。 */ } };
  const host = createBlueprintPlannerHost(execution.workspace, { gpuLayout: false, worker, storage: {
    load: async () => [], save: async file => { files.set(file.taskId, structuredClone(file)); }, delete: async id => { files.delete(id); } } });
  try {
    await host.whenSettled();
    const id = await host.actions.createProductionTask(request);
    host.actions.continuePlanning(id, 20_000, 1, false);
    await host.whenSettled();
    const result = host.queries.getResult(id);
    const exported = host.queries.exportTask(id);
    expect(result, JSON.stringify({ outlines, progress: exported.progress })).not.toBeNull();
    const checkpoint = exported.checkpoint as { best: { candidate: PlannerCandidate } | null };
    expect(checkpoint.best).not.toBeNull();
    const candidate = checkpoint.best!.candidate;
    expect(candidate.search.outline.baseSide).toBe(2);
    expect(candidate.metrics.width).toBe(24);
    expect(measure(candidate).every(d => d.edge === "right")).toBe(true);
    const report = await execution.simulation.actions.runBlueprint(candidate.execution);
    expect(meetsProductionTargets(request, report)).toBe(true);
    const point = exported.checkpoint as PlannerCheckpoint;
    expect(point.parallel?.dimensionSchedule?.warehouseSides).toEqual([1]);
    const missingSides = { ...exported, checkpoint: { ...point, parallel: { ...point.parallel!,
      dimensionSchedule: { ...point.parallel!.dimensionSchedule!, warehouseSides: undefined } } } };
    expect(() => parsePlannerTaskFile(missingSides, execution.workspace.registry)).toThrow("非默认人工存取边缺少对应的尺寸调度身份");
    const imported = await host.actions.importTask(JSON.parse(JSON.stringify(exported)) as BlueprintPlannerTaskFile);
    const importedFile = host.queries.exportTask(imported);
    if (!("plan" in importedFile.request)) throw new Error("导入结果必须为生产任务。");
    expect(importedFile.request.manualLayout!.boundary.busEdges).toEqual({ base: "right" });
    const restored = importedFile.checkpoint as { best: { candidate: PlannerCandidate } | null };
    expect(restored.best).not.toBeNull();
    expect(measure(restored.best!.candidate).every(d => d.edge === "right")).toBe(true);
    expect(() => restorePlannerSeed(execution.workspace.registry, importedFile.request as BlueprintPlannerRequest, restored.best!.candidate.seed!)).not.toThrow();
  } finally { host.dispose(); await host.whenSettled(); }
}, 90_000);

it("默认边配置规范化等价，U形交换左右角色被拒绝", async () => {
  const explicit = await requestFor("straight", { base: "bottom" });
  const omitted = { ...explicit, manualLayout: { ...explicit.manualLayout!, boundary: { ...explicit.manualLayout!.boundary, busEdges: undefined } } };
  expect(plannerRequestKey(explicit)).toBe(plannerRequestKey(omitted));
  const u = await requestFor("u-shaped", { base: "top" });
  const invalid = { ...u, manualLayout: { ...u.manualLayout!, boundary: { ...u.manualLayout!.boundary,
    busEdges: { base: "top" as const, left: "right" as const, right: "left" as const } } } };
  expect(() => plannerRequestKey(invalid)).toThrow();
});
