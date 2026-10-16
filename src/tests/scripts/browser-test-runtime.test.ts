// @vitest-environment node
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { BrowserRound, browserProcesses, cliResult, portIsOpen, parseCliResult } from "../../../scripts/browser-test/runtime.mjs";
import { createBrowserTestPlugin } from "../../../scripts/browser-test/bridge-plugin.mjs";

async function roundDirectory() {
  const directory = resolve(".temp/playwright-test/runtime-contract");
  await mkdir(directory, { recursive: true });
  return mkdtemp(resolve(directory, "run-"));
}

it("CLI 即使返回退出码零，也不能把报告的错误当成通过", () => {
  expect(() => cliResult("### Error\nTimeoutError: page.goto")).toThrow("Playwright CLI 失败");
  expect(cliResult("### Result\n{\"passed\":true}")).toContain('"passed":true');
  expect(parseCliResult('### Result\n{"passed":false}\n### Ran Playwright code\nreturn {passed:true};')).toEqual({ passed: false });
  expect(() => parseCliResult('### Ran Playwright code\nreturn {passed:true};')).toThrow("未返回结构化");
});

it("资源清理终止本轮服务及后代、释放端口，并保留未归属服务", async () => {
  const round = new BrowserRound(await roundDirectory());
  const unrelated = new BrowserRound(await roundDirectory());
  const own = await round.start(process.execPath, ["--input-type=module", "-e", `
    import {createServer} from 'node:http';
    import {spawn} from 'node:child_process';
    spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    createServer((req,res)=>res.end('ready')).listen(4187,'127.0.0.1');
  `], "server.log");
  const foreign = await unrelated.start(process.execPath, ["-e", "setInterval(()=>{},1000)"], "foreign.log");
  try {
    await round.waitForServer(own, "http://127.0.0.1:4187");
    const descendants = (await browserProcesses()).filter(item => item.group === own.pid).map(item => item.pid);
    expect(descendants.length).toBeGreaterThanOrEqual(2);
    await round.close();
    expect(await portIsOpen(4187)).toBe(false);
    const live = await browserProcesses();
    expect(live.some(item => descendants.includes(item.pid))).toBe(false);
    expect(live.some(item => item.pid === foreign.pid)).toBe(true);
    expect(JSON.parse(await readFile(resolve(round.directory, "cleanup.json"), "utf8")).passed).toBe(true);
  } finally {
    await round.close();
    await unrelated.close();
  }
});

it("命令忽略 SIGTERM 时仍有界终止，并完整保留输出", async () => {
  const round = new BrowserRound(await roundDirectory());
  try {
    await expect(round.command(process.execPath, ["-e", `
      process.on('SIGTERM',()=>{}); console.log('started'); setInterval(()=>{},1000);
    `], "timeout.log", 500)).rejects.toThrow("超时");
    expect(await readFile(resolve(round.directory, "timeout.log"), "utf8")).toContain("started");
    expect(await readFile(resolve(round.directory, "timeout.log"), "utf8")).toContain("[command failure]");
    expect(await readFile(resolve(round.directory, "timeout.log"), "utf8")).toContain("超时");
  } finally { await round.close(); }
});

it("清理开始后，迟到的异步步骤不得重新启动命令或服务", async () => {
  const round = new BrowserRound(await roundDirectory());
  const pending = expect(round.command(process.execPath, ["-e", "console.log('must not run')"], "late.log"))
    .rejects.toThrow("已开始清理");
  try {
    await round.close();
    await pending;
    await expect(round.start(process.execPath, ["-e", "setInterval(()=>{},1000)"], "late-service.log"))
      .rejects.toThrow("已开始清理");
    await expect(round.openCli("must-not-open", {})).rejects.toThrow("已开始清理");
    expect(JSON.parse(await readFile(resolve(round.directory, "cleanup.json"), "utf8")).passed).toBe(true);
  } finally { await round.close(); }
});

it("专用注入只处理当前工作台装配入口，入口漂移立即失败", async () => {
  const plugin = await createBrowserTestPlugin();
  const main = await readFile("src/main.tsx", "utf8");
  expect(plugin.transform(main, resolve("src/other.tsx"))).toBeUndefined();
  const transformed = plugin.transform(main, resolve("src/main.tsx"));
  expect(transformed?.code).toContain("installE2eBridge(appHost, e2eNormalizeBlueprint, e2eEnsureCore)");
  expect(await readFile("src/main.tsx", "utf8")).toBe(main);
  expect(() => plugin.transform("function other() {}", resolve("src/main.tsx"))).toThrow("装配入口变化");
});

it("统一锁拒绝第二个入口，且释放后允许后续入口运行", async () => {
  const round = new BrowserRound(await roundDirectory());
  // 独立工作目录仅隔离锁文件；仍执行真实进程扫描，绝不清理其他测试的锁。
  const moduleUrl = new URL("../../../scripts/browser-test/runtime.mjs", import.meta.url).href;
  try {
    const output = await round.command(process.execPath, ["--input-type=module", "-e", `
      process.chdir(${JSON.stringify(round.directory)});
      const { acquireBrowserLease } = await import(${JSON.stringify(moduleUrl)});
      const release = await acquireBrowserLease('first');
      try {
        try { await acquireBrowserLease('second'); throw new Error('unexpected success'); }
        catch (error) { if (!error.message.includes('执行锁已存在')) throw error; }
      } finally { await release(); }
      const next = await acquireBrowserLease('next'); await next(); console.log('lease passed');
    `], "lease.log");
    expect(output).toContain("lease passed");
  } finally { await round.close(); }
});
