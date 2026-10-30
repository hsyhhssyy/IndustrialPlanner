import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

test.use({ appServer: false });

// 2026-10-30：独立于开发期故障注入验证，检查真实浏览器的取证策略与关闭后的产物。
test("原生首轮省略 trace，仍保存页面、状态和错误证据", async ({ browserSession }, info) => {
  const context = await browserSession.profile(SCREEN_PROFILES[2]);
  const page = await context.newPage();
  await page.setContent('<button type="button">取证</button>');
  await page.getByRole("button", { name: "取证", exact: true }).click();
  await page.evaluate(() => console.error("native-trace-policy-evidence"));
  await browserSession.closeContext(context);

  const directory = info.outputPath("context-0");
  const files = await readdir(directory);
  expect(files).toEqual(expect.arrayContaining(["page-0.png", "page-0.yaml", "state-0.json", "diagnostics.json"]));
  expect(files.includes("trace.zip")).toBe(info.retry > 0);
  expect(await readFile(resolve(directory, "console-errors.log"), "utf8")).toContain("native-trace-policy-evidence");
  expect(JSON.parse(await readFile(resolve(directory, "diagnostics.json"), "utf8"))).toEqual({ pageErrors: [], evidenceErrors: [] });
});

test("CLI 常规首轮不启动 live trace，真实点击仍可执行", async ({ browserSession, round }, info) => {
  const cli = await browserSession.openCli(SCREEN_PROFILES[2]);
  expect(await cli.runJson(`async page => {
    await page.setContent('<button type="button">取证</button>');
    await page.getByRole('button', {name:'取证', exact:true}).click();
    await page.evaluate(() => console.error('cli-trace-policy-evidence'));
    return { clicked: true };
  }`)).toEqual({ clicked: true });
  const files = await readdir(round.directory);
  expect(files.includes("trace-start.log")).toBe(info.retry > 0);
  expect(files.includes("traces")).toBe(info.retry > 0);
});

test.describe("原生 trace 专项显式开启", () => {
  test.use({ recordTrace: true });

  test("首轮关闭 context 时保存完整 trace", async ({ browserSession }, info) => {
    const context = await browserSession.profile(SCREEN_PROFILES[2]);
    const page = await context.newPage();
    await page.setContent('<button type="button">记录动作</button>');
    await page.getByRole("button", { name: "记录动作", exact: true }).click();
    await browserSession.closeContext(context);
    const trace = await readFile(info.outputPath("context-0", "trace.zip"));
    expect(trace.subarray(0, 2).toString()).toBe("PK");
  });
});
