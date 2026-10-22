// @vitest-environment node
// 2026-10-21：瓶装回归同时保留 20M 首解及累计 50M 内严格缩面积，普通检查不执行长时搜索。
import { expect, it } from "vitest";
import type { BlueprintPlannerProgress, BlueprintPlannerResult } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { checkEdaRegression, checkEdaRegressionContinuation, createEdaRegressionContinuation,
  EDA_REGRESSION_CASES, loadEdaRegressionInput } from "@/shared/eda-regression";
import evidence from "./fixtures/eda-bottling-stages.json";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "cuprium-canister-30-2s")!;
// 历史探索使用默认 2S，首次派发前没有面积字段；正式回归的 exportDraft 已显式固定初始面积。
const initial = { ...evidence.initial, initialArea: scenario.initialArea } as BlueprintPlannerProgress;
const first = { progress: evidence.first.progress as BlueprintPlannerProgress, result: evidence.first.result as BlueprintPlannerResult };
const final = evidence.second.progress as BlueprintPlannerProgress, result = evidence.second.result as BlueprintPlannerResult;

it("历史首解及更小次解分别通过各自的累计预算、产率和结算检查", () => {
  expect(checkEdaRegression(scenario, initial, first.progress, first.result, scenario.seed).every(check => check.passed)).toBe(true);
  expect(checkEdaRegressionContinuation(scenario, initial, first, final, result, scenario.seed).every(check => check.passed)).toBe(true);
});

it.each([49_999_999, 50_000_000, 50_000_001])("累计 %i 次严格按 50M 验收，不把第二轮额度当成额外 50M", total => {
  const checks = checkEdaRegressionContinuation(scenario, initial, first, { ...final, evaluatedProposals: total,
    roundEvaluatedProposals: total - first.progress.evaluatedProposals }, result, scenario.seed);
  expect(checks.find(check => check.name === "continuation.totalEvaluations")?.passed).toBe(total < 50_000_000);
});

it("同面积质量改善、计数清零、没有新增验收和在途结果均不能冒充次解", () => {
  const same = { ...result, metrics: { ...first.result.metrics } };
  expect(checkEdaRegressionContinuation(scenario, initial, first, { ...final, bestArea: same.metrics.area }, same, scenario.seed)
    .find(check => check.name === "continuation.improvedArea")?.passed).toBe(false);
  expect(checkEdaRegressionContinuation(scenario, initial, first, { ...final,
    evaluatedProposals: final.roundEvaluatedProposals }, result, scenario.seed)
    .find(check => check.name === "continuation.retainedEvaluations")?.passed).toBe(false);
  expect(checkEdaRegressionContinuation(scenario, initial, first, { ...final,
    validatedCandidateCount: first.progress.validatedCandidateCount }, result, scenario.seed)
    .find(check => check.name === "continuation.additionalValidation")?.passed).toBe(false);
  expect(checkEdaRegressionContinuation(scenario, initial, first, { ...final, activeWorkerCount: 1 }, result, scenario.seed)
    .find(check => check.name === "continuation.settled")?.passed).toBe(false);
  expect(checkEdaRegressionContinuation(scenario, initial, null, final, result, scenario.seed).every(check => check.passed)).toBe(false);
});

it("次解仍检查几何、原始种子、初始面积和目标产率", () => {
  const invalid = { ...result, metrics: { ...result.metrics, area: result.metrics.area - 1 },
    measuredOutputs: [{ itemId: scenario.targets[0]!.itemId, perMinute: 29 }] };
  const checks = checkEdaRegressionContinuation(scenario, initial, first, { ...final, initialArea: 712 }, invalid, scenario.seed + 1);
  for (const name of ["randomSeed", "initialArea", "finalArea", `output:${scenario.targets[0]!.itemId}`]) {
    expect(checks.find(check => check.name === `continuation.${name}`)?.passed, name).toBe(false);
  }
});

it("续算请求只切换停止与预算选项，保留任务内容、累计进度及不透明检查点", async () => {
  const registry = createRegistryContract();
  const host = createBlueprintPlannerHost({ state: createWorkspaceState(), registry, simulation: null,
    app: null, editor: null, audio: null, render: null, sync: null, blueprintPlanner: null }, { storage: null });
  try {
    const draft = host.queries.exportDraft(await loadEdaRegressionInput(scenario.id));
    // 这是纯任务转换的边界输入；检查点由真实 Host 创建，不在普通检查中执行 20M 搜索。
    const task = { ...draft, progress: first.progress }, before = structuredClone(task);
    const next = createEdaRegressionContinuation(scenario, task);
    // AI-REMOVED 2026-10-21:
    // Reason: 用户要求完整执行累计上限，不再向下取整。
    // Trigger: 完整 50M 规则。Evidence: 原期望忽略不足一万的尾额。
    // Replacement: 下方精确差额。Risk: Low。Human Review: Required
    // Original code:
    // expect(next.evaluations).toBe(31_400_000);
    expect(next.evaluations).toBe(scenario.continuation!.cumulativeRoundEvaluations - first.progress.evaluatedProposals);
    expect(next.evaluations + first.progress.evaluatedProposals).toBe(scenario.continuation!.cumulativeRoundEvaluations);
    expect(next.evaluations + first.progress.evaluatedProposals).toBeLessThan(50_000_000);
    expect(next.input.progress).toEqual(task.progress);
    expect(next.input.checkpoint).toEqual(task.checkpoint);
    expect(next.input.algorithmVersion).toBe(task.algorithmVersion);
    expect(next.input.request).toEqual({ ...task.request, options: { ...task.request.options,
      stopAfterFirstSolution: false, evaluationsPerRound: 49_800_000 } });
    expect(task).toEqual(before);
    expect(next.input.request).not.toBe(task.request);
    expect(next.input.checkpoint).not.toBe(task.checkpoint);
    // AI-REMOVED 2026-10-21:
    // Reason: 小于一万的剩余预算也必须可执行。
    // Trigger: 完整累计预算规则。Evidence: 旧断言拒绝合法的 5000 次尾额。
    // Replacement: 下方尾额、无解阶段和已耗尽边界。Risk: Low。Human Review: Required
    // Original code:
    // expect(() => createEdaRegressionContinuation(scenario, { ...task, progress: { ...first.progress,
    //   evaluatedProposals: 49_795_000 } })).toThrow("累计预算不足");
    expect(createEdaRegressionContinuation(scenario, { ...task, progress: { ...first.progress,
      evaluatedProposals: 49_795_000 } }).evaluations).toBe(5000);
    expect(createEdaRegressionContinuation(scenario, { ...task, progress: { ...first.progress,
      evaluatedProposals: 20_000_000, bestArea: null, validatedCandidateCount: 0, areaHistory: [] } }).evaluations).toBe(29_800_000);
    expect(() => createEdaRegressionContinuation(scenario, { ...task, progress: { ...first.progress,
      evaluatedProposals: 49_800_000 } })).toThrow("累计预算不足");
    expect(() => createEdaRegressionContinuation(scenario, draft)).toThrow("续算预算无效");
  } finally { host.dispose(); }
});
