// @vitest-environment node
import { expect, it } from "vitest";
import { assertPlannerFailureSummary, createPlannerFailureSummary, recordPlannerSearch, recordPlannerVerification,
  totalPlannerFailures, mergePlannerFailureSummaries, migratePlannerFailureSummary, PLANNER_FAILURE_COUNTERS,
  PLANNER_FAILURE_REASONS, PLANNER_FAILURE_SUMMARY_MAX_BYTES } from "@/blueprint-planner/failure-summary";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, restorePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import nugget from "./fixtures/pyrrolite-nugget.json";

const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const statistics = (): PlannerSearchStatistics => ({ seed: 1, evaluationLimit: 1000, evaluations: 1000,
  outline: { width: 30, height: 40 }, acceptedMoves: 0, routingAttempts: 1, initialWireLength: 0, finalWireLength: 0,
  summary: { layoutChecks: 4, feasibleLayouts: 1, fullyRoutedAttempts: 0, rejections: { routing: 1 },
    rejectionDetails: { routing: "无法连接两个端口" }, layoutIssues: { "body-overlap": "device-a,device-b @3,4" } } });

it("十万次失败只增长计数，变化的坐标和消息不会创建新分类或样本", () => {
  const summary = createPlannerFailureSummary(PLANNER_ALGORITHM_VERSION, 100, 123_800_000);
  const search = statistics();
  recordPlannerSearch(summary, 0, "failed", 1000, 10, search.outline, search);
  const initialBytes = size(summary), originalSamples = structuredClone(summary.samples);
  for (let index = 1; index < 100_000; index++) {
    search.summary!.layoutIssues["body-overlap"] = `device-${index},other @${index},${index}`;
    recordPlannerSearch(summary, 0, "failed", 1000, 10, search.outline, search, `错误 ${index}`);
  }
  expect(totalPlannerFailures(summary)).toMatchObject({ counts: { batches: 100_000, failed: 100_000, evaluations: 100_000_000,
    layoutChecks: 400_000, feasibleLayouts: 100_000 }, reasons: { "body-overlap": 100_000, routing: 100_000 } });
  expect(summary.startedAt).toEqual({ attempt: 100, evaluations: 123_800_000 });
  expect(summary.samples).toEqual(originalSamples);
  expect(size(summary) - initialBytes).toBeLessThan(100);
  assertPlannerFailureSummary(JSON.parse(JSON.stringify(summary)), PLANNER_ALGORITHM_VERSION);
});

it("所有分片、分类、最长计数和旧版本同时占满仍小于 64 KiB，计数饱和不破坏 JSON", () => {
  const summary = createPlannerFailureSummary("x".repeat(254), Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const counts = Object.fromEntries(PLANNER_FAILURE_COUNTERS.map(key => [key, Number.MAX_SAFE_INTEGER]));
  const reasons = Object.fromEntries(PLANNER_FAILURE_REASONS.map(key => [key, Number.MAX_SAFE_INTEGER]));
  for (let index = 0; index < 32; index++) summary.shards[index] = { counts: { ...counts }, reasons: { ...reasons } };
  for (const reason of PLANNER_FAILURE_REASONS) summary.samples[reason] = { width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER, evaluations: Number.MAX_SAFE_INTEGER, message: "x".repeat(190) };
  summary.previous = { algorithmVersion: "y".repeat(254), counts, reasons };
  recordPlannerSearch(summary, 31, "failed", 1000, 10, statistics().outline, statistics());
  expect(size(summary)).toBeLessThan(PLANNER_FAILURE_SUMMARY_MAX_BYTES);
  expect(summary.shards[31]!.counts.evaluations).toBe(Number.MAX_SAFE_INTEGER);
  assertPlannerFailureSummary(summary, summary.algorithmVersion);
});

it("暂停、目标更新、超时和异常不计为无解；验收失败与搜索失败分开", () => {
  const summary = createPlannerFailureSummary(PLANNER_ALGORITHM_VERSION, 0, 0);
  const search = statistics();
  for (const outcome of ["cancelled", "superseded", "timeout", "error"] as const) {
    recordPlannerSearch(summary, 0, outcome, 50, 10, search.outline);
  }
  recordPlannerSearch(summary, 0, "candidate", 1000, 10, search.outline, search);
  recordPlannerVerification(summary, 0, "verificationFailed", 10, search, "verification-output", "产量不足");
  const total = totalPlannerFailures(summary);
  expect(total.counts).toMatchObject({ batches: 5, partial: 4, candidate: 1, verificationFailed: 1 });
  expect(total.counts.failed).toBeUndefined();
  expect(total.reasons["verification-output"]).toBe(1);
});

it("导入校验拒绝无界类别、无效计数、超长样本和错误版本，Unicode 与控制字符按字节截断", () => {
  const summary = createPlannerFailureSummary(PLANNER_ALGORITHM_VERSION, 0, 0);
  recordPlannerSearch(summary, 0, "failed", 0, 10, { width: 1, height: 1 }, undefined, "\u0000😀中".repeat(1000));
  assertPlannerFailureSummary(summary, PLANNER_ALGORITHM_VERSION);
  expect(size(summary.samples.preparation!.message)).toBeLessThanOrEqual(192);
  for (const invalid of [
    { ...summary, algorithmVersion: "other" },
    { ...summary, shards: { 32: { counts: {}, reasons: {} } } },
    { ...summary, shards: { 0: { counts: { failed: -1 }, reasons: {} } } },
    { ...summary, shards: { 0: { counts: {}, reasons: { arbitrary: 1 } } } },
    { ...summary, samples: { preparation: { width: 1, height: 1, evaluations: 0, message: "x".repeat(65_536) } } },
  ]) expect(() => assertPlannerFailureSummary(invalid, PLANNER_ALGORITHM_VERSION)).toThrow("失败统计");
});

it("离线合并只采用分片所有者的计数，公共祖先不重复；迁移只保留最近旧版本", () => {
  const initial = createPlannerFailureSummary(PLANNER_ALGORITHM_VERSION, 0, 0), search = statistics();
  recordPlannerSearch(initial, 0, "failed", 1000, 10, search.outline, search);
  const first = structuredClone(initial), second = structuredClone(initial);
  recordPlannerSearch(first, 0, "failed", 1000, 10, search.outline, search);
  recordPlannerSearch(second, 1, "failed", 1000, 10, search.outline, search);
  const merged = mergePlannerFailureSummaries([{ summary: first, ownedShards: [0] }, { summary: second, ownedShards: [1] }])!;
  expect(totalPlannerFailures(merged).counts).toMatchObject({ failed: 3, evaluations: 3000 });
  const next = migratePlannerFailureSummary(merged, PLANNER_ALGORITHM_VERSION, "next", 3, 3000)!;
  expect(next.previous?.counts.failed).toBe(3);
  expect(next.shards).toEqual({});
  recordPlannerSearch(next, 1, "failed", 1000, 10, search.outline, search);
  const last = migratePlannerFailureSummary(next, "next", "last", 4, 4000)!;
  expect(last.previous).toMatchObject({ algorithmVersion: "next", counts: { failed: 1 } });
  expect(JSON.stringify(last)).not.toContain(PLANNER_ALGORITHM_VERSION);
});

it("任务 JSON 往返保留统计，算法迁移保留独立的历史摘要，旧任务没有伪造的零失败", async () => {
  const registry = createRegistryContract();
  const file: BlueprintPlannerTaskFile = { formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: "summary-test",
    request: structuredClone(nugget.request) as BlueprintPlannerRequest, checkpoint: emptyPlannerCheckpoint(),
    progress: { taskId: "summary-test", status: "waiting", phase: "preparing", startedAt: 1, elapsedMs: 0,
      estimatedProgress: null, candidateCount: 0, evaluatedProposals: 0, roundEvaluatedProposals: 0,
      validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null } };
  const parsed = parsePlannerTaskFile(file, registry);
  expect(parsed.checkpoint.failureSummary).toBeUndefined();
  const summary = createPlannerFailureSummary(PLANNER_ALGORITHM_VERSION, 0, 0);
  recordPlannerSearch(summary, 0, "failed", 0, 10, { width: 1, height: 1 }, undefined, "构网失败");
  parsed.checkpoint.failureSummary = summary;
  expect(parsePlannerTaskFile(JSON.parse(JSON.stringify(parsed)), registry).checkpoint.failureSummary).toEqual(summary);
  const historical = { ...parsed, algorithmVersion: "older-observed-version" };
  summary.algorithmVersion = historical.algorithmVersion;
  const migrated = await restorePlannerTaskFile(historical, registry);
  expect(migrated.checkpoint.failureSummary).toMatchObject({ algorithmVersion: PLANNER_ALGORITHM_VERSION, shards: {},
    previous: { algorithmVersion: "older-observed-version", counts: { failed: 1 } } });
});
