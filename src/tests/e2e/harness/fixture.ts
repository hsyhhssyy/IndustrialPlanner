import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type TestInfo } from "playwright/test";
import { BrowserRound, assertBrowserIdle, browserProcesses, portIsOpen, parseCliResult } from "../../../../scripts/browser-test/runtime.mjs";
import { installCanvasLockAudit } from "../canvas-lock-audit";
import { contextOptions, installDesktopPointer, SCREEN_PROFILES, type TestScreenProfile } from "./profiles";
import type {} from "./browser-bridge";
import ts from "typescript";

export { chromium, expect, SCREEN_PROFILES };
export type { APIRequestContext, Browser, BrowserContext, Page } from "playwright/test";

const APP_URL = "http://127.0.0.1:4174";

async function bounded<T>(operation: Promise<T>, label: string, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export class ManagedBrowser {
  private browser: Browser | undefined;
  private launching: Promise<Browser> | undefined;
  private contexts = new Map<BrowserContext, { finishAudit: () => Promise<void>; directory: string; errors: string[]; consoleErrors: string[] }>();
  private cleanupErrors: unknown[] = [];
  private cleanupFailed = false;
  private cli: ManagedCli | undefined;
  private contextSequence = 0;
  private closing = false;

  constructor(private round: BrowserRound, private info: TestInfo, private recordTrace: boolean) {}

  async newContext(options: BrowserContextOptions = {}): Promise<BrowserContext> {
    if (this.closing || this.round.stopping) throw new Error("受管浏览器已开始清理，拒绝创建 context");
    if (this.cli) throw new Error("同一轮不能同时创建 CLI 和原生浏览器会话");
    try { this.browser ??= await (this.launching ??= chromium.launch()); }
    finally { await this.round.recordNativeBrowser(); }
    if (this.closing || this.round.stopping) { await this.browser.close(); throw new Error("浏览器启动完成时，本轮已开始清理"); }
    const directory = this.info.outputPath(`context-${this.contextSequence++}`);
    await mkdir(directory, { recursive: true });
    const context = await this.browser.newContext({ baseURL: APP_URL, locale: "zh-CN", ...options });
    if (this.closing || this.round.stopping) { await context.close(); await this.browser.close(); throw new Error("context 创建完成时，本轮已开始清理"); }
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(60_000);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    context.on("page", page => {
      page.on("pageerror", error => errors.push(error.stack ?? error.message));
      page.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
    });
    const owned = { finishAudit: async () => {}, directory, errors, consoleErrors };
    this.contexts.set(context, owned);
    if (this.recordTrace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    owned.finishAudit = await installCanvasLockAudit(context, this.info);
    return context;
  }

  async profile(profile: TestScreenProfile): Promise<BrowserContext> {
    const context = await this.newContext(contextOptions(profile));
    if (profile.name === "desktop") await installDesktopPointer(context);
    return context;
  }

  async closeContext(context: BrowserContext): Promise<void> {
    const owned = this.contexts.get(context);
    if (!owned) return;
    this.contexts.delete(context);
    const evidenceErrors: string[] = [];
    try {
      for (const [index, page] of context.pages().entries()) {
        if (page.isClosed()) continue;
        try {
          await writeFile(resolve(owned.directory, `page-${index}.yaml`), await page.locator("body").ariaSnapshot({ timeout: 5000 }));
          await writeFile(resolve(owned.directory, `state-${index}.json`), JSON.stringify(await bounded(page.evaluate(() => ({
            url: location.href, readiness: window.__test__?.readiness(), state: window.__test__?.getAppState(),
            document: window.__test__?.document(),
          })), "读取页面状态", 5000), null, 2));
          await page.screenshot({ path: resolve(owned.directory, `page-${index}.png`), timeout: 5000 });
        } catch (error) { evidenceErrors.push(String(error)); }
      }
      await bounded(owned.finishAudit(), "画布锁定审计");
    } catch (error) { this.cleanupErrors.push(error); }
    finally {
      try { if (this.recordTrace) await bounded(context.tracing.stop({ path: resolve(owned.directory, "trace.zip") }), "停止 trace", 30_000); }
      catch (error) { this.cleanupFailed = true; this.cleanupErrors.push(error); }
      try { await bounded(context.close(), "关闭 context"); }
      catch (error) { this.cleanupFailed = true; this.cleanupErrors.push(error); }
      await writeFile(resolve(owned.directory, "console-errors.log"), owned.consoleErrors.join("\n"));
      await writeFile(resolve(owned.directory, "diagnostics.json"), JSON.stringify({ pageErrors: owned.errors, evidenceErrors }, null, 2));
      if (this.recordTrace) await this.info.attach(`browser-${this.info.attachments.length}`, { path: resolve(owned.directory, "trace.zip"), contentType: "application/zip" }).catch(error => this.cleanupErrors.push(error));
    }
  }

  async openCli(profile: TestScreenProfile): Promise<ManagedCli> {
    if (this.closing || this.round.stopping) throw new Error("受管浏览器已开始清理，拒绝创建 CLI 会话");
    if (this.browser || this.cli) throw new Error("每轮只允许一个受管浏览器会话");
    this.cli = new ManagedCli(this.round, this.info, profile, this.recordTrace);
    await this.cli.open();
    return this.cli;
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const context of [...this.contexts.keys()]) await this.closeContext(context);
    try { await this.cli?.capture(); } catch (error) { this.cleanupErrors.push(error); }
    try { if (this.browser) await bounded(this.browser.close(), "关闭浏览器"); }
    catch (error) { this.cleanupFailed = true; this.cleanupErrors.push(error); }
    if (this.cleanupFailed || this.cli?.cleanupFailed) {
      await writeFile(resolve(this.info.project.outputDir, "cleanup-failed"), "浏览器或 trace 清理失败，停止后续轮次");
    }
    if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, "浏览器取证或清理失败");
  }
}

export class ManagedCli {
  readonly session: string;
  readonly directory: string;
  cleanupFailed = false;
  private sequence = 0;
  private opened = false;
  private tracing = false;
  private closing = false;
  constructor(private round: BrowserRound, private info: TestInfo, private screen: TestScreenProfile, private recordTrace: boolean) {
    this.session = `e2e-${process.pid}-${info.testId.slice(-10)}-${screen.name}`;
    this.directory = round.directory;
  }
  async open(): Promise<void> {
    await this.round.openCli(this.session, { browser: {
      launchOptions: { executablePath: chromium.executablePath(), headless: true },
      contextOptions: contextOptions(this.screen),
    } });
    this.opened = true;
    if (this.recordTrace) {
      // CLI live tracing 的建目录与调用栈写入不共享队列，先完成建目录，避免首次 .stacks 写入抢先失败。
      await mkdir(resolve(this.directory, "traces"), { recursive: true });
      await this.invoke(["tracing-start"], "trace-start.log");
      this.tracing = true;
    }
    if (this.screen.name === "desktop") {
      await this.runCode(`async page => { await (${installDesktopPointer.toString()})(page.context()); }`, "pointer.log");
    }
    const auditSource = await readFile(resolve("src/tests/e2e/canvas-lock-audit.ts"), "utf8");
    const auditCode = ts.transpileModule(auditSource, { compilerOptions: {
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
    } }).outputText.replace("export async function installCanvasLockAudit", "async function installCanvasLockAudit");
    await this.runCode(`async page => {
      ${auditCode}
      page.__e2eErrors = [];
      page.__e2eConsole = [];
      page.on('pageerror', error => page.__e2eErrors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') page.__e2eConsole.push(message.text()); });
      page.__finishCanvasLockAudit = await installCanvasLockAudit(page.context(), {
        attach: async (name, data) => { console.log(name + '\\n' + data.body); },
      });
    }`, "audit-install.log");
  }
  async invoke(args: string[], log: string): Promise<string> {
    if (this.closing) throw new Error("CLI 会话已开始清理，拒绝迟到的测试命令");
    return this.round.command("playwright-cli", [`-s=${this.session}`, ...args], log, Math.max(30_000, this.info.timeout - 15_000));
  }
  async runCode(code: string, log = "scenario.log"): Promise<string> {
    const path = resolve(this.directory, `scenario-${++this.sequence}.js`);
    await writeFile(path, `async page => { page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(60000); return (${code})(page); }`);
    return this.invoke(["run-code", `--filename=${path}`], log);
  }
  async runFile(path: string, log = "scenario.log"): Promise<string> { return this.runCode(await readFile(path, "utf8"), log); }
  async runJson(code: string, log = "scenario.log"): Promise<unknown> {
    return parseCliResult(await this.runCode(code, log));
  }
  async capture(): Promise<void> {
    this.closing = true;
    if (!this.opened) return;
    const errors: unknown[] = [];
    try {
      await this.round.command("playwright-cli", [`-s=${this.session}`, "run-code", `async page => {
        await page.screenshot({path:${JSON.stringify(resolve(this.directory, "final.png"))},timeout:5000});
        return {snapshot:await page.locator('body').ariaSnapshot({timeout:5000}),
          errors:page.__e2eErrors, consoleErrors:page.__e2eConsole,
          state:await page.evaluate(() => window.__test__?.getAppState() ?? null)};
      }`], "final-state.log", 15_000);
    } catch (error) { errors.push(error); }
    try {
      await this.round.command("playwright-cli", [`-s=${this.session}`, "run-code",
        "async page => { await page.__finishCanvasLockAudit?.(); }"], "canvas-lock-audit.log", 15_000);
    } catch (error) { errors.push(error); }
    if (this.tracing) {
      // 2026-10-16：live trace 停止需排空写入队列，与原生 context 的 trace 收尾使用相同的有界预算。
      try { await this.round.command("playwright-cli", [`-s=${this.session}`, "tracing-stop"], "trace-stop.log", 30_000); }
      catch (error) { this.cleanupFailed = true; errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "CLI 取证失败");
  }
}

type HarnessFixtures = {
  round: BrowserRound;
  browserSession: ManagedBrowser;
  appServer: boolean;
  recordTrace: boolean;
};

export const test = base.extend<HarnessFixtures>({
  appServer: [true, { option: true }],
  // 2026-10-30：常规首轮免去全程 trace；重试自动取证，trace 专项可显式开启。
  recordTrace: [false, { option: true }],
  round: [async ({ appServer }, provide, info) => {
    const stopped = resolve(info.project.outputDir, "cleanup-failed");
    try { await access(stopped); throw new Error("此前轮次清理失败，停止后续测试"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await assertBrowserIdle();
    const round = new BrowserRound(info.outputPath("runtime"));
    const errors: unknown[] = [];
    try {
      if (appServer) {
        // AI-REMOVED 2026-10-30:
        // Reason: Vite 的所有权提升到整轮，复用源码转换缓存，避免逐例重启。
        // Trigger: 用户明确要求只启动一次 Vite 并观察前 30 分钟进度。
        // Evidence: 原始基座每例创建开发服务；首轮关闭 trace 后相同前缀仍耗时约 30 分钟。
        // Replacement: scripts/e2e/setup.mjs；本处仅核验共享服务身份。
        // Risk: 共享 Vite 常驻期间保留转换缓存；浏览器存储与有状态后端仍隔离。
        // Human Review: Required
        // Original code:
        // if (await portIsOpen(4174)) throw new Error("4174 已被其他服务占用");
        // 同一 worker 中的 Vite build 会设置 NODE_ENV；开发服务不能继承前例的构建模式。
        // const server = await round.start(process.execPath, ["scripts/e2e/serve.mjs"], "vite.log", { NODE_ENV: "development" });
        // await round.waitForServer(server, APP_URL);
        const { appServer: server } = JSON.parse(await readFile(resolve(info.project.outputDir, "run.json"), "utf8"));
        const owner = (await browserProcesses()).find(item => item.pid === server?.pid && item.started === server.started);
        if (!owner || !(await portIsOpen(4174))) throw new Error("本轮共享 Vite 已退出或不可用，禁止接管或重启其他服务");
        await mkdir(round.directory, { recursive: true });
        await writeFile(resolve(round.directory, "app-server.json"), JSON.stringify(server, null, 2));
      }
      if (info.file.endsWith("webdav-sync.test.ts")) {
        if (await portIsOpen(4175)) throw new Error("4175 已被其他服务占用");
        const server = await round.start(process.execPath, ["scripts/e2e/start-webdav-e2e-server.mjs"], "webdav.log");
        await round.waitForServer(server, "http://127.0.0.1:4175");
      }
      await provide(round);
    } catch (error) {
      errors.push(error);
    } finally {
      try { await round.close(); await assertBrowserIdle(); }
      catch (error) {
        await writeFile(stopped, String(error));
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "E2E 轮次失败；原始错误和清理错误均已保留");
  }, { auto: true, timeout: 150_000 }],
  browserSession: async ({ round, recordTrace }, provide, info) => {
    const session = new ManagedBrowser(round, info, recordTrace || info.retry > 0);
    try { await provide(session); } finally { await session.close(); }
  },
  context: async ({ browserSession, contextOptions, viewport, deviceScaleFactor, hasTouch, isMobile, userAgent }, provide) => {
    const context = await browserSession.newContext({ ...contextOptions, viewport, deviceScaleFactor, hasTouch, isMobile, userAgent });
    try { await provide(context); } finally { await browserSession.closeContext(context); }
  },
  page: async ({ context }, provide) => { await provide(await context.newPage()); },
});
