import { readFile, rename, writeFile } from "node:fs/promises";
import type { Interface } from "node:readline";
import { relative, resolve, isAbsolute } from "node:path";
import { PlannerBatchSession, runPlannerBatch, type PlannerBatchOptions } from "./planner-runner";
import { readPlanningInput } from "./planning-input";
import { edaOutputPath } from "./artifact-paths";

interface TrainingJob { readonly id: string; readonly planPath: string; readonly reportPath: string; readonly options: PlannerBatchOptions; }

/** 一个进程顺序复用执行环境；跨进程并发、取消和资源限制统一归 Python 调度器。 */
export async function serveTrainingWorker(lines: Interface): Promise<void> {
  const session = new PlannerBatchSession();
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  send({ type: "ready", pid: process.pid, backend: "cpu", protocol: 1 });
  try {
    for await (const line of lines) {
      const job = JSON.parse(line) as TrainingJob;
      if (!job.id || !job.planPath || !job.reportPath) throw new Error("无效训练任务。");
      try {
        const path = resolve(job.reportPath);
        const offset = relative(edaOutputPath(), path);
        if (!offset || offset === ".." || offset.startsWith("../") || isAbsolute(offset)) throw new Error("训练报告必须位于 .temp/eda 内。");
        const request = readPlanningInput(session.workspace.registry, JSON.parse(await readFile(job.planPath, "utf8")));
        const result = await runPlannerBatch(request, job.options, session);
        const pending = `${path}.pending`;
        await writeFile(pending, JSON.stringify(result, null, 2));
        await rename(pending, path);
        send({ type: "completed", id: job.id, reportPath: path });
      } catch (error) {
        send({ type: "failed", id: job.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally { await session.dispose(); lines.close(); }
}
