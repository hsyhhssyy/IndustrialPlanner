// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { emptyPlannerCheckpoint, mergePlannerTaskFiles, parsePlannerTaskFile, restorePlannerTaskFile, PLANNER_ALGORITHM_VERSION,
  type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import yazhen from "./fixtures/yazhen-syringe.json";

function originalTask(concurrency: number | "auto" = 1): BlueprintPlannerTaskFile {
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "collaboration-origin",
    request: { ...request, options: { ...request.options, concurrency } }, checkpoint: emptyPlannerCheckpoint(),
    progress: { taskId: "collaboration-origin", status: "waiting", phase: "preparing", startedAt: 1,
      elapsedMs: 0, estimatedProgress: null, evaluatedProposals: 0, roundEvaluatedProposals: 0,
      candidateCount: 0, validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null } };
}

async function runRange(start: number, end: number, count: number, input: BlueprintPlannerTaskFile) {
  const session = new PlannerBatchSession();
  const clients: NodePlannerClient[] = [];
  let active = 0, maximumActive = 0;
  const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
    const client = new NodePlannerClient();
    clients.push(client);
    return { build: async (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        expect(targetOutline).toBeDefined();
        expect(evaluations).toBeLessThanOrEqual(5000);
        const candidate = await client.build(request, variant, budgetMs,
          { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline }, update, signal);
        expect(candidate.search.outline).toEqual(targetOutline);
        return candidate;
      } catch (error) {
        if (error instanceof PlannerCandidateError && error.search) expect(error.search.outline).toEqual(targetOutline);
        throw error;
      }
      finally { active--; }
    }, dispose: () => { void client.dispose(); } };
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 40,
    worker: makeWorker(), workerFactory: makeWorker, shardSelection: { count, start, end } });
  try {
    const id = await host.actions.importTask(input);
    host.actions.continuePlanning(id, 10_000);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 20));
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(file.progress.status, file.progress.message ?? undefined).toBe("waiting");
    return { file, maximumActive, clientCount: clients.length, registry: session.workspace.registry };
  } finally {
    host.dispose();
    await Promise.all(clients.map(client => client.dispose()));
    await session.dispose();
  }
}

it("真实 Node Worker 在分片内执行有界批次，并保存可恢复计数", async () => {
  const { file, maximumActive, clientCount } = await runRange(0, 32, 32, originalTask(2));
  const point = file.checkpoint;
  expect(maximumActive).toBe(1);
  expect(clientCount).toBe(1);
  expect(point.parallel?.shards.map(shard => shard.index)).toEqual(Array.from({ length: 32 }, (_, index) => index));
  expect(point.parallel?.shards.some(shard => shard.attempts > 0)).toBe(true);
  expect(point.evaluations).toBe(40);
  expect(file.progress.evaluatedProposals).toBe(point.evaluations);
}, 90_000);

it("自动模式通过真实 Worker 运行，导出不携带上次机器的活动并发", async () => {
  const { file } = await runRange(0, 32, 32, originalTask("auto"));
  expect(file.request.options.concurrency).toBe("auto");
  expect(file.progress.activeWorkerCount).toBe(0);
  expect(file.checkpoint.evaluations).toBe(40);
  expect(file.checkpoint.parallel?.count).toBe(32);
}, 90_000);

it("独立分片能从同一旧任务出发并合并，重叠和缺失均拒绝", async () => {
  const input = originalTask();
  const first = await runRange(0, 16, 32, input);
  const second = await runRange(16, 32, 32, input);
  const merged = parsePlannerTaskFile(await mergePlannerTaskFiles([first.file, second.file], first.registry), first.registry);
  expect(merged.checkpoint.parallel?.originTaskId).toBe(input.taskId);
  expect(merged.checkpoint.parallel?.ownedShards).toEqual(Array.from({ length: 32 }, (_, index) => index));
  expect(merged.checkpoint.attempt).toBe(first.file.checkpoint.attempt + second.file.checkpoint.attempt);
  expect(merged.checkpoint.evaluations).toBe(first.file.checkpoint.evaluations + second.file.checkpoint.evaluations);
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
}, 90_000);

it("较小总分片数转换到浏览器虚拟分片后，保留累计进度并重建尺寸访问记录", async () => {
  const previous = (await runRange(0, 32, 32, originalTask(2))).file;
  // 旧算法允许两片；构造其合法计数，验证升级只重建调度，不丢历史。
  const parallel = previous.checkpoint.parallel!;
  parallel.count = 2;
  parallel.shards = parallel.shards.slice(0, 2);
  parallel.ownedShards = [0, 1];
  parallel.nextShard %= 2;
  Reflect.deleteProperty(parallel, "dimensionSchedule");
  for (const shard of parallel.shards) {
    shard.nextVariant = parallel.baseAttempt + shard.index + shard.attempts * 2;
    Reflect.deleteProperty(shard, "dimensions"); Reflect.deleteProperty(shard, "dimensionCursor");
  }

  const counted = previous.checkpoint.parallel!.shards.find(shard => shard.attempts > 0)!;
  counted.shapeVisits = { "stash/999/999": counted.attempts };
  counted.shapeEvaluations = { "stash/999/999": counted.evaluations };
  const session = new PlannerBatchSession();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => 10,
    worker: { build: async (_request, _variant, _budgetMs, _evaluations, _signal, update) => {
      update("layout", "搜索中", 10);
      throw new PlannerCandidateError("本次布局无候选");
    }, dispose: () => undefined } });
  try {
    const id = await host.actions.importTask(previous);
    host.actions.continuePlanning(id, 10_000);
    while (host.state.activeTaskId !== null) await new Promise(resolve => setTimeout(resolve, 5));
    const resumed = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(resumed.checkpoint.parallel?.count).toBe(32);
    expect(resumed.checkpoint.evaluations).toBe(previous.checkpoint.evaluations + 10);
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
