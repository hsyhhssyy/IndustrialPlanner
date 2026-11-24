import { performance } from "node:perf_hooks";

import { runPlannerBatch, type PlannerAttemptRecord } from "../../src/scripts/eda/planner-runner";
import { loadEdaRegressionInput } from "../../src/shared/eda-regression";
import type { PerfAccounting, PerfSample, EdaPerfScenario } from "./types";

function accountingOf(records: readonly PlannerAttemptRecord[]): PerfAccounting | null {
  if (records.length === 0) return null;
  const exact = records.filter(record => record.evaluationAccounting === "exact").length;
  const upperBound = records.length - exact;
  if (exact === records.length) return "exact";
  if (upperBound === records.length) return "upper-bound";
  return "mixed";
}

/**
 * core 模式只测算法单 Worker 路径：NodePlannerClient 不加载 GPU，
 * 因而结果可以明确标为 CPU 基线；GPU 必须走浏览器模式。
 */
export async function runEdaCoreSample(scenario: EdaPerfScenario): Promise<PerfSample> {
  const input = await loadEdaRegressionInput(scenario.caseId);
  const perRoundBudget = Math.min(50_000, Math.max(1, scenario.localEvaluations));
  const request = {
    ...input,
    options: {
      ...input.options,
      evaluationsPerRound: perRoundBudget,
      concurrency: 1,
      gpu: false,
      stopAfterFirstSolution: false,
      stopAreaBelow: undefined,
    },
  };
  const started = performance.now();
  const result = await runPlannerBatch(request, {
    engineKind: "dense-v2",
    attempts: scenario.attempts,
    localEvaluations: scenario.localEvaluations,
    startVariant: scenario.startVariant,
    candidateSeconds: scenario.candidateSeconds,
    verificationSeconds: scenario.verificationSeconds,
  });
  const wallMs = performance.now() - started;
  const records = result.records;
  const searchMs = records.reduce((sum, record) => sum + record.generationMs, 0);
  const verificationMs = records.reduce((sum, record) => sum + record.verificationMs, 0);
  const activeMs = records.length === 0 ? null : searchMs + verificationMs;
  const evaluations = result.localEvaluations;
  const outcomeCounts = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.outcome] = (counts[record.outcome] ?? 0) + 1;
    return counts;
  }, {});
  return {
    index: 0,
    wallMs,
    activeMs,
    evaluations,
    attempts: result.attempts,
    evaluationsPerSecond: activeMs !== null && activeMs > 0 ? evaluations / (activeMs / 1000) : null,
    searchEvaluationsPerSecond: searchMs > 0 ? evaluations / (searchMs / 1000) : null,
    accounting: accountingOf(records),
    phases: records.length === 0 ? null : {
      searchMs,
      verificationMs,
      schedulerMs: Math.max(0, wallMs - searchMs - verificationMs),
    },
    outcome: Object.entries(outcomeCounts).map(([outcome, count]) => `${outcome}:${count}`).join(",") || null,
    error: null,
    details: {
      caseId: scenario.caseId,
      gpu: { requested: false, hardware: false, fallback: null, adapter: null },
      seed: request.options.randomSeed ?? null,
      deterministicSearch: request.options.deterministicSearch ?? null,
      requestedEvaluations: scenario.localEvaluations,
      perRoundBudget,
      attempts: result.attempts,
      successes: result.successes,
      firstSuccessMs: result.firstSuccessMs,
      attemptsPerMinute: result.attemptsPerMinute,
      workerThreadId: result.workerThreadId,
      runnerEnvironment: result.environment,
      records: records.map(record => ({
        variant: record.variant,
        evaluations: record.evaluations,
        accounting: record.evaluationAccounting,
        outcome: record.outcome,
        generationMs: record.generationMs,
        verificationMs: record.verificationMs,
        area: record.area ?? null,
      })),
    },
  };
}
