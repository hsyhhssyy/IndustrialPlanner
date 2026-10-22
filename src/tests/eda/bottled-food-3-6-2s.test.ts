/**
 * EDA-007：精选柑实罐头 6/min：2S、20M 首解、完整 50M；固定 2S=1470，产率至少 6/min。
 * 对应文档：.docs/common/测试/EDA用例/007-精选柑实罐头.md
 * 首解发现次数 ≤20M；完整执行累计 50M，最终面积必须严格小于最早首解。
 * 20M 无首解、提前首解或提前缩面积均不得停止；原种子、24 CPU 与硬件 GPU。
 * 算法调整记录（北京时间）：
 * 2026-10-21 至 22 日（历史日期精度）：通用构网、端口、布线、供电和预算探索见用例文档；未取得五项同版通过。
 * 2026-10-22 09:52:50 +08:00：按用户收尾要求固化修订 1；本专项未执行，不以暖启动或系统图代替冷启动成绩。
 */
import { expect, it } from "vitest";
import { EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import { runEdaBrowserCase } from "./browser-runner";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "bottled-food-3-6-2s")!;
it("bottled-food-3-6-2s：20M 首解、完整 50M 与严格缩面积", async () => {
  const report = await runEdaBrowserCase(scenario);
  expect(report.test).toEqual(scenario);
  expect(report.status, JSON.stringify({ error: report.error, checks: report.checks })).toBe("passed");
  expect(report.cleanupPassed).toBe(true);
  expect(report.firstSolution?.progress?.evaluatedProposals).toBe(20_000_000);
  expect(report.final?.evaluatedProposals).toBe(50_000_000);
  expect(report.final?.activeWorkerCount).toBe(0);
  expect(report.firstSolution?.task).toBeTruthy();
  expect(report.continuationInput).toBeTruthy();
  const first = report.final?.areaHistory?.[0];
  expect(first?.evaluatedProposals).toBeGreaterThan(0);
  expect(first?.evaluatedProposals).toBeLessThanOrEqual(20_000_000);
  expect(report.result?.metrics.area).toBeLessThan(first!.bestArea);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(report.checks.every(check => check.passed)).toBe(true);
}, scenario.timeoutMs + 600_000);
