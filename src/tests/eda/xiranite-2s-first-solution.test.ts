/**
 * EDA-001：息壤 360/min，固定种子 1928356741；初始 1530 格，首解 ≤1530 格，总尝试 <20M。
 * 对应文档：.docs/common/测试/EDA用例/001-息壤两倍面积首解.md
 * 输入、断言和网页入口共用 src/shared/eda-regression；本用例只在显式 eda project 执行。
 *
 * 算法调整记录（历史修改未逐项记录时刻，时间范围来自原探索台账，不虚构精确时间）：
 * 2026-10-16 21:51 至 2026-10-17 02:48 +08:00：加工/工作供液分组分离、环境共同移动。
 * 同一探索窗口：整数子网冷启动后组合、尺寸面积权重、子网预算与整网独立重启。
 * 同一探索窗口：未完成布局指导池保留独立搜索、首解供电桩位预留后重布。
 * 2026-10-17：新增浏览器回归入口与取消结算后的严格预算验收；本次未修改求解算法。
 * 2026-10-17 05:39:00 +08:00：补齐在途 Worker 拒绝断言、清理失败保留执行锁及清理后成功归档。
 * 2026-10-17 07:34:44 +08:00：按用户授权改为声明式输入；当前 Host 固定种子、初始面积、确定性批次与首解停止。
 * 算法版本仅记录，尺寸调度由当前算法生成；原面积、产率及 20M 门槛不变，完整专项成绩另行显式运行。
 * 2026-10-17 07:40—07:48 +08:00：全局重建续搜、中心对称提案、同面积供料排名及供电回溯；复制首解保留原参数。
 * 2026-10-17 07:55 +08:00：相同 revision 2 条件远程实测 18,404,619 次、1500 格、Dense 360/min。
 * 2026-10-17 08:00 +08:00：首解停止保存匹配成果的续算调度；算法版本升为 first-solution-11。
 * 2026-10-17 08:08—08:12 +08:00：重建续搜保留指导摆位并偏好兼容旧端口/配对，避免无谓破坏已布通结构。
 * 2026-10-17 08:25 +08:00：中心对称分组纳入真实环境覆盖关系；旋转后覆盖不变的回归先失败、修复后通过。
 * 后续每次为本用例调整算法，必须同步本文头与对应文档，记录完整时间、原因、位置和实测结果。
 */
import { expect, it } from "vitest";
import { EDA_REGRESSION_CASES } from "@/shared/eda-regression";
import { runEdaBrowserCase } from "./browser-runner";

const scenario = EDA_REGRESSION_CASES.find(test => test.id === "xiranite-2s-first-solution")!;
it("xiranite-2s-first-solution：2S 冷启动在 20M 以内取得首解", async () => {
  const report = await runEdaBrowserCase(scenario);
  expect(report.test).toEqual(scenario);
  expect(report.status, JSON.stringify({ error: report.error, checks: report.checks })).toBe("passed");
  expect(report.cleanupPassed).toBe(true);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(report.checks.every(check => check.passed)).toBe(true);
// 外层额外留出服务启动、CLI 超时及逐项清理时间，不能抢先打断 finally。
}, scenario.timeoutMs + 600_000);
