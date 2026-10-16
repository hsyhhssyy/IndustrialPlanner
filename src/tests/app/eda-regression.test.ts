// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerProgress, BlueprintPlannerResult } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { parsePlannerTaskFile } from "@/blueprint-planner/task-checkpoint";
import { checkEdaRegression, EDA_REGRESSION_CASES, loadEdaRegressionInput } from "@/shared/eda-regression";
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

it("发布用冷启动输入通过正式解析，所有分片无成果、无访问记录且初始尺寸不超过 2S", async () => {
  const file = parsePlannerTaskFile(await loadEdaRegressionInput(scenario.id), createRegistryContract());
  const point = file.checkpoint;
  expect(point.randomSeed).toBe(scenario.seed);
  expect(point.evaluations).toBe(0);
  expect(point.attempt).toBe(0);
  expect(point.best).toBeNull();
  expect(point.result).toBeNull();
  expect(point.pendingCandidate).toBeNull();
  expect(point.portfolio.pools).toEqual([]);
  expect(point.parallel?.dimensionSchedule?.targetArea).toBe(scenario.initialArea);
  expect(point.parallel?.shards).toHaveLength(32);
  for (const shard of point.parallel!.shards) {
    expect(shard.evaluations).toBe(0);
    expect(shard.attempts).toBe(0);
    expect(shard.portfolio.pools).toEqual([]);
    expect(shard.pendingCandidate).toBeNull();
    expect(shard.shapeVisits).toEqual({});
    expect(shard.strategyStates).toEqual({});
    expect(shard.dimensions?.every(shape => shape.area === shape.width * shape.height && shape.area <= scenario.maximumArea)).toBe(true);
  }
});
