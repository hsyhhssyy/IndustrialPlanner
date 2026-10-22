/**
 * EDA-003：赤铜耐压罐（气态赤铜）30/min；固定 2S=356，首解 <20M，严格更小次解累计 <50M。
 * 对应文档：.docs/common/测试/EDA用例/003-赤铜耐压罐气态赤铜.md
 * 仅显式 eda project 使用有界面浏览器执行；与网页共用输入、正式 Host 和验收规则。
 *
 * 算法调整记录（北京时间）：
 * 2026-10-20 至 21 日（历史日期精度）：瓶装供料、布线/供电协调及批次深度探索见对应文档。
 * v27 两轮普通异步探索取得 20M 首解及 50M 内更小次解，不作为本确定性用例通过记录。
 * 2026-10-21 08:52:13 +08:00：固化修订 1，保留完整输入及累计预算；本次未修改算法。
 * 后续算法修改须同步本文头与文档，记录调整时间、原因和实测结果，不放宽固定条件。
 */
import { expect, it } from "vitest";
import { EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import { runEdaBrowserCase } from "./browser-runner";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "cuprium-canister-30-2s")!;
it("cuprium-canister-30-2s：2S、20M 首解及累计 50M 内严格更小次解", async () => {
  const report = await runEdaBrowserCase(scenario);
  expect(report.test).toEqual(scenario);
  expect(report.status, JSON.stringify({ error: report.error, checks: report.checks })).toBe("passed");
  expect(report.cleanupPassed).toBe(true);
  expect(report.firstSolution?.task).toBeTruthy();
  expect(report.firstSolution?.checks.length).toBeGreaterThan(0);
  expect(report.firstSolution?.checks.every(check => check.passed)).toBe(true);
  expect(report.continuationInput).toBeTruthy();
  expect(report.checks.some(check => check.name === "continuation.improvedArea")).toBe(true);
  expect(report.checks.every(check => check.passed)).toBe(true);
}, scenario.timeoutMs + 600_000);
