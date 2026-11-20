// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { restorePlannerTaskFile } from "@/blueprint-planner/task-migration";
import { hasPlannerStarted } from "@/shared/planner-task";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import live from "./fixtures/live-v1.6.1.2-tasks.json";

// 原件来自实际 live 生产产物；不得改写 algorithmVersion 或用当前实现生成其检查点。
it.each(["draft", "started", "best"] as const)("live v1.6.1.2 的 %s 任务保留事实、先落盘迁移再真实续算", async kind => {
  const file = structuredClone(live.tasks[kind]) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  const original = structuredClone(file);
  const session = new PlannerBatchSession();
  const records = new Map([[file.taskId, structuredClone(file) as BlueprintPlannerTaskFile]]);
  let builds = 0;
  const host = createBlueprintPlannerHost(session.workspace, {
    storage: { load: async () => structuredClone([...records.values()]),
      save: async next => { records.set(next.taskId, structuredClone(next)); }, delete: async id => { records.delete(id); } },
    roundLimit: () => 5000,
    worker: { build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      builds++;
      expect(records.get(file.taskId)!.algorithmVersion).toBe(PLANNER_ALGORITHM_VERSION);
      expect(records.get(file.taskId)!.progress.evaluatedProposals).toBeGreaterThanOrEqual(file.progress.evaluatedProposals);
      return session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep,
        maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
    }, dispose: () => {} },
  });
  try {
    expect(file.algorithmVersion).toBe("hierarchical-module-routing-3");
    await host.whenSettled();
    expect(records.get(file.taskId)).toEqual(original);
    expect(host.queries.getTask(file.taskId)!.planningStarted).toBe(kind !== "draft");
    host.actions.continuePlanning(file.taskId, 10000, 1, false);
    await host.whenSettled();
    expect(builds).toBeGreaterThan(0);
    const next = parsePlannerTaskFile(records.get(file.taskId), session.workspace.registry);
    expect(next.algorithmVersion).toBe(PLANNER_ALGORITHM_VERSION);
    expect(hasPlannerStarted(next.progress)).toBe(true);
    expect(next.progress.evaluatedProposals).toBeGreaterThan(file.progress.evaluatedProposals);
    // 测试主机将新增预算限制为 5000；live 的已有尾额必须全数结转，而非随搜索缓存丢弃。
    expect(next.progress.evaluatedProposals + (next.checkpoint.unspentEvaluations ?? 0))
      .toBe(file.progress.evaluatedProposals + (file.checkpoint.unspentEvaluations ?? 0) + 5000);
    expect(next.progress.candidateCount).toBeGreaterThanOrEqual(file.progress.candidateCount);
    expect(next.progress.elapsedMs).toBeGreaterThanOrEqual(file.progress.elapsedMs);
    expect(next.progress.areaHistory!.slice(0, file.progress.areaHistory!.length)).toEqual(file.progress.areaHistory);
    if (kind === "best") {
      expect(next.checkpoint.best!.report.status).toBe("completed");
      expect(next.checkpoint.best!.report.probes.find(probe => probe.id === file.request.plan.targets[0]!.itemId)!.perMinute).toBeGreaterThanOrEqual(60);
      expect(next.progress.bestArea).toBeLessThanOrEqual(file.progress.bestArea!);
      expect(next.checkpoint.result!.metrics.area).toBe(next.progress.bestArea);
      expect(next.checkpoint.best!.candidate.seed).toBeDefined();
    }
    expect(await restorePlannerTaskFile(next, session.workspace.registry)).toEqual(next);
    expect(file).toEqual(original);
  } finally { host.dispose(); await session.dispose(); }
}, 60_000);

it.each([-1, 0.5])("live 剩余预算 %s 无效时拒绝恢复并保留原件", async unspentEvaluations => {
  const file = structuredClone(live.tasks.started) as unknown as BlueprintPlannerTaskFile & { checkpoint: PlannerCheckpoint };
  file.checkpoint.unspentEvaluations = unspentEvaluations;
  const original = structuredClone(file);
  const session = new PlannerBatchSession();
  try {
    await expect(restorePlannerTaskFile(file, session.workspace.registry)).rejects.toThrow("旧任务剩余预算无效");
    expect(file).toEqual(original);
  } finally { await session.dispose(); }
});

it("继承 live 成果的未启动草稿清空次数后仍能复制、往返并以有效预算启动", async () => {
  const session = new PlannerBatchSession();
  const original = structuredClone(live.tasks.best) as unknown as BlueprintPlannerTaskFile;
  const records = new Map([[original.taskId, structuredClone(original)]]);
  const host = createBlueprintPlannerHost(session.workspace, {
    storage: { load: async () => structuredClone([...records.values()]), save: async file => { records.set(file.taskId, structuredClone(file)); },
      delete: async id => { records.delete(id); } },
    worker: { build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) =>
      session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea,
        targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal), dispose: () => {} },
  });
  try {
    const oldDraft = structuredClone(live.tasks.draft) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
    oldDraft.request = { ...oldDraft.request, options: { ...oldDraft.request.options, evaluationsPerRound: 0 } };
    const restoredDraft = await restorePlannerTaskFile(oldDraft, session.workspace.registry);
    expect(restoredDraft.request.options.evaluationsPerRound).toBe(0);
    expect(restoredDraft.progress.planningStarted).toBe(false);
    await host.whenSettled();
    const first = await host.actions.duplicateTask(original.taskId);
    const request = host.queries.getLastRequest(first) as BlueprintPlannerRequest;
    await host.actions.updateProductionTask(first, { ...request, options: { ...request.options, evaluationsPerRound: 0 } });
    const source = host.queries.exportTask(first);
    const second = await host.actions.duplicateTask(first);
    const copy = parsePlannerTaskFile(JSON.parse(JSON.stringify(host.queries.exportTask(second))), session.workspace.registry);
    expect(copy.request.options.evaluationsPerRound).toBe(0);
    expect(copy.progress.planningStarted).toBe(false);
    expect(copy.checkpoint.best!.candidate.metrics).toEqual((source.checkpoint as PlannerCheckpoint).best!.candidate.metrics);
    expect(await restorePlannerTaskFile(copy, session.workspace.registry)).toEqual(copy);
    expect(host.queries.exportTask(first)).toEqual(source);
    expect(() => host.actions.continuePlanning(second, 0, 1, false)).toThrow("正安全整数");
    expect(host.state.activeTaskId).toBeNull();
    await host.actions.updateProductionTask(second, { ...copy.request, options: { ...copy.request.options, evaluationsPerRound: 5000 } });
    host.actions.continuePlanning(second, 5000, 1, false);
    await host.whenSettled();
    expect(host.queries.getTask(second)?.planningStarted).toBe(true);
    expect(host.queries.getTask(second)!.evaluatedProposals).toBeGreaterThan(0);
    expect(host.queries.getResult(second)!.metrics.area).toBeLessThanOrEqual(copy.checkpoint.best!.candidate.metrics.area);
    expect(host.queries.exportTask(first)).toEqual(source);
  } finally { host.dispose(); await session.dispose(); }
}, 60_000);
