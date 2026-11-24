import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runEdaBrowserSample } from "./eda-browser";
import { runEdaCoreSample } from "./eda-core";
import { findEdaScenario } from "./eda-scenarios";
import { collectEnvironment, getGitCommit, hasUncommittedChanges } from "./environment";
import { appendMarkdownRow, createRunDirectory, createRunId, formatNumber, readRun, summarize, writeRun } from "./report";
import type { EdaPerfScenario, PerfGpuInfo, PerfRun, PerfSample, PerfSuite } from "./types";

const PERF_SCRIPT = fileURLToPath(import.meta.url);
const TSX_ARGS = ["tsx", "--tsconfig", "tsconfig.app.json"];

interface CliOptions {
  readonly mode: "core" | "browser";
  readonly scenario: string;
  readonly iterations: number;
  readonly affinity: number | null;
  readonly engine: string | null;
  readonly evaluations: number | null;
  readonly attempts: number | null;
  readonly url: string | null;
  readonly browser: "chromium" | "chrome" | "msedge" | null;
  readonly timeoutMs: number | null;
  readonly sample: PerfSuite | null;
  readonly output: string | null;
  readonly allowDirty: boolean;
}

function usage(): void {
  console.log([
    "用法：",
    "  npm run perf -- sim [--engine dense-v2|legacy] [-n 10] [--affinity 0]",
    "  npm run perf -- eda --mode core --scenario cuprium-200k [-n 3] [--affinity 0]",
    "  npm run perf -- eda --mode browser --scenario cuprium-browser-200k [--url http://127.0.0.1:4176/] [--browser msedge] [-n 1]",
    "  npm run perf -- compare <baseline-run-dir> <current-run-dir>",
    "",
    "说明：",
    "  core     Node 单 Worker，纯 CPU；可用 --affinity 绑定单核，结果标记 CPU。",
    "  browser  真实硬件 WebGPU + 界面浏览器；无 adapter 或 fallback 直接失败，不会静默改测 CPU。",
    "  正式基线要求工作区干净；-n 1 允许未提交改动，但结果标记 +WT，不能当作正式基线。",
    "  --allow-dirty 仅用于开发验证，允许在未提交改动上多次采样；结果仍标记 +WT。",
    "  输出：.temp/perf/runs/<runId>/ 与 .temp/perf/{sim,eda}.md",
  ].join("\n"));
}

function readNumber(value: string | undefined, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} 需要有效数字，收到：${value ?? "缺失"}`);
  return number;
}

function parseOptions(args: readonly string[]): CliOptions {
  let mode: "core" | "browser" = "core";
  let scenario = "cuprium-200k";
  let iterations = 3;
  let affinity: number | null = null;
  let engine: string | null = null;
  let evaluations: number | null = null;
  let attempts: number | null = null;
  let url: string | null = null;
  let browser: "chromium" | "chrome" | "msedge" | null = null;
  let timeoutMs: number | null = null;
  let sample: PerfSuite | null = null;
  let output: string | null = null;
  let allowDirty = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[index + 1];
    switch (key) {
      case "-n":
      case "--iterations":
        iterations = Math.floor(readNumber(value, key));
        index++;
        break;
      case "--mode":
        if (value !== "core" && value !== "browser") throw new Error("--mode 必须是 core 或 browser。");
        mode = value;
        index++;
        break;
      case "--scenario":
        if (!value) throw new Error("--scenario 缺少值。");
        scenario = value;
        index++;
        break;
      case "--affinity":
        affinity = Math.floor(readNumber(value, key));
        index++;
        break;
      case "--engine":
        if (!value) throw new Error("--engine 缺少值。");
        engine = value;
        index++;
        break;
      case "--evaluations":
        evaluations = Math.floor(readNumber(value, key));
        index++;
        break;
      case "--attempts":
        attempts = Math.floor(readNumber(value, key));
        index++;
        break;
      case "--url":
        if (!value) throw new Error("--url 缺少值。");
        url = value;
        index++;
        break;
      case "--browser":
        if (value !== "chromium" && value !== "chrome" && value !== "msedge") throw new Error("--browser 必须是 chromium、chrome 或 msedge。");
        browser = value;
        index++;
        break;
      case "--timeout":
        timeoutMs = Math.floor(readNumber(value, key));
        index++;
        break;
      case "--sample":
        if (value !== "eda-core" && value !== "eda-browser") throw new Error("--sample 只能是 eda-core 或 eda-browser。");
        sample = value;
        index++;
        break;
      case "--output":
        if (!value) throw new Error("--output 缺少值。");
        output = value;
        index++;
        break;
      case "--allow-dirty":
        allowDirty = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数：${key}`);
    }
  }
  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error("迭代次数必须是正整数。");
  if (affinity !== null && (!Number.isInteger(affinity) || affinity < 0 || affinity >= availableParallelism())) {
    throw new Error(`--affinity 超出可用并行度：${affinity}`);
  }
  if (affinity !== null && process.platform !== "linux") {
    console.warn("⚠️ 当前平台不支持 taskset；--affinity 将被忽略。");
    affinity = null;
  }
  return { mode, scenario, iterations, affinity, engine, evaluations, attempts, url, browser, timeoutMs, sample, output, allowDirty };
}

function effectiveScenario(options: CliOptions): EdaPerfScenario {
  const base = findEdaScenario(options.scenario);
  return {
    ...base,
    ...(options.evaluations === null ? {} : { localEvaluations: options.evaluations }),
    ...(options.attempts === null ? {} : { attempts: options.attempts }),
  };
}

function writeSample(path: string, sample: PerfSample): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(sample, null, 2) + "\n", "utf8");
}

function readSample(path: string): PerfSample {
  return JSON.parse(readFileSync(path, "utf8")) as PerfSample;
}

function commandFor(affinity: number | null, args: readonly string[]): { command: string; args: string[] } {
  if (affinity !== null && process.platform === "linux") {
    return { command: "taskset", args: ["-c", String(affinity), "npx", ...args] };
  }
  return { command: "npx", args: [...args] };
}

function runProcess(command: string, args: readonly string[], logPath: string, env?: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const spawnError = result.error ? `${result.error.message}\n` : "";
  writeFileSync(logPath, `${spawnError}${result.stdout ?? ""}${result.stderr ?? ""}`, "utf8");
  return { status: result.status, stdout: result.stdout ?? "", stderr: `${spawnError}${result.stderr ?? ""}` };
}

function runEdaChild(options: CliOptions, scenario: EdaPerfScenario, index: number, directory: string): PerfSample {
  const output = resolve(directory, "samples", `sample-${index}.json`);
  const log = resolve(directory, `sample-${index}.console.log`);
  const args = [...TSX_ARGS, PERF_SCRIPT, "--sample", options.mode === "browser" ? "eda-browser" : "eda-core",
    "--scenario", scenario.id, "--output", output,
    ...(options.evaluations === null ? [] : ["--evaluations", String(options.evaluations)]),
    ...(options.attempts === null ? [] : ["--attempts", String(options.attempts)]),
    ...(options.url === null ? [] : ["--url", options.url]),
    ...(options.browser === null ? [] : ["--browser", options.browser]),
    ...(options.timeoutMs === null ? [] : ["--timeout", String(options.timeoutMs)])];
  const command = commandFor(options.affinity, args);
  const result = runProcess(command.command, command.args, log);
  if (result.status !== 0) {
    return { index, wallMs: 0, activeMs: null, evaluations: null, attempts: null, evaluationsPerSecond: null, searchEvaluationsPerSecond: null,
      accounting: null, phases: null, outcome: "failed", error: (result.stderr || result.stdout).trim().slice(-2_000) || `退出码 ${result.status}`,
      details: { scenario: scenario.id } };
  }
  if (!existsSync(output)) throw new Error(`样本缺少输出文件：${output}`);
  return { ...readSample(output), index };
}

function runSimSample(engine: string, affinity: number | null, index: number, directory: string): PerfSample {
  const log = resolve(directory, `sample-${index}.sim-console.log`);
  const processLog = resolve(directory, `sample-${index}.console.log`);
  const args = [...TSX_ARGS, "scripts/perf/sim-perf.ts", "--single", log];
  const command = commandFor(affinity, args);
  const env = { ...process.env, SIMULATION_TEST_ENGINE: engine };
  const result = runProcess(command.command, command.args, processLog, env);
  const match = result.stdout.match(/RESULT:([\d.]+)/);
  if (result.status !== 0 || !match) {
    return { index, wallMs: 0, activeMs: null, evaluations: null, attempts: null, evaluationsPerSecond: null, searchEvaluationsPerSecond: null,
      accounting: null, phases: null, outcome: "failed", error: (result.stderr || result.stdout).trim().slice(-2_000) || `退出码 ${result.status}`,
      details: { engine } };
  }
  const wallMs = Number(match[1]);
  return { index, wallMs, activeMs: wallMs, evaluations: null, attempts: null, evaluationsPerSecond: null, searchEvaluationsPerSecond: null,
    accounting: null, phases: null, outcome: "completed", error: null, details: { engine, ticks: 3600, ticksPerSecond: 3600_000 / wallMs, log } };
}

function writeRunMarkdown(run: PerfRun): void {
  const sha = `${run.commit}${run.dirty ? "+WT" : ""}`;
  const succeeded = run.samples.filter(sample => sample.error === null).length;
  if (succeeded === 0) return;
  const iterations = `${succeeded}/${run.samples.length}`;
  if (run.suite === "sim") {
    appendMarkdownRow("sim.md", `| ${run.runId} | ${sha} | ${String(run.options.engine ?? "")} | ${run.scenario} | ${iterations} | ${formatNumber(run.summary.wallMsMedian)} | ${formatNumber(run.summary.wallMsMedian === null ? null : 3600_000 / run.summary.wallMsMedian)} | ${formatNumber(run.summary.wallMsCv === null ? null : run.summary.wallMsCv * 100)}% | ${run.finishedAt} |\n`,
      "| Run ID | 提交 SHA | 引擎 | 场景 | 迭代 | 中位耗时 (ms) | 中位 tick/s | 耗时 CV | 时间 |\n| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |\n");
    return;
  }
  const gpu = run.environment.gpu;
  const mode = run.suite === "eda-browser" ? `browser${gpu?.adapter ? `:${gpu.adapter}` : ""}` : "core-cpu";
  appendMarkdownRow("eda.md", `| ${run.runId} | ${sha} | ${mode} | ${run.scenario} | ${iterations} | ${formatNumber(run.summary.evaluationsMedian, 0)} | ${formatNumber(run.summary.wallMsMedian)} | ${formatNumber(run.summary.activeMsMedian)} | ${formatNumber(run.summary.evaluationsPerSecondMedian, 0)} | ${formatNumber(run.summary.searchEvaluationsPerSecondMedian, 0)} | ${formatNumber(run.summary.searchMsMedian)} | ${formatNumber(run.summary.verificationMsMedian)} | ${formatNumber(run.summary.schedulerMsMedian)} | ${formatNumber(run.summary.wallMsCv === null ? null : run.summary.wallMsCv * 100)}% | ${run.finishedAt} |\n`,
    "| Run ID | 提交 SHA | 模式 | 场景 | 迭代 | 中位提案数 | 中位墙钟 (ms) | 中位有效 (ms) | 总提案/s | 搜索提案/s | search (ms) | verify (ms) | 墙钟开销 (ms) | 墙钟 CV | 时间 |\n| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n");
}

function finishRun(runId: string, directory: string, suite: PerfSuite, scenario: string, options: Record<string, unknown>,
  samples: readonly PerfSample[], startedAt: string, affinity: number | null): PerfRun {
  const gpu = samples.find(sample => typeof sample.details.gpu === "object" && sample.details.gpu !== null)
    ?.details.gpu as PerfGpuInfo | undefined;
  const run: PerfRun = {
    formatVersion: 1,
    runId,
    suite,
    scenario,
    commit: getGitCommit(),
    dirty: hasUncommittedChanges(),
    options,
    environment: collectEnvironment(affinity, gpu ?? null),
    startedAt,
    finishedAt: new Date().toISOString(),
    samples,
    summary: summarize(samples),
  };
  writeRun(directory, run);
  writeRunMarkdown(run);
  return run;
}

function printSummary(run: PerfRun): void {
  console.log("");
  console.log("========================================");
  console.log(`🏁 ${run.suite} / ${run.scenario}`);
  console.log(`   Run ID: ${run.runId}`);
  console.log(`   样本: ${run.samples.length}，墙钟中位: ${formatNumber(run.summary.wallMsMedian)} ms，CV: ${formatNumber(run.summary.wallMsCv === null ? null : run.summary.wallMsCv * 100)}%`);
  if (run.suite === "sim") console.log(`   中位 tick/s: ${formatNumber(run.summary.wallMsMedian === null ? null : 3600_000 / run.summary.wallMsMedian)}`);
  else console.log(`   总提案/s: ${formatNumber(run.summary.evaluationsPerSecondMedian, 0)}，搜索提案/s: ${formatNumber(run.summary.searchEvaluationsPerSecondMedian, 0)}，search: ${formatNumber(run.summary.searchMsMedian)} ms，verify: ${formatNumber(run.summary.verificationMsMedian)} ms`);
  const failed = run.samples.filter(sample => sample.error !== null);
  if (failed.length) console.log(`   ❌ 失败样本: ${failed.length}；详情见 .temp/perf/runs/${run.runId}/`);
  console.log(`📂 .temp/perf/runs/${run.runId}/`);
  console.log("========================================");
}

async function runSuite(suite: "sim" | "eda", options: CliOptions): Promise<void> {
  const dirty = hasUncommittedChanges();
  if (dirty && options.iterations !== 1 && !options.allowDirty) {
    console.error("❌ 检测到未提交改动。正式基线必须先提交；快速验证请使用 -n 1，或显式使用 --allow-dirty 做开发验证。");
    process.exit(1);
  }
  if (suite === "sim") {
    const engine = options.engine ?? process.env.SIMULATION_TEST_ENGINE ?? null;
    if (engine === null) throw new Error("sim 性能测试必须通过 --engine 或 SIMULATION_TEST_ENGINE 显式指定引擎。");
    const startedAt = new Date().toISOString();
    const runId = createRunId("sim", "xiranite-3600");
    const directory = createRunDirectory(runId);
    const samples: PerfSample[] = [];
    for (let index = 1; index <= options.iterations; index++) {
      console.log(`▶️  sim 第 ${index}/${options.iterations} 次...`);
      const sample = runSimSample(engine, options.affinity, index, directory);
      samples.push(sample);
      console.log(sample.error === null ? `   ✅ ${sample.wallMs.toFixed(1)} ms` : `   ❌ ${sample.error}`);
    }
    const run = finishRun(runId, directory, "sim", "xiranite-3600", { engine, iterations: options.iterations, affinity: options.affinity },
      samples, startedAt, options.affinity);
    printSummary(run);
    if (run.samples.every(sample => sample.error !== null)) process.exit(1);
    return;
  }
  const scenario = effectiveScenario(options);
  const suiteName: PerfSuite = options.mode === "browser" ? "eda-browser" : "eda-core";
  const startedAt = new Date().toISOString();
  const runId = createRunId(suiteName, scenario.id);
  const directory = createRunDirectory(runId);
  const samples: PerfSample[] = [];
  for (let index = 1; index <= options.iterations; index++) {
    console.log(`▶️  ${suiteName} 第 ${index}/${options.iterations} 次...`);
    const sample = runEdaChild({ ...options, mode: options.mode }, scenario, index, directory);
    samples.push(sample);
    console.log(sample.error === null
      ? `   ✅ 墙钟 ${sample.wallMs.toFixed(1)} ms，${sample.evaluations ?? "—"} 提案，总 ${formatNumber(sample.evaluationsPerSecond, 0)} 提案/s，搜索 ${formatNumber(sample.searchEvaluationsPerSecond, 0)} 提案/s`
      : `   ❌ ${sample.error}`);
  }
  const run = finishRun(runId, directory, suiteName, scenario.id, {
    mode: options.mode, scenario, iterations: options.iterations, affinity: options.affinity,
  }, samples, startedAt, options.affinity);
  printSummary(run);
  if (run.samples.every(sample => sample.error !== null)) process.exit(1);
}

interface CompareResult {
  readonly metric: string;
  readonly baseline: number | null;
  readonly current: number | null;
  readonly ratio: number | null;
}

function compareMetric(name: string, baseline: number | null, current: number | null): CompareResult {
  return { metric: name, baseline, current, ratio: baseline !== null && current !== null && baseline !== 0 ? current / baseline : null };
}

async function runCompare(args: readonly string[]): Promise<void> {
  if (args.length !== 2) throw new Error("compare 需要 baseline 与 current 两个结果路径。");
  const baseline = readRun(args[0]!);
  const current = readRun(args[1]!);
  if (baseline.suite !== current.suite || baseline.scenario !== current.scenario) {
    throw new Error(`不可比较：suite/scenario 不一致（${baseline.suite}/${baseline.scenario} vs ${current.suite}/${current.scenario}）。`);
  }
  const baselineGpu = baseline.environment.gpu?.hardware ?? null;
  const currentGpu = current.environment.gpu?.hardware ?? null;
  if (baselineGpu !== currentGpu) throw new Error(`不可比较：GPU 状态不一致（${String(baselineGpu)} vs ${String(currentGpu)}）。`);
  if (JSON.stringify(baseline.options.engine) !== JSON.stringify(current.options.engine)) throw new Error("不可比较：仿真引擎不一致。");
  if (JSON.stringify(baseline.options.mode) !== JSON.stringify(current.options.mode)) throw new Error("不可比较：EDA 运行模式不一致。");
  if (JSON.stringify(baseline.options.affinity) !== JSON.stringify(current.options.affinity)) throw new Error("不可比较：CPU 绑定不一致。");
  const baselineScenario = baseline.options.scenario as EdaPerfScenario | undefined;
  const currentScenario = current.options.scenario as EdaPerfScenario | undefined;
  if (baselineScenario && currentScenario) {
    for (const key of ["localEvaluations", "attempts", "candidateSeconds", "verificationSeconds", "gpu", "concurrency"] as const) {
      if (JSON.stringify(baselineScenario[key]) !== JSON.stringify(currentScenario[key])) {
        throw new Error(`不可比较：场景参数 ${key} 不一致（${JSON.stringify(baselineScenario[key])} vs ${JSON.stringify(currentScenario[key])}）。`);
      }
    }
  }
  const results = [
    compareMetric("墙钟中位 (ms)", baseline.summary.wallMsMedian, current.summary.wallMsMedian),
    compareMetric("有效中位 (ms)", baseline.summary.activeMsMedian, current.summary.activeMsMedian),
    compareMetric("总提案/s 中位", baseline.summary.evaluationsPerSecondMedian, current.summary.evaluationsPerSecondMedian),
    compareMetric("搜索提案/s 中位", baseline.summary.searchEvaluationsPerSecondMedian, current.summary.searchEvaluationsPerSecondMedian),
    compareMetric("search 中位 (ms)", baseline.summary.searchMsMedian, current.summary.searchMsMedian),
    compareMetric("verify 中位 (ms)", baseline.summary.verificationMsMedian, current.summary.verificationMsMedian),
    compareMetric("墙钟开销中位 (ms)", baseline.summary.schedulerMsMedian, current.summary.schedulerMsMedian),
  ];
  const lines = [
    `# Perf Compare ${new Date().toISOString()}`,
    "",
    `- baseline: ${baseline.runId} (${baseline.commit}${baseline.dirty ? "+WT" : ""})`,
    `- current: ${current.runId} (${current.commit}${current.dirty ? "+WT" : ""})`,
    `- suite/scenario: ${baseline.suite} / ${baseline.scenario}`,
    "",
    "| 指标 | baseline | current | current/baseline |",
    "| --- | ---: | ---: | ---: |",
    ...results.map(result => `| ${result.metric} | ${formatNumber(result.baseline)} | ${formatNumber(result.current)} | ${result.ratio === null ? "—" : `${result.ratio.toFixed(3)}x`} |`),
  ];
  const output = resolve(".temp/perf", `compare-${Date.now()}.md`);
  mkdirSync(resolve(".temp/perf"), { recursive: true });
  writeFileSync(output, lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  console.log(`\n📝 ${output}`);
}

async function runChild(options: CliOptions): Promise<void> {
  if (!options.output) throw new Error("--sample 模式必须提供 --output。");
  const scenario = effectiveScenario(options);
  const sample = options.sample === "eda-browser"
    ? await runEdaBrowserSample(scenario, { url: options.url ?? undefined, browser: options.browser ?? undefined, timeoutMs: options.timeoutMs ?? undefined })
    : await runEdaCoreSample(scenario);
  writeSample(options.output, { ...sample, index: 1 });
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw.includes("--sample")) {
    const options = parseOptions(raw);
    await runChild(options);
    return;
  }
  const [suite, ...rest] = raw;
  if (!suite || suite === "--help" || suite === "-h") { usage(); return; }
  if (suite === "compare") { await runCompare(rest); return; }
  if (suite !== "sim" && suite !== "eda") throw new Error(`未知 suite：${suite}`);
  const options = parseOptions(rest);
  await runSuite(suite, options);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
