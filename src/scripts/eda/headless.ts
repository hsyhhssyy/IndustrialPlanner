import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { readFile, rename, stat, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import { mergePlannerTaskFiles, parsePlannerTaskFile, restorePlannerTaskFile, type PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
        // AI-REMOVED 2026-09-30: 批量测试执行器含 Editor 验证依赖，无头客户端直接装配生产契约。
        // Trigger: 独立 Node 启动。Evidence: 浏览器存储环境初始化。Replacement: 下方 Workspace 装配。
        // Risk: Low。Human Review: Required
        // Original code:
        // import { PlannerBatchSession } from "./planner-runner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { NodePlannerClient } from "./node-planner-client";
import { saveSuccessfulPlanning } from "./artifacts";

export async function runHeadlessPlanner(args: readonly string[]): Promise<void> {
  if (args[0] === "merge") { await mergeHeadlessPlannerTasks(args.slice(1)); return; }
  if (args.includes("--help")) {
    console.log("node src/scripts/run-eda-task.mjs --task <任务.json> [--proposals <总次数>] [--shard-count <X>] [--shard-range <起点:终点>] [--output <输出任务.json>]\nnode src/scripts/run-eda-task.mjs merge --output <合并任务.json> <分片任务.json>...\n分片编号从 0 起，范围右端不包含。省略 --proposals 时持续计算；Ctrl+C 保存检查点并退出。");
    return;
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1];
    if (!["--task", "--proposals", "--output", "--shard-count", "--shard-range"].includes(key) || !value || values.has(key)) throw new Error(`无效或重复参数：${key}`);
    values.set(key, value);
  }
  const taskPath = values.get("--task");
  if (!taskPath) throw new Error("必须提供 --task 任务 JSON 路径。");
  const limit = values.has("--proposals") ? Number(values.get("--proposals")) : Infinity;
  if (values.has("--proposals") && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error("提案次数必须是正整数。");
  if ((await stat(taskPath)).size > 100 * 1024 * 1024) throw new Error("任务文件不能超过 100 MB。");
  const output = resolve(values.get("--output") ?? `${taskPath.replace(/\.json$/i, "")}.continued.json`);
  const lockPath = `${output}.lock`;
  const lock = await open(lockPath, "wx").catch(() => { throw new Error(`输出任务已被占用：${lockPath}`); });
  try {
    const workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(), app: null,
      editor: null, render: null, simulation: null, sync: null, audio: null, blueprintPlanner: null };
    const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
    const session = { workspace, planners: new Set<NodePlannerClient>(),
      async dispose() { try { await Promise.all([...this.planners].map(planner => planner.dispose())); } finally { simulation.dispose(); } } };
    try {
      const source = JSON.parse(await readFile(taskPath, "utf8"));
      const restorationAbort = new AbortController();
      const stopRestoration = () => restorationAbort.abort();
      process.on("SIGINT", stopRestoration); process.on("SIGTERM", stopRestoration);
      const input = await restorePlannerTaskFile(source, session.workspace.registry,
        execution => simulation.actions.runBlueprint(execution, restorationAbort.signal))
        .finally(() => { process.off("SIGINT", stopRestoration); process.off("SIGTERM", stopRestoration); });
      restorationAbort.signal.throwIfAborted();
      const count = values.has("--shard-count") ? Number(values.get("--shard-count"))
        : input.checkpoint.parallel?.count ?? (input.request.options.concurrency === "auto" ? 32 : input.request.options.concurrency ?? 1);
      const range = values.get("--shard-range") ?? `0:${count}`;
      const match = /^(\d+):(\d+)$/.exec(range);
      const start = Number(match?.[1]), end = Number(match?.[2]);
      if (!Number.isSafeInteger(count) || count < 1 || count > 32 || !match || !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end) || start < 0 || end > count || start >= end
        || input.checkpoint.parallel && input.checkpoint.parallel.count !== count
          && (input.checkpoint.parallel.count !== 1 || input.checkpoint.parallel.ownedShards.length !== 1)) throw new Error("分片范围无效。");
      const totalLocalLimit = Number.isFinite(limit) ? Math.ceil(limit * (end - start) / count) : Infinity;
      let remaining = totalLocalLimit;
      const makeWorker: NonNullable<PlannerHostOptions["workerFactory"]> = () => {
        const planner = new NodePlannerClient();
        session.planners.add(planner);
        return {
          // AI-REMOVED 2026-09-30:
          // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
          // Trigger: 用户批准本轮接口与交互调整。
          // Evidence: 原实现使用时间截止或关闭任务面板。
          // Replacement: src/scripts/eda/headless.ts
          // Risk: Low。Human Review: Required
          // Original code:
          //         build: (request, variant, budgetMs, evaluations, signal, _update, seed, continuationStep, maximumArea) => {
          //           const abort = () => { void session.planner.dispose(); };
          //           signal.addEventListener("abort", abort, { once: true });
          //           return session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea })
          //             .finally(() => signal.removeEventListener("abort", abort));
          //         },
          build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed) =>
            planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed }, update, signal),
          dispose: () => { void planner.dispose(); },
        };
      };
      const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => remaining,
        worker: makeWorker(), workerFactory: makeWorker, shardSelection: { count, start, end },
      });
      let stopped = false, id: string | null = null, savedBlueprintId: string | null = null;
      const stop = () => { stopped = true; if (id !== null) host.actions.cancel(id); };
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
      const persist = async () => {
        if (id === null) return;
        const file = host.queries.exportTask(id);
        const staging = `${output}.${process.pid}.tmp`;
        try {
          const handle = await open(staging, "w");
          try { await handle.writeFile(JSON.stringify(file)); await handle.sync(); }
          finally { await handle.close(); }
          await rename(staging, output);
        } finally { await unlink(staging).catch(() => undefined); }
        const result = host.queries.getResult(id);
        if (result && !isBlueprintRecognitionRequest(file.request) && savedBlueprintId !== result.blueprint.blueprintId) {
          const path = await saveSuccessfulPlanning(session.workspace.registry, file.request.plan.name,
            result.blueprint, file.request, { result, checkpoint: file.checkpoint, engineKind: "dense-v2", ticksPerSecond: 2 });
          savedBlueprintId = result.blueprint.blueprintId;
          console.log(`最优蓝图：${path}`);
        }
      };
      try {
        id = await host.actions.importTask(input);
        const initialEvaluations = input.checkpoint.evaluations;
        await persist();
        while (!stopped && remaining > 0) {
          // 无头持续运行不受网页单轮短时间限制；仍以有限阶段落盘并响应退出。
          // 订正 2026-09-30：网页与无头均只按提案预算停止，内部阶段仍落盘并响应退出。
          host.actions.continuePlanning(id,
            Math.max(10_000, Math.ceil(Math.min(100_000, remaining) / 10_000) * 10_000));
          let previousCheckpoint = "";
          while (host.state.activeTaskId !== null) {
            await new Promise<void>(resolve => setTimeout(resolve, 250));
            const file = host.queries.exportTask(id);
            const point = file.checkpoint as PlannerCheckpoint;
            const signature = `${point.attempt}/${point.evaluations}/${file.progress.validatedCandidateCount}`;
            if (signature !== previousCheckpoint) { await persist(); previousCheckpoint = signature; }
          }
          await persist();
          const file = parsePlannerTaskFile(host.queries.exportTask(id), session.workspace.registry);
          remaining = totalLocalLimit - (file.checkpoint.evaluations - initialEvaluations);
          console.log(`累计提案 ${file.checkpoint.evaluations}，布局 ${file.checkpoint.attempt}，最优面积 ${file.progress.bestArea ?? "暂无"}；检查点 ${output}`);
          if (file.progress.status === "failed" && !stopped) throw new Error(file.progress.message ?? "计算失败。");
        }
      } finally {
        process.off("SIGINT", stop); process.off("SIGTERM", stop);
        try { await persist(); }
        finally {
          host.dispose();
        }
      }
    } finally { await session.dispose(); }
  } finally { await lock.close(); await unlink(lockPath); }
}

// AI-REMOVED 2026-10-01:
// Reason: 无头客户端按分片范围实例化多个 Node Worker，原单客户端会阻止并行搜索。
// Trigger: 用户授权并发分片和多人协作。
// Evidence: 原 session.planner 仅构造一个 NodePlannerClient，Host 仅注入一个 worker。
// Replacement: runHeadlessPlanner 内 session.planners、makeWorker 和 shardSelection。
// Risk: Node Worker 数随分片范围增长；需验证退出时逐个释放。
// Human Review: Required
//
// Original code:
//     const session = { workspace, planner: new NodePlannerClient(),
//       async dispose() { try { await this.planner.dispose(); } finally { simulation.dispose(); } } };
//     let remaining = limit;
//     const host = createBlueprintPlannerHost(session.workspace, { storage: null, roundLimit: () => remaining,
//       worker: {
//         build: (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea) =>
//           session.planner.build(request, variant, budgetMs, { maxEvaluations: evaluations, seed, continuationStep, maximumArea }, update, signal),
//         dispose: () => { void session.planner.dispose(); },
//       },
//     });

async function mergeHeadlessPlannerTasks(args: readonly string[]): Promise<void> {
  if (args[0] !== "--output" || !args[1] || args.length < 4) {
    throw new Error("用法：merge --output <合并任务.json> <分片任务.json>...");
  }
  const output = resolve(args[1]);
  const paths = args.slice(2);
  if (paths.some(path => resolve(path) === output)) throw new Error("合并输出不能覆盖输入分片。");
  const registry = createRegistryContract();
  const files = await Promise.all(paths.map(async path => {
    if ((await stat(path)).size > 100 * 1024 * 1024) throw new Error(`任务文件过大：${path}`);
    return JSON.parse(await readFile(path, "utf8"));
  }));
  const merged = await mergePlannerTaskFiles(files, registry);
  const lockPath = `${output}.lock`;
  const lock = await open(lockPath, "wx").catch(() => { throw new Error(`输出任务已被占用：${lockPath}`); });
  const staging = `${output}.${process.pid}.tmp`;
  try {
    const handle = await open(staging, "w");
    try { await handle.writeFile(JSON.stringify(merged)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(staging, output);
  } finally { await unlink(staging).catch(() => undefined); await lock.close(); await unlink(lockPath); }
  console.log(`已合并 ${paths.length} 个任务，累计提案 ${merged.progress.evaluatedProposals}，最优面积 ${merged.progress.bestArea ?? "暂无"}：${output}`);
}
