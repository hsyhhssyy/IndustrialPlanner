/**
 * 仿真性能基线记录脚本
 *
 * 用法: npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts [-n N]
 *
 * 使用蓝图 7核息壤 (utimate-xiranite) 运行到 3600 tick，
 * 重复执行 N 次（默认 10），取平均值毫秒数，
 * 记录到 .temp/sim-perf.md
 */

import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { runBlueprintSimulation } from "../../src/tests/simulation/blueprint-runner";
import { loadBlueprintFromFile } from "../../src/tests/simulation/blueprint-test-helpers";
import { createRegistryContract } from "../../src/registry";

const __filename = fileURLToPath(import.meta.url);

// ---- 常量 ----

const BLUEPRINT_PATH = "public/blueprints/utimate-xiranite.json";
const MAX_TICK = 3600;
const OUTPUT_FILE = ".temp/sim-perf.md";
const OUTPUT_DIR = ".temp";

// ---- 辅助函数 ----

// 解析 -n 参数
function parseIterations(): number {
  const nIndex = process.argv.indexOf("-n");
  if (nIndex !== -1 && nIndex + 1 < process.argv.length) {
    const n = Number(process.argv[nIndex + 1]);
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) {
      return n;
    }
    console.error(`❌ -n 参数无效: ${process.argv[nIndex + 1]}，应为正整数`);
    process.exit(1);
  }
  return 10; // 默认值
}

// 生成本次运行的唯一标识
function generateRunHash(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function getGitHeadSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function hasUncommittedChanges(): boolean {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function formatDateTime(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

function ensureOutputDir(): void {
  const absDir = resolve(OUTPUT_DIR);
  if (!existsSync(absDir)) {
    mkdirSync(absDir, { recursive: true });
  }
}

function ensureHeader(): void {
  const absFile = resolve(OUTPUT_FILE);
  if (!existsSync(absFile)) {
    appendFileSync(absFile, "| Run ID | 提交 SHA | 执行时间 | 平均耗时 (ms) |\n");
    appendFileSync(absFile, "|--------|----------|----------|---------------|\n");
  }
}

// ---- 日志 Tee ----

function createTeeLogger(filePath: string): {
  log: (...args: unknown[]) => void;
  restore: () => void;
} {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const lines: string[] = [];

  const teeLog = (level: "log" | "debug", ...args: unknown[]) => {
    const line = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    lines.push(`[${level}] ${line}`);
    // 终端只输出非 perf 日志：debug 级别和 [perf] 前缀的 log 只写文件
    if (level === "debug") {
      // 不进终端
    } else {
      const text = args[0];
      if (typeof text === "string" && /^\s*\[perf\]/.test(text)) {
        // [perf] 前缀的 log 只写文件
      } else {
        originalLog(...args);
      }
    }
  };

  console.log = (...args: unknown[]) => teeLog("log", ...args);
  console.debug = (...args: unknown[]) => teeLog("debug", ...args);

  return {
    log: (...args: unknown[]) => teeLog("log", ...args),
    restore: () => {
      console.log = originalLog;
      console.debug = originalDebug;
      mkdirSync(resolve(filePath, ".."), { recursive: true });
      writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    },
  };
}

// ---- 子进程单次执行 ----

async function runSingleAndExit(logFile: string): Promise<never> {
  const tee = createTeeLogger(logFile);
  const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
  const registry = createRegistryContract();
  const start = performance.now();
  await runBlueprintSimulation({
    blueprint,
    maxTickNumber: MAX_TICK,
    registry,
    perfEnabled: true,
  });
  const elapsed = performance.now() - start;
  tee.restore();
  // 父进程通过解析 stdout 获取耗时
  console.log(`RESULT:${elapsed.toFixed(1)}`);
  process.exit(0);
}

// --single 模式：子进程入口，执行单次仿真后退出
const SINGLE_MODE_INDEX = process.argv.indexOf("--single");
if (SINGLE_MODE_INDEX !== -1) {
  const logFile = process.argv[SINGLE_MODE_INDEX + 1];
  if (!logFile) {
    console.error("--single requires a log file path");
    process.exit(1);
  }
  await runSingleAndExit(logFile);
}

// ---- 正常模式 ----

const ITERATIONS = parseIterations();
const RUN_HASH = generateRunHash();
const RUNS_DIR = resolve(`.temp/sim-perf/runs/${RUN_HASH}`);

async function main(): Promise<void> {
  const isDirty = hasUncommittedChanges();

  // 1. 检查未提交改动：-n 1 快速验证模式可跳过
  if (isDirty && ITERATIONS !== 1) {
    console.error("❌ 检测到未提交的改动，请先提交代码再执行性能测试。");
    console.error("   提示：使用 -n 1 可跳过此检查进行快速验证。");
    process.exit(1);
  }

  console.log(`📋 蓝图: ${BLUEPRINT_PATH}`);
  console.log(`⏱️  目标 tick: ${MAX_TICK}`);
  console.log(`🔁 迭代次数: ${ITERATIONS}`);
  console.log(`📂 运行日志: ${RUNS_DIR}/`);
  console.log("");

  const durations: number[] = [];

  for (let i = 1; i <= ITERATIONS; i++) {
    const logFile = resolve(`${RUNS_DIR}/run-${i}.console.log`);
    console.log(`▶️  第 ${i}/${ITERATIONS} 次执行...`);

    const result = spawnSync(
      "npx",
      ["tsx", "--tsconfig", "tsconfig.app.json", __filename, "--single", logFile],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );

    if (result.status !== 0) {
      console.error(`   ❌ 第 ${i} 次执行失败，子进程退出码: ${result.status}`);
      continue;
    }

    const match = result.stdout.match(/RESULT:([\d.]+)/);
    if (match) {
      const elapsed = Number(match[1]);
      durations.push(elapsed);
      console.log(`   ✅ 耗时: ${elapsed.toFixed(1)} ms`);
      console.log(`   📝 日志已写入: ${logFile}`);
    } else {
      console.error(`   ❌ 第 ${i} 次执行失败，无法解析耗时`);
    }
  }

  if (durations.length === 0) {
    console.error("❌ 所有迭代均失败，无法计算平均值。");
    process.exit(1);
  }

  // 计算平均值
  const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const avgPerTick = avg / MAX_TICK;
  const avgTicksPerSec = (MAX_TICK / avg) * 1000;

  // 记录到文件
  const sha = isDirty ? `${getGitHeadSha()}+WT` : getGitHeadSha();
  const dateTime = formatDateTime();

  ensureOutputDir();
  ensureHeader();
  appendFileSync(resolve(OUTPUT_FILE), `| ${RUN_HASH} | ${sha} | ${dateTime} | ${avg.toFixed(1)} |\n`);

  console.log("");
  console.log("========================================");
  console.log(`🏁 完成! 平均耗时: ${avg.toFixed(1)} ms`);
  console.log(`   ⏱️  平均每 tick: ${avgPerTick.toFixed(2)} ms`);
  console.log(`   🎯 平均模拟速率: ${avgTicksPerSec.toFixed(1)} tick/s`);
  console.log(`📝 已记录到 ${OUTPUT_FILE}`);
  console.log(`   提交: ${sha}`);
  console.log(`   时间: ${dateTime}`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("仿真性能测试失败:", err);
  process.exit(1);
});
