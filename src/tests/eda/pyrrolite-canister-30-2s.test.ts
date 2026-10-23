/**
 * EDA-004：赤铜耐压罐（气态灼铜）30/min；固定种子 4293745261，2S=1086，首解总尝试 <20M。
 * AI-CORRECTION 2026-10-23：副产物输出修正后的正式S=516，修订2收紧2S=1032；种子/预算/产率不变。
 * 对应文档：.docs/common/测试/EDA用例/004-赤铜耐压罐气态灼铜.md
 * 保留完整自供植物循环；只在显式 eda project 使用有界面浏览器执行。
 *
 * 算法调整记录（北京时间）：
 * 2026-10-20（历史日期精度）：瓶装循环净产与整台环境耗材修复见对应文档。
 * 2026-10-21 08:52:13 +08:00：固化修订 1；本次未修改算法，尚未执行本例正式确定性搜索。
 * 后续算法修改须同步本文头与文档，记录调整时间、原因和实测结果，不放宽固定条件。
 */
import { expect, it } from "vitest";
import { EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import { runEdaBrowserCase } from "./browser-runner";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "pyrrolite-canister-30-2s")!;
it("pyrrolite-canister-30-2s：完整植物循环在 2S、20M 内取得首解", async () => {
  const report = await runEdaBrowserCase(scenario);
  expect(report.test).toEqual(scenario);
  expect(report.status, JSON.stringify({ error: report.error, checks: report.checks })).toBe("passed");
  expect(report.cleanupPassed).toBe(true);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(report.checks.every(check => check.passed)).toBe(true);
}, scenario.timeoutMs + 600_000);
