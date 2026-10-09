// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { capturePlannerSeed } from "@/blueprint-planner/search-seed";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import yazhen from "./fixtures/yazhen-syringe.json";
import environment from "./fixtures/environment-supply.json";
import powerFixture from "./fixtures/power-validation.json";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

function taskFile(): BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest } {
  return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "test-task",
    request: structuredClone(yazhen.request) as BlueprintPlannerRequest, checkpoint: emptyPlannerCheckpoint(),
    progress: { taskId: "test-task", status: "waiting", phase: "preparing", startedAt: 1,
      elapsedMs: 0, estimatedProgress: null, evaluatedProposals: 0, roundEvaluatedProposals: 0, candidateCount: 0, validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null } };
}

it("恢复检查点拒绝超限宽高，并保持原始任务数据不变", () => {
  const registry = createRegistryContract();
  const candidate: PlannerCandidate = {
    execution: { ...powerFixture.execution,
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/power-validation/covered.schema7.json") } as SimulationBlueprintRunRequest,
    metrics: powerFixture.metrics, connections: [], supplyAudit: { operatingLimits: [], splitterCount: 0, bufferedAdmissions: 0 },
    search: { seed: 0, evaluationLimit: 10000, evaluations: 0, acceptedMoves: 0, routingAttempts: 0,
      initialWireLength: 0, finalWireLength: 0, outline: powerFixture.metrics },
  };
  const file = { ...taskFile(), request: powerFixture.request as BlueprintPlannerRequest,
    checkpoint: { ...emptyPlannerCheckpoint(), pendingCandidate: candidate } };
  expect(parsePlannerTaskFile(structuredClone(file), registry).checkpoint.pendingCandidate?.metrics).toEqual(candidate.metrics);
  for (const metrics of [{ ...candidate.metrics, width: 71, height: 60, area: 4260 },
    { ...candidate.metrics, width: 60, height: 71, area: 4260 }]) {
    const invalid = { ...file, checkpoint: { ...file.checkpoint, pendingCandidate: { ...candidate, metrics } } };
    const original = JSON.stringify(invalid);
    expect(() => parsePlannerTaskFile(invalid, registry)).toThrow("70");
    expect(JSON.stringify(invalid)).toBe(original);
  }
});

it("未启动草稿可导出并导入，保留当前配置且不需要仿真服务", async () => {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const host = createBlueprintPlannerHost(workspace, { storage: null });
  const request = structuredClone(environment) as BlueprintPlannerRequest;
  const configured: BlueprintPlannerRequest = { ...request, options: { ...request.options,
    concurrency: "auto", evaluationsPerRound: 70_000,
    itemPolicies: [{ itemId: "item_liquid_acid", supply: "external" }] } };
  try {
    const revision = host.state.revision;
    const file = host.queries.exportDraft(configured);
    const second = host.queries.exportDraft(configured);
    expect(second.taskId).not.toBe(file.taskId);
    expect(host.queries.listTasks()).toEqual([]);
    expect(host.state.activeTaskId).toBeNull();
    expect(host.state.revision).toBe(revision);
    const parsed = parsePlannerTaskFile(JSON.parse(JSON.stringify(file)), workspace.registry);
    expect(parsed.request).toEqual(configured);
    expect(parsed.checkpoint).toEqual(emptyPlannerCheckpoint());
    expect(parsed.progress).toMatchObject({ taskId: file.taskId, status: "waiting", elapsedMs: 0,
      evaluatedProposals: 0, roundEvaluatedProposals: 0, candidateCount: 0, validatedCandidateCount: 0 });
    const id = await host.actions.importTask(parsed);
    expect(host.queries.getLastRequest(id)).toEqual(configured);
    expect(host.queries.getTask(id)?.status).toBe("waiting");
    expect(host.queries.getResult(id)).toBeNull();
    expect(host.state.activeTaskId).toBeNull();
    Object.assign(configured.options, { evaluationsPerRound: 90_000 });
    Object.assign(file.request.options, { evaluationsPerRound: 20_000 });
    expect(second.request.options.evaluationsPerRound).toBe(70_000);
    expect(host.queries.getLastRequest(id)?.options.evaluationsPerRound).toBe(70_000);
  } finally { host.dispose(); }
});

it("草稿下载不受启动准入限制，仍完整保留未满足条件的配置", () => {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const host = createBlueprintPlannerHost(workspace, { storage: null });
  const request = taskFile().request;
  const invalid = { ...request, plan: { ...request.plan, containsModules: true },
    options: { ...request.options, evaluationsPerRound: 0 } };
  try {
    expect(host.queries.exportDraft(invalid).request).toEqual(invalid);
    expect(host.queries.listTasks()).toEqual([]);
    expect(host.state.activeTaskId).toBeNull();
  } finally { host.dispose(); }
});

it("检查点往返保持布局池的访问次数、轮换顺序和独立输出拓扑", () => {
  const registry = createRegistryContract();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const auto = { ...request, options: { ...request.options, solidOutput: "auto" as const } };
  const pool = new PlannerSearchPortfolio(auto);
  for (const mode of ["stash", "warehouse"] as const) {
    const input = { ...request, options: { ...request.options, solidOutput: mode } };
    const seed = capturePlannerSeed(input, createProductionNetwork(registry, input), [], [], 20, 20);
    pool.remember(seed);
    const other = structuredClone(seed);
    other.network.nodes[0]!.entity.position = { ...other.network.nodes[0]!.entity.position, x: other.network.nodes[0]!.entity.position.x + 1 };
    pool.remember(other);
  }
  for (let i = 0; i < 17; i++) pool.next(i);
  const restored = new PlannerSearchPortfolio(auto);
  restored.restore(JSON.parse(JSON.stringify(pool.snapshot())));
  for (let i = 17; i < 40; i++) expect(restored.next(i)).toEqual(pool.next(i));
});

it("检查点使用原始请求校验归一化网络，不重置已完成的搜索池", () => {
  const registry = createRegistryContract(), file = taskFile();
  const seed = capturePlannerSeed(file.request, createProductionNetwork(registry, file.request), [], [], 20, 20);
  const pool = new PlannerSearchPortfolio(file.request, seed);
  pool.next(0); pool.next(1);
  const checkpoint = { ...emptyPlannerCheckpoint(), portfolio: pool.snapshot() };
  const parsed = parsePlannerTaskFile(JSON.parse(JSON.stringify({ ...file, checkpoint })), registry);
  expect(parsed.checkpoint.portfolio).toEqual(checkpoint.portfolio);
});

it("拒绝不兼容版本、错误计数与无效选项，不能降级为从头计算", () => {
  const registry = createRegistryContract(), file = taskFile();
  expect(parsePlannerTaskFile(JSON.parse(JSON.stringify(file)), registry)).toEqual(file);
  expect(() => parsePlannerTaskFile({ ...file, algorithmVersion: "future" }, registry)).toThrow("版本不兼容");
  expect(() => parsePlannerTaskFile({ ...file, checkpoint: { ...emptyPlannerCheckpoint(), attempt: -1 } }, registry)).toThrow("计数无效");
  expect(() => parsePlannerTaskFile({ ...file, request: { ...file.request, options: { ...file.request.options, solidSupply: "invalid" } } }, registry)).toThrow("规划选项");
});

it("自动任务可以跨机器恢复，活动 Worker 数不会随文件恢复", () => {
  const registry = createRegistryContract(), file = taskFile();
  const input = { ...file, request: { ...file.request, options: { ...file.request.options, concurrency: "auto" as const } },
    progress: { ...file.progress, activeWorkerCount: 3 } };
  const restored = parsePlannerTaskFile(JSON.parse(JSON.stringify(input)), registry);
  expect(restored.request.options.concurrency).toBe("auto");
  expect(restored.progress.activeWorkerCount).toBe(0);
  expect(restored.checkpoint).toEqual(file.checkpoint);
  expect(input.progress.activeWorkerCount).toBe(3);
  expect(() => parsePlannerTaskFile({ ...input, progress: { ...input.progress, activeWorkerCount: -1 } }, registry)).toThrow("并行状态无效");
});

it("真实 Worker 与仿真 Host 支持多任务导入、续算检查点与删除隔离", async () => {
  const session = new PlannerBatchSession();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 10,
    worker: {
      build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline) =>
        session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline }, update, signal),
      dispose: () => { void session.planner.dispose(); },
    },
  });
  try {
    const first = await host.actions.importTask(taskFile());
    const second = await host.actions.importTask(taskFile());
    expect(first).not.toBe(second);
    host.actions.continuePlanning(first, 10_000);
    expect(() => host.actions.continuePlanning(second, 10_000)).toThrow("已有任务");
    await expect(host.actions.importTask(taskFile())).rejects.toThrow("已有任务");
    expect(host.queries.listTasks().map(task => task.taskId)).toEqual(expect.arrayContaining([first, second]));
    expect(host.queries.listTasks()).toHaveLength(2);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const file = parsePlannerTaskFile(JSON.parse(JSON.stringify(host.queries.exportTask(first))), session.workspace.registry);
    expect(file.checkpoint.attempt).toBeGreaterThan(0);
    expect(file.checkpoint.evaluations).toBe(10);
    expect(file.progress.evaluatedProposals).toBe(10);
    expect(file.progress.roundEvaluatedProposals).toBe(10);
    const imported = await host.actions.importTask(file);
    expect(host.queries.getTask(imported)?.candidateCount).toBe(file.progress.candidateCount);
    await host.actions.deleteTask(second);
    expect(host.queries.listTasks().map(task => task.taskId)).toEqual(expect.arrayContaining([first, imported]));
    expect(host.queries.getTask(second)).toBeNull();
    host.actions.continuePlanning(imported, 10_000);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const resumed = parsePlannerTaskFile(host.queries.exportTask(imported), session.workspace.registry);
    expect(resumed.checkpoint.attempt).toBeGreaterThan(file.checkpoint.attempt);
    expect(resumed.checkpoint.evaluations).toBe(20);
    expect(resumed.progress.evaluatedProposals).toBe(20);
    expect(resumed.progress.roundEvaluatedProposals).toBe(10);
    expect(host.queries.getTask(first)?.candidateCount).toBe(file.progress.candidateCount);
  } finally { host.dispose(); await session.dispose(); }
}, 90_000);

it("真实 Worker 暂停结算已用提案，续算只重置本轮计数且不受旧时间预算影响", async () => {
  const session = new PlannerBatchSession();
  let requestedPause = false;
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    worker: {
      build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline) =>
        session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline },
          (phase, message, count) => {
            update(phase, message, count);
            if (!requestedPause && count > 0) {
              requestedPause = true;
              host.actions.cancel(host.state.activeTaskId!);
            }
          }, signal),
      dispose: () => { void session.planner.dispose(); },
    },
  });
  try {
    const original = taskFile();
    const file = { ...original, request: { ...original.request,
      options: { ...original.request.options, budgetMs: 1, evaluationsPerRound: 100_000 } } };
    const id = await host.actions.importTask(file);
    host.actions.continuePlanning(id, 100_000);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const paused = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(requestedPause).toBe(true);
    expect(paused.progress.status).toBe("waiting");
    expect(paused.progress.evaluatedProposals).toBeGreaterThan(0);
    expect(paused.progress.evaluatedProposals).toBeLessThan(100_000);
    expect(paused.progress.roundEvaluatedProposals).toBe(paused.checkpoint.evaluations);
    expect(paused.progress.elapsedMs).toBeGreaterThan(1);
    const imported = await host.actions.importTask(JSON.parse(JSON.stringify(paused)));
    expect(host.queries.getTask(imported)?.evaluatedProposals).toBe(paused.checkpoint.evaluations);
    host.actions.continuePlanning(imported, 10_000);
    expect(host.queries.getTask(imported)?.roundEvaluatedProposals).toBe(0);
    expect(host.queries.getTask(imported)?.evaluatedProposals).toBe(paused.checkpoint.evaluations);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const continued = host.queries.getTask(imported)!;
    expect(continued.roundEvaluatedProposals).toBe(10_000);
    expect(continued.evaluatedProposals).toBe(paused.checkpoint.evaluations + 10_000);
  } finally { host.dispose(); await session.dispose(); }
}, 90_000);

it("已知旧算法保留累计进度并重建搜索状态，未知版本与无效输入不猜测迁移", async () => {
  const { restorePlannerTaskFile } = await import("@/blueprint-planner/task-checkpoint");
  const registry = createRegistryContract();
  const file = { ...taskFile(), algorithmVersion: "compact-portfolio-1", checkpoint: { obsolete: true },
    progress: { ...taskFile().progress, elapsedMs: 1234, candidateCount: 12, evaluatedProposals: 100, bestArea: 20 } };
  const original = structuredClone(file);
  const restored = await restorePlannerTaskFile(file, registry);
  expect(restored.request).toEqual(file.request);
  expect(restored.taskId).toBe(file.taskId);
  expect(restored.algorithmVersion).toBe(PLANNER_ALGORITHM_VERSION);
  expect(restored.checkpoint).toEqual({ ...emptyPlannerCheckpoint(), attempt: 12, evaluations: 100, legacyHistoryLength: 0 });
  expect(restored.progress).toMatchObject({ status: "waiting", elapsedMs: 1234, candidateCount: 12,
    evaluatedProposals: 100, roundEvaluatedProposals: 0, bestArea: null, startedAt: 1 });
  expect(restored.progress.message).toContain("保留");
  expect(file).toEqual(original);
  expect(await restorePlannerTaskFile(restored, registry)).toEqual(restored);
  for (const algorithmVersion of ["future", "compact-portfolio-3", "compact-portfolio-0"])
    await expect(restorePlannerTaskFile({ ...file, algorithmVersion }, registry)).rejects.toThrow();
  await expect(restorePlannerTaskFile({ ...file, request: { ...file.request,
    options: { ...file.request.options, evaluationsPerRound: -1 } } }, registry)).rejects.toThrow();
});

it("启动不验收旧算法；无法读取的任务保留原文，继续操作才报错", async () => {
  const session = new PlannerBatchSession();
  const original = { ...taskFile(), taskId: "blocked", algorithmVersion: "future", request: null } as unknown as BlueprintPlannerTaskFile;
  const old = { ...taskFile(), algorithmVersion: "compact-portfolio-1" };
  const records = new Map([[original.taskId, original], [old.taskId, old]]);
  const { hasStorageFailure } = await import("@/shared/storage/storage-failure");
  const before = hasStorageFailure();
  const storage = { load: async () => structuredClone([...records.values()]),
    save: async (file: BlueprintPlannerTaskFile) => { records.set(file.taskId, structuredClone(file)); },
    delete: async (id: string) => { records.delete(id); } };
  const host = createBlueprintPlannerHost(session.workspace, { storage, worker: {
    build: (...args) => session.planner.build(args[0], args[1], args[2], { maxEvaluations: args[3] }, args[5], args[4]),
    dispose: () => {},
  } });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.queries.listTasks()).toHaveLength(2);
    expect(host.queries.getTask("blocked")?.status).toBe("waiting");
    expect(host.queries.getLastRequest("blocked")).toBeNull();
    expect(host.queries.exportTask("blocked")).toEqual(original);
    host.actions.continuePlanning("blocked", 10_000);
    await host.whenSettled();
    expect(host.queries.getTask("blocked")?.status).toBe("failed");
    expect(hasStorageFailure()).toBe(before);
    expect(records.get(old.taskId)).toEqual(old);
    expect(host.queries.getTask(old.taskId)?.message).toContain("继续");
    const imported = await host.actions.importTask(original);
    expect(host.queries.getTask(imported)?.status).toBe("failed");
    expect(host.queries.exportTask(imported)).toEqual({ ...original, taskId: imported, progress: { ...original.progress, taskId: imported, status: "waiting", activeWorkerCount: 0 } });
    await host.actions.deleteTask(imported);
    expect(records.has(imported)).toBe(false);
    host.dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(records.get("blocked")).toEqual(original);
  } finally { host.dispose(); await session.dispose(); }
}, 30_000);

it("异步导入提交前禁止启动、续算、保存及再次导入，提交后释放入口", async () => {
  const file = taskFile();
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writing = false;
  const storage = { load: async () => [file], delete: async () => {},
    save: async () => { writing = true; await gate; } };
  const host = createBlueprintPlannerHost(workspace, { storage });
  const pending = host.actions.importTask(file);
  try {
    await vi.waitFor(() => expect(writing).toBe(true));
    expect(() => host.actions.start(file.request)).toThrow("导入");
    expect(() => host.actions.continuePlanning(file.taskId, 10_000)).toThrow("导入");
    await expect(host.actions.save(file.taskId)).rejects.toThrow("导入");
    await expect(host.actions.importTask(file)).rejects.toThrow("导入");
    expect(host.queries.listTasks()).toHaveLength(1);
    release();
    const imported = await pending;
    expect(imported).not.toBe(file.taskId);
    expect(host.queries.listTasks()).toHaveLength(2);
    await host.actions.importTask(file);
    expect(host.queries.listTasks()).toHaveLength(3);
  } finally {
    release();
    await pending.catch(() => {});
    host.dispose();
  }
});

it("隔离损坏的历史时只展示可读取的曲线和计数，导出保留原文", async () => {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const host = createBlueprintPlannerHost(workspace, { storage: null });
  try {
    for (const areaHistory of ["invalid", [null], [{ evaluatedProposals: -1, bestArea: 1 }]]) {
      const file = { ...taskFile(), algorithmVersion: "future", progress: { ...taskFile().progress,
        evaluatedProposals: -1, elapsedMs: -1, areaHistory } } as unknown as BlueprintPlannerTaskFile;
      const id = await host.actions.importTask(file);
      expect(host.queries.getTask(id)).toMatchObject({ status: "waiting", evaluatedProposals: 0, elapsedMs: 0, areaHistory: [] });
      expect(host.queries.exportTask(id)).toEqual({ ...file, taskId: id, progress: { ...file.progress, taskId: id, status: "waiting", activeWorkerCount: 0 } });
    }
  } finally { host.dispose(); }
});

it("导入校验或持久化失败后释放入口，不创建半完成任务", async () => {
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(),
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  let failWrite = true;
  const storage = { load: async () => [], delete: async () => {},
    save: async () => { if (failWrite) throw new Error("导入写入失败"); } };
  const host = createBlueprintPlannerHost(workspace, { storage });
  try {
    await expect(host.actions.importTask(null as unknown as BlueprintPlannerTaskFile)).rejects.toThrow();
    await expect(host.actions.importTask(taskFile())).rejects.toThrow("导入写入失败");
    expect(host.queries.listTasks()).toHaveLength(0);
    failWrite = false;
    const id = await host.actions.importTask(taskFile());
    expect(host.queries.getTask(id)?.status).toBe("waiting");
    expect(host.queries.listTasks()).toHaveLength(1);
  } finally { host.dispose(); }
});

it("真实 Worker 暂停请求发出后仍禁止导入，完成收尾后恢复导入", async () => {
  const session = new PlannerBatchSession();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 10,
    worker: {
      build: (...args) => session.planner.build(args[0], args[1], args[2], { maxEvaluations: args[3] }, args[5], args[4]),
      dispose: () => {},
    },
  });
  try {
    const id = await host.actions.importTask(taskFile());
    host.actions.continuePlanning(id, 10_000);
    host.actions.cancel(id);
    expect(host.state.activeTaskId).toBe(id);
    await expect(host.actions.importTask(taskFile())).rejects.toThrow("已有任务");
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    await host.actions.importTask(taskFile());
    expect(host.queries.listTasks()).toHaveLength(2);
  } finally { host.dispose(); await session.dispose(); }
});
