import type { PlannerDiagnosticPhase, PlannerSearchDiagnostics, PlannerSearchStatistics } from "./search-types";
import { compactPlannerFailureMessage, type PlannerAttemptSummary } from "./failure-summary";

/** 生成与原图优化共用阶段统计；诊断只读搜索结果，不消费随机数。 */
export function createPlannerDiagnostics(statistics: PlannerSearchStatistics, enabled: boolean, started = performance.now()) {
  const diagnostics: PlannerSearchDiagnostics | undefined = enabled ? {
    timingsMs: { setup: 0, layout: 0, routing: 0, power: 0, supply: 0, finalization: 0 },
    layoutChecks: 0, feasibleLayouts: 0, fullyRoutedAttempts: 0,
    rejectionCounts: { routing: 0, power: 0, supply: 0, circulation: 0 }, rejections: [], omittedRejectionDetails: 0,
  } : undefined;
  statistics.diagnostics = diagnostics;
  const summary: PlannerAttemptSummary = statistics.summary = { layoutChecks: 0, feasibleLayouts: 0, fullyRoutedAttempts: 0,
    rejections: {}, rejectionDetails: {}, layoutIssues: {} };
  let phase: PlannerDiagnosticPhase = "setup", since = started;
  return {
    diagnostics,
    summary,
    enterPhase(next: PlannerDiagnosticPhase): void {
      if (!diagnostics) return;
      const now = performance.now(); diagnostics.timingsMs[phase] += now - since;
      phase = next; since = now;
    },
    reject(rejected: keyof PlannerSearchDiagnostics["rejectionCounts"], reason: string): void {
      summary.rejections[rejected] = (summary.rejections[rejected] ?? 0) + 1;
      summary.rejectionDetails[rejected] ??= compactPlannerFailureMessage(reason);
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

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/blueprint-planner/search-diagnostics.ts 第 3 行：
//
// /** 内层重布和外层候选共用拒绝记录；未启用诊断时仍保留精简摘要。 */
// export function recordPlannerRejection(statistics: PlannerSearchStatistics,
//   rejected: keyof PlannerSearchDiagnostics["rejectionCounts"], reason: string): void {
//   const { summary, diagnostics } = statistics;
//   if (summary) {
//     summary.rejections[rejected] = (summary.rejections[rejected] ?? 0) + 1;
//     summary.rejectionDetails[rejected] ??= compactPlannerFailureMessage(reason);
//   }
//   if (!diagnostics) return;
//   diagnostics.rejectionCounts[rejected]++;
//   const existing = diagnostics.rejections.find(entry => entry.phase === rejected && entry.reason === reason);
//   if (existing) { existing.count++; existing.lastEvaluation = statistics.evaluations; }
//   else if (diagnostics.rejections.length < 64) diagnostics.rejections.push({ phase: rejected, reason, count: 1,
//     firstEvaluation: statistics.evaluations, lastEvaluation: statistics.evaluations });
//   else diagnostics.omittedRejectionDetails++;
// }
// 原文件 src/blueprint-planner/search-diagnostics.ts 第 41 行：
//       // AI-REMOVED 2026-11-16:
//       // Reason: 拒绝记录需覆盖内部补电重布。Trigger: 布线成功次数缺少对应失败，无法对账。
//       // Evidence: search-diagnostics 得到 fullyRoutedAttempts=2、power=0、成功数=1。
//       // Replacement: recordPlannerRejection。Risk: Low。Human Review: Required。
//       // Original code:
//       // summary.rejections[rejected] = (summary.rejections[rejected] ?? 0) + 1;
//       // summary.rejectionDetails[rejected] ??= compactPlannerFailureMessage(reason);
//       // if (!diagnostics) return;
//       // diagnostics.rejectionCounts[rejected]++;
//       // const existing = diagnostics.rejections.find(entry => entry.phase === rejected && entry.reason === reason);
//       // if (existing) { existing.count++; existing.lastEvaluation = statistics.evaluations; }
//       // else if (diagnostics.rejections.length < 64) diagnostics.rejections.push({ phase: rejected, reason, count: 1,
//       //   firstEvaluation: statistics.evaluations, lastEvaluation: statistics.evaluations });
//       // else diagnostics.omittedRejectionDetails++;
//       recordPlannerRejection(statistics, rejected, reason);
