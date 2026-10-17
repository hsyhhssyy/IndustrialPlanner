/**
 * EDA-002：赤铜块输入，分离芯 120/min；固定种子 1928356741，初始 482 格，首解 ≤482 格，总尝试 <20M。
 * 对应文档：.docs/common/测试/EDA用例/002-分离芯共享供料.md
 * 输入、断言与网页入口共用 src/shared/eda-regression；仅在显式 eda project 执行，有界面浏览器。
 *
 * 算法调整记录（北京时间，分钟精度）：
 * 2026-10-17 07:40—07:44 +08:00：续搜按全局需求重建供料、以旧解摆位指导并允许连接分量旋转 180°。
 * 同一窗口：保留同面积搜索，统一按面积、产物箱数、供料设施数、端口数及施工成本选优。
 * 2026-10-17 07:44—07:48 +08:00：供电贪心失败后从空方案回溯；相邻桩合法，分支计入总预算。
 * 2026-10-17 07:47—07:48 +08:00：完整产线首解轮换供料拓扑，使用紧凑初排和较长高温探索；复制子网参数保留。
 * 2026-10-17 07:51 +08:00：远程浏览器 8,594,252 次得到 468 格，Dense 120/min；一个单口暗管供全部 66/min 惰气。
 * 2026-10-17 08:00 +08:00：首解停止后保存匹配成果面积的尺寸调度，保证结果可导入续算。
 * 2026-10-17 08:08—08:12 +08:00：重建续搜保留指导摆位并偏好兼容旧端口/配对，避免无谓破坏已布通结构。
 * 2026-10-17 08:25 +08:00：中心对称分组纳入真实环境覆盖关系；旋转后覆盖不变的回归先失败、修复后通过。
 * 后续算法修改必须同步本文头与对应文档，记录时间、原因、位置和实测结果。
 */
import { expect, it } from "vitest";
import { EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import { runEdaBrowserCase } from "./browser-runner";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "filter-core-120-2s")!;
it("filter-core-120-2s：赤铜块输入，2S 冷启动在 20M 以内取得首解", async () => {
  const report = await runEdaBrowserCase(scenario);
  expect(report.test).toEqual(scenario);
  expect(report.status, JSON.stringify({ error: report.error, checks: report.checks })).toBe("passed");
  expect(report.cleanupPassed).toBe(true);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(report.checks.every(check => check.passed)).toBe(true);
}, scenario.timeoutMs + 600_000);
