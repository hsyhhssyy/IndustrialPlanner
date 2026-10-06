/**
 * 算力基准测试（Node 侧）：测量「并发通道数 → 实测提案吞吐」曲线并取膝盖点。
 * 用法:
 *   npx tsx --tsconfig tsconfig.app.json src/scripts/eda/capacity-benchmark.ts [--window=4] [--levels=6] [--plan=<json>]
 * 结果写入 .temp/eda/capacity/，供后续调度策略上限与离线对照使用。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { calibratePlannerCapacity, type PlannerCapacityReport } from "@/blueprint-planner/capacity-calibration";
import { browserPlannerResources } from "@/blueprint-planner/automatic-concurrency";
import { edaOutputPath } from "./artifact-paths";
import { probeNodePlannerCapacity } from "./capacity-probe";
import { cpus, totalmem } from "node:os";

function argument(name: string): string | undefined {
  const found = process.argv.find(value => value.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

const windowSeconds = Number(argument("window") ?? 4);
const levels = Number(argument("levels") ?? 6);
const planPath = argument("plan") ?? "src/tests/blueprint-planner/fixtures/yazhen-syringe.json";
const raw = JSON.parse(await readFile(planPath, "utf8")) as { request?: BlueprintPlannerRequest } & BlueprintPlannerRequest;
const request = (raw.request ?? raw) as BlueprintPlannerRequest;
if (!request?.plan || !request?.options) throw new Error(`无法从 ${planPath} 读出生产方案请求。`);

// Node 侧没有 navigator：用真实核心数与物理内存给出容量提示，避免退化成 2 核假设。
const resourceHints = { hardwareConcurrency: cpus().length, deviceMemory: Math.round(totalmem() / 1024 ** 3) };
console.log(`本机: ${resourceHints.hardwareConcurrency} 逻辑核, ${resourceHints.deviceMemory} GB 内存; 窗口 ${windowSeconds}s, 最多 ${levels} 档`);

const report: PlannerCapacityReport = await calibratePlannerCapacity(
  options => probeNodePlannerCapacity(options, { localEvaluationsPerWorker: 5_000_000,
    onProgress: message => console.log(`  ${message}`) }),
  { request, engineKind: "dense-v2", resourceHints, windowMs: windowSeconds * 1000, maxLevels: levels,
    confirm: async () => true, onProgress: message => console.log(message) });

const output = edaOutputPath("capacity", String(report.measuredAt));
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "capacity.json"), JSON.stringify({ ...report, resourceHints: browserPlannerResources() }, null, 2));

console.log("\n并发 → 吞吐:");
for (const point of report.points) {
  console.log(`  ${String(point.workers).padStart(2)} 通道: ${point.evaluationsPerSecond.toFixed(0)} 提案/s  `
    + `增益 ${point.gain.toFixed(2)}×  主线程延迟 ${point.lagMs.toFixed(0)}ms  (${point.evaluations} 提案 / ${(point.windowMs / 1000).toFixed(1)}s)`);
}
console.log(`\n标定并发上限: ${report.concurrentWorkers}（保守提示 ${report.conservativeLimit}）`);
for (const note of report.notes) console.log(`  - ${note}`);
console.log(`报告: ${output}`);
