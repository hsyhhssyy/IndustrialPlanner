// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";

it("常驻训练执行器连续运行独立预算的真实规划，复用同一布局 Worker", async () => {
  const parent = resolve(".temp/eda/runs/worker-tests");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(`${parent}/run-`);
  const child = spawn(process.execPath, ["src/scripts/eda/training-worker.mjs"], {
    detached: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const terminate = () => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let errors = "";
  child.stderr.on("data", data => { errors += String(data); });
  const timeout = setTimeout(terminate, 25_000);
  try {
    const ready = JSON.parse((await lines.next()).value ?? "{}");
    expect(ready).toMatchObject({ type: "ready", backend: "cpu", pid: child.pid });
    const reports = [];
    for (const [id, budget] of [["first", 7], ["second", 3]] as const) {
      const reportPath = resolve(directory, `${id}.json`);
      child.stdin.write(`${JSON.stringify({ id, planPath: resolve("src/tests/blueprint-planner/fixtures/pyrrolite-nugget.json"),
        reportPath, options: { engineKind: "dense-v2", attempts: 1, localEvaluations: budget, width: 25, height: 30, candidateSeconds: 10 } })}\n`);
      const message = JSON.parse((await lines.next()).value ?? "{}");
      expect(message, errors).toMatchObject({ type: "completed", id });
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      expect(report.localEvaluations).toBe(budget);
      expect(report.records).toHaveLength(1);
      reports.push(report);
    }
    expect(reports[0].workerThreadId).toBeGreaterThan(0);
    expect(reports[1].workerThreadId).toBe(reports[0].workerThreadId);
    child.stdin.end();
    expect(await exited).toEqual([0, null]);
  } finally {
    clearTimeout(timeout);
    terminate();
    await exited;
    await lines.return?.();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
