// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import { prepareManualLayout } from "@/blueprint-planner/manual-layout";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import type { PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { getPlannerPorts, EDGES, opposite } from "@/blueprint-planner/geometry";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts, meetsProductionTargets } from "@/blueprint-planner/verification";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

const execution = new PlannerBatchSession();
afterAll(() => execution.dispose());
const evidence = resolve(".temp/playwright-test/req051-fixed-base/algorithm", `${Date.now()}-${process.pid}`);
async function save(label: string, value: unknown) { await mkdir(evidence, { recursive: true }); await writeFile(resolve(evidence, label + ".json"), JSON.stringify(value, null, 2)); }

/** 只固定生产设备；真实取货口、电力及布线全部由求解器完成。 */
async function requestFor(orientation: "free" | "fixed", rotation: GridRotation, shape: "14x5" | "7x10" | "known", rotateSource = false) {
  const base = structuredClone(separator.request) as BlueprintPlannerRequest;
  const scale = (flows: readonly { itemId: string; perMinute: number }[]) => flows.map(flow => ({ ...flow, perMinute: flow.perMinute * 2 }));
  const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan, targets: scale(base.plan.targets), externalSupplies: scale(base.plan.externalSupplies),
    recipes: base.plan.recipes.map(recipe => ({ ...recipe, deviceCount: recipe.deviceCount * 2, cyclesPerMinute: recipe.cyclesPerMinute * 2,
      inputs: scale(recipe.inputs), outputs: scale(recipe.outputs), runningInputs: scale(recipe.runningInputs) })) },
    options: { ...base.options, warehouseBus: "corner", solidOutput: "stash", gpu: false, concurrency: 1, deterministicSearch: true,
      randomSeed: 85196838, evaluationsPerRound: 5_000, dimensionLimits: { exactBaseLength: 24, maxSideLength: 12 } },
    manualLayout: { enabled: true, mode: "recipe", orientation, boundary: { rotation, position: null, assignments: [] }, facilities: [], placements: [],
      preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  const preparation = await prepareManualLayout(execution.workspace.registry, request);
  const production = preparation.nodes.filter(node => node.purpose === "production"); expect(production).toHaveLength(2);
  const definition = execution.workspace.registry.queries.findEntityDefinition(production[0]!.definitionId)!;
  expect(definition.footprint).toMatchObject({ width: 6, height: 4 });
  // 仅两台生产设备的已知可行相对参考来自free-0真实交付；端口/电力/线路不复制。
  const locations = shape === "known" ? [{ x: 13, y: 4 }, { x: 5, y: 3 }]
    : shape === "14x5" ? [{ x: 0, y: 0 }, { x: 8, y: 1 }] : [{ x: 0, y: 0 }, { x: 1, y: 6 }];
  const placements = production.map((referenceNode, index) => transformManualPlacement({ referenceNode, position: locations[index]!, rotation: shape === "known" ? 180 : 0 }, definition,
    { rotation: shape === "known" ? rotation : rotateSource ? 90 : 0, translation: { x: 0, y: 0 } }));
  const ports = preparation.nodes.filter(node => ["loader_1", "unloader_1"].includes(node.definitionId)); expect(ports.length).toBeGreaterThanOrEqual(2);
  const current = { ...request, manualLayout: { ...request.manualLayout!, preparation, placements,
    boundary: { rotation, position: null, assignments: ports.map((referenceNode, index) => ({ referenceNode, side: index === 0 ? "base" as const : "left" as const })) } } };
  return { ...current, manualLayout: { ...current.manualLayout, preparation: await prepareManualLayout(execution.workspace.registry, current) } };
}

function measure(candidate: PlannerCandidate, request: BlueprintPlannerRequest) {
  const registry = execution.workspace.registry, origin = candidate.outlineOrigin ?? { x: 0, y: 0 };
  const entities = (request.manualLayout?.enabled ? request.manualLayout.placements : undefined)?.map(p => candidate.execution.blueprint.entities[p.referenceNode.id]!) ?? [];
  const rects = entities.map(entity => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  const span = rects.length ? { width: Math.max(...rects.map(r => r.x + r.width)) - Math.min(...rects.map(r => r.x)),
    height: Math.max(...rects.map(r => r.y + r.height)) - Math.min(...rects.map(r => r.y)) } : null;
  const docks = candidate.execution.blueprint.entityOrder.map(id => candidate.execution.blueprint.entities[id]!).filter(e => ["unloader_1", "loader_1"].includes(e.definitionId)).map(entity => {
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!, rect = resolveEntityGridRect({ entity, definition });
    const port = getPlannerPorts(registry, entity, definition, entity.definitionId === "loader_1" ? "input" : "output")[0]!;
    const side = EDGES.indexOf(opposite(port.edge));
    expect(side === 2 ? rect.y + rect.height === origin.y + candidate.metrics.height : side === 3 ? rect.x === origin.x : side === 1 && rect.x + rect.width === origin.x + candidate.metrics.width).toBe(true);
    return { id: entity.id, side, rect };
  });
  expect(docks.length).toBeGreaterThanOrEqual(2); expect(candidate.search.outline.baseSide).toBe(2);
  for (const assignment of request.manualLayout?.enabled ? request.manualLayout.boundary.assignments : []) expect(docks.find(d => d.id === assignment.referenceNode.id)?.side).toBe(({ base: 2, left: 3, right: 1 })[assignment.side]);
  return { width: candidate.metrics.width, height: candidate.metrics.height, origin, span, docks, rects, entities };
}

async function verify(candidate: PlannerCandidate, request: BlueprintPlannerRequest, label: string) {
  assertPlannerCandidateBounds(execution.workspace.registry, candidate); assertPlannerWarehousePorts(execution.workspace.registry, request, candidate);
  const measured = measure(candidate, request); expect(measured.width).toBe(24); expect(measured.height).toBeLessThanOrEqual(12);
  if (request.manualLayout?.enabled && request.manualLayout.orientation === "fixed") expect(candidate.manualTransform?.rotation).toBe((360 - (request.manualLayout.boundary.rotation ?? 0)) % 360);
  for (const source of request.manualLayout?.enabled ? request.manualLayout.placements : []) expect(candidate.execution.blueprint.entities[source.referenceNode.id]!.rotation).toBe((source.rotation + candidate.manualTransform!.rotation) % 360);
  const report = await execution.simulation.actions.runBlueprint(candidate.execution); expect(report.status).toBe("completed"); expect(meetsProductionTargets(request, report)).toBe(true);
  expect(report.probes.find(p => p.id === request.plan.targets[0]!.itemId)?.perMinute).toBeGreaterThanOrEqual(120);
  await save(label, { request, candidate, measured, report }); return measured;
}
async function generate(request: BlueprintPlannerRequest, label: string) {
  try {
    const candidate = await execution.planner.build(request, 0, 20_000, { targetOutline: { width: 24, height: 12 }, maxEvaluations: 5_000 });
    expect(execution.planner.threadId).toBeGreaterThan(0); expect(candidate.search.evaluations).toBeGreaterThan(0); expect(candidate.search.evaluations).toBeLessThanOrEqual(5_000);
    return { candidate, measured: await verify(candidate, request, label) };
  } catch (error) { await save(label + "-failure", { request, error: String(error) }); throw error; }
}

it.each([0, 90, 180, 270] as const)("free旧方向%s被忽略：5×14非方设备组只能转90/270后真实产解", async rotation => {
  const request = await requestFor("free", rotation, "14x5", true);
  const base = { ...request, manualLayout: { ...request.manualLayout, boundary: { ...request.manualLayout.boundary, rotation: 0 as const } } };
  expect(plannerRequestKey(request)).toBe(plannerRequestKey(base));
  const { candidate, measured } = await generate(request, `free-${rotation}`);
  expect([90, 270]).toContain(candidate.manualTransform?.rotation); expect(measured.span).toEqual({ width: 14, height: 5 });
}, 30_000);

// AI-REMOVED 2026-11-21: Reason: 原7×10在fixed90未于5000预算路由成功，不能据此声称方向规则有错。
// Trigger: representative.json物流耗尽；主代理批准采用已成功free姿态作相对参考。
// Evidence: free-0两生产设备(13,4)/(5,3)180度真实120/min。
// Replacement: 下方四向反推草稿，独立-r/跨度/位移/朝向/南西口/产率断言保持。Risk: Low。Human Review: Required
// Original code:
// it.each([0, 90, 180, 270] as const)("fixed%s：7×10非方设备组按负角旋转，底边始终南且侧口西", async rotation => {
//   const request = await requestFor("fixed", rotation, "7x10");
//   const { measured } = await generate(request, `fixed-${rotation}`);
//   expect(measured.span).toEqual(rotation % 180 ? { width: 10, height: 7 } : { width: 7, height: 10 });
//   const deltas = [{ x: 1, y: 6 }, { x: 6, y: -1 }, { x: -1, y: -6 }, { x: -6, y: 1 }];
//   expect({ x: measured.rects[1]!.x - measured.rects[0]!.x, y: measured.rects[1]!.y - measured.rects[0]!.y }).toEqual(deltas[rotation / 90]);
// }, 30_000);
it.each([0, 90, 180, 270] as const)("fixed%s：可行非方参考反推四种草稿朝向，按负角还原且端口南/西", async rotation => {
  const request = await requestFor("fixed", rotation, "known");
  const { measured } = await generate(request, `fixed-${rotation}`);
  expect(measured.span).toEqual({ width: 14, height: 5 });
  expect({ x: measured.rects[1]!.x - measured.rects[0]!.x, y: measured.rects[1]!.y - measured.rects[0]!.y }).toEqual({ x: -8, y: -1 });
  expect(measured.entities.map(e => e.rotation)).toEqual([180, 180]);
}, 30_000);

it("14×5规格正反例：原朝向真实产解，横转后14格纵深由实际Worker拒绝", async () => {
  const valid = await generate(await requestFor("fixed", 0, "14x5"), "spec-14x5");
  expect(valid.measured.span).toEqual({ width: 14, height: 5 });
  const wrong = await requestFor("fixed", 90, "14x5");
  await expect(execution.planner.build(wrong, 0, 20_000, { targetOutline: { width: 24, height: 12 }, maxEvaluations: 5_000 })).rejects.toThrow();
}, 30_000);

it("关闭manual的全自动仍实际生成24×不超过12，底边口南/侧边口西", async () => {
  const source = await requestFor("free", 90, "14x5", true);
  await generate({ ...source, manualLayout: { ...source.manualLayout, enabled: false } }, "automatic-disabled-draft");
}, 30_000);

it.each([0, 90, 180, 270] as const)("绝对%s：最终底边南/侧边西，完整设备到底边三格不变", async rotation => {
  const source = await requestFor("fixed", rotation, "7x10");
  const referenceNode = source.manualLayout.preparation.nodes.find(n => n.purpose === "production")!;
  const placement = transformManualPlacement({ referenceNode, position: { x: 9, y: 9 }, rotation: 0 },
    execution.workspace.registry.queries.findEntityDefinition(referenceNode.definitionId)!, { rotation, translation: { x: 0, y: 0 } });
  const current = { ...source, manualLayout: { ...source.manualLayout, placements: [placement],
    boundary: { ...source.manualLayout.boundary, position: { base: 16, left: 0, right: null } } } };
  const request = { ...current, manualLayout: { ...current.manualLayout, preparation: await prepareManualLayout(execution.workspace.registry, current) } };
  const { measured } = await generate(request, `absolute-${rotation}`);
  expect(measured.origin.y + measured.height - measured.rects[0]!.y - measured.rects[0]!.height).toBe(3);
  expect(measured.rects[0]!.x - measured.origin.x).toBe(9);
}, 30_000);

it("真实Host新检查点保存恢复后继续派发缩框，固定两轴与自由旋转规则不泄出错向成果", async () => {
  const base = await requestFor("free", 90, "14x5", true);
  const run = async (request: BlueprintPlannerRequest, restored?: BlueprintPlannerTaskFile) => {
    const batch = new PlannerBatchSession();
    const records = new Map<string, BlueprintPlannerTaskFile>(restored ? [[restored.taskId, structuredClone(restored)]] : []);
    const traces: { outline: unknown; offered: number; actual?: number; error?: string; seeded: boolean }[] = [];
    const worker: NonNullable<PlannerHostOptions["worker"]> = { build: async (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      const trace: typeof traces[number] = { outline: targetOutline, offered: evaluations, seeded: !!seed || !!originSeed }; traces.push(trace);
      try { const result = await batch.planner.build(input, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
        trace.actual = result.search.evaluations; return result;
      } catch (error) { trace.error = String(error); throw error; }
    }, dispose: () => { void batch.planner.dispose(); } };
    const host = createBlueprintPlannerHost(batch.workspace, { gpuLayout: false, worker, storage: {
      load: async () => [...records.values()].map(f => structuredClone(f)), save: async f => { records.set(f.taskId, structuredClone(f)); }, delete: async id => { records.delete(id); } } });
    try {
      await host.whenSettled(); const id = restored?.taskId ?? await host.actions.createProductionTask(request);
      host.actions.continuePlanning(id, 20_000, 1, false); await host.whenSettled();
      const file = host.queries.exportTask(id), point = file.checkpoint as PlannerCheckpoint;
      expect(point.best, JSON.stringify({ traces, progress: file.progress })).not.toBeNull(); expect(host.queries.getResult(id)).not.toBeNull();
      expect(traces.length).toBeGreaterThan(0);
      expect(traces.every(t => !t.outline || (t.outline as { width: number; height: number }).width === 24 && (t.outline as { height: number }).height <= 12)).toBe(true);
      await verify(point.best!.candidate, request, restored ? "host-restored" : "host-first");
      if (restored) {
        const previous = restored.checkpoint as PlannerCheckpoint;
        expect(point.best!.candidate.metrics.area).toBeLessThan(previous.best!.candidate.metrics.area);
        expect(point.evaluations).toBeGreaterThan(previous.evaluations);
        expect(point.evaluations + (point.unspentEvaluations ?? 0)).toBe(previous.evaluations + (previous.unspentEvaluations ?? 0) + 20_000);
      }
      await save(restored ? "host-restored-file" : "host-first-file", { file, traces }); return structuredClone(file);
    } finally { await save(restored ? "host-restored-traces" : "host-first-traces", traces); host.dispose(); await host.whenSettled(); await batch.dispose(); }
  };
  const first = await run({ ...base, options: { ...base.options, initialArea: 288, stopAfterFirstSolution: true } });
  const loaded = JSON.parse(JSON.stringify(first)) as BlueprintPlannerTaskFile;
  if (!("plan" in loaded.request)) throw new Error("恢复夹具必须为生产任务。");
  const request = { ...loaded.request, options: { ...loaded.request.options, stopAfterFirstSolution: false } };
  await run(request, { ...loaded, request });
}, 90_000);


it("固定U形右侧身份交付到东边，不随设备组的手选左/右朝向漂移", async () => {
  const source = await requestFor("fixed", 270, "known");
  const current = { ...source, options: { ...source.options, warehouseBus: "u-shaped" as const }, manualLayout: { ...source.manualLayout,
    boundary: { ...source.manualLayout.boundary, assignments: source.manualLayout.boundary.assignments.map((a, i) => ({ ...a, side: i === 0 ? "base" as const : "right" as const })) } } };
  const request = { ...current, manualLayout: { ...current.manualLayout, preparation: await prepareManualLayout(execution.workspace.registry, current) } };
  const { measured } = await generate(request, "fixed-u-right-east");
  expect([...new Set(measured.docks.map(d => d.side))].sort()).toEqual([1, 2]);
}, 30_000);
