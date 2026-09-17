import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { runPlannerBatch, type PlannerBatchOptions } from "@/scripts/eda/planner-runner";
import { edaOutputPath } from "@/scripts/eda/artifact-paths";

it("按给定预算执行规划并保存成功蓝图与统计", async () => {
  const path = process.env.EDA_PLAN ?? "src/tests/blueprint-planner/fixtures/pyrrolite-nugget.json";
  const request = readPlanningInput(createRegistryContract(), JSON.parse(await readFile(resolve(path), "utf8")));
  const options: PlannerBatchOptions = JSON.parse(process.env.EDA_RUN_OPTIONS ?? '{"attempts":1,"engineKind":"dense-v2"}');
  const result = await runPlannerBatch(request, options);
  const directory = edaOutputPath("runs", `${Date.now()}-${process.pid}`);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "report.json"), JSON.stringify(result, null, 2));
  if (process.env.EDA_REPORT_PATH) {
    const reportPath = resolve(process.env.EDA_REPORT_PATH);
    if (!reportPath.startsWith(edaOutputPath() + "/")) throw new Error("批量报告只能写入 .temp/eda。");
    await writeFile(reportPath, JSON.stringify({ ...result, reportPath: resolve(directory, "report.json") }, null, 2));
  }
  process.stdout.write(`${JSON.stringify({ report: `${directory}/report.json`, ...result, input: undefined }, null, 2)}\n`);
  // 此入口验证预算执行与报告；成功率作为结果记录，不把有限次未找到布局称为无解。
  expect(result.attempts).toBeGreaterThan(0);
  if (options.attempts !== undefined) {
    if (options.localEvaluations === undefined) expect(result.attempts).toBe(options.attempts);
    else expect(result.attempts).toBeLessThanOrEqual(options.attempts);
  }
  if (options.localEvaluations !== undefined) expect(result.localEvaluations).toBeLessThanOrEqual(options.localEvaluations);
}, 86_400_000);
