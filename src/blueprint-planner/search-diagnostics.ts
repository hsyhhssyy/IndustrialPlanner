import type { PlannerDiagnosticPhase, PlannerSearchDiagnostics, PlannerSearchStatistics } from "./search-types";

/** 生成与原图优化共用阶段统计；诊断只读搜索结果，不消费随机数。 */
export function createPlannerDiagnostics(statistics: PlannerSearchStatistics, enabled: boolean, started = performance.now()) {
  const diagnostics: PlannerSearchDiagnostics | undefined = enabled ? {
    timingsMs: { setup: 0, layout: 0, routing: 0, power: 0, supply: 0, finalization: 0 },
    layoutChecks: 0, feasibleLayouts: 0, fullyRoutedAttempts: 0,
    rejectionCounts: { routing: 0, power: 0, supply: 0, circulation: 0 }, rejections: [], omittedRejectionDetails: 0,
  } : undefined;
  statistics.diagnostics = diagnostics;
  let phase: PlannerDiagnosticPhase = "setup", since = started;
  return {
    diagnostics,
    enterPhase(next: PlannerDiagnosticPhase): void {
      if (!diagnostics) return;
      const now = performance.now(); diagnostics.timingsMs[phase] += now - since;
      phase = next; since = now;
    },
    reject(rejected: keyof PlannerSearchDiagnostics["rejectionCounts"], reason: string): void {
      if (!diagnostics) return;
      diagnostics.rejectionCounts[rejected]++;
      const existing = diagnostics.rejections.find(entry => entry.phase === rejected && entry.reason === reason);
      if (existing) { existing.count++; existing.lastEvaluation = statistics.evaluations; }
      else if (diagnostics.rejections.length < 64) diagnostics.rejections.push({ phase: rejected, reason, count: 1,
        firstEvaluation: statistics.evaluations, lastEvaluation: statistics.evaluations });
      else diagnostics.omittedRejectionDetails++;
    },
  };
}
