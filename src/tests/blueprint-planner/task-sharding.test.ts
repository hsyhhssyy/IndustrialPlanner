// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { mergePlannerTaskFiles } from "@/blueprint-planner/task-merge";
import { restorePlannerTaskFile } from "@/blueprint-planner/task-migration";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { totalPlannerFailures } from "@/blueprint-planner/failure-summary";
import { createRegistryContract } from "@/registry";
import { partitionPlannerDimensions } from "@/blueprint-planner/dimension-schedule";
import narrowTerminal from "./fixtures/manual-narrow-terminal.json";
import yazhen from "./fixtures/yazhen-syringe.json";
// AI-CORRECTION 2026-10-29：真实 Worker 必须领取完整 X；分片回归使用两个 5,000 次单元，尾额另由 precise-budget 验证。
// AI-CORRECTION 2026-10-29：X 随设备面积变化；先以 1 次预算初始化目录，再补足两个实际 X，不能固定假设 5,000。

function originalTask(concurrency: number | "auto" = 1): BlueprintPlannerTaskFile {
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "collaboration-origin",
    request: { ...request, options: { ...request.options, concurrency } }, checkpoint: emptyPlannerCheckpoint(),
    progress: { taskId: "collaboration-origin", status: "waiting", phase: "preparing", startedAt: 1,
      elapsedMs: 0, estimatedProgress: null, evaluatedProposals: 0, roundEvaluatedProposals: 0,
      candidateCount: 0, validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null } };
}

async function runRange(start: number, end: number, count: number, input: BlueprintPlannerTaskFile, cancelImmediately = false, verifyCopy = false) {
  const session = new PlannerBatchSession();
  let initialized: ReturnType<typeof parsePlannerTaskFile> | undefined;
  const clients: NodePlannerClient[] = [];
  let active = 0, maximumActive = 0;
  let quantum = (input.checkpoint as PlannerCheckpoint).parallel?.dimensionSchedule?.attemptsPerTask ?? 0, funded = 10_000;
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
    const client = new NodePlannerClient();
    clients.push(client);
    return { build: async (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        expect(targetOutline).toBeDefined();
        expect(evaluations).toBeLessThanOrEqual(quantum);
        const candidate = await client.build(request, variant, budgetMs,
          { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
        expect(candidate.search.outline).toEqual(targetOutline);
        return candidate;
      } catch (error) {
        if (error instanceof PlannerCandidateError && error.search) expect(error.search.outline).toEqual(targetOutline);
        throw error;
      }
      finally { active--; }
    }, dispose: () => { void client.dispose(); } };
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    worker: makeWorker(), workerFactory: makeWorker, shardSelection: { count, start, end } });
  try {
    const id = await host.actions.importTask(input);
    if (!cancelImmediately) {
      host.actions.continuePlanning(id, 1);
      await host.whenSettled();
      initialized = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
      quantum = initialized.checkpoint.parallel!.dimensionSchedule!.attemptsPerTask;
      funded = 2 * quantum;
    }
    host.actions.continuePlanning(id, cancelImmediately ? funded : funded - 1);
    if (cancelImmediately) {
      // 导入先异步恢复；在开始动作提交后立即暂停，不能把取消恢复当成取消规划。
      const deadline = performance.now() + 1_000;
      while (!host.queries.getTask(id)?.planningStarted) {
        if (performance.now() > deadline) throw new Error("未能在恢复微任务完成后开始规划。");
        await Promise.resolve();
      }
      host.actions.cancel(id);
    }
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(file.progress.status, file.progress.message ?? undefined).toBe("waiting");
    if (verifyCopy) {
      const copied = await host.actions.duplicateTask(id);
      const copy = parsePlannerTaskFile(host.queries.exportTask(copied), session.workspace.registry);
      expect(copy.checkpoint.failureSummary).toBeUndefined();
      expect(copy.checkpoint.attempt).toBe(0);
    }
    return { file, initialized, funded, maximumActive, clientCount: clients.length, registry: session.workspace.registry };
  } finally {
    host.dispose();
    await Promise.all(clients.map(client => client.dispose()));
    await session.dispose();
  }
}

it("零提案分片合并保留任一分片的首次启动标记，不受文件顺序影响", async () => {
  const input = originalTask();
  const first = await runRange(0, 16, 32, input, true);
  const second = await runRange(16, 32, 32, input, true);
  const unstarted = { ...first.file, progress: { ...first.file.progress, planningStarted: false } };
  for (const files of [[unstarted, second.file], [second.file, unstarted]]) {
    const merged = await mergePlannerTaskFiles(files, first.registry);
    expect(merged.progress).toMatchObject({ planningStarted: true, evaluatedProposals: 0, candidateCount: 0 });
  }
}, 30_000);

it("真实 Node Worker 在分片内执行有界批次，并保存可恢复计数", async () => {
  const { file, initialized, funded, maximumActive, clientCount } = await runRange(0, 32, 32, originalTask(2), false, true);
  const point = file.checkpoint;
  expect(maximumActive).toBe(2);
  expect(clientCount).toBe(2);
  expect(point.parallel?.shards.map(shard => shard.index)).toEqual(Array.from({ length: 32 }, (_, index) => index));
  expect(point.parallel?.shards.some(shard => shard.attempts > 0)).toBe(true);
  expect(point.evaluations + (point.unspentEvaluations ?? 0)).toBe(funded);
  expect(totalPlannerFailures(point.failureSummary!).counts).toMatchObject({ batches: point.attempt, evaluations: point.evaluations });
  expect(file.progress.evaluatedProposals).toBe(point.evaluations);
  // AI-CORRECTION 2026-10-29：真实完整批次可能已经缩框；初始面积从搜索前快照核对，缺失字段也只从第一代恢复。
  expect(file.progress.initialArea).toBe(initialized!.progress.initialArea);
  const historyWithoutInitial = { ...initialized!, progress: { ...initialized!.progress, initialArea: undefined } };
  expect(parsePlannerTaskFile(historyWithoutInitial, createRegistryContract()).progress.initialArea).toBe(file.progress.initialArea);
}, 90_000);

it("自动模式通过真实 Worker 运行，导出不携带上次机器的活动并发", async () => {
  const { file, funded } = await runRange(0, 32, 32, originalTask("auto"));
  expect(file.request.options.concurrency).toBe("auto");
  expect(file.progress.activeWorkerCount).toBe(0);
  expect(file.checkpoint.evaluations + (file.checkpoint.unspentEvaluations ?? 0)).toBe(funded);
  expect(file.checkpoint.parallel?.count).toBe(32);
}, 90_000);

it("独立分片能从同一旧任务出发并合并，重叠和缺失均拒绝", async () => {
  const input = originalTask();
  const first = await runRange(0, 16, 32, input);
  const second = await runRange(16, 32, 32, input);
  const merged = parsePlannerTaskFile(await mergePlannerTaskFiles([first.file, second.file], first.registry), first.registry);
  expect(merged.checkpoint.parallel?.originTaskId).toBe(input.taskId);
  expect(merged.checkpoint.parallel?.ownedShards).toEqual(Array.from({ length: 32 }, (_, index) => index));
  expect(merged.checkpoint.randomSeed).toBe(first.file.checkpoint.randomSeed);
  for (const file of [first.file, second.file]) for (const index of file.checkpoint.parallel!.ownedShards) {
    expect(merged.checkpoint.parallel!.shards[index]!.strategyStates).toEqual(file.checkpoint.parallel!.shards[index]!.strategyStates);
  }
  expect(merged.checkpoint.attempt).toBe(first.file.checkpoint.attempt + second.file.checkpoint.attempt);
  expect(merged.checkpoint.evaluations).toBe(first.file.checkpoint.evaluations + second.file.checkpoint.evaluations);
  expect(merged.checkpoint.unspentEvaluations).toBe((first.file.checkpoint.unspentEvaluations ?? 0) + (second.file.checkpoint.unspentEvaluations ?? 0));
  expect(first.file.progress.initialArea).toBeGreaterThan(0);
  expect(merged.progress.initialArea).toBe(first.file.progress.initialArea);
  const conflicting = { ...second.file, progress: { ...second.file.progress, initialArea: second.file.progress.initialArea! + 1 } };
  await expect(mergePlannerTaskFiles([first.file, conflicting], first.registry)).rejects.toThrow("初始面积基准不一致");
  await expect(mergePlannerTaskFiles([first.file, first.file], first.registry)).rejects.toThrow("重复");
  await expect(mergePlannerTaskFiles([first.file], first.registry)).rejects.toThrow("不完整");
}, 90_000);

it("已运行的并行任务继续分给多人后合并，不重复累计原有验证数", async () => {
  const initial = await runRange(0, 32, 32, originalTask(2));
  const first = await runRange(0, 16, 32, initial.file);
  const second = await runRange(16, 32, 32, initial.file);
  const merged = parsePlannerTaskFile(await mergePlannerTaskFiles([first.file, second.file], first.registry), first.registry);
  const oldValidated = initial.file.progress.validatedCandidateCount;
  expect(merged.progress.validatedCandidateCount).toBe(oldValidated
    + (first.file.progress.validatedCandidateCount - oldValidated)
    + (second.file.progress.validatedCandidateCount - oldValidated));
  expect(merged.checkpoint.evaluations).toBe(first.file.checkpoint.evaluations
    + second.file.checkpoint.evaluations - initial.file.checkpoint.evaluations);
  expect(merged.checkpoint.evaluations + (merged.checkpoint.unspentEvaluations ?? 0))
    .toBe(initial.file.checkpoint.evaluations + (initial.file.checkpoint.unspentEvaluations ?? 0) + first.funded + second.funded);
  expect(totalPlannerFailures(merged.checkpoint.failureSummary!).counts).toMatchObject({
    batches: merged.checkpoint.attempt, evaluations: merged.checkpoint.evaluations });
  const continued = await runRange(0, 32, 32, JSON.parse(JSON.stringify(merged)));
  expect(totalPlannerFailures(continued.file.checkpoint.failureSummary!).counts).toMatchObject({
    batches: continued.file.checkpoint.attempt, evaluations: continued.file.checkpoint.evaluations });
  expect(continued.file.checkpoint.evaluations + (continued.file.checkpoint.unspentEvaluations ?? 0))
    .toBe(merged.checkpoint.evaluations + (merged.checkpoint.unspentEvaluations ?? 0) + continued.funded);
}, 90_000);

it("较小总分片数转换到浏览器虚拟分片后，保留累计进度并重建尺寸访问记录", async () => {
  const previous = (await runRange(0, 32, 32, originalTask(2))).file;
  // 旧算法允许两片；构造其合法计数，验证升级只重建调度，不丢历史。
  const parallel = previous.checkpoint.parallel!;
  const omitted = parallel.shards.slice(2);
  parallel.baseAttempt += omitted.reduce((sum, shard) => sum + shard.attempts, 0);
  parallel.baseEvaluations += omitted.reduce((sum, shard) => sum + shard.evaluations, 0);
  parallel.baseValidatedCandidates += omitted.reduce((sum, shard) => sum + shard.validatedCandidates, 0);
  parallel.baseVariant = parallel.baseAttempt;
  previous.checkpoint.unspentEvaluationsOwner = 0;
  parallel.count = 2;
  parallel.shards = parallel.shards.slice(0, 2);
  parallel.ownedShards = [0, 1];
  parallel.nextShard %= 2;
  Reflect.deleteProperty(parallel, "dimensionSchedule");
  for (const shard of parallel.shards) {
    shard.nextVariant = parallel.baseAttempt + shard.index + shard.attempts * 2;
    Reflect.deleteProperty(shard, "dimensions"); Reflect.deleteProperty(shard, "dimensionCursor");
    Reflect.deleteProperty(shard, "unitStates");
  }

  const counted = previous.checkpoint.parallel!.shards.find(shard => shard.attempts > 0)!;
  counted.shapeVisits = { "stash/999/999": counted.attempts };
  counted.shapeEvaluations = { "stash/999/999": counted.evaluations };
  const session = new PlannerBatchSession();
  // 完整单元及继承尾额足以启用两条通道，两个通道都必须使用本测试明确提供的 Worker。
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => ({
    build: async (_request, _variant, _budgetMs, _evaluations, _signal, update) => {
      update("layout", "搜索中", _evaluations);
      throw new PlannerCandidateError("本次布局无候选");
    }, dispose: () => undefined,
  });
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: makeWorker(), workerFactory: makeWorker });
  try {
    const id = await host.actions.importTask(previous);
    host.actions.continuePlanning(id, 10_000);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 5));
    const resumed = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(resumed.progress.status, resumed.progress.message ?? undefined).toBe("waiting");
    expect(resumed.checkpoint.parallel?.count).toBe(32);
    expect(resumed.checkpoint.evaluations + (resumed.checkpoint.unspentEvaluations ?? 0))
      .toBe(previous.checkpoint.evaluations + (previous.checkpoint.unspentEvaluations ?? 0) + 10_000);
    expect(resumed.checkpoint.parallel?.shards.every(shard => shard.shapeVisits["stash/999/999"] === undefined)).toBe(true);
  } finally { host.dispose(); await session.dispose(); }
}, 90_000);

it("暂停后调整提案预算与并发数，保留检查点且不重复搜索序号", async () => {
  const session = new PlannerBatchSession();
  let active = 0, maximumActive = 0;
  const variants: number[] = [];
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => ({
    build: async (_request, variant, _budgetMs, _evaluations, _signal, update) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      variants.push(variant);
      try {
        await new Promise(resolve => setTimeout(resolve, 2));
        update("layout", "搜索中", _evaluations);
        throw new PlannerCandidateError("本次布局无候选");
      } finally { active--; }
    },
    dispose: () => undefined,
  });
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 80_000,
    worker: makeWorker(), workerFactory: makeWorker });
  try {
    const id = await host.actions.importTask(originalTask(2));
    const run = async (proposals: number, concurrency?: number) => {
      maximumActive = 0;
      host.actions.continuePlanning(id, proposals, concurrency);
      while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 5));
      const exported = host.queries.exportTask(id);
      expect(exported.progress.evaluatedProposals).toBe((exported.checkpoint as PlannerCheckpoint).evaluations);
      expect(exported.progress.roundEvaluatedProposals).toBeLessThanOrEqual(exported.request.options.evaluationsPerRound);
      return parsePlannerTaskFile(exported, session.workspace.registry);
    };
    const first = await run(100_000);
    expect(maximumActive).toBe(2);
    expect(first.checkpoint.parallel?.count).toBe(32);
    const legacy = structuredClone({ ...first, algorithmVersion: "compact-portfolio-2" });
    Reflect.deleteProperty(legacy.checkpoint.parallel!, "nextShard");
    for (const shard of legacy.checkpoint.parallel!.shards) Reflect.deleteProperty(shard, "shapeVisits");
    const migrated = await restorePlannerTaskFile(legacy, session.workspace.registry,
      execution => session.workspace.simulation!.actions.runBlueprint(execution));
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: 下方断言：旧面积口径下的分片必须重置。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//     expect(migrated.checkpoint.evaluations).toBe(first.checkpoint.evaluations);
//     expect(migrated.checkpoint.parallel?.shards.every(shard => Object.keys(shard.shapeVisits).length === 0)).toBe(true);
    // AI-CORRECTION 2026-10-06：只重建分片内部状态，累计搜索次数和历史仍保留。
    expect(migrated.checkpoint.evaluations).toBe(first.checkpoint.evaluations);
    expect(migrated.checkpoint.parallel).toBeUndefined();
    expect(migrated.progress.bestArea).toBeNull();

    const decreased = await run(200_000, 1);
    expect(maximumActive).toBe(1);
    expect(decreased.checkpoint.parallel?.count).toBe(32);
    expect(decreased.request.options).toMatchObject({ evaluationsPerRound: 200_000, concurrency: 1 });

    const increased = await run(300_000, 4);
    expect(maximumActive).toBe(4);
    expect(increased.checkpoint.parallel?.count).toBe(32);
    expect(increased.request.options).toMatchObject({ evaluationsPerRound: 300_000, concurrency: 4 });
    expect(increased.checkpoint.evaluations).toBe(240_000);
    expect(increased.progress.roundEvaluatedProposals).toBe(80_000);
    expect(new Set(variants).size).toBe(variants.length);
    expect(() => host.actions.continuePlanning(id, 10_000, 33)).toThrow("并发计算数");
    expect(host.queries.getLastRequest(id)?.options.concurrency).toBe(4);
  } finally {
    host.dispose();
    await session.dispose();
  }
}, 90_000);

it.each([0, null] as const)("精确定位任务方向%s初始化、分片合并及再次导入保留尺寸约束和未消费预算", async rotation => {
  const request = structuredClone(narrowTerminal) as BlueprintPlannerRequest;
  const manual = request.manualLayout!;
  const input: BlueprintPlannerTaskFile = { ...originalTask(), request: { ...request,
    manualLayout: { ...manual, boundary: { ...manual.boundary, rotation, position: { base: 13, left: 0, right: 3 } } } } };
  const initialize = async (source: BlueprintPlannerTaskFile, start: number, end: number) => {
    const session = new PlannerBatchSession(), client = new NodePlannerClient();
    const worker: NonNullable<PlannerHostOptions["worker"]> = {
      build: (value, variant, _budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) =>
        client.build(value, variant, _budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal),
      dispose: () => { void client.dispose(); },
    };
    const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker, shardSelection: { count: 32, start, end } });
    try {
      const id = await host.actions.importTask(source);
      // 一次预算低于实际单元额度，只生成真实调度并保留预算，不启动搜索。
      host.actions.continuePlanning(id, 1);
      await host.whenSettled();
      const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
      expect(file.progress.status, file.progress.message ?? undefined).toBe("waiting");
      expect(file.checkpoint.evaluations).toBe(0);
      const schedule = file.checkpoint.parallel!.dimensionSchedule!;
      expect(schedule.manualPosition).toMatchObject({ rotation: 0, exactWidth: 3 });
      expect(file.checkpoint.parallel!.shards.flatMap(shard => shard.dimensions ?? []).length).toBeGreaterThan(0);
      expect(file.checkpoint.parallel!.shards.flatMap(shard => shard.dimensions ?? []).every(dimension => dimension.width === 3)).toBe(true);
      return file;
    } finally { host.dispose(); await client.dispose(); await session.dispose(); }
  };
  const first = await initialize(input, 0, 16), second = await initialize(input, 16, 32);
  const registry = createRegistryContract();
  const merged = parsePlannerTaskFile(await mergePlannerTaskFiles([first, second], registry), registry);
  expect(merged.request.manualLayout!.boundary.position).toEqual({ base: 13, left: 0, right: 3 });
  expect(merged.request.manualLayout!.orientation).toBe("fixed");
  expect(merged.request.manualLayout!.boundary.rotation).toBe(rotation);
  const schedule = merged.checkpoint.parallel!.dimensionSchedule!;
  expect(schedule.manualPosition).toEqual(first.checkpoint.parallel!.dimensionSchedule!.manualPosition);
  expect(merged.checkpoint.parallel!.shards.map(shard => shard.dimensions)).toEqual(partitionPlannerDimensions(schedule.targetArea,
    schedule.minimum, schedule.warehousePorts, schedule.inclusive, schedule.boundaryLength, schedule.limits, schedule.manualSpans, schedule.manualPosition));
  expect(merged.checkpoint.unspentEvaluations).toBe(2);
  const continued = await initialize(JSON.parse(JSON.stringify(merged)), 0, 32);
  expect(continued.checkpoint.unspentEvaluations).toBe(3);
  expect(continued.checkpoint.parallel!.dimensionSchedule!.manualPosition).toEqual(schedule.manualPosition);
});

it.each([
  { orientation: "free" as const, rotation: 0 as const },
  { orientation: "fixed" as const, rotation: null },
])("离线合并入口校验固定朝向，未选旧方向不阻断：%j", async ({ orientation, rotation }) => {
  const file = originalTask();
  const request = file.request as BlueprintPlannerRequest;
  const manualLayout = { enabled: true, mode: "recipe" as const, orientation,
    boundary: { rotation, assignments: [], position: { base: 20, left: null, right: null } },
    facilities: [], placements: [], preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } };
  const invalid = { ...file, request: { ...request, manualLayout } };
  // 没有调度／成果时也必须先检查模式，不能等算法或UI替它发现非法条件。
  // 订正 2026-11-21：固定设备组直接采用草稿实际朝向，rotation:null不再是缺失条件。
  // Original code: await expect(mergePlannerTaskFiles([invalid], createRegistryContract())).rejects.toThrow("绝对定位要求");
  if (orientation === "free") await expect(mergePlannerTaskFiles([invalid], createRegistryContract())).rejects.toThrow("按边界定位要求");
  // 原夹具刻意没有分片检查点；fixed/null必须通过方向门禁并进入下一层检查。
  else await expect(mergePlannerTaskFiles([invalid], createRegistryContract())).rejects.toThrow("任务没有分片检查点。");
});
