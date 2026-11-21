// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import { prepareManualLayout } from "@/blueprint-planner/manual-layout";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import type { PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts, meetsProductionTargets } from "@/blueprint-planner/verification";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

const execution = new PlannerBatchSession();
afterAll(() => execution.dispose());
const evidence = resolve(".temp/playwright-test/req051-task-size/algorithm", `${Date.now()}-${process.pid}`);
type Mode = "automatic" | "disabled-draft" | "relative-free" | "relative-fixed" | "absolute";

async function requestFor(mode: Mode, rotation: GridRotation = 0): Promise<BlueprintPlannerRequest> {
  const baseline = structuredClone(separator.request) as BlueprintPlannerRequest;
  const request: BlueprintPlannerRequest = { ...baseline, manualLayout: undefined,
    options: { ...baseline.options, warehouseBus: "straight", solidOutput: "warehouse", concurrency: 1,
      evaluationsPerRound: 5_000, randomSeed: 85196838, deterministicSearch: true,
      dimensionLimits: { exactBaseLength: 24, straight: { edge: 28, side: 30 } } } };
  if (mode === "automatic") return request;
  const draft: BlueprintPlannerRequest = { ...request, manualLayout: { enabled: true, mode: "recipe",
    orientation: mode === "relative-free" ? "free" : "fixed", boundary: { rotation, position: null, assignments: [] },
    facilities: [], placements: [], preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  const preparation = await prepareManualLayout(execution.workspace.registry, draft);
  const node = preparation.nodes.find(node => node.purpose === "production")!;
  expect(node).toBeDefined();
  const placement = transformManualPlacement({ referenceNode: node, position: { x: 9, y: 17 }, rotation: 0 },
    execution.workspace.registry.queries.findEntityDefinition(node.definitionId)!, { rotation, translation: { x: 0, y: 0 } });
  const current: BlueprintPlannerRequest = { ...draft, manualLayout: { ...draft.manualLayout!, preparation,
    placements: [placement], boundary: { rotation, position: mode === "absolute" ? { base: 24, left: 0, right: 24 } : null,
      assignments: preparation.nodes.filter(node => ["loader_1", "unloader_1"].includes(node.definitionId)).map(referenceNode => ({ referenceNode, side: "base" })) } } };
  const prepared = { ...current, manualLayout: { ...current.manualLayout!, preparation: await prepareManualLayout(execution.workspace.registry, current) } };
  return mode === "disabled-draft" ? { ...prepared, manualLayout: { ...prepared.manualLayout, enabled: false } } : prepared;
}

/** 只看交付仓库口的完整占地与外框公共接触边，独立判定直线底边；不读取请求方向或manualTransform。 */
function deliveredBase(candidate: PlannerCandidate) {
  const origin = candidate.outlineOrigin ?? { x: 0, y: 0 };
  const ports = candidate.execution.blueprint.entityOrder.map(id => candidate.execution.blueprint.entities[id]!)
    .filter(entity => ["loader_1", "unloader_1"].includes(entity.definitionId))
    .map(entity => resolveEntityGridRect({ entity, definition: execution.workspace.registry.queries.findEntityDefinition(entity.definitionId)! }));
  expect(ports.length).toBeGreaterThanOrEqual(3);
  const edges = ["top", "right", "bottom", "left"].filter(edge => ports.every(rect => edge === "top" ? rect.y === origin.y
    : edge === "bottom" ? rect.y + rect.height === origin.y + candidate.metrics.height
      : edge === "left" ? rect.x === origin.x : rect.x + rect.width === origin.x + candidate.metrics.width));
  expect(edges, JSON.stringify({ ports, origin, metrics: candidate.metrics })).toHaveLength(1);
  const edge = edges[0]!;
  return { edge, length: edge === "top" || edge === "bottom" ? candidate.metrics.width : candidate.metrics.height, ports, origin };
}

async function verify(request: BlueprintPlannerRequest, candidate: PlannerCandidate, label: string) {
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, label + "-raw.json"), JSON.stringify({ request, candidate }, null, 2));
  assertPlannerCandidateBounds(execution.workspace.registry, candidate);
  assertPlannerWarehousePorts(execution.workspace.registry, request, candidate);
  const base = deliveredBase(candidate);
  expect(base.length).toBe(24);
  const report = await execution.simulation.actions.runBlueprint(candidate.execution);
  expect(report.status).toBe("completed");
  expect(meetsProductionTargets(request, report), JSON.stringify(report.diagnostics)).toBe(true);
  expect(report.probes.find(probe => probe.id === request.plan.targets[0]!.itemId)?.perMinute).toBeGreaterThanOrEqual(60);
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, label + ".json"), JSON.stringify({ request, candidate, base, report }, null, 2));
  return base;
}

it.each(["automatic", "disabled-draft"] as const)("%s：关闭人工仍真实生成精确24格，底边按交付口位独立测量", async mode => {
  const request = await requestFor(mode);
  for (const outline of [{ width: 24, height: 28 }, { width: 28, height: 24 }]) {
    const candidate = await execution.planner.build(request, 0, 20_000, { targetOutline: outline, maxEvaluations: 5_000 });
    expect(candidate.search.evaluations).toBeGreaterThan(0);
    expect(candidate.search.evaluations).toBeLessThanOrEqual(5_000);
    const base = await verify(request, candidate, `${mode}-${outline.width}x${outline.height}`);
    expect(base.edge === "top" || base.edge === "bottom").toBe(outline.width === 24);
  }
}, 60_000);

for (const mode of ["relative-free", "relative-fixed", "absolute"] as const) {
  it.each([0, 90, 180, 270] as const)(`${mode}/%s：非方形真实产解与四向底边均精确24格`, async rotation => {
    const request = await requestFor(mode, rotation);
    const outline = rotation % 180 ? { width: 28, height: 24 } : { width: 24, height: 28 };
    const candidate = await execution.planner.build(request, 0, 20_000, { targetOutline: outline, maxEvaluations: 5_000 });
    expect(candidate.search.evaluations).toBeGreaterThan(0);
    expect(candidate.search.evaluations).toBeLessThanOrEqual(5_000);
    await verify(request, candidate, `${mode}-${rotation}`);
    if (mode !== "relative-free") expect(candidate.manualTransform?.rotation).toBe(0);
  }, 30_000);
}

it("非24候选不能启动；另一轴恰好24也不能掩盖交付底边错误", async () => {
  const request = await requestFor("relative-fixed", 0);
  await expect(execution.planner.build(request, 0, 20_000, { targetOutline: { width: 23, height: 23 }, maxEvaluations: 5_000 })).rejects.toThrow();
  const withoutExact: BlueprintPlannerRequest = { ...request, options: { ...request.options, dimensionLimits: { straight: { edge: 28, side: 30 } } } };
  const candidate = await execution.planner.build(withoutExact, 0, 20_000, { targetOutline: { width: 28, height: 24 }, maxEvaluations: 5_000 });
  const physical = deliveredBase(candidate);
  // 若无约束搜索恰选24轴，旋转请求的人工底边不能替代真实口位；在后续专项明确构造28底边的真实成果。
  // AI-CORRECTION 2026-11-21：本例固定底边方向为0且三口全在base，真实28×24成果底边必须28，不能条件跳过拒绝断言。
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, "without-exact-delivery.json"), JSON.stringify({ candidate, physical }, null, 2));
  // AI-REMOVED 2026-11-21:
  // Reason: 条件断言可能跳过另一轴24而底边28的必需final拒绝覆盖。
  // Trigger: REQ-051任务级精确底边必须按交付方向验证。
  // Evidence: 固定direction0与全base口位可确定真实28底边。
  // Replacement: 下方无条件28和final拒绝断言。Risk: Low。Human Review: Required
  // Original code:
  // expect([24, 28]).toContain(physical.length);
  // if (physical.length !== 24) expect(() => assertPlannerWarehousePorts(execution.workspace.registry, request, candidate)).toThrow();
  expect(physical.length).toBe(28);
  expect(() => assertPlannerWarehousePorts(execution.workspace.registry, request, candidate)).toThrow();
}, 60_000);

it("全自动真实Host：精确24首解落盘、销毁恢复后继续缩框仍保持24", async () => {
  const base = await requestFor("automatic");
  const firstRequest = { ...base, options: { ...base.options, initialArea: 576, stopAfterFirstSolution: true } };
  const run = async (request: BlueprintPlannerRequest, restored?: BlueprintPlannerTaskFile) => {
    const batch = new PlannerBatchSession(), trace: { outline: unknown; offered: number; actual?: number }[] = [];
    const files = new Map<string, BlueprintPlannerTaskFile>(restored ? [[restored.taskId, structuredClone(restored)]] : []);
    const worker: NonNullable<PlannerHostOptions["worker"]> = { build: async (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      const item: typeof trace[number] = { outline: targetOutline, offered: evaluations }; trace.push(item);
      const result = await batch.planner.build(input, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
      item.actual = result.search.evaluations; return result;
    }, dispose: () => { void batch.planner.dispose(); } };
    const host = createBlueprintPlannerHost(batch.workspace, { gpuLayout: false, worker, storage: {
      load: async () => [...files.values()].map(file => structuredClone(file)), save: async file => { files.set(file.taskId, structuredClone(file)); }, delete: async id => { files.delete(id); } } });
    try {
      await host.whenSettled();
      const id = restored?.taskId ?? await host.actions.createProductionTask(request);
      host.actions.continuePlanning(id, 20_000, 1, false); await host.whenSettled();
      const file = host.queries.exportTask(id), point = file.checkpoint as PlannerCheckpoint;
      expect(trace.length).toBeGreaterThan(0); expect(point.best).not.toBeNull();
      expect(host.queries.getResult(id)).not.toBeNull();
      if (restored) {
        expect(file.progress.validatedCandidateCount).toBeGreaterThan(restored.progress.validatedCandidateCount);
        expect(point.best!.candidate.metrics.area).toBeLessThan((restored.checkpoint as PlannerCheckpoint).best!.candidate.metrics.area);
      }
      await verify(request, point.best!.candidate, restored ? "host-restored" : "host-first");
      await writeFile(resolve(evidence, restored ? "host-restored-trace.json" : "host-first-trace.json"), JSON.stringify({ trace, file }, null, 2));
      return structuredClone(file);
    } finally {
      try {
        await mkdir(evidence, { recursive: true });
        await writeFile(resolve(evidence, restored ? "host-restored-final-trace.json" : "host-first-final-trace.json"), JSON.stringify({ request, trace }, null, 2));
      } finally { host.dispose(); await host.whenSettled(); await batch.dispose(); }
    }
  };
  const first = await run(firstRequest);
  const path = resolve(evidence, "persisted-automatic.json"); await writeFile(path, JSON.stringify(first));
  const loaded = JSON.parse(await readFile(path, "utf8")) as BlueprintPlannerTaskFile;
  // 2026-11-21：恢复文件允许包含识别任务；此生产续算夹具必须显式拒绝错误种类，不靠类型断言掩盖。
  if (!("plan" in loaded.request)) throw new Error("持久化续算夹具必须恢复生产任务。");
  const resumedRequest = { ...loaded.request, options: { ...loaded.request.options, stopAfterFirstSolution: false } };
  await run(resumedRequest, { ...loaded, request: resumedRequest });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(first);
}, 90_000);
