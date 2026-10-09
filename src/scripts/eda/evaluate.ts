import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { parseArgs, promisify } from "node:util";
import { PlannerBatchSession, runPlannerBatch } from "./planner-runner";
import { readPlanningInput } from "./planning-input";
import { edaOutputPath } from "./artifact-paths";
import { saveProposalCurve } from "./proposal-curve";
import type { PlannerSearchProfile } from "@/blueprint-planner/search-profile";

/** 固定累计预算的算法评估入口；默认冷启动，完整保留失败和已验证面积曲线。 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    plan: { type: "string", default: "src/tests/blueprint-planner/fixtures/yazhen-syringe.json" },
    proposals: { type: "string", default: "500000" }, seconds: { type: "string", default: "3600" },
    "candidate-seconds": { type: "string", default: "120" }, "verification-seconds": { type: "string", default: "120" },
    "start-variant": { type: "string", default: "0" }, strategy: { type: "string", default: "compact" },
    profile: { type: "string" }, python: { type: "string", default: process.env.EDA_PYTHON ?? "python3" },
  } });
  const proposals = Number(values.proposals);
  if (!Number.isSafeInteger(proposals) || proposals <= 0) throw new Error("proposals 必须为正安全整数。");
  if (values.strategy !== "compact" && values.strategy !== "baseline") throw new Error("strategy 必须为 compact 或 baseline。");
  const execute = promisify(execFile);
  // 2026-10-07：Windows 上 Python 默认以 GBK 读写，而这里传给 -c 的源码与生成的 JSON 都是 UTF-8，
  // plot-eda-curve.py 读取报告时会以 UnicodeDecodeError 失败。显式给子进程补 UTF-8 默认值，
  // 已显式设置的环境变量优先。CI（ubuntu）本身即为 UTF-8，无副作用。
  const pythonEnv = { ...process.env,
    PYTHONUTF8: process.env.PYTHONUTF8 ?? "1", PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8" };
  await execute(values.python, ["-c", "import matplotlib"], { env: pythonEnv });
  const output = edaOutputPath("evaluations", `${Date.now()}-${process.pid}`);
  await mkdir(output, { recursive: true });
  const rawInput = await readFile(resolve(values.plan), "utf8");
  const profileInput = values.profile ? JSON.parse(await readFile(resolve(values.profile), "utf8")) : undefined;
  const profile: Partial<PlannerSearchProfile> | undefined = profileInput?.profile ?? profileInput;
  const sourceFiles = ["package-lock.json", "src/scripts/eda/planner-runner.ts", "src/scripts/eda/evaluate.ts",
    "src/scripts/eda/proposal-curve.ts", "src/scripts/eda/node-planner-client.ts", "src/scripts/eda/node-worker.mjs"];
  for (const root of ["src/blueprint-planner", "src/registry", "src/simulation", "src/domain", "src/shared", "src/editor"]) {
    for (const file of await readdir(root, { recursive: true })) if (/\.(ts|tsx|json)$/.test(file)) sourceFiles.push(`${root}/${file}`);
  }
  const hashSources = async () => {
    const hashes: Record<string, string> = {};
    for (const path of sourceFiles.sort()) hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
    return hashes;
  };
  const sourceHashes = await hashSources();
  await writeFile(resolve(output, "source-hashes.json"), JSON.stringify(sourceHashes, null, 2));
  const session = new PlannerBatchSession();
  console.log(JSON.stringify({ output, proposals, strategy: values.strategy }));
  try {
    const request = readPlanningInput(session.workspace.registry, JSON.parse(rawInput));
    await writeFile(resolve(output, "input.json"), JSON.stringify(request, null, 2));
    let cumulative = 0, best: number | null = null;
    const result = await runPlannerBatch(request, { engineKind: "dense-v2", strategy: values.strategy, profile,
      localEvaluations: proposals, seconds: Number(values.seconds), startVariant: Number(values["start-variant"]),
      candidateSeconds: Number(values["candidate-seconds"]), verificationSeconds: Number(values["verification-seconds"]), diagnostics: true,
    }, session, async record => {
      cumulative += record.evaluations;
      if (record.outcome === "success") best = Math.min(best ?? Infinity, record.area!);
      await appendFile(resolve(output, "attempts.jsonl"), JSON.stringify(record) + "\n");
      console.log(JSON.stringify({ variant: record.variant, proposals: cumulative, bestArea: best, outcome: record.outcome,
        candidateCoverage: record.outcome === "success" ? record.search?.quality?.utilization : undefined,
        area: record.area, elapsedMs: record.elapsedMs, accounting: record.evaluationAccounting }));
    });
    const sourcesUnchanged = JSON.stringify(sourceHashes) === JSON.stringify(await hashSources());
    const report = { ...result, protocol: "cumulative-proposals-v1", inputPath: values.plan,
      inputSha256: createHash("sha256").update(rawInput).digest("hex"), sourcesUnchanged,
      budgetCompletedExactly: result.localEvaluations === proposals && result.proposalCurve.exact,
      stopReason: result.localEvaluations >= proposals ? "proposal-budget" : "time-budget" };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    await saveProposalCurve(output, result.proposalCurve);
    await execute(values.python, ["src/scripts/plot-eda-curve.py", resolve(output, "report.json")], { env: pythonEnv });
    console.log(JSON.stringify({ output, elapsedMs: result.elapsedMs, bestArea: result.proposalCurve.bestArea,
      bestCoverage: result.proposalCurve.bestCoverage,
      budgetCompletedExactly: report.budgetCompletedExactly, improvements: result.proposalCurve.improvements }));
    if (!sourcesUnchanged) throw new Error("实验期间相关源码改变，报告已保存但不能作为固定版本成绩。");
    if (!report.budgetCompletedExactly) throw new Error("未完成精确提案预算；请查看停止原因和计数可信度，不能宣称已跑满。");
  } finally { await session.dispose(); }
}

await main();
