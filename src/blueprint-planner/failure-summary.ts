import type { PlannerLayoutIssue, PlannerSearchStatistics } from "./search-types";

/** 固定分类不含尺寸、实体 ID 或错误全文，避免随机搜索产生无限多键。 */
export const PLANNER_FAILURE_REASONS = ["minimum-coordinate", "body-overlap", "body-boundary", "same-device-distance",
  "environment-coverage", "power-coverage", "fixture-blocked", "port-minimum-coordinate", "port-blocked",
  "port-competition", "port-boundary", "disconnected", "boundary-access", "preparation", "routing", "power",
  "supply", "circulation", "verification-output", "verification-operating", "verification-constraints", "runtime-error", "timeout", "unknown"] as const;
export type PlannerFailureReason = typeof PLANNER_FAILURE_REASONS[number];
export const PLANNER_FAILURE_COUNTERS = ["batches", "evaluations", "searchMs", "failed", "candidate", "cancelled", "superseded",
  "timeout", "error", "partial", "layoutChecks", "feasibleLayouts", "routingAttempts", "fullyRoutedAttempts",
  "verificationMs", "verified", "verificationFailed", "verificationCancelled", "verificationSuperseded",
  "verificationTimeout", "verificationError"] as const;
type Counter = typeof PLANNER_FAILURE_COUNTERS[number];
type Counts = Partial<Record<Counter, number>>;
type Reasons = Partial<Record<PlannerFailureReason, number>>;
export type PlannerSearchOutcome = "failed" | "candidate" | "cancelled" | "superseded" | "timeout" | "error";
export type PlannerVerificationOutcome = "verified" | "verificationFailed" | "verificationCancelled"
  | "verificationSuperseded" | "verificationTimeout" | "verificationError";
export interface PlannerFailureSample { width: number; height: number; evaluations: number; message: string }
export interface PlannerFailureShard { counts: Counts; reasons: Reasons }
export interface PlannerFailureSummary {
  schemaVersion: 1;
  algorithmVersion: string;
  /** 旧任务从此处开始覆盖；计数为实际观测值，不补记此前的失败。 */
  startedAt: { attempt: number; evaluations: number };
  shards: Record<string, PlannerFailureShard>;
  samples: Partial<Record<PlannerFailureReason, PlannerFailureSample>>;
  /** 仅保留最近一个旧版本的汇总，算法升级不产生无限历史。 */
  /** AI-CORRECTION 2026-10-16：历史段保留统计自身的版本标记，迁移后可能与当前算法同名。 */
  previous?: { algorithmVersion: string; counts: Counts; reasons: Reasons };
}
export interface PlannerAttemptSummary {
  layoutChecks: number;
  feasibleLayouts: number;
  fullyRoutedAttempts: number;
  rejections: Partial<Record<"routing" | "power" | "supply" | "circulation", number>>;
  rejectionDetails: Partial<Record<"routing" | "power" | "supply" | "circulation", string>>;
  /** 仅在批次失败后检查一次最佳姿态；不是每次提案的失败原因分布。 */
  layoutIssues: Partial<Record<PlannerLayoutIssue["kind"], string>>;
}

export const PLANNER_FAILURE_SUMMARY_MAX_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const add = <K extends string>(counts: Partial<Record<K, number>>, key: K, value: number) => {
  counts[key] = Math.min(Number.MAX_SAFE_INTEGER, (counts[key] ?? 0) + Math.max(0, Math.round(value)));
};

export function createPlannerFailureSummary(algorithmVersion: string, attempt: number, evaluations: number): PlannerFailureSummary {
  return { schemaVersion: 1, algorithmVersion, startedAt: { attempt, evaluations }, shards: {}, samples: {} };
}

export function totalPlannerFailures(summary: PlannerFailureSummary): PlannerFailureShard {
  const total: PlannerFailureShard = { counts: {}, reasons: {} };
  for (const shard of Object.values(summary.shards)) {
    for (const key of PLANNER_FAILURE_COUNTERS) if (shard.counts[key] !== undefined) add(total.counts, key, shard.counts[key]);
    for (const key of PLANNER_FAILURE_REASONS) if (shard.reasons[key] !== undefined) add(total.reasons, key, shard.reasons[key]);
  }
  return total;
}

/** 限制 UTF-8 JSON 字节，包含转义字符；不会切出半个 Unicode 码点。 */
export function compactPlannerFailureMessage(message: string): string {
  let result = Array.from(message.slice(0, 256)).slice(0, 96).join("");
  while (bytes(result) > 192) result = Array.from(result).slice(0, -1).join("");
  return result;
}

function recordReason(summary: PlannerFailureSummary, shard: PlannerFailureShard, reason: PlannerFailureReason,
  count: number, sample: PlannerFailureSample): void {
  if (count <= 0) return;
  add(shard.reasons, reason, count);
  if (summary.samples[reason] === undefined) summary.samples[reason] = {
    width: sample.width, height: sample.height, evaluations: sample.evaluations,
    message: compactPlannerFailureMessage(sample.message),
  };
}

export function recordPlannerSearch(summary: PlannerFailureSummary, index: number, outcome: PlannerSearchOutcome,
  evaluations: number, elapsedMs: number, outline: { width: number; height: number },
  statistics?: PlannerSearchStatistics, message = ""): void {
  const shard = summary.shards[index] ??= { counts: {}, reasons: {} };
  add(shard.counts, "batches", 1); add(shard.counts, outcome, 1);
  add(shard.counts, "evaluations", evaluations); add(shard.counts, "searchMs", elapsedMs);
  const observed = statistics?.summary;
  if (!observed) add(shard.counts, "partial", 1);
  if (statistics) add(shard.counts, "routingAttempts", statistics.routingAttempts);
  if (observed) {
    for (const key of ["layoutChecks", "feasibleLayouts", "fullyRoutedAttempts"] as const) add(shard.counts, key, observed[key]);
    for (const reason of ["routing", "power", "supply", "circulation"] as const) {
      recordReason(summary, shard, reason, observed.rejections[reason] ?? 0,
        { ...outline, evaluations, message: observed.rejectionDetails[reason] ?? message });
    }
    for (const reason of PLANNER_FAILURE_REASONS) {
      const detail = observed.layoutIssues[reason as PlannerLayoutIssue["kind"]];
      if (detail !== undefined) recordReason(summary, shard, reason, 1, { ...outline, evaluations, message: detail });
    }
  }
  if (outcome === "failed" && (!observed || (!Object.keys(observed.layoutIssues).length && !Object.keys(observed.rejections).length))) {
    recordReason(summary, shard, statistics?.preparationRejected || !statistics ? "preparation" : "unknown", 1,
      { ...outline, evaluations, message });
  }
  if (outcome === "error" || outcome === "timeout") recordReason(summary, shard, outcome === "error" ? "runtime-error" : "timeout",
    1, { ...outline, evaluations, message });
}

export function recordPlannerVerification(summary: PlannerFailureSummary, index: number, outcome: PlannerVerificationOutcome,
  elapsedMs: number, statistics: PlannerSearchStatistics, reason?: PlannerFailureReason, message = ""): void {
  const shard = summary.shards[index] ??= { counts: {}, reasons: {} };
  add(shard.counts, outcome, 1); add(shard.counts, "verificationMs", elapsedMs);
  if (reason) recordReason(summary, shard, reason, 1, { ...statistics.outline, evaluations: statistics.evaluations, message });
}

/** 校验整个诊断块的固定键、计数和字节上限；导入文件也不能绕过有界约束。 */
export function assertPlannerFailureSummary(value: unknown, algorithmVersion: string): asserts value is PlannerFailureSummary {
  const fail = (): never => { throw new Error("EDA 失败统计无效或超过 64 KiB。"); };
  const object = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
    return input as Record<string, unknown>;
  };
  const keys = (input: unknown, allowed: readonly string[]) => {
    const result = object(input);
    if (Object.keys(result).some(key => !allowed.includes(key))) fail();
    return result;
  };
  const integer = (input: unknown) => { if (!Number.isSafeInteger(input) || (input as number) < 0) fail(); };
  const counters = (input: unknown, allowed: readonly string[]) => { Object.values(keys(input, allowed)).forEach(integer); };
  const version = (input: unknown) => { if (typeof input !== "string" || !input || bytes(input) > 256) fail(); };
  const root = keys(value, ["schemaVersion", "algorithmVersion", "startedAt", "shards", "samples", "previous"]);
  if (root.schemaVersion !== 1 || root.algorithmVersion !== algorithmVersion || bytes(value) > PLANNER_FAILURE_SUMMARY_MAX_BYTES) fail();
  version(root.algorithmVersion);
  const start = keys(root.startedAt, ["attempt", "evaluations"]); integer(start.attempt); integer(start.evaluations);
  for (const [index, item] of Object.entries(object(root.shards))) {
    if (!/^(?:[0-9]|[12][0-9]|3[01])$/.test(index)) fail();
    const shard = keys(item, ["counts", "reasons"]);
    counters(shard.counts, PLANNER_FAILURE_COUNTERS); counters(shard.reasons, PLANNER_FAILURE_REASONS);
  }
  for (const item of Object.values(keys(root.samples, PLANNER_FAILURE_REASONS))) {
    const sample = keys(item, ["width", "height", "evaluations", "message"]);
    integer(sample.width); integer(sample.height); integer(sample.evaluations);
    if (typeof sample.message !== "string" || bytes(sample.message) > 192) fail();
  }
  if (root.previous !== undefined) {
    const previous = keys(root.previous, ["algorithmVersion", "counts", "reasons"]);
    version(previous.algorithmVersion);
    counters(previous.counts, PLANNER_FAILURE_COUNTERS); counters(previous.reasons, PLANNER_FAILURE_REASONS);
  }
}

export function migratePlannerFailureSummary(previous: unknown, oldVersion: string, nextVersion: string,
  attempt: number, evaluations: number): PlannerFailureSummary | undefined {
  if (previous === undefined) return undefined;
  // 诊断自身标记才是观测来源；任务算法切换只重建搜索缓存，不能给已有观测改写版本。
  const observedVersion = (previous as Partial<PlannerFailureSummary> | null)?.algorithmVersion ?? oldVersion;
  assertPlannerFailureSummary(previous, observedVersion);
  return { ...createPlannerFailureSummary(nextVersion, attempt, evaluations),
    previous: { algorithmVersion: previous.algorithmVersion, ...totalPlannerFailures(previous) } };
}

export function mergePlannerFailureSummaries(inputs: readonly { summary?: PlannerFailureSummary; ownedShards: readonly number[] }[]): PlannerFailureSummary | undefined {
  const first = inputs.find(input => input.summary)?.summary;
  if (!first) return undefined;
  const merged: PlannerFailureSummary = { ...structuredClone(first), shards: {}, samples: {} };
  for (const { summary, ownedShards } of inputs) {
    if (!summary) continue;
    merged.startedAt.attempt = Math.min(merged.startedAt.attempt, summary.startedAt.attempt);
    merged.startedAt.evaluations = Math.min(merged.startedAt.evaluations, summary.startedAt.evaluations);
    for (const index of ownedShards) if (summary.shards[index]) merged.shards[index] = structuredClone(summary.shards[index]);
    for (const reason of PLANNER_FAILURE_REASONS) if (!merged.samples[reason] && summary.samples[reason]
      && ownedShards.some(index => (summary.shards[index]?.reasons[reason] ?? 0) > 0)) merged.samples[reason] = structuredClone(summary.samples[reason]);
  }
  return merged;
}
