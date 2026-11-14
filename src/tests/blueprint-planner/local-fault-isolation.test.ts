// @vitest-environment node
// 2026-11-14：REQ-049；从全物品真实故障提取，验证局部失败范围与实际计数。
import { beforeAll, describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { PlannerCandidateError, PlannerWorkerUnavailableError } from "@/blueprint-planner/model";
import type { PlannerSearchOptions } from "@/blueprint-planner/search-types";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { totalPlannerFailures } from "@/blueprint-planner/failure-summary";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import incident from "./fixtures/partition-feedback-transition.json";
import small from "./fixtures/power-no-space.json";

it("真实故障请求经过分区和融合搜索，只交付有效候选或正常候选拒绝，不泄漏内部异常", async () => {
  const client = new NodePlannerClient();
  const request = structuredClone(incident.request) as BlueprintPlannerRequest;
  const search = structuredClone(incident.search) as PlannerSearchOptions;
  let reported = 0;
  try {
    const outcome = await client.build(request, incident.variant, null, search,
      (_phase, _message, count) => { reported = count; }).then(
      candidate => ({ candidate, error: undefined }),
      (error: unknown) => ({ candidate: undefined, error }),
    );
    if (outcome.candidate) {
      expect(outcome.candidate.metrics.area).toBeLessThanOrEqual(search.maximumArea!);
      expect(outcome.candidate.search.evaluations).toBe(reported);
    } else {
      expect(outcome.error).toBeInstanceOf(PlannerCandidateError);
      if (!(outcome.error instanceof PlannerCandidateError)) return;
      expect(outcome.error.search?.evaluations).toBe(reported);
      expect(outcome.error.search?.evaluations).toBe(search.maxEvaluations);
    }
    expect(reported).toBeGreaterThan(0);
  } finally { await client.dispose(); }
}, 180_000);

/** 在真实 Worker 完成一个批次后制造一次通道异常；后续计算仍走正式 Worker。 */
async function runWithOneLocalFault(options: {
  beforeProgress?: boolean; failures?: number; cancelAfterFault?: boolean; unavailable?: boolean;
} = {}) {
  const session = new PlannerBatchSession();
  const clients: NodePlannerClient[] = [];
  const records: Array<{ evaluations: number; startedAfterFault: boolean }> = [];
  let injected = false;
  const factory: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
    const client = new NodePlannerClient();
    clients.push(client);
    return {
      build: async (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep,
        maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
        const first = records.length === 0;
        const shouldFault = first || records.length < (options.failures ?? 1);
        const record = { evaluations: 0, startedAfterFault: injected };
        records.push(record);
        if (shouldFault && options.beforeProgress) {
          injected = true;
          if (options.unavailable) throw new PlannerWorkerUnavailableError("REQ-049 执行通道无法启动");
          throw new Error("REQ-049 零进度局部执行故障");
        }
        const outcome = await client.build(request, variant, budgetMs,
          { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy },
          (phase, message, count) => {
            record.evaluations = count;
            update(phase, message, count);
          }, signal).then(
          candidate => ({ candidate, error: undefined }),
          (error: unknown) => ({ candidate: undefined, error }),
        );
        // 只改变一次完成消息的失败条件，不伪造计算进度、不替换搜索或验收逻辑。
        if (shouldFault && record.evaluations > 0 && !signal.aborted
          && (outcome.candidate || outcome.error instanceof PlannerCandidateError)) {
          injected = true;
          if (options.cancelAfterFault) host.actions.cancel(id!);
          throw new Error("REQ-049 单次局部执行故障");
        }
        if (outcome.candidate) return outcome.candidate;
        throw outcome.error;
      },
      dispose: () => { void client.dispose(); },
    };
  };
  const host = createBlueprintPlannerHost(session.workspace, { storage: null, worker: factory(), workerFactory: factory });
  let id: string | undefined;
  try {
    const request = structuredClone(small.request) as BlueprintPlannerRequest;
    id = await host.actions.importTask(host.queries.exportDraft({ ...request,
      options: { ...request.options, evaluationsPerRound: 1, concurrency: 2, gpu: false, deterministicSearch: false } }));
    // 先让正式 Host 建立尺寸与原生批次预算；1 次尾额不会派发不完整批次。
    host.actions.continuePlanning(id, 1);
    await host.whenSettled();
    const initialized = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    const quantum = initialized.checkpoint.parallel!.dimensionSchedule!.attemptsPerTask;
    const funded = quantum * 3;
    host.actions.continuePlanning(id, funded - 1);
    await host.whenSettled();
    const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
    return { file, funded, records, injected };
  } finally {
    if (id && host.state.activeTaskId === id) host.actions.cancel(id);
    try { await host.whenSettled(); }
    finally {
      host.dispose();
      await Promise.all(clients.map(client => client.dispose()));
      await session.dispose();
    }
  }
}

describe("真实 Host 的单次局部执行故障", () => {
  let outcome: Awaited<ReturnType<typeof runWithOneLocalFault>>;
  beforeAll(async () => { outcome = await runWithOneLocalFault(); }, 90_000);

  it("故障后继续派发并实际执行后续工作，不将整个 EDA 标为失败", () => {
    expect(outcome.injected).toBe(true);
    expect(outcome.records.some(record => record.startedAfterFault && record.evaluations > 0)).toBe(true);
    expect(outcome.file.progress.status, outcome.file.progress.message ?? undefined).not.toBe("failed");
  });

  it("故障批次实际消耗与其他通道一并结算，任务、分片和失败统计计数守恒", () => {
    expect(outcome.injected).toBe(true);
    const actual = outcome.records.reduce((sum, record) => sum + record.evaluations, 0);
    const checkpoint = outcome.file.checkpoint;
    expect(actual).toBeGreaterThan(0);
    expect(totalPlannerFailures(checkpoint.failureSummary!).counts.evaluations).toBe(actual);
    expect(checkpoint.evaluations).toBe(actual);
    expect(checkpoint.parallel!.shards.reduce((sum, shard) => sum + shard.evaluations, 0)).toBe(actual);
    expect(outcome.file.progress.evaluatedProposals).toBe(actual);
    expect(actual + (checkpoint.unspentEvaluations ?? 0)).toBe(outcome.funded);
  });
});

it("连续两次零进度局部故障仍能重建并执行，保留完整计算预算", async () => {
  const outcome = await runWithOneLocalFault({ beforeProgress: true, failures: 2 });
  expect(outcome.injected).toBe(true);
  expect(outcome.records.slice(0, 2).map(record => record.evaluations)).toEqual([0, 0]);
  expect(outcome.records.some(record => record.startedAfterFault && record.evaluations > 0)).toBe(true);
  expect(outcome.file.progress.status, outcome.file.progress.message ?? undefined).not.toBe("failed");
  const actual = outcome.records.reduce((sum, record) => sum + record.evaluations, 0);
  expect(outcome.file.checkpoint.evaluations).toBe(actual);
  expect(actual + (outcome.file.checkpoint.unspentEvaluations ?? 0)).toBe(outcome.funded);
}, 90_000);

it("局部故障与用户暂停同时到达时准确结算，不继续派发恢复工作", async () => {
  const outcome = await runWithOneLocalFault({ cancelAfterFault: true });
  expect(outcome.injected).toBe(true);
  expect(outcome.records.some(record => record.startedAfterFault)).toBe(false);
  expect(outcome.file.progress.status, outcome.file.progress.message ?? undefined).not.toBe("failed");
  expect(outcome.file.progress.activeWorkerCount).toBe(0);
  expect(outcome.file.checkpoint.evaluations).toBe(outcome.records.reduce((sum, record) => sum + record.evaluations, 0));
}, 90_000);

it("单个通道无法启动时由健康通道完成预算，不终止整个 EDA", async () => {
  const outcome = await runWithOneLocalFault({ beforeProgress: true, unavailable: true });
  expect(outcome.injected).toBe(true);
  expect(outcome.records.some(record => record.startedAfterFault && record.evaluations > 0)).toBe(true);
  expect(outcome.file.progress.status, outcome.file.progress.message ?? undefined).not.toBe("failed");
  expect(outcome.file.checkpoint.evaluations + (outcome.file.checkpoint.unspentEvaluations ?? 0)).toBe(outcome.funded);
}, 90_000);

it("全部通道无法启动时保留完整预算并暂停，不能标成产线失败或无限重试", async () => {
  const outcome = await runWithOneLocalFault({ beforeProgress: true, unavailable: true, failures: Infinity });
  expect(outcome.injected).toBe(true);
  expect(outcome.records.every(record => record.evaluations === 0)).toBe(true);
  expect(outcome.file.progress.status).toBe("waiting");
  expect(outcome.file.progress.message).toContain("执行通道暂不可用");
  expect(outcome.file.checkpoint.evaluations).toBe(0);
  expect(outcome.file.checkpoint.unspentEvaluations).toBe(outcome.funded);
}, 90_000);
