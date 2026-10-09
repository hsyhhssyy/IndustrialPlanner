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
    expect(host.queries.getResult(id)?.metrics).toEqual((file.checkpoint as PlannerCheckpoint).result?.metrics);
    expect(host.queries.getTask(id)).toMatchObject({ bestArea: file.progress.bestArea, areaHistory: file.progress.areaHistory,
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

it("启动只读取历史；用户继续时才验收持久化，刷新仍保持暂停", async () => {
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
    await host.whenSettled();
    expect(records.get(file.taskId)).toEqual(file);
    expect(host.queries.getTask(file.taskId)?.status).toBe("waiting");
    host.actions.continuePlanning(file.taskId, 10000, 1);
    await host.whenSettled();
    expect(host.queries.getTask(file.taskId)?.bestArea).toBe(60);
    await vi.waitFor(() => expect(records.get(file.taskId)!.algorithmVersion).toBe("external-boundary-1"));
    const persisted = parsePlannerTaskFile(records.get(file.taskId), session.workspace.registry);
    expect(host.queries.exportTask(file.taskId).progress.areaHistory).toEqual(persisted.progress.areaHistory);
    const id = await host.actions.importTask(persisted);
    expect(host.queries.getResult(id)!.blueprint.blueprintId).not.toBe(persisted.checkpoint.result!.blueprint.blueprintId);
    host.actions.continuePlanning(id, 10000, 1);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    expect(host.queries.getTask(id)!.evaluatedProposals).toBe(persisted.progress.evaluatedProposals + 20);
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
    await host.whenSettled();
    expect(host.queries.getTask(file.taskId)?.status).toBe("waiting");
    expect(writes).toEqual([]);
    host.actions.continuePlanning(file.taskId, 10000);
    await host.whenSettled();
    expect(host.queries.getTask(file.taskId)?.status).toBe("failed");
    expect(host.queries.getTask(file.taskId)).toMatchObject({ evaluatedProposals: 12345, elapsedMs: 54321, areaHistory: file.progress.areaHistory });
    expect(host.queries.exportTask(file.taskId)).toEqual(file);
    expect(writes).toEqual([]);
  } finally { host.dispose(); }
  await Promise.resolve();
  expect(writes).toEqual([]);
});

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 实际继续计算期间取消的回归
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// it("导入验收期间关闭 Host 会取消恢复，不能迟到写入任务", async () => {
//   const session = new PlannerBatchSession();
//   const host = createBlueprintPlannerHost(session.workspace, { storage: null });
//   try {
//     const pending = host.actions.importTask(taskFile());
//     await Promise.resolve();
//     host.dispose();
//     await expect(pending).rejects.toThrow();
//     expect(host.queries.listTasks()).toEqual([]);
//   } finally { host.dispose(); await session.dispose(); }
// });
it("导入不做验收；继续计算时关闭 Host，不能迟到改写任务", async () => {
  const session = new PlannerBatchSession();
  const saved: BlueprintPlannerTaskFile[] = [];
  const host = createBlueprintPlannerHost(session.workspace, { storage: { load: async () => [],
    save: async file => { saved.push(structuredClone(file)); }, delete: async () => {} } });
  const verify = vi.spyOn(session.simulation.actions, "runBlueprint");
  try {
    const id = await host.actions.importTask(taskFile());
    expect(verify).not.toHaveBeenCalled();
    const before = structuredClone(saved);
    host.actions.continuePlanning(id, 10000);
    host.dispose();
    await host.whenSettled();
    expect(saved).toEqual(before);
  } finally { host.dispose(); await session.dispose(); }
});

it("继续时验收失败可导出原件；服务恢复后可重新导入并恢复", async () => {
  const session = new PlannerBatchSession();
  const unavailable = createBlueprintPlannerHost({ ...session.workspace, simulation: null }, { storage: null });
  const available = createBlueprintPlannerHost(session.workspace, { storage: null });
  try {
    const id = await unavailable.actions.importTask(taskFile());
    expect(unavailable.queries.getTask(id)?.status).toBe("waiting");
    unavailable.actions.continuePlanning(id, 10000);
    await unavailable.whenSettled();
    expect(unavailable.queries.getTask(id)?.status).toBe("failed");
    const file = unavailable.queries.exportTask(id);
    expect(file.progress.taskId).toBe(id);
    const restoredId = await available.actions.importTask(JSON.parse(JSON.stringify(file)));
    expect(available.queries.getTask(restoredId)).toMatchObject({ status: "waiting", evaluatedProposals: 12345, elapsedMs: 54321 });
    // 保存也是明确用户操作，此时才恢复验收；只需验证恢复输出，无需再运行搜索。
    const restored = await restorePlannerTaskFile(available.queries.exportTask(restoredId), session.workspace.registry,
      request => session.simulation.actions.runBlueprint(request));
    expect(restored.checkpoint.result?.blueprint.entityOrder).toHaveLength(9);
  } finally { unavailable.dispose(); available.dispose(); await session.dispose(); }
});
