// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { plannerRequestKey } from "@/blueprint-planner/search-seed";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import plant from "./fixtures/plant-preload.json";

const session = new PlannerBatchSession();
const request = readPlanningInput(session.workspace.registry, plant);
let baseline: PlannerCandidate, report: SimulationBlueprintRunReport;

beforeAll(async () => {
  // 使用真实 Worker 生成种子与蓝图；后续只控制布局 IO 的完成次序，验收仍运行 Dense 2 TPS。
  baseline = await session.planner.build(request, 0, 30_000);
  report = await session.simulation.actions.runBlueprint(baseline.execution);
  expect(report.status).toBe("completed");
  expect(report.probes[0]!.perMinute).toBeGreaterThanOrEqual(request.plan.targets[0]!.perMinute);
  await saveSuccessfulPlanning(session.workspace.registry, "global-rescheduling-baseline", baseline.execution.blueprint,
    request, { report, metrics: baseline.metrics, search: baseline.search });
}, 60_000);

afterAll(async () => { await session.dispose(); });

function originalTask(): BlueprintPlannerTaskFile {
  const pool = new PlannerSearchPortfolio(request, { ...baseline.seed!, width: baseline.seed!.width + 1 });
  const shards = Array.from({ length: 32 }, (_, index) => ({ index, nextVariant: 320 + index,
    attempts: 10, evaluations: 1000, validatedCandidates: 0, portfolio: pool.snapshot(), pendingCandidate: null,
    shapeVisits: { "stash/19/15": 10 } }));
  return { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "global-rescheduling",
    request: { ...request, options: { ...request.options, concurrency: 2, gpu: true } },
    checkpoint: { ...emptyPlannerCheckpoint(), attempt: 320, evaluations: 32000, best: { candidate: baseline, report },
      parallel: { count: 32, originTaskId: "global-rescheduling", baseAttempt: 0, baseEvaluations: 0,
        baseValidatedCandidates: 0, ownedShards: shards.map(shard => shard.index), shards,
        requestKey: plannerRequestKey(request), nextShard: 0 } },
    progress: { taskId: "global-rescheduling", status: "waiting", phase: "optimization", startedAt: 1, elapsedMs: 100,
      estimatedProgress: null, evaluatedProposals: 32000, roundEvaluatedProposals: 0, candidateCount: 320,
      validatedCandidateCount: 0, bestArea: baseline.metrics.area,
      areaHistory: [{ evaluatedProposals: 32000, bestArea: baseline.metrics.area }], message: null } };
}

function improvedCandidate(delta: number, evaluations: number): PlannerCandidate {
  const candidate = structuredClone(baseline);
  // 固定几何与产量，只控制同面积施工排名，验证此类改进也触发全局切换。
  candidate.execution.blueprint.blueprintId = `rescheduled-${delta}`;
  candidate.search.quality = { ...candidate.search.quality!, secondary: candidate.search.quality!.secondary - delta };
  candidate.search.evaluations = evaluations;
  return candidate;
}

it.each(["cancelled", "better", "worse"] as const)(
  "新最优取消 CPU/GPU 旧批次，计数守恒并处理迟到候选：%s", async late => {
    let releaseWinner!: () => void;
    const winnerReady = new Promise<void>(resolve => { releaseWinner = resolve; });
    let cpuCalls = 0, gpuCalls = 0, cancelled = 0, active = 0;
    const variants = new Set<number>();
    const postRestartSeeds: number[] = [];
    const build = (gpu: boolean): NonNullable<PlannerHostOptions["worker"]>["build"] =>
      async (_request, variant, _ms, budget, signal, update, seed, _step, maximumArea) => {
        expect(variants.has(variant)).toBe(false); variants.add(variant);
        const call = gpu ? gpuCalls++ : cpuCalls++;
        active++;
        try {
          if (!gpu && call === 0) {
            await winnerReady;
            update("layout", "候选已完成", 90);
            return improvedCandidate(1, 90);
          }
          if ((gpu && call === 0) || (!gpu && call === 1)) {
            // 一个批次已计算，另一个尚未计算；两者都必须推进分片序号。
            const used = gpu ? 103 : 0;
            update("layout", "旧目标计算中", used);
            await new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            cancelled++;
            if (gpu && late !== "cancelled") return improvedCandidate(late === "better" ? 2 : 0, used);
            throw new DOMException("旧目标取消", "AbortError");
          }
          if (seed) postRestartSeeds.push(seed.width * seed.height);
          expect(maximumArea).toBeLessThanOrEqual(baseline.metrics.area);
          await new Promise(resolve => setTimeout(resolve, 1));
          update("layout", "已完成评估", budget);
          throw new PlannerCandidateError("本批无更优布局");
        } finally { active--; }
      };
    const host = createBlueprintPlannerHost(session.workspace, { storage: null,
      worker: { build: build(false), dispose: () => undefined },
      workerFactory: () => ({ build: build(false), dispose: () => undefined }),
      gpuWorkerFactory: () => ({ build: build(true), dispose: () => undefined, gpuAvailable: true }) });
    let id = "";
    try {
      id = await host.actions.importTask(originalTask());
      host.actions.continuePlanning(id, 40_000, 2, true);
      await vi.waitFor(() => expect(active).toBe(3));
      releaseWinner();
      await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
      const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
      expect(file.progress.status, file.progress.message ?? "").toBe("waiting");
      expect(cancelled).toBe(2);
      expect(file.checkpoint.evaluations).toBe(72_000);
      expect(file.checkpoint.best!.candidate.execution.blueprint.blueprintId).toBe(`rescheduled-${late === "better" ? 2 : 1}`);
      expect(file.progress.validatedCandidateCount).toBe(late === "better" ? 2 : 1);
      expect(file.checkpoint.parallel!.shards.every(shard => shard.pendingCandidate === null)).toBe(true);
      expect(new Set(file.checkpoint.parallel!.shards.map(shard => shard.searchTarget)).size).toBe(1);
      expect(postRestartSeeds.length).toBeGreaterThan(0);
      expect(postRestartSeeds.every(area => area === baseline.metrics.area)).toBe(true);
      expect(file.checkpoint.parallel!.shards.some(shard => shard.shapeVisits["stash/19/15"] === 10)).toBe(false);
      await saveSuccessfulPlanning(session.workspace.registry, `global-rescheduling-${late}`, file.checkpoint.best!.candidate.execution.blueprint,
        file.request, { report: file.checkpoint.best!.report, progress: file.progress, note: "受控布局完成顺序，真实 Dense 验收；不作为搜索性能证据。" });
    } finally {
      releaseWinner();
      if (id) host.actions.cancel(id);
      await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull(), { timeout: 30_000 });
      host.dispose();
    }
  }, 60_000);

it("旧任务恢复重分配一次，后续暂停续算保留目标访问记录及分片计数", async () => {
  const seen = new Set<number>();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    worker: { build: async (_request, variant, _ms, budget, _signal, update) => {
      expect(seen.has(variant)).toBe(false); seen.add(variant);
      update("layout", "已完成评估", budget);
      throw new PlannerCandidateError("本批无更优布局");
    }, dispose: () => undefined } });
  let id = "";
  try {
    id = await host.actions.importTask(originalTask());
    for (let round = 1; round <= 2; round++) {
      host.actions.continuePlanning(id, 10_000, 1, false);
      await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
      const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
      expect(file.progress.status).toBe("waiting");
      expect(file.checkpoint.evaluations).toBe(32000 + round * 10000);
      expect(file.checkpoint.parallel!.shards.reduce((sum, shard) => sum
        + Object.values(shard.shapeVisits).reduce((total, visits) => total + visits, 0), 0)).toBe(round * 2);
      expect(file.checkpoint.parallel!.shards.every(shard => shard.searchTarget !== undefined)).toBe(true);
    }
    // 导入会分配新的蓝图身份；对应同一最优结果的访问记录应随引用一起保留。
    const saved = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    id = await host.actions.importTask(saved);
    host.actions.continuePlanning(id, 10_000, 1, false);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    const imported = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(imported.checkpoint.best!.candidate.execution.blueprint.blueprintId)
      .not.toBe(saved.checkpoint.best!.candidate.execution.blueprint.blueprintId);
    expect(imported.checkpoint.evaluations).toBe(62000);
    expect(imported.checkpoint.parallel!.shards.reduce((sum, shard) => sum
      + Object.values(shard.shapeVisits).reduce((total, visits) => total + visits, 0), 0)).toBe(6);
  } finally { if (id) host.actions.cancel(id); host.dispose(); }
});

it("更优候选未通过真实产量验收时，不取消其他分片或替换全局最优", async () => {
  let calls = 0, oldSignal: AbortSignal | undefined;
  const build: NonNullable<PlannerHostOptions["worker"]>["build"] = async (_request, _variant, _ms, budget, signal, update) => {
    const call = calls++;
    if (call === 0) {
      const candidate = improvedCandidate(1, 90);
      // 不提供目标探针，真实仿真报告无法证明产量达标，必须拒绝该候选。
      const execution = { ...candidate.execution, probes: [] };
      update("layout", "待验收候选", 90);
      return { ...candidate, execution };
    }
    if (call === 1) {
      oldSignal = signal;
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new DOMException("任务暂停", "AbortError");
    }
    await new Promise(resolve => setTimeout(resolve, 1));
    update("layout", "已完成评估", budget);
    throw new PlannerCandidateError("本批无候选");
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    worker: { build, dispose: () => undefined }, workerFactory: () => ({ build, dispose: () => undefined }) });
  let id = "";
  try {
    id = await host.actions.importTask(originalTask());
    const importedBest = (host.queries.exportTask(id).checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).best;
    host.actions.continuePlanning(id, 20_000, 2, false);
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
    expect(oldSignal?.aborted).toBe(false);
    const file = host.queries.exportTask(id);
    expect(file.progress.validatedCandidateCount).toBe(0);
    // AI-REMOVED 2026-10-07:
    // Reason: 导入前的蓝图 ID 不是本次任务身份，不能用来判断验收是否替换最优。
    // Trigger: 新增反向用例错误地忽略 importTask 的独立身份语义。
    // Evidence: importTask 明确调用 createUuid 更新蓝图 ID；验收次数仍为零。
    // Replacement: 下方完整比较导入后、搜索前的最优快照；Risk: Low；Human Review: Required。
    // Original code:
    // expect((file.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).best!.candidate.execution.blueprint.blueprintId)
    //   .toBe(baseline.execution.blueprint.blueprintId);
    expect((file.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).best).toEqual(importedBest);
  } finally {
    if (id) host.actions.cancel(id);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    host.dispose();
  }
});

it("离线协作恢复只重调度本地拥有的分片，不改写其他客户端的检查点", async () => {
  const input = originalTask();
  const host = createBlueprintPlannerHost(session.workspace, { storage: null,
    shardSelection: { count: 32, start: 12, end: 13 },
    worker: { build: async (_request, _variant, _ms, budget, _signal, update, seed) => {
      expect(seed?.width).toBe(baseline.seed!.width);
      update("layout", "已完成评估", budget);
      throw new PlannerCandidateError("本批无候选");
    }, dispose: () => undefined } });
  let id = "";
  try {
    id = await host.actions.importTask(input);
    host.actions.continuePlanning(id, 10_000, 1, false);
    await vi.waitFor(() => expect(host.state.activeTaskId).toBeNull());
    const output = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    expect(output.progress.status).toBe("waiting");
    expect(output.checkpoint.parallel!.ownedShards).toEqual([12]);
    for (const shard of output.checkpoint.parallel!.shards) {
      if (shard.index === 12) {
        expect(shard.searchTarget).toBeDefined();
        expect(shard.evaluations).toBe(11000);
      } else expect(shard).toEqual((input.checkpoint as ReturnType<typeof emptyPlannerCheckpoint>).parallel!.shards[shard.index]);
    }
  } finally { if (id) host.actions.cancel(id); host.dispose(); }
});
