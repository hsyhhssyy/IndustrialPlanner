import { renderToStaticMarkup } from "react-dom/server";
import { toJS } from "mobx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppHost } from "@/app/host/app-host";
import { BlueprintPlannerDialog } from "@/app/shell/blueprint-planner-dialog";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parseRecognitionTaskFile } from "@/blueprint-planner/blueprint-recognition-task";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const fixtures = "src/tests/fixtures/blueprints/blueprint-planner/blueprint-optimization/";
beforeEach(() => { vi.stubGlobal("indexedDB", createFakeIndexedDbFactory()); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

async function setup() {
  const session = new PlannerBatchSession();
  const app = createAppHost(session.workspace);
  app.blueprintPlannerDialog.setBlueprintPlanningEnabled(true);
  const planner = createBlueprintPlannerHost(session.workspace, { gpuLayout: false, worker: {
    build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) =>
      session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal),
    // Node Worker 由 session 拥有，在最终收尾统一等待释放。
    dispose: () => {},
  } });
  await planner.whenSettled();
  return { session, app, planner, controller: app.blueprintPlannerDialog,
    dispose: async () => { planner.dispose(); app.dispose(); await session.dispose(); } };
}

// AI-REMOVED 2026-10-16:
// Reason: 复制改为继承原配置、识别基线及当前最小成果，旧助手只接受重新识别。
// Trigger: 用户要求随机种子与任务复制新语义。
// Evidence: BlueprintPlannerAction.duplicateTask。
// Replacement: 下方 duplicate 助手。
// Risk: 原图与副本隔离断言继续保留。
// Human Review: Required
// Original code:
// async function duplicate(env: Awaited<ReturnType<typeof setup>>) {
//   const { planner, controller, session } = env;
//   const id = controller.viewTaskId!;
//   const source = planner.queries.exportTask(id);
//   const count = planner.queries.listTasks().length;
//   controller.duplicateTask();
//   await vi.waitFor(() => {
//     expect(controller.viewTaskId).not.toBeNull();
//     expect(controller.viewTaskId).not.toBe(id);
//     expect(planner.state.activeTaskId).toBeNull();
//   });
//   const copied = parseRecognitionTaskFile(planner.queries.exportTask(controller.viewTaskId!), session.workspace.registry);
//   const input = isBlueprintRecognitionRequest(source.request) ? source.request.input : source.request.blueprintSource;
//   expect(planner.queries.listTasks()).toHaveLength(count + 1);
//   expect(copied.request.input).toEqual(input);
//   expect(planner.queries.exportTask(id)).toEqual(source);
//   expect(copied.request.options).toMatchObject({ warehousePortPlacement: "continuous", warehouseBus: "straight",
//     evaluationsPerRound: 5_000_000, concurrency: "auto", gpu: true, itemPolicies: [] });
//   expect(copied.checkpoint.step).toBe("inputs");
//   expect(copied.progress).toMatchObject({ evaluatedProposals: 0, candidateCount: 0 });
//   expect(planner.queries.getResult(copied.taskId)).toBeNull();
//   return { source, copied };
// }

async function duplicate(env: Awaited<ReturnType<typeof setup>>) {
  const { planner, controller, session } = env;
  const id = controller.viewTaskId!;
  const source = planner.queries.exportTask(id);
  const seed = planner.queries.getRandomSeed(id);
  const count = planner.queries.listTasks().length;
  await controller.duplicateTask();
  expect(controller.viewTaskId).not.toBeNull();
  expect(controller.viewTaskId).not.toBe(id);
  expect(planner.state.activeTaskId).toBeNull();
  const file = planner.queries.exportTask(controller.viewTaskId!);
  const copied = isBlueprintRecognitionRequest(file.request)
    ? parseRecognitionTaskFile(file, session.workspace.registry) : parsePlannerTaskFile(file, session.workspace.registry);
  expect(planner.queries.listTasks()).toHaveLength(count + 1);
  expect(copied.request).toEqual(source.request);
  expect(planner.queries.exportTask(id)).toEqual(source);
  expect(copied.checkpoint.randomSeed).toBeGreaterThan(0);
  expect(copied.checkpoint.randomSeed).not.toBe(seed);
  expect(planner.queries.getRandomSeed(copied.taskId)).toBe(copied.checkpoint.randomSeed);
  expect(copied.progress).toMatchObject({ elapsedMs: 0, evaluatedProposals: 0, candidateCount: 0, validatedCandidateCount: 0 });
  if (isBlueprintRecognitionRequest(copied.request)) {
    expect(planner.queries.getResult(copied.taskId)).toBeNull();
  } else {
    const point = parsePlannerTaskFile(copied, session.workspace.registry).checkpoint;
    const original = parsePlannerTaskFile(source, session.workspace.registry).checkpoint;
    expect(point.blueprintBaseline).toEqual(original.blueprintBaseline);
    expect(point.parallel).toBeUndefined();
    expect(point.pendingCandidate).toBeNull();
    expect(point.savedBlueprintId).toBeNull();
    expect(point.best?.candidate.metrics ?? null).toEqual(original.best?.candidate.metrics ?? null);
    if (original.best) {
      expect(point.best!.candidate.execution.blueprint.blueprintId).not.toBe(original.best.candidate.execution.blueprint.blueprintId);
      expect(point.best!.candidate.execution.blueprint.entities).toEqual(original.best.candidate.execution.blueprint.entities);
      expect(point.best!.report).toEqual(original.best.report);
      expect(point.result).toMatchObject({ taskId: copied.taskId, folderId: null, elapsedMs: 0 });
      expect(copied.progress.areaHistory).toEqual([{ evaluatedProposals: 0, bestArea: original.best.candidate.metrics.area }]);
      expect(copied.progress.initialArea).toBe(original.best.candidate.metrics.area);
      expect(point.portfolio.pools.flatMap(pool => pool.entries).every(entry => entry.visits === 0)).toBe(true);
    } else expect(point.result).toBeNull();
  }
  expect(renderToStaticMarkup(<BlueprintPlannerDialog appHost={env.app} />)).toContain(`随机种子 <strong>${copied.checkpoint.randomSeed}</strong>`);
  return { source, copied };
}

it("无结果识别任务复制保留原图、边界和活动，副本编辑独立且可恢复", async () => {
  const env = await setup();
  try {
    env.controller.openBlueprint(loadBlueprintFromFile(`${fixtures}unknown-entry.schema7.json`));
    await vi.waitFor(() => { expect(env.controller.viewTaskId).not.toBeNull(); expect(env.planner.state.activeTaskId).toBeNull(); });
    const id = env.controller.viewTaskId!;
    const original = parseRecognitionTaskFile(env.planner.queries.exportTask(id), env.session.workspace.registry);
    const originalSeed = env.planner.queries.getRandomSeed(id);
    await env.planner.actions.updateBlueprintBoundaries(id, original.request.input.boundaries.map(boundary =>
      boundary.direction === "input" ? { ...boundary, itemId: "item_iron_ore" } : boundary));
    await env.planner.actions.updateBlueprintOptions(id, { ...original.request.options, warehouseBus: "corner" });
    expect(env.planner.queries.getRandomSeed(id)).toBe(originalSeed);
    const { source, copied } = await duplicate(env);
    await env.planner.actions.updateBlueprintBoundaries(copied.taskId, parseRecognitionTaskFile(copied, env.session.workspace.registry).request.input.boundaries.map(boundary =>
      boundary.direction === "input" ? { ...boundary, itemId: null } : boundary));
    expect(env.planner.queries.exportTask(source.taskId)).toEqual(source);
    await env.planner.whenSettled();
    env.planner.dispose();
    const restored = createBlueprintPlannerHost(env.session.workspace);
    try {
      await restored.whenSettled();
      const request = parseRecognitionTaskFile(restored.queries.exportTask(copied.taskId), env.session.workspace.registry).request;
      expect(request.input.activeActivityIds).toEqual([]);
      expect(request.input.boundaries.some(boundary => boundary.direction === "input" && boundary.itemId === null)).toBe(true);
      expect(restored.queries.getRandomSeed(copied.taskId)).toBe(copied.checkpoint.randomSeed);
      expect(restored.queries.exportTask(source.taskId)).toEqual(source);
    } finally { restored.dispose(); }
  } finally { await env.dispose(); }
});

it("已有基线与无结果暂停优化任务均可复制，真实计算期间禁止复制", async () => {
  const env = await setup();
  try {
    env.controller.openBlueprint(loadBlueprintFromFile(`${fixtures}plant-cycle.schema7.json`));
    await vi.waitFor(() => { expect(env.controller.viewTaskId).not.toBeNull(); expect(env.planner.state.activeTaskId).toBeNull(); });
    const id = env.controller.viewTaskId!;
    const seed = env.planner.queries.getRandomSeed(id);
    await env.planner.actions.updateBlueprintOptions(id, { ...toJS(env.controller.options), warehousePortPlacement: "any" });
    await env.planner.actions.identifyBlueprint(id);
    expect(env.planner.queries.getRandomSeed(id)).toBe(seed);
    env.controller.selectTask(id, env.planner.queries.getLastRequest(id) ?? undefined);
    expect(env.planner.queries.getResult(id)).not.toBeNull();
    await env.planner.actions.save(id);
    const { source } = await duplicate(env);
    const copiedId = env.controller.viewTaskId!;
    const copiedSeed = env.planner.queries.getRandomSeed(copiedId);
    await env.planner.actions.updateBlueprintOptions(copiedId, {
      ...toJS(env.controller.options), blueprintOptimizations: {
        reassignPorts: true, reassignConnections: false, rebuildLogistics: false, mergeBoundaryFacilities: false,
      },
    });
    expect(env.planner.queries.getRandomSeed(copiedId)).toBe(copiedSeed);
    expect(env.planner.queries.exportTask(source.taskId)).toEqual(source);
    const file = parsePlannerTaskFile(source, env.session.workspace.registry);
    // 保留真实识别基线，仅设置原 E2E 所需的“尚无结果”暂停输入。
    file.checkpoint.best = null; file.checkpoint.result = null; file.checkpoint.savedBlueprintId = null;
    file.checkpoint.portfolio = { pools: [] }; Object.assign(file.progress, { bestArea: null, areaHistory: [] });
    Object.assign(file.request, { options: { ...file.request.options, evaluationsPerRound: 10_000, concurrency: 1, gpu: false } });
    const paused = await env.planner.actions.importTask(file);
    env.controller.selectTask(paused, env.planner.queries.getLastRequest(paused) ?? undefined);
    env.planner.actions.continuePlanning(paused, 10_000, 1, false);
    expect(env.controller.taskLocked).toBe(true);
    const count = env.planner.queries.listTasks().length;
    await env.controller.duplicateTask();
    expect(env.planner.queries.listTasks()).toHaveLength(count);
    expect(renderToStaticMarkup(<BlueprintPlannerDialog appHost={env.app} />)).not.toContain("复制任务");
    env.planner.actions.cancel(paused);
    await env.planner.whenSettled();
    expect(env.planner.queries.getResult(paused)).toBeNull();
    expect(env.planner.queries.getTask(paused)?.status).toBe("waiting");
    await duplicate(env);
  } finally { await env.dispose(); }
}, 60_000);
