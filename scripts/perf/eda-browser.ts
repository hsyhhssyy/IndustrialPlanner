import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { connect } from "node:net";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { loadEdaRegressionInput } from "../../src/shared/eda-regression";
import type { EdaPerfScenario, PerfGpuInfo, PerfSample } from "./types";

const DEFAULT_PORT = 4176;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

interface BrowserProgress {
  readonly taskId: string;
  readonly status: string;
  readonly phase: string;
  readonly elapsedMs: number;
  readonly evaluatedProposals: number;
  readonly activeWorkerCount?: number;
  readonly bestArea: number | null;
}

interface BrowserPlanner {
  readonly state: { readonly activeTaskId: string | null };
  readonly queries: {
    exportDraft(request: unknown): unknown;
    getTask(id: string): BrowserProgress | null;
    exportTask(id: string): unknown;
  };
  readonly actions: {
    importTask(file: unknown): Promise<string>;
    continuePlanning(id: string, evaluations: number, concurrency: "auto" | number, gpu: boolean): void;
    cancel(id: string): void;
    deleteTask(id: string): Promise<void>;
  };
}

interface BrowserHostWindow {
  readonly __industrialPlannerAppHost?: { readonly workspace: { readonly blueprintPlanner: BrowserPlanner } };
}

interface GpuAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean;
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) return;
    } catch { /* 服务尚未就绪 */ }
    await delay(500);
  }
  throw new Error(`开发服务器未在 ${timeoutMs}ms 内就绪：${url}`);
}

async function startVite(): Promise<{ process: ChildProcess; url: string }> {
  if (await isPortOpen(DEFAULT_PORT)) throw new Error(`${DEFAULT_PORT} 端口已被占用，无法启动性能测试专用服务。`);
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(DEFAULT_PORT), "--strictPort"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", chunk => { logs += String(chunk); });
  child.stderr?.on("data", chunk => { logs += String(chunk); });
  const url = `http://127.0.0.1:${DEFAULT_PORT}/`;
  try {
    await waitForServer(url);
  } catch (error) {
    await stopProcess(child);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs.slice(-4_000)}`);
  }
  return { process: child, url };
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

function adapterName(info: GpuAdapterInfo): string {
  return [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "unknown";
}

async function readAdapter(page: Page): Promise<{ info: GpuAdapterInfo | null }> {
  return page.evaluate(async () => {
    const gpu = (navigator as unknown as {
      gpu?: { requestAdapter(options?: { powerPreference?: string }): Promise<{ info: GpuAdapterInfo } | null> };
    }).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: "high-performance" });
    return { info: adapter?.info ?? null };
  });
}

/** 浏览器样本只用于真实硬件 GPU；无 adapter 或 fallback 直接失败，禁止静默改测 CPU。 */
export async function runEdaBrowserSample(scenario: EdaPerfScenario, options: {
  readonly url?: string;
  readonly browser?: "chromium" | "chrome" | "msedge";
  readonly timeoutMs?: number;
}): Promise<PerfSample> {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("EDA 浏览器性能测试需要界面会话；无头模式不会测量真实 GPU，因此不提供。");
  }
  const request = await loadEdaRegressionInput(scenario.caseId);
  const configured = {
    ...request,
    options: {
      ...request.options,
      evaluationsPerRound: scenario.localEvaluations,
      concurrency: scenario.concurrency,
      gpu: true,
      stopAfterFirstSolution: false,
      stopAreaBelow: undefined,
    },
  };
  const server = options.url ? null : await startVite();
  const url = options.url ?? server!.url;
  const browserName = options.browser ?? (process.platform === "win32" ? "msedge" : "chromium");
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let taskId: string | null = null;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const started = performance.now();
  try {
    browser = await chromium.launch({
      headless: false,
      ...(browserName === "chromium" ? { executablePath: chromium.executablePath() } : { channel: browserName }),
    });
    context = await browser.newContext({
      viewport: { width: 2552, height: 1315 },
      deviceScaleFactor: 1,
      hasTouch: true,
      locale: "zh-CN",
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(120_000);
    const offlinePrompt = page.getByRole("dialog", { name: "启用离线模式", exact: true });
    await page.addLocatorHandler(offlinePrompt, async prompt => {
      await prompt.getByRole("button", { name: "暂不", exact: true }).click();
    }, { times: 1 });
    const installPrompt = page.getByRole("dialog", { name: "安装到桌面", exact: true });
    await page.addLocatorHandler(installPrompt, async prompt => {
      await prompt.getByRole("button", { name: "以后再说", exact: true }).click();
    }, { times: 1 });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const host = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost;
      return host?.workspace?.blueprintPlanner !== undefined;
    }, undefined, { timeout: 60_000 });
    const adapter = await readAdapter(page);
    if (!adapter.info || adapter.info.isFallbackAdapter) {
      throw new Error("硬件 WebGPU 不可用；浏览器性能样本拒绝回退到 CPU。");
    }
    const active = await page.evaluate(() => {
      const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost!.workspace.blueprintPlanner;
      return planner.state.activeTaskId;
    });
    if (active !== null) throw new Error(`已有规划任务运行：${active}`);
    taskId = await page.evaluate(async input => {
      const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost!.workspace.blueprintPlanner;
      return planner.actions.importTask(planner.queries.exportDraft(input));
    }, configured);
    if (!taskId) throw new Error("任务导入未返回任务 ID。");
    const activeTaskId = taskId;
    await page.evaluate(({ id, evaluations, concurrency, gpu }) => {
      const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost!.workspace.blueprintPlanner;
      planner.actions.continuePlanning(id, evaluations, concurrency, gpu);
    }, { id: activeTaskId, evaluations: scenario.localEvaluations, concurrency: scenario.concurrency, gpu: true });
    const deadline = Date.now() + timeoutMs;
    let first: BrowserProgress | null = null;
    let last: BrowserProgress | null = null;
    while (Date.now() < deadline) {
      const progress = await page.evaluate(id => {
        const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost!.workspace.blueprintPlanner;
        return planner.queries.getTask(id);
      }, activeTaskId);
      if (progress) {
        first ??= progress;
        last = progress;
        if (progress.status !== "running" && (progress.activeWorkerCount ?? 0) === 0) break;
      }
      await delay(200);
    }
    if (!first || !last || last.status === "running" || (last.activeWorkerCount ?? 0) > 0) {
      await page.evaluate(id => {
        const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost!.workspace.blueprintPlanner;
        planner.actions.cancel(id);
      }, activeTaskId).catch(() => undefined);
      throw new Error(`浏览器性能样本超时：${timeoutMs}ms`);
    }
    const checkpoint = await page.evaluate(id => {
      const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost!.workspace.blueprintPlanner;
      const file = planner.queries.exportTask(id) as {
        readonly checkpoint?: { readonly failureSummary?: { readonly shards?: Record<string, { readonly counts?: Record<string, number> }> } };
      };
      let searchMs = 0, verificationMs = 0, evaluations = 0;
      for (const shard of Object.values(file.checkpoint?.failureSummary?.shards ?? {})) {
        searchMs += shard.counts?.searchMs ?? 0;
        verificationMs += shard.counts?.verificationMs ?? 0;
        evaluations += shard.counts?.evaluations ?? 0;
      }
      return { searchMs, verificationMs, evaluations };
    }, activeTaskId);
    const wallMs = performance.now() - started;
    const activeMs = Math.max(0, last.elapsedMs - first.elapsedMs);
    const evaluations = Math.max(0, last.evaluatedProposals - first.evaluatedProposals);
    const searchMs = checkpoint.searchMs || null;
    const verificationMs = checkpoint.verificationMs || null;
    const gpu: PerfGpuInfo = { requested: true, hardware: true, fallback: false, adapter: adapterName(adapter.info) };
    return {
      index: 0,
      wallMs,
      activeMs,
      evaluations,
      attempts: null,
      evaluationsPerSecond: activeMs > 0 ? evaluations / (activeMs / 1000) : null,
      searchEvaluationsPerSecond: searchMs !== null && searchMs > 0 ? evaluations / (searchMs / 1000) : null,
      accounting: null,
      phases: {
        searchMs,
        verificationMs,
        schedulerMs: Math.max(0, wallMs - activeMs),
      },
      outcome: `${last.status}/${last.phase}`,
      error: null,
      details: {
        caseId: scenario.caseId,
        gpu,
        gpuEvidence: "adapter+request-option",
        concurrency: scenario.concurrency,
        requestedEvaluations: scenario.localEvaluations,
        first: { elapsedMs: first.elapsedMs, evaluatedProposals: first.evaluatedProposals },
        last: { elapsedMs: last.elapsedMs, evaluatedProposals: last.evaluatedProposals, bestArea: last.bestArea, activeWorkerCount: last.activeWorkerCount ?? null },
        checkpoint,
      },
    };
  } finally {
    if (page && taskId) {
      await page.evaluate(async id => {
        const planner = (window as unknown as BrowserHostWindow).__industrialPlannerAppHost?.workspace.blueprintPlanner;
        planner?.actions.cancel(id);
        await planner?.actions.deleteTask(id).catch(() => undefined);
      }, taskId).catch(() => undefined);
    }
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (server) {
      await stopProcess(server.process);
      await delay(200);
      if (await isPortOpen(DEFAULT_PORT)) console.error(`⚠️ 性能测试服务仍占用端口：${DEFAULT_PORT}`);
    }
  }
}
