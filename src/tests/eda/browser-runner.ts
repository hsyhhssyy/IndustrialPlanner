import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";
import type { EdaRegressionCase, EdaRegressionReport } from "@/shared/eda-regression";
import { acquireBrowserLease, assertBrowserIdle, BrowserRound, portIsOpen } from "../../../scripts/browser-test/runtime.mjs";

/** 仅 EDA project 调用；服务、CLI、trace 与浏览器按单用例创建和回收。 */
export async function runEdaBrowserCase(test: EdaRegressionCase): Promise<EdaRegressionReport> {
  const directory = resolve(".temp/playwright-test/eda", `${Date.now()}-${process.pid}-${test.id}`);
  await mkdir(directory, { recursive: true });
  const release = await acquireBrowserLease(`eda:${test.id}`);
  const round = new BrowserRound(directory), session = `eda-${process.pid}-${Date.now()}`;
  const errors: unknown[] = [];
  let report: EdaRegressionReport | undefined, opened = false, tracing = false, cleanupPassed = true;
  try {
    await assertBrowserIdle();
    const url = process.env.EDA_TEST_URL ?? "http://127.0.0.1:4176/";
    if (!process.env.EDA_TEST_URL) {
      if (await portIsOpen(4176)) throw new Error("4176 端口已被占用。");
      const server = await round.start(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4176", "--strictPort"], "vite.log");
      await round.waitForServer(server, url);
    }
    const browser = process.env.EDA_TEST_BROWSER ?? "chromium";
    if (!["chromium", "chrome", "msedge"].includes(browser)) throw new Error(`不支持的浏览器：${browser}`);
    await round.openCli(session, { browser: {
      launchOptions: { headless: false, ...(browser === "chromium" ? { executablePath: chromium.executablePath() } : { channel: browser }) },
      contextOptions: { viewport: { width: 2552, height: 1315 }, deviceScaleFactor: 1, hasTouch: true, locale: "zh-CN", acceptDownloads: true },
    } });
    opened = true;
    await mkdir(resolve(directory, "traces"), { recursive: true });
    await round.command("playwright-cli", [`-s=${session}`, "tracing-start"], "trace-start.log"); tracing = true;
    const source = ts.transpileModule(await readFile(resolve("src/tests/eda/browser-scenario.ts"), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText.replace("export async function runEdaBrowserScenario", "async function runEdaBrowserScenario");
    const reportPath = resolve(directory, "report.json"), script = resolve(directory, "scenario.js");
    await writeFile(script, `async page => {\n${source}\nawait runEdaBrowserScenario(page, ${JSON.stringify({ url, id: test.id,
      timeoutMs: test.timeoutMs, reportPath, screenshotPath: resolve(directory, "completed.png") })});\n}`);
    await round.command("playwright-cli", [`-s=${session}`, "run-code", `--filename=${script}`], "execution.log", test.timeoutMs + 150_000);
    report = JSON.parse(await readFile(reportPath, "utf8")) as EdaRegressionReport;
  } catch (error) { errors.push(error); }
  finally {
    if (opened && errors.length) {
      try { await round.command("playwright-cli", [`-s=${session}`, "screenshot", `--filename=${resolve(directory, "failed.png")}`], "failure.log", 15_000); }
      catch (error) { errors.push(error); }
    }
    if (tracing) {
      try { await round.command("playwright-cli", [`-s=${session}`, "tracing-stop"], "trace-stop.log", 30_000); }
      catch (error) { cleanupPassed = false; errors.push(error); }
    }
    try { await round.close(); } catch (error) { cleanupPassed = false; errors.push(error); }
    // 清理未确认时保留执行锁，阻止下一个用例进入；不得自动删除归属不明的锁。
    if (cleanupPassed) {
      try { await release(); } catch (error) { cleanupPassed = false; errors.push(error); }
    }
    await writeFile(resolve(directory, "execution-result.json"), JSON.stringify({ reportStatus: report?.status ?? null,
      cleanupPassed, errors: errors.map(String) }, null, 2));
  }
  if (errors.length) throw new AggregateError(errors, `EDA 浏览器测试失败；证据：${directory}`);
  if (!report) throw new Error(`EDA 缺少结果报告：${directory}`);
  // 成功产物归档移至资源清理确认之后，避免把清理失败的执行记录为成功。
  // 2026-10-21：两阶段用例即使压缩失败，也归档已经正式通过的首解；整份报告仍保留失败状态。
  // AI-CORRECTION 2026-10-22：晚于首解门槛的 Dense 成果也须留存；成果可用不代表预算验收通过，report 保留原失败状态。
  const first = report.firstSolution, firstPassed = !!first?.result && !!first.task && first.checks.length > 0
    && first.checks.every(check => check.passed);
  const finalAccepted = report.cleanupPassed && !!report.result && !!report.input && !!report.task
    && (report.final?.validatedCandidateCount ?? 0) > 0;
  if (finalAccepted || firstPassed) {
    const success = resolve(".temp/eda/success", `${Date.now()}-${process.pid}-${test.id}`);
    await mkdir(success, { recursive: true });
    await writeFile(resolve(success, "report.json"), JSON.stringify(report, null, 2));
    if (finalAccepted && report.result && report.input && report.task) {
      for (const [name, value] of Object.entries({ "blueprint.json": report.result.blueprint, "input.eda-task.json": report.input,
        "task.eda-task.json": report.task })) await writeFile(resolve(success, name), JSON.stringify(value, null, 2));
    }
    if (firstPassed) {
      // 2026-10-22：完整预算模式保存的是 20M 阶段最佳成果，目录不能冒充最早首解。
      const firstDirectory = test.budgetMode === "milestones" ? "20m" : "first";
      await mkdir(resolve(success, firstDirectory), { recursive: true });
      for (const [name, value] of Object.entries({ "blueprint.json": first!.result!.blueprint, "input.eda-task.json": report.input,
        "task.eda-task.json": first!.task, "report.json": { ...first, continuationInput: report.continuationInput } })) {
        await writeFile(resolve(success, firstDirectory, name), JSON.stringify(value, null, 2));
      }
    }
  }
  return report;
}
