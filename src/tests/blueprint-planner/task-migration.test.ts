// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { BlueprintPlannerTaskFile, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile, restorePlannerTaskFile, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { plannerRequestKey, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import legacy from "./fixtures/legacy-boundary-task.json";
import invalid from "./fixtures/legacy-boundary-invalid-task.json";

const taskFile = () => structuredClone(legacy.file) as unknown as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };

it.each(["compact-portfolio-1", "compact-portfolio-2", "compact-breadth-1"])("%s：旧最优移除存取线后真实验收，保留进度且只改曲线末点", async algorithmVersion => {
  const session = new PlannerBatchSession();
  try {
    const file = { ...taskFile(), algorithmVersion };
    const original = structuredClone(file);
    const migrated = await restorePlannerTaskFile(file, session.workspace.registry,
      execution => session.simulation.actions.runBlueprint(execution));
    expect(migrated.progress).toMatchObject({ evaluatedProposals: 12345, candidateCount: 7,
      validatedCandidateCount: 3, elapsedMs: 54321, startedAt: 42, roundEvaluatedProposals: 2345, bestArea: 60 });
    expect(migrated.progress.areaHistory).toEqual([
      ...file.progress.areaHistory!.slice(0, -1), { evaluatedProposals: 12345, bestArea: 60 },
    ]);
    const best = migrated.checkpoint.best!;
    expect(best.candidate.metrics).toMatchObject({ width: 6, height: 10, area: 60, entityCount: 9 });
    expect(best.report).toMatchObject({ status: "completed", engineKind: "dense-v2" });
    expect(best.report.probes[0]!.perMinute).toBeGreaterThanOrEqual(60);
    expect(Object.values(best.candidate.execution.blueprint.entities).some(entity => entity.definitionId.startsWith("log_hongs_bus"))).toBe(false);
    expect(best.candidate.execution.scene.externalEntities.some(entity => entity.definitionId === "log_hongs_bus")).toBe(true);
    expect(best.candidate.seed!.network.nodes.some(node => node.entity.definitionId.startsWith("log_hongs_bus"))).toBe(false);
    expect(best.candidate.seed!.requestKey).toBe(plannerRequestKey(file.request));
    expect(restorePlannerSeed(session.workspace.registry, file.request, best.candidate.seed!).network.nodes).toHaveLength(4);
    expect(migrated.checkpoint.portfolio.pools[0]!.entries[0]!.seed).toEqual(best.candidate.seed);
    expect(migrated.checkpoint.result!.metrics).toEqual(best.candidate.metrics);
    expect(migrated.checkpoint.savedBlueprintId).toBeNull();
    expect(await restorePlannerTaskFile(JSON.parse(JSON.stringify(migrated)), session.workspace.registry)).toEqual(migrated);
    expect(file).toEqual(original);
    await saveSuccessfulPlanning(session.workspace.registry, `历史进度迁移-${algorithmVersion}`, best.candidate.execution.blueprint,
      file.request, { originalProgress: file.progress, migrated, engineKind: "dense-v2", ticksPerSecond: 2 });
  } finally { await session.dispose(); }
}, 60_000);

it("缺少续搜种子的旧结果仍可保留已验收最小蓝图", async () => {
  const session = new PlannerBatchSession();
  try {
    const file = taskFile();
    const { seed: _seed, ...candidate } = file.checkpoint.best!.candidate;
    file.checkpoint.best = { ...file.checkpoint.best!, candidate };
    const migrated = await restorePlannerTaskFile(file, session.workspace.registry,
      execution => session.simulation.actions.runBlueprint(execution));
    expect(migrated.progress.bestArea).toBe(60);
    expect(migrated.checkpoint.portfolio.pools).toEqual([]);
    expect(migrated.checkpoint.result!.blueprint.entityOrder).toHaveLength(9);
  } finally { await session.dispose(); }
});

it("旧自由存取线连同种子指纹统一迁移为直角，保留合格蓝图", async () => {
  const session = new PlannerBatchSession();
  try {
    const file = taskFile();
    Object.assign(file.request.options, { warehouseBus: "free" });
    const seed = file.checkpoint.best!.candidate.seed!;
    Object.assign(seed.network.request.options, { warehouseBus: "free" });
    const keyed = JSON.parse(seed.requestKey);
    keyed.options.warehouseBus = "free";
    Object.assign(seed, { requestKey: JSON.stringify(keyed) });
    const migrated = await restorePlannerTaskFile(file, session.workspace.registry,
      execution => session.simulation.actions.runBlueprint(execution));
    expect(migrated.request.options.warehouseBus).toBe("corner");
    expect(migrated.progress.bestArea).toBe(60);
    expect(migrated.checkpoint.best!.candidate.seed!.network.request.options.warehouseBus).toBe("corner");
    expect(migrated.checkpoint.best!.candidate.seed!.requestKey).toBe(plannerRequestKey(migrated.request));
  } finally { await session.dispose(); }
});

it("旧边界不合格仍保留曲线，真实 Worker 从原累计次数续算", async () => {
  const session = new PlannerBatchSession();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 20,
    worker: { build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline) =>
      session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline }, update, signal),
    dispose: () => {} } });
  try {
    const file = structuredClone(invalid.file) as unknown as BlueprintPlannerTaskFile;
    const id = await host.actions.importTask(file);
    expect(host.queries.getResult(id)).toBeNull();
    expect(host.queries.getTask(id)).toMatchObject({ bestArea: null, areaHistory: file.progress.areaHistory,
      evaluatedProposals: 12345, elapsedMs: 54321, candidateCount: 7 });
    host.actions.continuePlanning(id, 10000, 1);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const continued = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(continued.checkpoint.evaluations).toBe(12365);
    expect(continued.progress.areaHistory!.slice(0, 3)).toEqual(file.progress.areaHistory);
    expect(continued.progress.elapsedMs).toBeGreaterThan(54321);
    expect(continued.checkpoint.legacyHistoryLength).toBe(3);
  } finally { host.dispose(); await session.dispose(); }
}, 60_000);

it("旧曲线与新规则最优结果分段验证，新规则首解面积可以高于旧记录", async () => {
  const session = new PlannerBatchSession();
  try {
    const migrated = await restorePlannerTaskFile(taskFile(), session.workspace.registry,
      execution => session.simulation.actions.runBlueprint(execution));
    const input = { ...migrated, checkpoint: { ...migrated.checkpoint, legacyHistoryLength: 1 },
      progress: { ...migrated.progress, areaHistory: [{ evaluatedProposals: 100, bestArea: 20 }, { evaluatedProposals: 12345, bestArea: 60 }] } };
    expect(parsePlannerTaskFile(input, session.workspace.registry).progress.areaHistory).toEqual(input.progress.areaHistory);
    expect(() => parsePlannerTaskFile({ ...input, progress: { ...input.progress,
      areaHistory: [...input.progress.areaHistory, { evaluatedProposals: 12345, bestArea: 61 }] } }, session.workspace.registry)).toThrow("面积曲线无效");
  } finally { await session.dispose(); }
});

it("加载历史任务验收后持久化，可导出、重新加载并带最优种子继续搜索", async () => {
  const session = new PlannerBatchSession();
  const file = taskFile();
  const records = new Map([[file.taskId, file as BlueprintPlannerTaskFile]]);
  const storage = { load: async () => structuredClone([...records.values()]),
    save: async (value: BlueprintPlannerTaskFile) => { records.set(value.taskId, structuredClone(value)); }, delete: async (id: string) => { records.delete(id); } };
  const host = createBlueprintPlannerHost(session.workspace, { storage, roundLimit: () => 20,
    worker: { build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline) =>
      session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline }, update, signal),
    dispose: () => {} } });
  let reloaded: ReturnType<typeof createBlueprintPlannerHost> | undefined;
  try {
    await vi.waitFor(() => expect(host.queries.getTask(file.taskId)?.bestArea).toBe(60), { timeout: 15000 });
    await vi.waitFor(() => expect(records.get(file.taskId)!.algorithmVersion).toBe("external-boundary-1"));
    const persisted = parsePlannerTaskFile(records.get(file.taskId), session.workspace.registry);
    expect(host.queries.exportTask(file.taskId).progress.areaHistory).toEqual(persisted.progress.areaHistory);
    const id = await host.actions.importTask(persisted);
    expect(host.queries.getResult(id)!.blueprint.blueprintId).not.toBe(persisted.checkpoint.result!.blueprint.blueprintId);
    host.actions.continuePlanning(id, 10000, 1);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    expect(host.queries.getTask(id)!.evaluatedProposals).toBe(12365);
    expect(host.queries.getTask(id)!.bestArea).toBe(60);
    expect(parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry).checkpoint.portfolio.pools.length).toBeGreaterThan(0);
    host.dispose();
    reloaded = createBlueprintPlannerHost(session.workspace, { storage });
    await vi.waitFor(() => expect(reloaded!.queries.getTask(file.taskId)?.bestArea).toBe(60));
    expect(reloaded.queries.getResult(file.taskId)).toEqual(persisted.checkpoint.result);
  } finally { reloaded?.dispose(); host.dispose(); await session.dispose(); }
}, 60_000);

it("仿真不可用时保留旧任务原文、历史与计数，不自动写入半成品", async () => {
  const file = taskFile();
  const writes: BlueprintPlannerTaskFile[] = [];
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null };
  const host = createBlueprintPlannerHost(workspace, { storage: { load: async () => [file],
    save: async value => { writes.push(value); }, delete: async () => {} } });
  try {
    await vi.waitFor(() => expect(host.queries.getTask(file.taskId)?.status).toBe("failed"));
    expect(host.queries.getTask(file.taskId)).toMatchObject({ evaluatedProposals: 12345, elapsedMs: 54321, areaHistory: file.progress.areaHistory });
    expect(host.queries.exportTask(file.taskId)).toEqual(file);
    expect(writes).toEqual([]);
  } finally { host.dispose(); }
  await Promise.resolve();
  expect(writes).toEqual([]);
});

it("导入验收期间关闭 Host 会取消恢复，不能迟到写入任务", async () => {
  const session = new PlannerBatchSession();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null });
  try {
    const pending = host.actions.importTask(taskFile());
    await Promise.resolve();
    host.dispose();
    await expect(pending).rejects.toThrow();
    expect(host.queries.listTasks()).toEqual([]);
  } finally { host.dispose(); await session.dispose(); }
});

it("导入验收失败的旧任务可原样导出，服务恢复后重新导入成功", async () => {
  const session = new PlannerBatchSession();
  const unavailable = createBlueprintPlannerHost({ ...session.workspace, simulation: null }, { storage: null });
  const available = createBlueprintPlannerHost(session.workspace, { storage: null });
  try {
    const id = await unavailable.actions.importTask(taskFile());
    expect(unavailable.queries.getTask(id)?.status).toBe("failed");
    const file = unavailable.queries.exportTask(id);
    expect(file.progress.taskId).toBe(id);
    const restoredId = await available.actions.importTask(JSON.parse(JSON.stringify(file)));
    expect(available.queries.getTask(restoredId)).toMatchObject({ bestArea: 60, evaluatedProposals: 12345, elapsedMs: 54321 });
    expect(available.queries.getResult(restoredId)?.blueprint.entityOrder).toHaveLength(9);
  } finally { unavailable.dispose(); available.dispose(); await session.dispose(); }
});
