/**
 * EDA-005：紫晶质瓶（赤铜溶液）30/min；固定种子 144609334，2S=564，首解总尝试 <20M。
 * 对应文档：.docs/common/测试/EDA用例/005-紫晶质瓶赤铜溶液.md
 * 保留整台运行耗材 6/min 与上游配平；只在显式 eda project 使用有界面浏览器执行。
 *
 * 算法调整记录（北京时间）：
 * 2026-10-20（历史日期精度）：App 整台耗材重新求解及 EDA 统一供料修复见对应文档。
 * 2026-10-21 08:52:13 +08:00：固化修订 1；本次未修改算法，尚未执行本例正式确定性搜索。
 * 后续算法修改须同步本文头与文档，记录调整时间、原因和实测结果，不放宽固定条件。
 */
import { expect, it } from "vitest";
import { EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import { runEdaBrowserCase } from "./browser-runner";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "amethyst-cuprium-solution-30-2s")!;
it("amethyst-cuprium-solution-30-2s：整台耗材完整产线在 2S、20M 内取得首解", async () => {
  const report = await runEdaBrowserCase(scenario);
  expect(report.test).toEqual(scenario);
  expect(report.status, JSON.stringify({ error: report.error, checks: report.checks })).toBe("passed");
  expect(report.cleanupPassed).toBe(true);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(report.checks.every(check => check.passed)).toBe(true);
}, scenario.timeoutMs + 600_000);
