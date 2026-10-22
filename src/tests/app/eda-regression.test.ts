// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerProgress, BlueprintPlannerResult } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { parsePlannerTaskFile, PLANNER_ALGORITHM_VERSION } from "@/blueprint-planner/task-checkpoint";
import { checkEdaRegression, EDA_REGRESSION_CASES, loadEdaRegressionInput } from "@/shared/eda-regression";
import input from "@/shared/eda-regression/cases/xiranite-2s-first-solution.json";
import reference from "./fixtures/eda-regression-success.json";

// 基础检查只验证报告规则和输入契约，不启动浏览器或运行 EDA 搜索。
const scenario = EDA_REGRESSION_CASES[0]!;
const initial = reference.initial as BlueprintPlannerProgress;
const final = reference.final as BlueprintPlannerProgress;
const result = reference.result as BlueprintPlannerResult;

it("历史真实验收报告满足面积、冷启动、产量与总预算规则", () => {
  expect(checkEdaRegression(scenario, initial, final, result, scenario.seed).every(check => check.passed)).toBe(true);
});

it.each([19_999_999, 20_000_000, 20_000_001])("总计数 %i 必须严格小于 20M，不能以首解曲线代替", evaluations => {
  const checks = checkEdaRegression(scenario, initial, { ...final, evaluatedProposals: evaluations }, result, scenario.seed);
  expect(checks.find(check => check.name === "totalEvaluations")?.passed).toBe(evaluations < 20_000_000);
});

it("初始面积漂移和已有成果均拒绝，不能只检查最终面积", () => {
  expect(checkEdaRegression(scenario, { ...initial, initialArea: 2295 }, final, result, scenario.seed)
    .find(check => check.name === "initialArea")?.passed).toBe(false);
  expect(checkEdaRegression(scenario, { ...initial, evaluatedProposals: 1 }, final, result, scenario.seed)
    .find(check => check.name === "coldStart")?.passed).toBe(false);
  expect(checkEdaRegression(scenario, { ...initial, bestArea: 1500 }, final, result, scenario.seed)
    .find(check => check.name === "coldStart")?.passed).toBe(false);
});

it("面积超限、产量不足、缺少验收结果或随机种子不符均不能通过", () => {
  const tooLarge = { ...result, metrics: { ...result.metrics, width: 60, height: 26, area: 1560 } };
  expect(checkEdaRegression(scenario, initial, { ...final, bestArea: 1560 }, tooLarge, scenario.seed)
    .find(check => check.name === "finalArea")?.passed).toBe(false);
  expect(checkEdaRegression(scenario, initial, final, { ...result, measuredOutputs: [{ itemId: "item_xiranite_powder", perMinute: 359 }] }, scenario.seed)
    .find(check => check.name.startsWith("output:"))?.passed).toBe(false);
  expect(checkEdaRegression(scenario, initial, final, null, scenario.seed).every(check => check.passed)).toBe(false);
  expect(checkEdaRegression(scenario, initial, final, result, scenario.seed + 1).find(check => check.name === "randomSeed")?.passed).toBe(false);
});

it("在途 Worker 的较小计数不能作为完成结算的验收结果", () => {
  expect(checkEdaRegression(scenario, initial, { ...final, activeWorkerCount: 1 }, result, scenario.seed)
    .find(check => check.name === "settled")?.passed).toBe(false);
  expect(checkEdaRegression(scenario, initial, { ...final, status: "save-failed" }, result, scenario.seed)
    .find(check => check.name === "settled")?.passed).toBe(false);
});

it.each(EDA_REGRESSION_CASES)("$id 仅固定问题条件，当前 Host 创建零状态任务，不绑定算法版本、分片及尺寸策略", async scenario => {
  const registry = createRegistryContract();
  const host = createBlueprintPlannerHost({ state: createWorkspaceState(), registry, simulation: null,
    app: null, editor: null, audio: null, render: null, sync: null, blueprintPlanner: null }, { storage: null });
  try {
    const request = await loadEdaRegressionInput(scenario.id);
    expect(Object.keys(input).sort()).toEqual(["formatVersion", "request"]);
    expect(request.plan.targets).toEqual(scenario.targets);
    expect(request.options).toMatchObject({ randomSeed: scenario.seed, initialArea: scenario.initialArea,
      concurrency: scenario.concurrency, gpu: scenario.gpu, evaluationsPerRound: scenario.roundEvaluations,
      stopAfterFirstSolution: scenario.budgetMode !== "milestones", deterministicSearch: scenario.deterministicSearch });
    const file = parsePlannerTaskFile(host.queries.exportDraft(request), registry);
    expect(file.algorithmVersion).toBe(PLANNER_ALGORITHM_VERSION);
    expect(file.progress).toMatchObject({ initialArea: scenario.initialArea, planningStarted: false });
    const point = file.checkpoint;
    expect(point.randomSeed).toBe(scenario.seed);
    expect(point.evaluations).toBe(0);
    expect(point.attempt).toBe(0);
    expect(point.best).toBeNull();
    expect(point.result).toBeNull();
    expect(point.pendingCandidate).toBeNull();
    expect(point.portfolio.pools).toEqual([]);
    // AI-REMOVED 2026-10-17:
    // Reason: 冷启动用例不能固化算法生成的尺寸与分片；应在实际运行时由当前 Host 创建。
    // Trigger: 用户授权修正跨版本回归测试。
    // Evidence: 输入检查点绑定 assertPlannerDimensionSchedule 的当前实现。
    // Replacement: 下方无计算状态断言；reproducible-search.test.ts 验证实际固定面积与首解。
    // Risk: Low；产量、面积和总尝试阈值不变。
    // Human Review: Required
    // Original code:
    // expect(point.parallel?.dimensionSchedule?.targetArea).toBe(scenario.initialArea);
    // expect(point.parallel?.shards).toHaveLength(32);
    // for (const shard of point.parallel!.shards) {
    //   expect(shard.evaluations).toBe(0);
    //   expect(shard.attempts).toBe(0);
    //   expect(shard.portfolio.pools).toEqual([]);
    //   expect(shard.pendingCandidate).toBeNull();
    //   expect(shard.shapeVisits).toEqual({});
    //   expect(shard.strategyStates).toEqual({});
    //   expect(shard.dimensions?.every(shape => shape.area === shape.width * shape.height && shape.area <= scenario.maximumArea)).toBe(true);
    // }
    expect(point.parallel).toBeUndefined();
    expect((await loadEdaRegressionInput(scenario.id)).plan).not.toBe(request.plan);
    expect(await loadEdaRegressionInput(scenario.id)).toEqual(request);
  } finally { host.dispose(); }
});

it("多个已验收成果或继续缩面积的结果不能冒充首解", () => {
  expect(checkEdaRegression(scenario, initial, { ...final, validatedCandidateCount: 2 }, result, scenario.seed)
    .find(check => check.name === "firstSolution")?.passed).toBe(false);
  expect(checkEdaRegression(scenario, initial, { ...final, areaHistory: [
    { evaluatedProposals: 1_000_000, bestArea: 1530 }, ...final.areaHistory!,
  ] }, result, scenario.seed).find(check => check.name === "firstSolution")?.passed).toBe(false);
});
