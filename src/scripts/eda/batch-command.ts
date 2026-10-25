import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRegistryContract } from "@/registry";
import { readPlanningInput } from "./planning-input";
import { runPlannerBatch, type PlannerBatchOptions } from "./planner-runner";
import { edaOutputPath } from "./artifact-paths";
import { saveProposalCurve } from "./proposal-curve";

/** 批量规划是实验工具；有限预算内未找到解仍输出真实结果，不作为测试成功率断言。 */
export async function runBatchCommand(path: string, options: PlannerBatchOptions, reportPath?: string): Promise<void> {
  const output = reportPath ? resolve(reportPath) : undefined;
  if (output && !output.startsWith(edaOutputPath() + "/")) throw new Error("批量报告只能写入 .temp/eda。");
  const request = readPlanningInput(createRegistryContract(), JSON.parse(await readFile(resolve(path), "utf8")));
  const result = await runPlannerBatch(request, options);
  const directory = edaOutputPath("runs", `${Date.now()}-${process.pid}`);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "report.json"), JSON.stringify(result, null, 2));
  await saveProposalCurve(directory, result.proposalCurve);
  if (output) await writeFile(output, JSON.stringify({ ...result, reportPath: resolve(directory, "report.json") }, null, 2));
  process.stdout.write(`${JSON.stringify({ report: `${directory}/report.json`, ...result, input: undefined }, null, 2)}\n`);
}
