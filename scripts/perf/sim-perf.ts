/**
 * 仿真性能基线记录脚本
 *
 * 用法: npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts [-n N]
 *
 * 使用蓝图 7核息壤 (utimate-xiranite) 运行到 3600 tick，
 * 重复执行 N 次（默认 10），取平均值毫秒数，
 * 记录到 .temp/sim-perf.md
 */

import { execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { runBlueprintSimulation } from "../../src/tests/simulation/blueprint-runner";
import { loadBlueprintFromFile } from "../../src/tests/simulation/blueprint-test-helpers";
import { createRegistryContract } from "../../src/registry";

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

const BLUEPRINT_PATH = "public/blueprints/utimate-xiranite.json";
const MAX_TICK = 3600;
const ITERATIONS = parseIterations();
const OUTPUT_FILE = ".temp/sim-perf.md";
const OUTPUT_DIR = ".temp";

// ---- 辅助函数 ----

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
    appendFileSync(absFile, "| 提交 SHA | 执行时间 | 平均耗时 (ms) |\n");
    appendFileSync(absFile, "|----------|----------|---------------|\n");
  }
}

// ---- 主流程 ----

async function main(): Promise<void> {
  // 1. 检查未提交改动
  if (hasUncommittedChanges()) {
    console.error("❌ 检测到未提交的改动，请先提交代码再执行性能测试。");
    process.exit(1);
  }

  console.log(`📋 蓝图: ${BLUEPRINT_PATH}`);
  console.log(`⏱️  目标 tick: ${MAX_TICK}`);
  console.log(`🔁 迭代次数: ${ITERATIONS}`);
  console.log("");

  const blueprint = loadBlueprintFromFile(BLUEPRINT_PATH);
  const registry = createRegistryContract();

  const durations: number[] = [];

  for (let i = 1; i <= ITERATIONS; i++) {
    console.log(`▶️  第 ${i}/${ITERATIONS} 次执行...`);

    const start = performance.now();
    await runBlueprintSimulation({
      blueprint,
      maxTickNumber: MAX_TICK,
      registry,
    });
    const elapsed = performance.now() - start;

    durations.push(elapsed);
    console.log(`   ✅ 耗时: ${elapsed.toFixed(1)} ms`);
  }

  // 计算平均值
  const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;

  // 记录到文件
  const sha = getGitHeadSha();
  const dateTime = formatDateTime();

  ensureOutputDir();
  ensureHeader();
  appendFileSync(resolve(OUTPUT_FILE), `| ${sha} | ${dateTime} | ${avg.toFixed(1)} |\n`);

  console.log("");
  console.log("========================================");
  console.log(`🏁 完成! 平均耗时: ${avg.toFixed(1)} ms`);
  console.log(`📝 已记录到 ${OUTPUT_FILE}`);
  console.log(`   提交: ${sha}`);
  console.log(`   时间: ${dateTime}`);
  console.log("========================================");
}

main().catch((err) => {
  console.error("仿真性能测试失败:", err);
  process.exit(1);
});
