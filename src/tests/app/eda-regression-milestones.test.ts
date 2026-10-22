// @vitest-environment node
// 2026-10-22：完整预算用例的阶段判定；只验证报告规则，不启动浏览器或长时搜索。
import { expect, it } from "vitest";
import type { BlueprintPlannerProgress, BlueprintPlannerResult } from "@/domain/blueprint-planner";
import { checkEdaRegression, checkEdaRegressionContinuation, EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import evidence from "./fixtures/eda-bottling-stages.json";

const original = EDA_REGRESSION_CASES.find(test => test.id === "cuprium-canister-30-2s")!;
const scenario = { ...original, budgetMode: "milestones", roundEvaluations: 20_000_000,
  continuation: { ...original.continuation!, cumulativeRoundEvaluations: 50_000_000 } };
const initial = { ...evidence.initial, initialArea: scenario.initialArea } as BlueprintPlannerProgress;
const firstResult = evidence.first.result as BlueprintPlannerResult;
const result = evidence.second.result as BlueprintPlannerResult;
const firstPoint = { evaluatedProposals: 10_000_000, bestArea: firstResult.metrics.area };
const smallerPoint = { evaluatedProposals: 15_000_000, bestArea: result.metrics.area };
// 使用已有真实 Dense 成果，只调整计数边界，模拟两份成果均在 20M 阶段发现。
const stage = { progress: { ...evidence.second.progress, evaluatedProposals: 20_000_000, roundEvaluatedProposals: 20_000_000,
  areaHistory: [firstPoint, smallerPoint] } as BlueprintPlannerProgress, result };
const final = { ...stage.progress, evaluatedProposals: 50_000_000, roundEvaluatedProposals: 30_000_000 };

it("首解和更小解都早于 20M 时，完整 50M 后仍正确通过，不要求 20M 后再缩一次", () => {
  expect(checkEdaRegression(scenario, initial, stage.progress, result, scenario.seed).every(check => check.passed)).toBe(true);
  expect(checkEdaRegressionContinuation(scenario, initial, stage, final, result, scenario.seed).every(check => check.passed)).toBe(true);
});

it.each([19_999_999, 20_000_000, 20_000_001])("最早首解发现于 %i 次时按包含 20M 的门槛判断", count => {
  const progress = { ...stage.progress, areaHistory: [{ ...firstPoint, evaluatedProposals: count }] };
  expect(checkEdaRegression(scenario, initial, progress, result, scenario.seed)
    .find(check => check.name === "firstSolution")?.passed).toBe(count <= 20_000_000);
});

it.each([49_999_999, 50_000_000, 50_000_001])("最终累计 %i 次必须精确等于 50M", count => {
  expect(checkEdaRegressionContinuation(scenario, initial, stage,
    { ...final, evaluatedProposals: count, roundEvaluatedProposals: count - 20_000_000 }, result, scenario.seed)
    .find(check => check.name === "continuation.totalEvaluations")?.passed).toBe(count === 50_000_000);
});

it("20M 无首解不能因后续发现两份成果而改记首阶段通过", () => {
  const missing = { progress: { ...stage.progress, bestArea: null, validatedCandidateCount: 0, areaHistory: [] }, result: null };
  expect(checkEdaRegression(scenario, initial, missing.progress, null, scenario.seed).every(check => check.passed)).toBe(false);
  const late = { ...final, areaHistory: [{ ...firstPoint, evaluatedProposals: 25_000_000 },
    { ...smallerPoint, evaluatedProposals: 40_000_000 }] };
  expect(checkEdaRegressionContinuation(scenario, initial, missing, late, result, scenario.seed).every(check => check.passed)).toBe(true);
});

it("同面积改善、没有完整结算和缺少真实验收结果均不能通过完整预算用例", () => {
  expect(checkEdaRegressionContinuation(scenario, initial, stage, { ...final, areaHistory: [smallerPoint] }, result, scenario.seed)
    .find(check => check.name === "continuation.improvedArea")?.passed).toBe(false);
  expect(checkEdaRegressionContinuation(scenario, initial, stage, { ...final, activeWorkerCount: 1 }, result, scenario.seed)
    .find(check => check.name === "continuation.settled")?.passed).toBe(false);
  expect(checkEdaRegression(scenario, initial, stage.progress, null, scenario.seed).every(check => check.passed)).toBe(false);
});
