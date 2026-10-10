// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 启动迁移不再比较算法版本
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { BLUEPRINT_RECOGNITION_VERSION } from "./blueprint-recognition-task";
import { adoptIncomingDataAndReload } from "@/shared/data-migration";
import { migrateTaskBlueprintSchemas } from "./task-blueprint-migration";
import { EDA_MIGRATION_VERSION } from "./data-migration";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { createRecognitionTaskFile, parseRecognitionTaskFile, validateRecognitionBoundaries,
  type BlueprintRecognitionTask } from "./blueprint-recognition-task";
import { plannerOutputModeKey } from "./output-policy";
import { observable, runInAction } from "mobx";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { BlueprintPlannerContract, BlueprintPlannerProgress, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { createUuid } from "@/domain/shared/uuid";
    // AI-REMOVED 2026-09-30: 浏览器蓝图库只在保存时加载，避免无头入口依赖浏览器环境。
    // Trigger: Node 客户端启动。Evidence: 同步存储依赖 import.meta.env。
    // Replacement: save 内动态 import。Risk: Low。Human Review: Required
    // Original code:
    // import { createBlueprintFolder, listBlueprintDirectory, saveBlueprintDocument } from "@/shared/storage/blueprint-storage";
import { edaTaskStorage } from "@/shared/storage/eda-task-storage";
import { assertDataMigrationIdle, hasDataMigrationController } from "@/shared/data-migration";
import { reportStorageFailure } from "@/shared/storage/storage-failure";
import { PlannerWorkerClient } from "./worker-client";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
import { comparePlannerRanks } from "./quality";
import { assertPlannerCandidateBounds, meetsOperatingLimits, meetsProductionTargets } from "./verification";
import { PlannerSearchPortfolio } from "./search-portfolio";
import { breadthOutlineKey, breadthOutlines, fixedOutlineMinimum, selectBreadthOutline } from "./search-outline";
import { createProductionNetwork } from "./production-network";
import { emptyPlannerCheckpoint, parsePlannerTaskFile, restorePlannerTaskFile, PLANNER_ALGORITHM_VERSION, validateTaskRequest, type PlannerCheckpoint, type PlannerParallelCheckpoint, type PlannerShardCheckpoint } from "./task-checkpoint";
import { plannerRequestKey } from "./search-seed";
import { inspectBlueprintBoundaries, blueprintBoundaryKey, assertBlueprintRecognition, assertBlueprintSteadyState } from "./blueprint-analysis";
import { blueprintRecognitionScene } from "./blueprint-scene";
import { identifyBlueprintNetwork } from "./blueprint-network";
import { assertBlueprintPreserved } from "./blueprint-constraints";
import { withBlueprintConverterStartup } from "./blueprint-startup";
import { excludeDisconnectedBlueprintPipes, withBlueprintDisconnectionWarning } from "./blueprint-disconnections";
import { browserPlannerResources, observePlannerPressure, plannerConcurrencyLimit, PlannerAutomaticConcurrency, PlannerConcurrencyMemory,
  type PlannerResourceHints, type PlannerConcurrencySample } from "./automatic-concurrency";

interface PlannerTask {
  file: BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest; checkpoint: PlannerCheckpoint };
  originTaskId: string;
  portfolio: PlannerSearchPortfolio;
  portfolios: Map<number, PlannerSearchPortfolio>;
  liveEvaluations: Map<number, number>;
  activeShards: Set<number>;
  activeShapes: Set<string>;
  abort: AbortController;
  resumedAt: number | null;
  roundStartedEvaluations: number;
  remaining: number;
  running: Promise<void> | null;
}

export interface BlueprintPlannerHost extends BlueprintPlannerContract {
  dispose(): void;
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: whenSettled；运行期迁移已删除
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   pauseForMigration(): Promise<void>;
//   reloadAfterMigration(): Promise<void>;
  whenSettled(): Promise<void>;
}

/** 浏览器与无头客户端只替换 IO，任务状态机、检查点与验收共用。 */
export interface PlannerHostOptions {
  readonly resourceHints?: PlannerResourceHints;
  readonly worker?: Pick<PlannerWorkerClient, "build" | "dispose">;
  readonly workerFactory?: () => Pick<PlannerWorkerClient, "build" | "dispose">;
  /** 内部对照入口；不新增产品设置。默认自动并发下增加一个硬件 GPU 通道。 */
  // 订正 2026-10-07：产品已拆分 gpu 选项；此内部入口仅可禁用 GPU，不再依赖 CPU 自动并发。
  readonly gpuLayout?: boolean;
  readonly gpuWorkerFactory?: () => Pick<PlannerWorkerClient, "build" | "dispose" | "gpuAvailable">;
  readonly storage?: (Pick<typeof edaTaskStorage, "load" | "save" | "delete">
    & Partial<Pick<typeof edaTaskStorage, "loadQuarantined" | "saveQuarantined">>) | null;
  readonly roundLimit?: () => number;
  readonly shardSelection?: { readonly count: number; readonly start: number; readonly end: number };
}

export function createBlueprintPlannerHost(workspace: WorkspaceContract, options: PlannerHostOptions = {}): BlueprintPlannerHost {
  const rank = (candidate: PlannerCandidate) => ({ area: candidate.metrics.area,
    outputStashCount: candidate.search.quality?.outputStashCount,
    secondary: candidate.search.quality?.secondary ?? candidate.metrics.score });
  const candidateSearchTarget = (candidate: PlannerCandidate) => JSON.stringify({
    blueprintId: candidate.execution.blueprint.blueprintId, ...rank(candidate) });
  const state = observable<{ activeTaskId: string | null; revision: number }>({ activeTaskId: null, revision: 0 });
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: reportStorageFailure；存储失败不再反馈全局迁移
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   const migrationWriteErrors = new Map<string, unknown>();
  const tasks = new Map<string, PlannerTask>();
  // 识别使用阶段检查点，不实例化尚未存在的搜索计划或种子池。
  const recognitionTasks = new Map<string, BlueprintRecognitionTask>();
  // 无法恢复的记录独立保留原文，禁止生命周期自动保存覆盖它们。
  const blockedTasks = new Map<string, { file: BlueprintPlannerTaskFile; progress: BlueprintPlannerProgress }>();
  const deferredTasks = new Map<string, { file: BlueprintPlannerTaskFile; progress: BlueprintPlannerProgress; originTaskId: string }>();
  let deferredOperation: Promise<void> | null = null;
  let restoringTask: { id: string; abort: AbortController } | null = null;
  const retainedProgress = (file: BlueprintPlannerTaskFile, error: unknown, taskId = file?.taskId): BlueprintPlannerProgress => {
    const id = taskId;
    const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
    const evaluatedProposals = count(file?.progress?.evaluatedProposals);
    const history = file?.progress?.areaHistory;
    return { ...file?.progress, taskId: id, status: "failed", phase: "preparing",
      startedAt: Number.isFinite(file?.progress?.startedAt) ? file.progress.startedAt : 0,
      elapsedMs: Number.isFinite(file?.progress?.elapsedMs) && file.progress.elapsedMs >= 0 ? file.progress.elapsedMs : 0,
      estimatedProgress: null, candidateCount: count(file?.progress?.candidateCount), evaluatedProposals,
      roundEvaluatedProposals: count(file?.progress?.roundEvaluatedProposals),
      validatedCandidateCount: count(file?.progress?.validatedCandidateCount), activeWorkerCount: 0, bestArea: null,
      // 原文可包含损坏字段；展示历史必须能被图表安全读取，导出仍保留完整原文。
      areaHistory: Array.isArray(history) && history.every(point => point && Number.isSafeInteger(point.evaluatedProposals)
        && point.evaluatedProposals >= 0 && point.evaluatedProposals <= evaluatedProposals
        && Number.isSafeInteger(point.bestArea) && point.bestArea > 0) ? structuredClone(history) : [],
      message: `任务无法继续，原始记录已保留，可导出或删除。${errorMessage(error)}` };
  };
  const retainBlocked = (file: BlueprintPlannerTaskFile, error: unknown, taskId = file?.taskId) => {
    blockedTasks.set(taskId, { file: structuredClone(file), progress: retainedProgress(file, error, taskId) });
  };
  const deferTask = (file: BlueprintPlannerTaskFile, originTaskId = (file.checkpoint as PlannerCheckpoint)?.parallel?.originTaskId ?? file.taskId) => {
    deferredTasks.set(file.taskId, { file: structuredClone(file), originTaskId, progress: { ...retainedProgress(file, ""),
      status: "waiting", bestArea: file.progress?.bestArea ?? null,
      message: "任务已读取，继续计算时恢复。" } });
  };
  const concurrencyMemory = new PlannerConcurrencyMemory();
  const worker = options.worker ?? new PlannerWorkerClient();
  const workers = new Map<number, Pick<PlannerWorkerClient, "build" | "dispose">>();
  const workerFor = (index: number) => {
    const existing = workers.get(index);
    if (existing) return existing;
    // 2026-10-07：普通通道全部保留 CPU；GPU 通道独立领取同一队列的分片。
    const created = index === 0 ? worker : options.workerFactory?.() ?? new PlannerWorkerClient();
    workers.set(index, created);
    return created;
  };
  const storage = options.storage === undefined ? edaTaskStorage : options.storage;
  let disposed = false, loaded = storage === null;
  const restorationAbort = new AbortController();
  let latestId: string | undefined;
  let writes: Promise<void> = Promise.resolve();
  const pendingWrites = new Set<PlannerTask | BlueprintRecognitionTask>();
  let writing = false;
  let lastWriteAt = -Infinity;
  let flushWrite: (() => void) | null = null;
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;
  let lastNotificationAt = -Infinity;
  // 导入包含异步持久化；从准入到提交占用入口，避免导入期间启动计算。
  let importing = false;
  const notify = (immediate = true) => {
    if (disposed) return;
    if (!immediate && performance.now() - lastNotificationAt < 250) {
      notificationTimer ??= setTimeout(() => { notificationTimer = null; notify(); },
        Math.max(0, 250 - (performance.now() - lastNotificationAt)));
      return;
    }
    if (notificationTimer !== null) { clearTimeout(notificationTimer); notificationTimer = null; }
    lastNotificationAt = performance.now();
    runInAction(() => { state.revision++; });
  };
  const elapsed = (task: PlannerTask | BlueprintRecognitionTask) => task.file.progress.elapsedMs + (task.resumedAt === null ? 0 : performance.now() - task.resumedAt);
  // 只保存已完成的搜索阶段；运行中的计数没有可恢复的退火状态，刷新后必须从安全边界重做。
// AI-REMOVED 2026-10-07:
// Reason: 持久化队列同时保存识别阶段和搜索检查点。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/blueprint-planner/blueprint-planner-host.ts snapshot
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   const snapshot = (task: PlannerTask): BlueprintPlannerTaskFile => structuredClone({ ...task.file,
//     progress: { ...task.file.progress, elapsedMs: elapsed(task), evaluatedProposals: task.file.checkpoint.evaluations,
//       candidateCount: task.file.checkpoint.attempt,
//       roundEvaluatedProposals: Math.max(0, task.file.checkpoint.evaluations - task.roundStartedEvaluations), activeWorkerCount: 0 },
//     checkpoint: { ...task.file.checkpoint, portfolio: task.portfolio.snapshot() } });
  const snapshot = (task: PlannerTask | BlueprintRecognitionTask): BlueprintPlannerTaskFile => {
    if (!("portfolio" in task)) return structuredClone({ ...task.file,
      progress: { ...task.file.progress, elapsedMs: elapsed(task), activeWorkerCount: 0 } });
    return structuredClone({ ...task.file,
      progress: { ...task.file.progress, elapsedMs: elapsed(task), evaluatedProposals: task.file.checkpoint.evaluations,
        candidateCount: task.file.checkpoint.attempt,
        roundEvaluatedProposals: Math.max(0, task.file.checkpoint.evaluations - task.roundStartedEvaluations), activeWorkerCount: 0 },
      checkpoint: { ...task.file.checkpoint, portfolio: task.portfolio.snapshot() } });
  };
  const persist = (task: PlannerTask | BlueprintRecognitionTask) => {
    if (storage === null) return;
    // AI-REMOVED 2026-10-03:
    // Reason: 写入较慢时，Promise 链会无限保留每个批次的完整 32 分片快照。
    // Trigger: 用户报告 12 和 8 并发快速 OOM。
    // Evidence: checkpoint-memory.test.ts 阻塞首次写入后，32 个真实 Worker 批次仍逐次深拷贝任务。
    // Replacement: 下方待写任务集合与单写入循环；取出任务时才复制最新已提交状态。
    // Risk: 中间检查点合并；最终结算仍等待全部待写任务。Human Review: Required
    // Original code:
    // const file = snapshot(task);
    // writes = writes.then(() => storage.save(file)).catch(error => reportStorageFailure("eda-task", error));
    pendingWrites.add(task);
    // 运行时只保留最新引用，两秒内合并检查点；收尾与关闭立即唤醒，仍等待最终写入。
    // 识别阶段只在边界、输入和出口确认时提交，立即落盘；搜索批次仍合并写入。
    if (disposed || !("portfolio" in task) || task.file.progress.status !== "running") flushWrite?.();
    if (writing) return;
    writing = true;
    writes = Promise.resolve().then(async () => {
      try {
        while (pendingWrites.size > 0) {
          const delay = 2000 - (performance.now() - lastWriteAt);
          if (!disposed && delay > 0 && [...pendingWrites].every(value => "portfolio" in value && value.file.progress.status === "running")) {
            await new Promise<void>(resolve => {
              const timer = setTimeout(() => { flushWrite = null; resolve(); }, delay);
              flushWrite = () => { clearTimeout(timer); flushWrite = null; resolve(); };
            });
          }
          const next = pendingWrites.values().next().value!;
          pendingWrites.delete(next);
          lastWriteAt = performance.now();
          // 等待期间只保留任务引用；写入中的独立快照不会随继续搜索而变化。
          try { await storage.save(snapshot(next)); }
          catch (error) { reportStorageFailure("eda-task", error); }
        }
      } finally { writing = false; }
    });
  };
  const publish = (task: PlannerTask | BlueprintRecognitionTask, patch: Partial<BlueprintPlannerProgress>, immediate = true) => {
    if (!("portfolio" in task) && patch.message !== undefined) patch = { ...patch,
      message: withBlueprintDisconnectionWarning(workspace.registry, task.file.request.input, patch.message) };
    const spent = elapsed(task);
    if (task.resumedAt !== null) task.resumedAt = performance.now();
    task.file = { ...task.file, progress: { ...task.file.progress, ...patch, elapsedMs: spent } };
    notify(immediate);
  };
  const assertReady = () => {
    assertDataMigrationIdle();
    if (disposed) throw new Error("规划器已关闭。");
    if (!loaded) throw new Error("正在读取历史计算任务，请稍候。");
  };
  // 草稿只封装输入与空检查点；下载不触发计算，也不写入任务历史。
  const createTaskFile = (request: BlueprintPlannerRequest, taskId = createUuid()): BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest } => ({
    formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId,
    request: structuredClone(request), checkpoint: emptyPlannerCheckpoint(), progress: { taskId, status: "waiting",
      phase: "preparing", startedAt: Date.now(), elapsedMs: 0, estimatedProgress: null, candidateCount: 0,
      evaluatedProposals: 0, roundEvaluatedProposals: 0,
      validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null },
  });
  const requireTask = (id: string) => {
    assertReady();
    const blocked = blockedTasks.get(id);
    if (blocked) throw new Error(blocked.progress.message!);
    const task = tasks.get(id);
    if (!task) throw new Error("计算任务不存在。");
    return task;
  };
  const materialize = (file: ReturnType<typeof parsePlannerTaskFile>): PlannerTask => {
    const parsed = file;
    const portfolio = new PlannerSearchPortfolio(parsed.request);
    portfolio.restore(parsed.checkpoint.portfolio);
    const portfolios = new Map<number, PlannerSearchPortfolio>();
    for (const shard of parsed.checkpoint.parallel?.shards ?? []) {
      const pool = new PlannerSearchPortfolio(parsed.request);
      pool.restore(shard.portfolio);
      portfolios.set(shard.index, pool);
    }
    return { file: parsed, originTaskId: parsed.checkpoint.parallel?.originTaskId ?? parsed.taskId,
      portfolio, portfolios, liveEvaluations: new Map(), activeShards: new Set(), activeShapes: new Set(), abort: new AbortController(),
      resumedAt: null, roundStartedEvaluations: parsed.checkpoint.evaluations - parsed.progress.roundEvaluatedProposals, remaining: 0, running: null };
  };
  const restore = async (file: BlueprintPlannerTaskFile, signal = restorationAbort.signal): Promise<PlannerTask> => {
    const parsed = await restorePlannerTaskFile(file, workspace.registry, async execution => {
      restorationAbort.signal.throwIfAborted();
      if (workspace.simulation === null) throw new Error("仿真服务不可用，无法验收旧最优蓝图。");
      const report = await workspace.simulation.actions.runBlueprint(execution, AbortSignal.any([restorationAbort.signal, signal]));
      signal.throwIfAborted();
      restorationAbort.signal.throwIfAborted();
      return report;
    });
    restorationAbort.signal.throwIfAborted();
    return materialize(parsed);
  };
  const restoreDeferred = async (id: string): Promise<PlannerTask> => {
    assertReady();
    const deferred = deferredTasks.get(id);
    if (!deferred) return requireTask(id);
    if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
    const abort = new AbortController();
    restoringTask = { id, abort };
    runInAction(() => { state.activeTaskId = id; });
    deferred.progress = { ...deferred.progress, status: "running", roundEvaluatedProposals: 0, message: "正在恢复计算任务" };
    notify();
    try {
      const task = await restore(deferred.file, abort.signal);
      task.originTaskId = deferred.originTaskId;
      abort.signal.throwIfAborted();
      await storage?.save(snapshot(task));
      tasks.set(id, task);
      deferredTasks.delete(id);
      return task;
    } catch (error) {
      deferred.progress = { ...deferred.progress, status: abort.signal.aborted ? "waiting" : "failed",
        message: abort.signal.aborted ? "恢复已暂停，原始任务已保留。" : `无法继续计算，原始任务已保留。${errorMessage(error)}` };
      throw error;
    } finally {
      restoringTask = null;
      runInAction(() => { state.activeTaskId = null; });
      notify();
    }
  };
  const settle = async (task: PlannerTask) => {
    publish(task, { estimatedProgress: null, activeWorkerCount: 0 });
    task.resumedAt = null;
    persist(task);
    await writes;
    task.running = null;
    if (state.activeTaskId === task.file.taskId) runInAction(() => { state.activeTaskId = null; });
    notify();
  };
  const check = (task: PlannerTask) => {
    if (disposed || task.abort.signal.aborted) throw new DOMException("计算已暂停", "AbortError");
    // AI-REMOVED 2026-09-30:
    // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
    // Trigger: 用户批准本轮接口与交互调整。
    // Evidence: 原实现使用时间截止或关闭任务面板。
    // Replacement: src/blueprint-planner/blueprint-planner-host.ts
    // Risk: Low。Human Review: Required
    // Original code:
    //     if (performance.now() >= task.deadline) throw new PlanningBudgetExhausted();

  };

  const prepareParallel = (task: PlannerTask, concurrency: number | "auto"): PlannerParallelCheckpoint => {
    const point = task.file.checkpoint;
    const requested = options.shardSelection;
    // AI-REMOVED 2026-10-02:
    // Reason: Worker 数曾决定分片数，增减并发会重排同一搜索任务。
    // Trigger: 用户要求多 Worker 唯一批次与暂停后尺寸访问记录连续。
    // Evidence: 原 count 随 concurrency 增长，prepareParallel 会重建分片序列。
    // Replacement: 浏览器固定 32 个虚拟分片，Worker 仅是可调整的执行容量。
    // Risk: 检查点增加空分片；Human Review: Required。
    // Original code:
    // const count = requested?.count ?? Math.max(point.parallel?.count ?? 0, concurrency);
    const count = requested?.count ?? 32;
    if (concurrency !== "auto" && (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32)) {
      throw new Error("并发计算数必须介于 1 到 32。");
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 32
      || (requested && (!Number.isSafeInteger(requested.start)
        || !Number.isSafeInteger(requested.end) || requested.start < 0 || requested.end > count
        || requested.start >= requested.end))) throw new Error("分片范围无效。");
    if (point.parallel && point.parallel.count !== count
      && (count < point.parallel.count || point.parallel.ownedShards.length !== point.parallel.count)) {
      throw new Error("已分片任务不能改变总分片数，请先合并全部分片。");
    }
    const ownedShards = Array.from({ length: requested ? requested.end - requested.start : count },
      (_, offset) => (requested?.start ?? 0) + offset);
    task.file = { ...task.file, request: { ...task.file.request,
      options: { ...task.file.request.options, concurrency } } };
    if (point.parallel && point.parallel.count !== count) {
      const previous = point.parallel;
      const baseVariant = Math.max(...previous.shards.map(shard => shard.nextVariant));
      // AI-REMOVED 2026-10-02:
      // Reason: 新虚拟分片不预复制当前最佳种子。
      // Trigger: 固定分片数后的检查点体积控制。
      // Evidence: 运行时可从 point.best 按需引入种子。
      // Replacement: run 中分片领任务时的按需 remember；Risk: Low；Human Review: Required。
      // Original code:
      // const initialPortfolio = new PlannerSearchPortfolio(task.file.request, point.best?.candidate.seed).snapshot();
      point.parallel = { count, originTaskId: task.originTaskId, baseAttempt: point.attempt, baseVariant, nextShard: previous.nextShard % count,
        baseEvaluations: point.evaluations, baseValidatedCandidates: task.file.progress.validatedCandidateCount,
        requestKey: plannerRequestKey(task.file.request), ownedShards,
        shards: Array.from({ length: count }, (_, index) => ({ index, nextVariant: baseVariant + index,
          attempts: 0, evaluations: 0, validatedCandidates: 0,
          // AI-REMOVED 2026-10-02:
          // Reason: 新虚拟分片无需预复制大蓝图种子，执行时才从当前最佳引入。
          // Trigger: 固定 32 分片时避免持久化 32 份相同布局。
          // Evidence: 旧扩容将 initialPortfolio 深拷贝到每个新分片。
          // Replacement: 空种子池与运行时按需 remember；Risk: Low；Human Review: Required。
          // Original code:
          // portfolio: structuredClone(previous.shards[index]?.portfolio ?? initialPortfolio),
          portfolio: structuredClone(previous.shards[index]?.portfolio ?? { pools: [] }),
          pendingCandidate: previous.shards[index]?.pendingCandidate ?? null,
          // AI-REMOVED 2026-10-02:
          // Reason: 扩大总分片数时，旧尝试计数已归入 baseAttempt，旧尺寸访问次数不能归给新分片。
          // Trigger: 从较小总分片数的协作任务导入浏览器固定 32 分片。
          // Evidence: 检查点要求每分片尺寸访问总数不超过该分片的新尝试次数。
          // Replacement: 新分片从空尺寸访问记录开始；Risk: 转换前的尺寸频次不参与之后排序；Human Review: Required。
          // Original code:
          // shapeVisits: structuredClone(previous.shards[index]?.shapeVisits ?? {})
          shapeVisits: {} })) };
      task.portfolios.clear();
    }
    if (!point.parallel) {
      const initialPortfolio = task.portfolio.snapshot();
      point.parallel = { count, originTaskId: task.originTaskId, baseAttempt: point.attempt, nextShard: 0,
        baseEvaluations: point.evaluations, baseValidatedCandidates: task.file.progress.validatedCandidateCount,
        requestKey: plannerRequestKey(task.file.request), ownedShards,
        shards: Array.from({ length: count }, (_, index) => ({ index, nextVariant: point.attempt + index,
          attempts: 0, evaluations: 0, validatedCandidates: 0,
          // AI-REMOVED 2026-10-02:
          // Reason: 仅实际领取任务的分片需要持有种子布局。
          // Trigger: 浏览器固定 32 虚拟分片；Evidence: 原代码逐分片复制同一种子。
          // Replacement: 首分片保留原种子，其余按需引入；Risk: Low；Human Review: Required。
          // Original code:
          // portfolio: structuredClone(initialPortfolio),
          portfolio: index === 0 ? structuredClone(initialPortfolio) : { pools: [] },
          pendingCandidate: index === 0 ? point.pendingCandidate : null, shapeVisits: {} })) };
      point.pendingCandidate = null;
    } else point.parallel.ownedShards = ownedShards;
    for (const shard of point.parallel.shards) if (!task.portfolios.has(shard.index)) {
      const portfolio = new PlannerSearchPortfolio(task.file.request);
      portfolio.restore(shard.portfolio);
      task.portfolios.set(shard.index, portfolio);
    }
    const workerCount = Math.min(concurrency === "auto" ? 1 : concurrency, ownedShards.length);
    for (const [index, current] of workers) if (index >= workerCount) {
      current.dispose();
      workers.delete(index);
    }
    return point.parallel;
  };

  async function run(task: PlannerTask): Promise<void> {
    const point = task.file.checkpoint;
    const parallel = point.parallel!;
    let searchAbort = new AbortController();
    const cancelSearch = () => searchAbort.abort();
    task.abort.signal.addEventListener("abort", cancelSearch);
    // AI-REMOVED 2026-10-07:
    // Reason: 导入重新分配蓝图 ID 时也须更新当前搜索目标引用，复用同一目标编码。
    // Trigger: 全局重调度检查点的导出、导入连续性。
    // Evidence: importTask 原有蓝图 ID 重分配行为。
    // Replacement: Host 级 rank / candidateSearchTarget；Risk: Low；Human Review: Required。
    // Original code:
    // const rank = (candidate: PlannerCandidate) => ({ area: candidate.metrics.area,
    //   outputStashCount: candidate.search.quality?.outputStashCount,
    //   secondary: candidate.search.quality?.secondary ?? candidate.metrics.score });
    const canImprove = (candidate: PlannerCandidate) => point.best === null
      || comparePlannerRanks(rank(candidate), rank(point.best.candidate)) < 0;
    const searchTarget = () => point.best ? candidateSearchTarget(point.best.candidate) : undefined;
    const idleStatus = () => point.result !== null && point.savedBlueprintId === point.result.blueprint.blueprintId ? "completed" as const : "waiting" as const;
    let lastFailure = "尚未找到通过验证的布局";
    let interruption: unknown = null;
// AI-REMOVED 2026-10-06:
// Reason: 串行 Promise 链改为共享资源额度内的验证队列。
// Trigger: 用户要求吸收 CPU 并发优化。
// Evidence: 原搜索与串行验证独立占用资源，验证积压无法并行消化。
// Replacement: verificationQueue / verificationActive / settleVerifications
// Risk: 取消时必须保留未验证候选并等待全部在途操作。
// Human Review: Required
// Original code:
//     let verificationTail: Promise<void> = Promise.resolve();
    const verificationQueue: Array<{ shard: PlannerShardCheckpoint; portfolio: PlannerSearchPortfolio }> = [];
    const verificationActive = new Map<Promise<void>, number>();
    const searchStarted = new Map<number, number>();
    let searchBusyMs = 0, verificationBusyMs = 0, completedVerifications = 0;
    let maximum = 1, target = 1, verificationTarget = 1;
    let pendingVerifications = 0;
    const verifying = new Set<number>();
    let wake: (() => void) | null = null;
    let stopMonitoring = () => {};
    const active = new Map<number, Promise<void>>();
    let gpuWorker: Pick<PlannerWorkerClient, "build" | "dispose" | "gpuAvailable"> | null = null;
    let gpuShard: number | null = null, gpuLaneEvaluations = 0;
    const cpuActiveCount = () => active.size - Number(active.has(-1));
    const live = (phase?: BlueprintPlannerProgress["phase"], message?: string) => {
      const inFlight = [...task.liveEvaluations.values()].reduce((sum, value) => sum + value, 0);
      const total = point.evaluations + inFlight;
      const round = total - task.roundStartedEvaluations;
      publish(task, { evaluatedProposals: total, roundEvaluatedProposals: round, activeWorkerCount: task.activeShards.size,
        candidateCount: point.attempt + task.activeShards.size,
        estimatedProgress: Math.min(1, round / task.file.request.options.evaluationsPerRound),
        ...(phase ? { phase } : {}), ...(message ? { message } : {}) }, false);
    };
    const verify = async (shard: PlannerShardCheckpoint, portfolio: PlannerSearchPortfolio) => {
      const candidate = shard.pendingCandidate;
      if (candidate === null) return;
      // 旧目标下已完成的候选仅在仍可能改善全局结果时启动验收；已启动的验收正常结算。
      if (!canImprove(candidate)) { shard.pendingCandidate = null; persist(task); return; }
      assertPlannerCandidateBounds(workspace.registry, candidate);
      check(task);
      const simulation = workspace.simulation;
      if (simulation === null) throw new Error("仿真服务不可用。");
      publish(task, { phase: "verification", message: "正在验证产量与循环运行" }, false);
      const report = await simulation.actions.runBlueprint(candidate.execution, task.abort.signal);
      if (task.abort.signal.aborted) return;
      if (report.status === "timeout") throw new PlanningBudgetExhausted("产量验证超时，检查点已保留");
      shard.pendingCandidate = null;
      if (!meetsProductionTargets(task.file.request, report) || !meetsOperatingLimits(candidate.supplyAudit, report)) {
        lastFailure = report.diagnostics.find(entry => entry.severity === "error")?.message ?? "布局实际产量未达到目标";
        persist(task);
        return;
      }
      if (task.file.request.blueprintSource) {
        try {
          assertBlueprintPreserved(workspace.registry, task.file.request, point.blueprintBaseline!.candidate.seed!, candidate.execution.blueprint, candidate.seed);
          assertBlueprintRecognition(workspace.registry, { ...task.file.request.blueprintSource, blueprint: candidate.execution.blueprint }, report);
          assertBlueprintSteadyState(workspace.registry, report, candidate.execution.probes);
        } catch (error) { lastFailure = errorMessage(error); persist(task); return; }
      }
      portfolio.remember(candidate.seed);
      shard.portfolio = portfolio.snapshot();
      shard.validatedCandidates++;
      publish(task, { validatedCandidateCount: task.file.progress.validatedCandidateCount + 1, phase: "optimization" }, false);
      const oldArea = point.best?.candidate.metrics.area ?? null;
      // AI-REMOVED 2026-10-07:
      // Reason: 验收与迟到候选筛选统一使用正式排名，避免两处规则漂移。
      // Trigger: 用户要求每次已验证改进立即全局重调度。
      // Evidence: 旧实现仅替换 point.best，其他分片仍继续旧搜索。
      // Replacement: 本函数的 canImprove / rank；Risk: Low；Human Review: Required。
      // Original code:
      // if (point.best === null || comparePlannerRanks({ area: candidate.metrics.area,
      //   outputStashCount: candidate.search.quality?.outputStashCount,
      //   secondary: candidate.search.quality?.secondary ?? candidate.metrics.score },
      // { area: point.best.candidate.metrics.area,
      //   outputStashCount: point.best.candidate.search.quality?.outputStashCount,
      //   secondary: point.best.candidate.search.quality?.secondary ?? point.best.candidate.metrics.score }) < 0) {
      if (canImprove(candidate)) {
        point.best = { candidate, report };
        // 立即停止旧目标派发，Worker 协作取消后结算实际提案；不取消任务或其他候选的在途验收。
        cancelSearch();
        wake?.();
        point.result = { taskId: task.file.taskId, blueprint: candidate.execution.blueprint, folderId: null,
          metrics: candidate.metrics, connections: candidate.connections,
          measuredOutputs: report.probes.filter(probe => task.file.request.plan.targets.some(target => target.itemId === probe.id))
            .map(probe => ({ itemId: probe.id, perMinute: probe.perMinute
              - (task.file.request.blueprintSource ? report.probes.find(entry => entry.id === `input:${probe.id}`)?.perMinute ?? 0 : 0) })),
          warmupSeconds: candidate.execution.warmupSeconds, observationSeconds: report.observationSeconds, elapsedMs: elapsed(task) };
        publish(task, { bestArea: candidate.metrics.area,
          areaHistory: oldArea === null || candidate.metrics.area < oldArea
            ? [...task.file.progress.areaHistory ?? [], { evaluatedProposals: point.evaluations, bestArea: candidate.metrics.area }]
            : task.file.progress.areaHistory });
      }
      persist(task);
    };
// AI-REMOVED 2026-10-06:
// Reason: 候选验证需要有界并行，且与搜索共用 CPU 额度。
// Trigger: 用户要求吸收 CPU 并发优化。
// Evidence: 原搜索与串行验证独立占用资源，验证积压无法并行消化。
// Replacement: queueVerification / startVerifications / settleVerifications
// Risk: 取消时必须保留未验证候选并等待全部在途操作。
// Human Review: Required
// Original code:
//     const queueVerification = (shard: PlannerShardCheckpoint, portfolio: PlannerSearchPortfolio) => {
//       pendingVerifications++;
//       verifying.add(shard.index);
//       const pending = verificationTail.then(() => verify(shard, portfolio)).catch(error => {
//         if (interruption === null) interruption = error;
//         task.abort.abort();
//       }).finally(() => { pendingVerifications--; verifying.delete(shard.index); wake?.(); });
//       verificationTail = pending.catch(() => undefined);
//       return pending;
//     };
    const queueVerification = (shard: PlannerShardCheckpoint, portfolio: PlannerSearchPortfolio) => {
      pendingVerifications++;
      verifying.add(shard.index);
      verificationQueue.push({ shard, portfolio });
    };
    const startVerifications = () => {
      // 验证先领取已释放的 CPU 额度；搜索和验证的在途数量之和不超过同一个上限。
      while (!task.abort.signal.aborted && verificationQueue.length > 0
        && verificationActive.size < verificationTarget && cpuActiveCount() + verificationActive.size < maximum) {
        const { shard, portfolio } = verificationQueue.shift()!;
        const started = performance.now();
        const running = verify(shard, portfolio).then(() => {
          if (!task.abort.signal.aborted) completedVerifications++;
        }).catch(error => {
          if (interruption === null) interruption = error;
          task.abort.abort();
        }).finally(() => {
          verificationBusyMs += performance.now() - started;
          verificationActive.delete(running);
          pendingVerifications--; verifying.delete(shard.index); wake?.();
        });
        verificationActive.set(running, started);
      }
    };
    const settleVerifications = async () => {
      // 未开始的验证保留 shard.pendingCandidate，继续任务时重新领取；绝不在取消后继续启动 Worker。
      for (const { shard } of verificationQueue.splice(0)) { pendingVerifications--; verifying.delete(shard.index); }
      await Promise.all(verificationActive.keys());
    };
    const owned = parallel.ownedShards;
    // AI-REMOVED 2026-10-02:
    // Reason: 预先平分到分片会让空闲 Worker 无法领取其他尺寸的剩余预算。
    // Trigger: 用户要求尺寸广度和动态并发批次。
    // Evidence: 原 quotas 每轮固定，快分片无法帮助慢分片。
    // Replacement: 下方 available 与 claim 的全局提案预留；Risk: 调度次序改变；Human Review: Required。
    // Original code:
    // const quotas = owned.map((_, index) => Math.floor(task.remaining / owned.length) + Number(index < task.remaining % owned.length));
    let available = task.remaining, zeroAttempts = 0;
    const leased = new Set<number>();
    const outlineCache = new Map<string, ReturnType<typeof breadthOutlines>>();
    const minimumCache = new Map<string, ReturnType<typeof fixedOutlineMinimum>>();
    const synchronizeSearch = () => {
      const target = searchTarget();
      if (target !== undefined) {
        for (const index of owned) {
          const shard = parallel.shards[index]!;
          if (shard.searchTarget === target) continue;
          const portfolio = task.portfolios.get(index)!;
          portfolio.restart(point.best!.candidate.seed);
          shard.portfolio = portfolio.snapshot();
          shard.shapeVisits = {};
          shard.searchTarget = target;
        }
        task.portfolio.restart(point.best!.candidate.seed);
      }
      outlineCache.clear(); minimumCache.clear();
      zeroAttempts = 0;
      persist(task);
    };
    const lane = async (shard: PlannerShardCheckpoint, quota: number, laneWorker: ReturnType<typeof workerFor>) => {
      const portfolio = task.portfolios.get(shard.index)!;
      const signal = searchAbort.signal;
      // AI-REMOVED 2026-10-02:
      // Reason: 零提案失败应按整轮统计，不能每个短批重置。
      // Trigger: 尺寸广度批次可能因固定设施不合而零提案跳过。
      // Evidence: 原局部 zeroAttempts 只在一个长期占用分片内累计。
      // Replacement: run 级 zeroAttempts；Risk: Low；Human Review: Required。
      // Original code:
      // let remaining = quota, zeroAttempts = 0;
      let remaining = quota;
      while (remaining > 0 || shard.pendingCandidate !== null) {
        check(task);
        if (shard.pendingCandidate === null) {
          // AI-REMOVED 2026-10-07:
          // Reason: 只初始化空池使已有旧种子的分片永远不采用新最优。
          // Trigger: 288 最优仅存在于一个分片，且从未用于 19×15 续搜。
          // Evidence: 用户任务的分片池和尺寸访问记录。
          // Replacement: synchronizeSearch；Risk: 改进时重新分配搜索机会；Human Review: Required。
          // Original code:
          // if (shard.portfolio.pools.length === 0 && point.best?.candidate.seed) portfolio.remember(point.best.candidate.seed);
          const before = portfolio.snapshot();
          const selection = portfolio.next(shard.nextVariant, true, point.best ? rank(point.best.candidate) : undefined);
          const sharedArea = point.best?.candidate.metrics.area;
          const maximumArea = sharedArea === undefined ? selection.maximumArea
            : Math.min(selection.maximumArea ?? sharedArea, sharedArea);
          let shapeKey: string | undefined;
          let targetOutline: { readonly width: number; readonly height: number } | undefined;
          const requestKey = plannerRequestKey(selection.request);
          const bestSeed = point.best?.candidate.seed;
          const source = selection.seed ?? (bestSeed?.requestKey === requestKey ? bestSeed : undefined);
          if (maximumArea !== undefined) {
            let minimum = minimumCache.get(requestKey);
            if (!minimum) {
              minimum = fixedOutlineMinimum(workspace.registry,
                source?.network.nodes ?? createProductionNetwork(workspace.registry, selection.request).nodes);
              minimumCache.set(requestKey, minimum);
            }
            const cacheKey = `${maximumArea}/${minimum.width}/${minimum.height}`;
            let shapes = outlineCache.get(cacheKey);
            if (!shapes) { shapes = breadthOutlines(maximumArea, minimum); outlineCache.set(cacheKey, shapes); }
            const mode = plannerOutputModeKey(selection.request.options);
            const visits = (key: string) => parallel.shards.reduce((sum, entry) => sum
              + (entry.searchTarget === shard.searchTarget ? entry.shapeVisits[key] ?? 0 : 0), 0);
            // AI-REMOVED 2026-10-02:
            // Reason: 尺寸领取规则移至纯函数，供真实调度与回归测试共用。
            // Trigger: 多 Worker 防重复与可验证的跨客户端分片归属。
            // Evidence: 内联选择无法独立验证同尺寸占用和最少访问策略。
            // Replacement: selectBreadthOutline；Risk: Low；Human Review: Required。
            // Original code:
            // const ownedShapes = owned.length === parallel.count ? shapes
            //   : shapes.filter(shape => shape.width % parallel.count === shard.index);
            // const choices = ownedShapes.length ? ownedShapes : shapes;
            // const unoccupied = choices.filter(shape => !task.activeShapes.has(`${mode}/${shape.width}/${shape.height}`));
            // const candidates = unoccupied.length ? unoccupied : choices;
            // targetOutline = candidates.reduce<typeof targetOutline>((best, shape) => {
            //   const key = `${mode}/${shape.width}/${shape.height}`;
            //   return !best || visits(key) < visits(`${mode}/${best.width}/${best.height}`) ? shape : best;
            // }, undefined);
            targetOutline = selectBreadthOutline(shapes, mode, visits, task.activeShapes,
              owned.length === parallel.count ? undefined : { count: parallel.count, index: shard.index });
            if (targetOutline) {
              shapeKey = breadthOutlineKey(mode, targetOutline);
              task.activeShapes.add(shapeKey);
            }
          }
          let observed = 0;
          task.activeShards.add(shard.index);
          live(undefined, `正在搜索第 ${point.attempt + task.activeShards.size} 个布局`);
          const commit = (used: number, candidate: PlannerCandidate | null) => {
            if (!Number.isSafeInteger(used) || used < observed || used > remaining) throw new Error("Worker 尝试计数无效。");
            shard.attempts++;
            shard.nextVariant += parallel.count;
            shard.evaluations += used;
            if (shapeKey && !signal.aborted) shard.shapeVisits[shapeKey] = (shard.shapeVisits[shapeKey] ?? 0) + 1;
            shard.portfolio = portfolio.snapshot();
            shard.pendingCandidate = candidate;
            point.attempt++;
            point.evaluations += used;
            if (shard.index === gpuShard) gpuLaneEvaluations += used;
            remaining -= used;
            if (!signal.aborted) zeroAttempts = used === 0 ? zeroAttempts + 1 : 0;
            task.liveEvaluations.delete(shard.index);
            task.activeShards.delete(shard.index);
            live();
            persist(task);
          };
          try {
            const candidate = await laneWorker.build(selection.request, selection.variant, null, remaining,
              signal, (phase, message, count) => {
                if (!Number.isSafeInteger(count) || count < observed || count > remaining) throw new Error("Worker 尝试计数无效。");
                observed = count;
                task.liveEvaluations.set(shard.index, count);
                live(phase, message);
              }, selection.seed, selection.continuationStep, maximumArea, targetOutline, point.blueprintBaseline?.candidate.seed);
            commit(candidate.search.evaluations, canImprove(candidate) ? candidate : null);
          } catch (error) {
            if (signal.aborted) {
              // 包含零提案的取消也推进已派发序号，避免全局改进或恢复后重复随机轨迹。
              commit(error instanceof PlannerCandidateError ? error.search?.evaluations ?? observed : observed, null);
              break;
            } else if (error instanceof PlannerCandidateError) {
              const used = error.search?.evaluations ?? observed;
              // AI-CORRECTION 2026-10-02: 显式尺寸不合时跳过该批；连续零提案仍停止以免无限循环。
              // AI-REMOVED 2026-10-03:
              // Reason: 一次初排失败不能代表所有摆位失败。
              // Trigger: 环境设施位置与数量参与搜索。Evidence: eda2 的首轮固定坐标越界。
              // Replacement: commit 后继续领取其他变体，保留连续零提案的上限。
              // Risk: 不可行输入最多检查 64 次初排；Human Review: Required。
              // Original code:
              // if (used === 0 && !targetOutline) throw new Error(`当前布局无法启动搜索：${error.message}`);
              commit(used, null);
              lastFailure = error.message;
            // AI-REMOVED 2026-10-07:
            // Reason: 全局重调度需要独立取消，零提案也必须推进已派发序号。
            // Trigger: 用户要求新最优出现后立即取消旧批次并重新搜索。
            // Evidence: 原逻辑仅检查任务暂停，且零提案恢复旧序号。
            // Replacement: 上方 signal.aborted 分支；Risk: 取消批次计入布局次数；Human Review: Required。
            // Original code:
            // } else if (task.abort.signal.aborted) {
            //   if (observed > 0) commit(observed, null);
            //   else { portfolio.restore(before); task.liveEvaluations.delete(shard.index); task.activeShards.delete(shard.index); }
            //   break;
            } else {
              portfolio.restore(before);
              task.liveEvaluations.delete(shard.index);
              task.activeShards.delete(shard.index);
              throw error;
            }
          } finally {
            if (shapeKey) task.activeShapes.delete(shapeKey);
          }
          // AI-CORRECTION 2026-10-02: 广度轮换可能遇到多个固定设施无法容纳的盒子，按整轮计数。
          if (zeroAttempts >= 64) throw new Error(`连续 64 次初排未能启动搜索：${lastFailure ?? "未找到合法布局"}`);
        }
        // AI-REMOVED 2026-10-03:
        // Reason: 已结束计算的 Worker 不应占着通道等待串行仿真。
        // Trigger: 自动并发 0/1 抖动。Evidence: Windows 验证队列积压时所有通道空闲。
        // Replacement: verifying 分片集合与 claim 背压，末尾统一等待 verificationTail。
        // Risk: 取消必须同时结算验证与搜索。Human Review: Required
        // Original code:
        // if (shard.pendingCandidate !== null) await queueVerification(shard, portfolio);
        if (shard.pendingCandidate !== null) void queueVerification(shard, portfolio);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        break;
      }
      return quota - remaining;
    };
    try {
      synchronizeSearch();
      const concurrency = task.file.request.options.concurrency ?? 1;
      if (task.file.request.options.gpu === true && owned.length > 1 && options.gpuLayout !== false && (options.gpuWorkerFactory
        || (!options.worker && !options.workerFactory && typeof navigator !== "undefined" && "gpu" in navigator))) {
        gpuWorker = options.gpuWorkerFactory?.() ?? new PlannerWorkerClient(true);
      }
      maximum = Math.min(owned.length, concurrency === "auto"
        ? plannerConcurrencyLimit(options.resourceHints ?? browserPlannerResources()) : concurrency);
      const capacityKey = `${maximum}/${plannerRequestKey(task.file.request)}`;
      const started = performance.now();
      const controller = concurrency === "auto" ? new PlannerAutomaticConcurrency(maximum, started, point.evaluations,
        concurrencyMemory.read(`search/${capacityKey}`, started)) : null;
      const verificationController = concurrency === "auto" ? new PlannerAutomaticConcurrency(maximum, started, 0,
        concurrencyMemory.read(`verification/${capacityKey}`, started)) : null;
      target = controller?.target ?? maximum;
      verificationTarget = verificationController?.target ?? maximum;
      // AI-REMOVED 2026-10-03: wake 移至验证队列同级，允许验证完成唤醒派发。
      // Trigger: 验证与搜索解耦。Evidence: queueVerification.finally。Replacement: run 局部 wake。
      // Risk: Low。Human Review: Required
      // let wake: (() => void) | null = null;
      const retire = () => {
        for (const [index, current] of workers) if (index > 0 && !active.has(index)
          && (index >= target || workers.size + verificationActive.size > maximum)) {
          current.dispose(); workers.delete(index);
        }
      };
      if (controller) {
        let expected = performance.now() + 1000;
        let pressure: PlannerConcurrencySample["pressure"];
        const stopPressure = observePlannerPressure(value => { pressure = value; });
        const timer = setInterval(() => {
          const at = performance.now();
          const lagMs = typeof document !== "undefined" && document.visibilityState !== "visible" ? 0 : Math.max(0, at - expected);
          expected = at + 1000;
          target = controller.observe({ at, lagMs, pressure, pendingVerifications,
            activeWorkers: task.activeShards.size - Number(gpuShard !== null && task.activeShards.has(gpuShard)),
            // GPU 代理次数不得诱导 CPU 缩容；只测 CPU 分片自己的评价与忙碌时间。
            evaluations: point.evaluations - gpuLaneEvaluations + [...task.liveEvaluations.values()].reduce((sum, value) => sum + value, 0)
              - (gpuShard === null ? 0 : task.liveEvaluations.get(gpuShard) ?? 0),
            busyMs: searchBusyMs + [...searchStarted.values()].reduce((sum, value) => sum + at - value, 0) });
          verificationTarget = verificationController!.observe({ at, lagMs, pressure, pendingVerifications,
            activeWorkers: verificationActive.size, evaluations: completedVerifications,
            busyMs: verificationBusyMs + [...verificationActive.values()].reduce((sum, value) => sum + at - value, 0) });
          retire(); wake?.();
        }, 1000);
        stopMonitoring = () => { clearInterval(timer); stopPressure(); };
      }
      const claim = (gpu = false) => {
        // 队列有界，背压只暂停新批次；不把串行验收误报为整机 CPU 满载。
        // 订正 2026-10-06：验证已可并行；高水位跟随共享上限，两个阶段分别测量吞吐。
        if (searchAbort.signal.aborted || pendingVerifications >= Math.max(2, maximum)) return null;
        for (let step = 0; step < parallel.count; step++) {
          const index = (parallel.nextShard + step) % parallel.count;
          if (!owned.includes(index) || leased.has(index) || verifying.has(index)) continue;
          const shard = parallel.shards[index]!;
          if (available <= 0 && shard.pendingCandidate === null) continue;
          const quota = shard.pendingCandidate !== null ? 0 : Math.min(available, point.best && !gpu ? 5_000 : 20_000);
          available -= quota;
          leased.add(index);
          parallel.nextShard = (index + 1) % parallel.count;
          return { shard, quota };
        }
        return null;
      };
      // 同一批预算、分片租约与验证队列由主线程统一管理；缩容只阻止后续领批。
      while (!task.abort.signal.aborted) {
        // 所有旧批次结算后才清空尺寸访问与更新种子，迟到回调不能写进新目标的记录。
        if (searchAbort.signal.aborted && active.size === 0) {
          synchronizeSearch();
          searchAbort = new AbortController();
        }
        startVerifications(); retire();
        // 初排构造主要是 CPU 工作；已有可用种子后，GPU 专注不同尺寸上的独立续搜。
        for (const index of [...(gpuWorker?.gpuAvailable && point.best ? [-1] : []), ...Array.from({ length: target }, (_, index) => index)]) {
          if (index >= 0 && cpuActiveCount() + verificationActive.size >= maximum) break;
          if (active.has(index)) continue;
          const job = claim(index === -1);
          if (job === null) break;
          if (index === -1) gpuShard = job.shard.index;
          else searchStarted.set(index, performance.now());
          // AI-REMOVED 2026-10-07:
          // Reason: 结算必须与 commit 同步，否则异步唤醒间隙会污染 CPU 吞吐样本。
          // Trigger: GPU 独立通道；Evidence: lane 内 commit 后仍有 await。
          // Replacement: commit 中累计 gpuLaneEvaluations；Risk: Low；Human Review: Required
          // Original code: const initialEvaluations = job.shard.evaluations;
          const running = lane(job.shard, job.quota, index === -1 ? gpuWorker! : workerFor(index)).then(used => {
            // 2026-10-02：await 期间其他 Worker 会领取额度；必须在 await 返回后读取最新 available。
            available += job.quota - used;
          }).catch(error => {
            if (interruption === null) interruption = error;
            task.abort.abort();
          }).finally(() => {
            if (index === -1) gpuShard = null;
            else searchBusyMs += performance.now() - searchStarted.get(index)!;
            searchStarted.delete(index);
            leased.delete(job.shard.index); active.delete(index); retire(); wake?.();
          });
          active.set(index, running);
        }
        if (active.size === 0 && pendingVerifications === 0) break;
        await new Promise<void>(resolve => { wake = resolve; });
        wake = null;
      }
      await Promise.allSettled(active.values());
      await settleVerifications();
      if (controller && verificationController) {
        concurrencyMemory.remember(`search/${capacityKey}`, controller.confirmedTarget, performance.now());
        concurrencyMemory.remember(`verification/${capacityKey}`, verificationController.confirmedTarget, performance.now());
      }
      target = 1; retire();
      // AI-REMOVED 2026-10-03:
      // Reason: 固定 Promise 池无法在本轮运行中增减执行容量，也不能重新唤醒提前退出的空闲通道。
      // Trigger: 用户授权自动 CPU 并发。
      // Evidence: 原 workerCount 只在启动时读取，退出的循环不会在其他批次退还额度时恢复。
      // Replacement: 上方动态派发循环，复用 claim、lane 和分片租约。
      // Risk: 暂停、验证等待和计数守恒须回归验证。
      // Human Review: Required
      // Original code:
      //       const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, (_, workerIndex) => (async () => {
      //         // AI-REMOVED 2026-10-02:
      //         // Reason: 固定分片循环会阻止空闲 Worker 领取其他尺寸批次。
      //         // Trigger: 用户要求多 Worker 在长宽比例广度上协同搜索。
      //         // Evidence: 原循环把单个 Worker 固定到 owned 的模数子集。
      //         // Replacement: claim 按全局剩余提案与空闲虚拟分片动态领取；Risk: 调度顺序改变；Human Review: Required。
      //         // Original code:
      //         // for (let offset = workerIndex; offset < owned.length; offset += workerCount) {
      //         //   await lane(parallel.shards[owned[offset]!]!, quotas[offset]!, laneWorker);
      //         // }
      //         while (true) {
      //           const job = claim();
      //           if (job === null) break;
      //           try {
      //             const used = await lane(job.shard, job.quota, workerFor(workerIndex));
      //             // 2026-10-02：await 期间其他 Worker 会领取额度；必须在 await 返回后读取最新 available。
      //             available += job.quota - used;
      //           }
      //           finally { leased.delete(job.shard.index); }
      //         }
      //       })().catch(error => { if (interruption === null) interruption = error; task.abort.abort(); throw error; })));
      //       void outcomes;
      if (interruption !== null && !(interruption instanceof DOMException && interruption.name === "AbortError")) throw interruption;
      publish(task, { status: idleStatus(), message: task.abort.signal.aborted ? "计算已暂停，可以继续。"
        : point.best ? "本轮计算完成，可以预览、保存蓝图或继续计算。" : `本轮计算结束；${lastFailure}。可以继续计算。` });
    } catch (error) {
      publish(task, { status: error instanceof PlanningBudgetExhausted || error instanceof DOMException && error.name === "AbortError"
        ? idleStatus() : "failed", message: error instanceof PlanningBudgetExhausted
        ? "计算中断，检查点已保留，可以继续计算。" : errorMessage(error) });
    } finally {
      stopMonitoring();
      if (active.size > 0 || pendingVerifications > 0) task.abort.abort();
      await Promise.allSettled(active.values());
      await settleVerifications();
      gpuWorker?.dispose();
      for (const [index, current] of workers) if (index > 0) { current.dispose(); workers.delete(index); }
      task.abort.signal.removeEventListener("abort", cancelSearch);
      await settle(task);
    }
  }

  // AI-REMOVED 2026-10-01:
  // Reason: 单 Worker 顺序状态机改由统一分片执行器承担，避免浏览器和无头端计数与验收规则分叉。
  // Trigger: 用户授权并发分片、协作计算和刷新检查点。
  // Evidence: 旧 run 每轮只 await 一个 worker.build，无法同时运行 X 个分片；中途快照包含不可恢复的实时计数。
  // Replacement: 本文件上方 run 与 prepareParallel。
  // Risk: 多分片调度和验收队列需要回归验证。
  // Human Review: Required
  //
  // Original code:
  //   async function run(task: PlannerTask): Promise<void> {
  //     const point = task.file.checkpoint;
  //     const idleStatus = () => point.result !== null && point.savedBlueprintId === point.result.blueprint.blueprintId ? "completed" as const : "waiting" as const;
  //     let lastFailure = "尚未找到通过验证的布局";
  //     try {
  //       while (task.remaining > 0 || point.pendingCandidate !== null) {
  //         check(task);
  //         const allowance = task.remaining;
  //         let accounted = point.pendingCandidate !== null;
  //         let observed = 0;
  //         const account = (count: number) => {
  //           if (!Number.isSafeInteger(count) || count < observed || count > allowance) throw new Error("Worker 提案计数无效。");
  //           const delta = count - observed;
  //           point.evaluations += delta; task.remaining -= delta; observed = count;
  //           const round = point.evaluations - task.roundStartedEvaluations;
  //           publish(task, { evaluatedProposals: point.evaluations, roundEvaluatedProposals: round,
  //             estimatedProgress: Math.min(1, round / task.file.request.options.evaluationsPerRound) });
  //         };
  //         try {
  //           if (point.pendingCandidate === null) {
  //             const attempt = point.attempt++;
  //             const selection = task.portfolio.next(attempt);
  //             publish(task, { candidateCount: point.attempt, message: `正在搜索第 ${point.attempt} 个布局` });
  //             point.pendingCandidate = await worker.build(selection.request, selection.variant,
  //               null, allowance, task.abort.signal,
  //               (phase, message, evaluations) => { account(evaluations); publish(task, { phase, message }); },
  //               selection.seed, selection.continuationStep, selection.maximumArea);
  //             const used = point.pendingCandidate.search.evaluations;
  //             account(used);
  //             accounted = true;
  //             persist(task);
  //           }
  //           check(task);
  //           const candidate = point.pendingCandidate;
  //           const simulation = workspace.simulation;
  //           if (simulation === null) throw new Error("仿真服务不可用。");
  //           publish(task, { phase: "verification", message: "正在验证产量与循环运行" });
  //           const report = await simulation.actions.runBlueprint(candidate.execution, task.abort.signal);
  //           if (task.abort.signal.aborted) break;
  //           if (report.status === "timeout") { lastFailure = "产量验证超时，检查点已保留"; break; }
  //           point.pendingCandidate = null;
  //           if (!meetsProductionTargets(task.file.request, report) || !meetsOperatingLimits(candidate.supplyAudit, report)) {
  //             lastFailure = report.diagnostics.find(entry => entry.severity === "error")?.message ?? "布局实际产量未达到目标";
  //             persist(task);
  //             continue;
  //           }
  //           task.portfolio.remember(candidate.seed);
  //           publish(task, { validatedCandidateCount: task.file.progress.validatedCandidateCount + 1, phase: "optimization" });
  //           // AI-REMOVED 2026-09-30:
  //           // Reason: 同面积优先减少输出箱，不能直接跳到物流成本。Trigger: 多线合箱需求。
  //           // Evidence: 原选优不区分箱数。Replacement: comparePlannerRanks。
  //           // Risk: 同面积结果可能改变。Human Review: Required。
  //           // Original code:
  //           // if (point.best === null || candidate.metrics.area < point.best.candidate.metrics.area
  //           //   || (candidate.metrics.area === point.best.candidate.metrics.area
  //           //     && (candidate.search.quality?.secondary ?? candidate.metrics.score)
  //           //       < (point.best.candidate.search.quality?.secondary ?? point.best.candidate.metrics.score))) {
  //           if (point.best === null || comparePlannerRanks({ area: candidate.metrics.area,
  //             outputStashCount: candidate.search.quality?.outputStashCount, secondary: candidate.search.quality?.secondary ?? candidate.metrics.score },
  //           { area: point.best.candidate.metrics.area, outputStashCount: point.best.candidate.search.quality?.outputStashCount,
  //             secondary: point.best.candidate.search.quality?.secondary ?? point.best.candidate.metrics.score }) < 0) {
  //             point.best = { candidate, report };
  //             point.result = { taskId: task.file.taskId, blueprint: candidate.execution.blueprint, folderId: null,
  //               metrics: candidate.metrics, connections: candidate.connections,
  //               measuredOutputs: report.probes.filter(probe => task.file.request.plan.targets.some(target => target.itemId === probe.id))
  //                 .map(probe => ({ itemId: probe.id, perMinute: probe.perMinute })),
  //               warmupSeconds: candidate.execution.warmupSeconds, observationSeconds: report.observationSeconds, elapsedMs: elapsed(task) };
  //             publish(task, { bestArea: candidate.metrics.area });
  //           }
  //           persist(task);
  //         } catch (error) {
  //           if (!accounted) {
  //             const used = error instanceof PlannerCandidateError ? error.search?.evaluations ?? observed : observed;
  //             account(used);
  //             if (used === 0 && error instanceof PlannerCandidateError) throw new Error(`当前布局无法启动搜索：${error.message}`);
  //           }
  //           if (!(error instanceof PlannerCandidateError)) throw error;
  //           lastFailure = error.message;
  //           persist(task);
  //         }
  //         await new Promise<void>(resolve => setTimeout(resolve, 0));
  //       }
  //       publish(task, { status: idleStatus(), message: task.abort.signal.aborted ? "计算已暂停，可以继续。"
  //         : point.best ? "本轮计算完成，可以预览、保存蓝图或继续计算。" : `本轮计算结束；${lastFailure}。可以继续计算。` });
  //     } catch (error) {
  //       publish(task, { status: task.abort.signal.aborted || error instanceof PlanningBudgetExhausted ? idleStatus() : "failed",
  //         message: task.abort.signal.aborted ? "计算已暂停，可以继续。" : error instanceof PlanningBudgetExhausted
  //           ? "计算中断，检查点已保留，可以继续计算。" : errorMessage(error) });
  //     } finally { settle(task); }
  //   }
  function launch(task: PlannerTask, evaluations: number, concurrency: number | "auto" = task.file.request.options.concurrency ?? 1,
    gpu = task.file.request.options.gpu ?? task.file.request.options.concurrency === "auto"): void {
    if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
    // AI-REMOVED 2026-09-30:
    // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
    // Trigger: 用户批准本轮接口与交互调整。
    // Evidence: 原实现使用时间截止或关闭任务面板。
    // Replacement: src/blueprint-planner/blueprint-planner-host.ts
    // Risk: Low。Human Review: Required
    // Original code:
    //     if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("计算时间必须大于零。");

    if (!Number.isSafeInteger(evaluations) || evaluations < 10_000 || evaluations % 10_000 !== 0) throw new Error("尝试次数必须为不少于一万的整万数。");
    if (workspace.simulation === null) throw new Error("仿真服务不可用。");
    if (typeof gpu !== "boolean") throw new Error("GPU 辅助计算选项必须为布尔值。");
    prepareParallel(task, concurrency);
    task.file = { ...task.file, request: { ...task.file.request, options: { ...task.file.request.options, evaluationsPerRound: evaluations, gpu } } };
    task.abort = new AbortController();
    task.roundStartedEvaluations = task.file.checkpoint.evaluations;
    task.remaining = Math.min(evaluations, options.roundLimit?.() ?? evaluations);
    if (!Number.isSafeInteger(task.remaining) || task.remaining <= 0) throw new Error("剩余尝试次数无效。");
    task.resumedAt = performance.now();
    workspace.simulation.actions.stop();
    latestId = task.file.taskId;
    runInAction(() => { state.activeTaskId = task.file.taskId; });
    publish(task, { status: "running", message: "正在计算", estimatedProgress: 0, activeWorkerCount: 0,
      evaluatedProposals: task.file.checkpoint.evaluations, roundEvaluatedProposals: 0 });
    persist(task);
    task.running = Promise.resolve().then(() => run(task));
  }

  async function save(task: PlannerTask): Promise<void> {
    if (state.activeTaskId !== null || task.running !== null || importing) throw new Error("请等待当前计算、保存或导入结束。");
    const result = task.file.checkpoint.result;
    if (result === null || result.blueprint.blueprintId === task.file.checkpoint.savedBlueprintId) throw new Error("当前没有可保存的新结果。");
    runInAction(() => { state.activeTaskId = task.file.taskId; });
    publish(task, { status: "saving", phase: "saving", message: "正在保存蓝图" });
    try {
      const { createBlueprintFolder, listBlueprintDirectory, saveBlueprintDocument } = await import("@/shared/storage/blueprint-storage");
      const directory = await listBlueprintDirectory();
      const folder = directory.folders.find(entry => entry.name === "自动规划") ?? await createBlueprintFolder({ name: "自动规划" });
      if (folder === null) throw new Error("无法创建自动规划文件夹。");
      const saved = await saveBlueprintDocument(result.blueprint, { parentFolderId: folder.folderId });
      if (saved === null) throw new Error("蓝图保存失败，请重试。");
      task.file.checkpoint.result = { ...result, folderId: folder.folderId };
      task.file.checkpoint.savedBlueprintId = result.blueprint.blueprintId;
      publish(task, { status: "completed", message: "蓝图已保存到用户蓝图/自动规划" });
    } catch (error) {
      publish(task, { status: "save-failed", message: errorMessage(error) });
      throw error;
    } finally { await settle(task); }
  }

  const recognitionRuntime = (file: ReturnType<typeof parseRecognitionTaskFile>): BlueprintRecognitionTask => ({
    file, abort: new AbortController(), resumedAt: null, running: null,
  });
  const inspectReport = async (input: import("@/domain/blueprint-planner").BlueprintPlannerBlueprintInput, signal?: AbortSignal) => {
    if (!workspace.simulation) throw new Error("仿真服务不可用。");
    input = excludeDisconnectedBlueprintPipes(workspace.registry, input).input;
    if (!input.blueprint.entityOrder.length) throw new Error("排除内部断连管道后没有可识别的设备。");
    return workspace.simulation.actions.runBlueprint({ blueprint: input.blueprint, activeActivityIds: input.activeActivityIds,
      engine: { kind: "dense-v2", ticksPerSecond: 2 },
      scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" }, probes: [],
      warmupSeconds: 0, observationSeconds: 0.5, inventorySampleCount: 2, maxWallTimeMs: 30_000, collectAnalysis: true },
      AbortSignal.any([restorationAbort.signal, ...signal ? [signal] : []]));
  };
  async function runRecognition(task: BlueprintRecognitionTask, inspectOnly: boolean, signal?: AbortSignal): Promise<void> {
    assertReady();
    if (state.activeTaskId !== null || importing || task.running !== null) throw new Error("已有任务正在计算、保存或导入。");
    task.abort = new AbortController();
    const combined = AbortSignal.any([restorationAbort.signal, task.abort.signal, ...signal ? [signal] : []]);
    const id = task.file.taskId;
    task.resumedAt = performance.now(); latestId = id;
    runInAction(() => { state.activeTaskId = id; });
    publish(task, { status: "running", message: "正在检查蓝图边界。" });
    persist(task);
    const operation = async () => {
      try {
        combined.throwIfAborted();
        let request = task.file.request;
        const initial = await inspectReport(request.input, combined);
        combined.throwIfAborted();
        if (!initial.analysis || initial.status !== "completed") throw new Error(initial.diagnostics[0]?.message ?? "无法解析蓝图。");
        const detected = inspectBlueprintBoundaries(workspace.registry, request.input.blueprint, initial.analysis, request.input.activeActivityIds);
        if (request.detectedBoundaries !== null && JSON.stringify(detected) !== JSON.stringify(request.detectedBoundaries)) {
          throw new Error("原图的边界或固定物品与任务不一致，请重新创建识别任务。");
        }
        if (request.detectedBoundaries === null) {
          const configured = new Map(request.input.boundaries.map(boundary => [blueprintBoundaryKey(boundary), boundary]));
          if ([...configured.keys()].some(key => !detected.some(boundary => blueprintBoundaryKey(boundary) === key))) throw new Error("任务包含原图中不存在的边界。");
          request = { ...request, detectedBoundaries: detected,
            input: { ...request.input, boundaries: detected.map(boundary => boundary.itemId !== null ? boundary
              : { ...boundary, itemId: configured.get(blueprintBoundaryKey(boundary))?.itemId ?? null }) } };
          task.file = { ...task.file, request, checkpoint: { step: "inputs" } };
          parseRecognitionTaskFile(snapshot(task), workspace.registry);
          persist(task); await writes; combined.throwIfAborted(); notify();
        }
        if (inspectOnly) {
          publish(task, { status: "waiting", message: "边界检查完成，可以确认输入并识别蓝图。" });
          return;
        }
        const unknownInputs = request.input.boundaries.filter(boundary => boundary.direction === "input" && !boundary.itemId);
        if (unknownInputs.length) throw new Error(`请补全输入物品：${unknownInputs.map(boundary => boundary.entityId).join("、")}。`);
        if (!request.input.boundaries.length) throw new Error("蓝图没有可识别的外部边界。");
        const outputsResolved = task.file.checkpoint.step === "verification";
        if (!outputsResolved) task.file.checkpoint.step = "outputs";
        publish(task, { message: outputsResolved ? "正在恢复产率验证。" : "正在自动识别出口物品。" }); persist(task); await writes; combined.throwIfAborted();
        let boundaries = outputsResolved ? [...request.input.boundaries] : inspectBlueprintBoundaries(workspace.registry, request.input.blueprint, initial.analysis,
          request.input.activeActivityIds, request.input.boundaries);
        // 静态传播不足时先观察真实生产；最终产率仍由完整持续收货场景验证。
        if (boundaries.some(boundary => boundary.direction === "output" && !boundary.itemId)) {
          const discoveryInput = { ...request.input, boundaries };
          const discovery = withBlueprintConverterStartup(workspace.registry, discoveryInput, request.options, initial.analysis,
            blueprintRecognitionScene(workspace.registry, discoveryInput, request.input.blueprint, 30, true));
          const observed = await workspace.simulation!.actions.runBlueprint(discovery, combined);
          combined.throwIfAborted();
          if (observed.status !== "completed" || !observed.analysis) throw new Error("出口发现未完成，请继续识别。");
          boundaries = inspectBlueprintBoundaries(workspace.registry, request.input.blueprint, observed.analysis,
            request.input.activeActivityIds, boundaries);
        }
        const unresolved = boundaries.filter(boundary => !boundary.itemId);
        if (unresolved.length) throw new Error(`无法确定出口物品：${unresolved.map(boundary => {
          const entity = request.input.blueprint.entities[boundary.entityId]!;
          return `${entity.id} (${entity.position.x}, ${entity.position.y})`;
        }).join("、")}。请检查上游配方、供料或混带。`);
        request = { ...request, input: { ...request.input, boundaries } };
        task.file = { ...task.file, request, checkpoint: { step: "verification" } };
        publish(task, { message: "正在验证持续净产率。" }); persist(task); await writes; combined.throwIfAborted();
        const execution = withBlueprintConverterStartup(workspace.registry, request.input, request.options, initial.analysis,
          blueprintRecognitionScene(workspace.registry, structuredClone(request.input)));
        const report = await workspace.simulation!.actions.runBlueprint(execution, combined);
        combined.throwIfAborted();
        const identified = identifyBlueprintNetwork(workspace.registry, request.input, request.options, execution, report);
        assertPlannerCandidateBounds(workspace.registry, identified.candidate);
        const file = createTaskFile(identified.request, id), baseline = { candidate: identified.candidate, report };
        const requiresTankConstruction = request.options.converterStartup === "tank" && Boolean(execution.scene.scheduledSlots?.length);
        const best = requiresTankConstruction ? null : structuredClone(baseline);
        // 保底结果也作为独立交付副本；保存到自动规划不能改写原蓝图库记录。
        // 订正 2026-10-09：借一次补料识别的携罐任务只有产率参考，先完成实体启动罐再进入最佳结果。
        if (best) best.candidate.execution.blueprint.blueprintId = createUuid();
        const planning = materialize({ ...file, checkpoint: { ...emptyPlannerCheckpoint(), blueprintBaseline: baseline, best,
          portfolio: new PlannerSearchPortfolio(identified.request, identified.candidate.seed).snapshot(),
          result: best ? { taskId: id, blueprint: best.candidate.execution.blueprint, folderId: null, metrics: identified.candidate.metrics, connections: [],
            measuredOutputs: identified.request.plan.targets, warmupSeconds: execution.warmupSeconds,
            observationSeconds: report.observationSeconds, elapsedMs: elapsed(task) } : null },
          progress: { ...file.progress, startedAt: task.file.progress.startedAt, elapsedMs: elapsed(task),
            message: withBlueprintDisconnectionWarning(workspace.registry, request.input, requiresTankConstruction
              ? "蓝图产率已识别，开始优化后将构建自启动供气。" : "蓝图识别完成，可以开始优化。"), bestArea: best ? identified.candidate.metrics.area : null,
            areaHistory: best ? [{ evaluatedProposals: 0, bestArea: identified.candidate.metrics.area }] : [] } });
        await writes; combined.throwIfAborted();
        pendingWrites.delete(task); recognitionTasks.delete(id); tasks.set(id, planning);
        persist(planning); await writes; notify();
      } catch (error) {
        publish(task, { status: combined.aborted ? "cancelled" : "failed", message: combined.aborted
          ? "识别已暂停，原图和已完成阶段已保留，可以继续识别。" : errorMessage(error) });
        throw error;
      } finally {
        if (recognitionTasks.has(id)) {
          publish(task, { estimatedProgress: null, activeWorkerCount: 0 });
          task.resumedAt = null; persist(task); await writes;
        }
        task.running = null;
        if (state.activeTaskId === id) runInAction(() => { state.activeTaskId = null; });
        notify();
      }
    };
    task.running = Promise.resolve().then(operation);
    return task.running;
  }

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: reportStorageFailure
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   let taskLoadError: unknown = null;
  const loadStoredTasks = () => storage === null ? Promise.resolve() : storage.load().then(async files => {
    if (disposed) return;
    for (const record of await storage.loadQuarantined?.() ?? []) {
      if (disposed) return;
      let file = record.sourceValue as BlueprintPlannerTaskFile;
      if (typeof record.sourceValue === "string") {
        try { file = JSON.parse(record.sourceValue) as BlueprintPlannerTaskFile; }
        catch { /* 非法 JSON 原文仍可导出，不能因展示失败阻止其他任务加载。 */ }
      }
      retainBlocked(file, record.message, record.taskId);
      latestId = record.taskId;
    }
    for (const file of files) {
      try {
        if (file.request && isBlueprintRecognitionRequest(file.request)) {
          const task = recognitionRuntime(parseRecognitionTaskFile(file, workspace.registry));
          if (task.file.progress.status === "running") task.file = { ...task.file,
            progress: { ...task.file.progress, status: "waiting",
              message: withBlueprintDisconnectionWarning(workspace.registry, task.file.request.input, "识别任务已恢复，可以继续识别。") } };
          recognitionTasks.set(file.taskId, task); latestId = file.taskId;
          if (JSON.stringify(task.file) !== JSON.stringify(file)) persist(task);
          continue;
        }
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: deferTask；用户操作时 restoreDeferred
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//         const task = hasDataMigrationController() ? materialize(parsePlannerTaskFile(file, workspace.registry)) : await restore(file);
//         if (["running", "saving"].includes(task.file.progress.status)) task.file = { ...task.file,
//           progress: { ...task.file.progress, status: "waiting", message: "计算已恢复，可以继续。", estimatedProgress: null } };
//         tasks.set(file.taskId, task);
//         latestId = file.taskId;
//         if (file.algorithmVersion !== task.file.algorithmVersion) persist(task);
        deferTask(file);
        latestId = file.taskId;
      // AI-REMOVED 2026-09-30:
      // Reason: 任务不兼容不是数据库故障。Trigger: 旧算法任务触发全局红条。
      // Evidence: eda-task-restore 日志。Replacement: retainBlocked。
      // Risk: Low。Human Review: Required
      // Original code:
      // } catch (error) { reportStorageFailure("eda-task-restore", error); }
      } catch (error) { if (disposed) return; retainBlocked(file, error); latestId = file.taskId; }
    }
  }).catch(error => { reportStorageFailure("eda-task-load", error); }).finally(() => { loaded = true; notify(); });
  const ready = loadStoredTasks();

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 下方 importTaskFile：读取 JSON、独立编号和持久化，恢复延后
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   const importTaskFile = async (file: BlueprintPlannerTaskFile, duringMigration = false): Promise<string> => {
//         if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
//         importing = true;
//         try {
//           await ready;
//           if (!duringMigration) assertReady();
//           const original = file;
//           let task: PlannerTask | BlueprintRecognitionTask;
//           try { file = migrateTaskBlueprintSchemas(original);
//             task = file?.request && isBlueprintRecognitionRequest(file.request)
//             ? recognitionRuntime(parseRecognitionTaskFile(file, workspace.registry)) : await restore(file); } catch (error) {
//             if (disposed) throw error;
//             if (!original || typeof original !== "object" || typeof original.taskId !== "string" || !original.taskId) throw error;
//             const id = createUuid();
//             const retained = { ...structuredClone(original), taskId: id };
//             // 独立导入的编号须同步内部引用，否则原文导出后仍会因编号不匹配而无法重试恢复。
//             if (retained.progress && typeof retained.progress === "object" && !Array.isArray(retained.progress)) {
//               retained.progress = { ...retained.progress, taskId: id };
//             }
//             const point = retained.checkpoint;
//             if (point && typeof point === "object" && "result" in point && point.result
//               && typeof point.result === "object" && !Array.isArray(point.result)) Object.assign(point.result, { taskId: id });
//             if (storage?.saveQuarantined) await storage.saveQuarantined({ taskId: id, sourceKey: id, sourceValue: retained,
//               message: errorMessage(error), migrationVersion: EDA_MIGRATION_VERSION });
//             else await storage?.save(retained);
//             retainBlocked(retained, error);
//             latestId = id;
//             notify();
//             return id;
//           }
//           // 导入始终创建独立任务，不能覆盖正在计算的同名任务或本机历史。
//           // AI-CORRECTION 2026-10-05：活动任务存在时禁止导入；导入提交前也禁止启动、续算和保存。
//           const id = createUuid();
//           if (!("portfolio" in task)) {
//             task.file = { ...task.file, taskId: id, progress: { ...task.file.progress, taskId: id, status: "waiting",
//               message: withBlueprintDisconnectionWarning(workspace.registry, task.file.request.input, "识别任务已导入，可以继续识别。"), estimatedProgress: null } };
//             await storage?.save(snapshot(task)); recognitionTasks.set(id, task); latestId = id; notify(); return id;
//           }
//           task.file = { ...task.file, taskId: id, progress: { ...task.file.progress, taskId: id, status: "waiting",
//             message: file.algorithmVersion === task.file.algorithmVersion ? "任务已导入，可以继续计算。" : task.file.progress.message, estimatedProgress: null } };
//           const result = task.file.checkpoint.result;
//           const blueprint = task.file.checkpoint.best?.candidate.execution.blueprint;
//           if (blueprint) {
//             const best = task.file.checkpoint.best!.candidate;
//             const previousTarget = candidateSearchTarget(best);
//             blueprint.blueprintId = createUuid();
//             const target = candidateSearchTarget(best);
//             // 导入创建独立身份，但对应当前最优的已完成搜索机会仍然有效。
//             for (const shard of task.file.checkpoint.parallel?.shards ?? []) {
//               if (shard.searchTarget === previousTarget) shard.searchTarget = target;
//             }
//           }
//           const pendingBlueprint = task.file.checkpoint.pendingCandidate?.execution.blueprint;
//           if (pendingBlueprint && pendingBlueprint !== blueprint) pendingBlueprint.blueprintId = createUuid();
//           if (result !== null) task.file.checkpoint.result = { ...result, taskId: id, folderId: null,
//             blueprint: { ...result.blueprint, blueprintId: blueprint!.blueprintId } };
//           task.file.checkpoint.savedBlueprintId = null;
//           await storage?.save(snapshot(task));
//           tasks.set(id, task);
//           latestId = id;
//           notify();
//           return id;
//         } finally { importing = false; }
//   };
//
//   const taskNeedsMigration = (file: BlueprintPlannerTaskFile): boolean => {
//     try {
//       return file.algorithmVersion !== (isBlueprintRecognitionRequest(file.request) ? BLUEPRINT_RECOGNITION_VERSION : PLANNER_ALGORITHM_VERSION)
//         || createStableJsonHash(file) !== createStableJsonHash(migrateTaskBlueprintSchemas(file));
//     } catch {
//       // 无法预检的输入交给 importTaskFile 保留原件；预检异常不能冻结已打开的仿真工作台。
//       return false;
//     }
//   };
  const importTaskFile = async (source: BlueprintPlannerTaskFile): Promise<string> => {
    await ready; assertReady();
    if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
    if (!source || source.formatVersion !== 1 || !source.taskId) throw new Error("任务文件格式无效。");
    importing = true;
    try {
      const id = createUuid();
      let file: BlueprintPlannerTaskFile = { ...structuredClone(source), taskId: id,
        progress: { ...source.progress, taskId: id, status: "waiting" as const, activeWorkerCount: 0 } };
      const point = file.checkpoint as PlannerCheckpoint;
      if (point?.result) point.result = { ...point.result, taskId: id, folderId: null };
      if (point && "savedBlueprintId" in point) point.savedBlueprintId = null;
      const best = point?.best?.candidate;
      if (best) {
        const previousTarget = candidateSearchTarget(best);
        best.execution.blueprint.blueprintId = createUuid();
        const target = candidateSearchTarget(best);
        for (const shard of point.parallel?.shards ?? []) if (shard.searchTarget === previousTarget) shard.searchTarget = target;
        if (point.result) point.result = { ...point.result, blueprint: { ...point.result.blueprint,
          blueprintId: best.execution.blueprint.blueprintId } };
      }
      if (point?.pendingCandidate) point.pendingCandidate.execution.blueprint.blueprintId = createUuid();
      let requiresMigration = false;
      try {
        requiresMigration = createStableJsonHash(file) !== createStableJsonHash(migrateTaskBlueprintSchemas(file));
      } catch (error) {
        if (storage?.saveQuarantined) await storage.saveQuarantined({ taskId: id, sourceKey: id, sourceValue: file,
          message: errorMessage(error), migrationVersion: EDA_MIGRATION_VERSION });
        else await storage?.save(file);
        retainBlocked(file, error); latestId = id; notify(); return id;
      }
      const saveInput = async () => { await storage?.save(file); };
      if (requiresMigration && hasDataMigrationController()) {
        await adoptIncomingDataAndReload([{ label: "计算任务", run: saveInput }]);
        return id;
      }
      if (requiresMigration) file = migrateTaskBlueprintSchemas(file);
      await saveInput();
      if (isBlueprintRecognitionRequest(file.request)) {
        recognitionTasks.set(id, recognitionRuntime(parseRecognitionTaskFile(file, workspace.registry)));
      } else deferTask(file, (file.checkpoint as PlannerCheckpoint)?.parallel?.originTaskId ?? source.taskId);
      latestId = id; notify();
      return id;
    } finally { importing = false; }
  };

  const host: BlueprintPlannerHost = {
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: whenSettled；不再装配迁移生命周期
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     async pauseForMigration() {
//       await ready;
//       if (taskLoadError !== null) throw taskLoadError;
//       const active = [...tasks.values(), ...recognitionTasks.values()];
//       for (const task of active) task.abort.abort();
//       await Promise.all(active.map(task => task.running?.catch(error => {
//         if (!task.abort.signal.aborted) throw error;
//       })));
//       flushWrite?.();
//       await writes;
//       if (migrationWriteErrors.size > 0) throw migrationWriteErrors.values().next().value;
//     },
//     async reloadAfterMigration() {
//       tasks.clear(); recognitionTasks.clear(); blockedTasks.clear();
//       loaded = false;
//       await loadStoredTasks();
//       if (taskLoadError !== null) throw taskLoadError;
//       flushWrite?.();
//       await writes;
//       if (migrationWriteErrors.size > 0) throw migrationWriteErrors.values().next().value;
//     },
    async whenSettled() {
      await ready;
      await deferredOperation;
      await Promise.all([...tasks.values(), ...recognitionTasks.values()].map(task => task.running));
      flushWrite?.();
      await writes;
    },
    state,
    actions: {
// AI-REMOVED 2026-10-07:
// Reason: 识别在现有任务内执行，并自动推断出口、保留暂停或失败状态。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/blueprint-planner/blueprint-planner-host.ts runRecognition
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//       async inspectBlueprint(blueprint, activeActivityIds, signal) {
//         await ready; assertReady();
//         if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
//         signal?.throwIfAborted();
//         try {
//           if (!workspace.simulation) throw new Error("仿真服务不可用。");
//           const report = await workspace.simulation.actions.runBlueprint({ blueprint, activeActivityIds,
//             engine: { kind: "dense-v2", ticksPerSecond: 2 },
//             scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" }, probes: [],
//             warmupSeconds: 0, observationSeconds: 0.5, inventorySampleCount: 2, maxWallTimeMs: 30_000, collectAnalysis: true },
//           AbortSignal.any([restorationAbort.signal, ...signal ? [signal] : []]));
//           if (!report.analysis) throw new Error(report.diagnostics[0]?.message ?? "无法解析蓝图。");
//           return inspectBlueprintBoundaries(workspace.registry, blueprint, report.analysis, activeActivityIds);
//         } finally { signal?.throwIfAborted(); }
//       },
//       async identifyBlueprint(input, inputOptions, signal) {
//         input = structuredClone(input); inputOptions = structuredClone(inputOptions);
//         const boundaries = await host.actions.inspectBlueprint(input.blueprint, input.activeActivityIds, signal);
//         if (boundaries.length !== input.boundaries.length || boundaries.some(boundary => {
//           const configured = input.boundaries.find(entry => blueprintBoundaryKey(entry) === blueprintBoundaryKey(boundary));
//           return !configured?.itemId || boundary.itemId !== null && boundary.itemId !== configured.itemId || configured.kind !== boundary.kind;
//         })) throw new Error("请补全所有边界物品，并保留蓝图中已有的物品配置。");
//         assertReady();
//         if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
//         importing = true;
//         try {
//           if (!workspace.simulation) throw new Error("仿真服务不可用。");
//           const execution = blueprintRecognitionScene(workspace.registry, structuredClone(input));
//           const report = await workspace.simulation.actions.runBlueprint(execution,
//             AbortSignal.any([restorationAbort.signal, ...signal ? [signal] : []]));
//           const identified = identifyBlueprintNetwork(workspace.registry, input, inputOptions, execution, report);
//           assertPlannerCandidateBounds(workspace.registry, identified.candidate);
//           const file = createTaskFile(identified.request), id = file.taskId;
//           const baseline = { candidate: identified.candidate, report };
//           const best = structuredClone(baseline);
//           // 保底结果也作为独立交付副本；保存到自动规划不能改写原蓝图库记录。
//           best.candidate.execution.blueprint.blueprintId = createUuid();
//           const task = materialize({ ...file, checkpoint: { ...emptyPlannerCheckpoint(), blueprintBaseline: baseline, best,
//             portfolio: new PlannerSearchPortfolio(identified.request, identified.candidate.seed).snapshot(),
//             result: { taskId: id, blueprint: best.candidate.execution.blueprint, folderId: null, metrics: identified.candidate.metrics, connections: [],
//               measuredOutputs: identified.request.plan.targets, warmupSeconds: execution.warmupSeconds,
//               observationSeconds: report.observationSeconds, elapsedMs: report.elapsedMs } },
//             progress: { ...file.progress, message: "蓝图识别完成，可以开始优化。", bestArea: identified.candidate.metrics.area,
//               areaHistory: [{ evaluatedProposals: 0, bestArea: identified.candidate.metrics.area }] } });
//           tasks.set(id, task); latestId = id; persist(task); await writes; notify();
//           return id;
//         } finally { importing = false; }
//       },
      async inspectBlueprint(blueprint, activeActivityIds, signal) {
        await ready; assertReady();
        if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
        const report = await inspectReport({ blueprint, boundaries: [], activeActivityIds }, signal);
        signal?.throwIfAborted();
        if (!report.analysis) throw new Error(report.diagnostics[0]?.message ?? "无法解析蓝图。");
        return inspectBlueprintBoundaries(workspace.registry, blueprint, report.analysis, activeActivityIds);
      },
      async createBlueprintTask(input, inputOptions) {
        await ready; assertReady();
        if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
        const id = createUuid(), task = recognitionRuntime(createRecognitionTaskFile(workspace.registry, id, input, inputOptions));
        recognitionTasks.set(id, task); latestId = id; persist(task); await writes; notify();
        // 后台边界检查的异常已进入任务进度；任务编号不依赖检查成功。
        void runRecognition(task, true).catch(() => {});
        return id;
      },
      async updateBlueprintBoundaries(id, boundaries) {
        assertReady();
        const task = recognitionTasks.get(id);
        if (!task) throw new Error("蓝图识别任务不存在。");
        if (state.activeTaskId !== null || importing || task.running) throw new Error("请先暂停当前任务并等待结束。");
        const request = task.file.request;
        if (!request.detectedBoundaries) throw new Error("请先完成边界检查。");
        validateRecognitionBoundaries(workspace.registry, request.input, boundaries);
        const fixed = new Map(request.detectedBoundaries.map(boundary => [blueprintBoundaryKey(boundary), boundary]));
        if (fixed.size !== boundaries.length || boundaries.some(boundary => {
          const original = fixed.get(blueprintBoundaryKey(boundary));
          return !original || original.kind !== boundary.kind || original.itemId !== null && original.itemId !== boundary.itemId;
        })) throw new Error("不能改变原图固定的边界或物品。");
        const inputs = boundaries.map(boundary => boundary.direction === "input" ? boundary
          : { ...boundary, itemId: fixed.get(blueprintBoundaryKey(boundary))!.itemId });
        task.file = { ...task.file, request: { ...request, input: { ...request.input, boundaries: structuredClone(inputs) } }, checkpoint: { step: "inputs" } };
        publish(task, { status: "waiting", message: "输入配置已保存，可以继续识别。" }); persist(task); await writes;
      },
      async identifyBlueprint(id, signal) {
        await ready; assertReady();
        const task = recognitionTasks.get(id);
        if (!task) throw new Error("蓝图识别任务不存在。");
        await runRecognition(task, false, signal);
      },
      start(request) {
        assertReady();
        if (request.blueprintSource) throw new Error("请先识别蓝图，再继续已建立基线的任务。");
        validateTaskRequest(workspace.registry, request);
        if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
        const id = createUuid();
        // AI-REMOVED 2026-10-04:
        // Reason: 启动与草稿导出共用任务文件封装，避免格式和初始计数分叉。
        // Trigger: 用户要求任务创建后无需成功启动即可下载。
        // Evidence: 原任务文件仅在 start 内构造；导入已支持空检查点。
        // Replacement: 本文件 createTaskFile。
        // Risk: Low。Human Review: Required
        // Original code:
        // const task = materialize({ formatVersion: 1, algorithmVersion: PLANNER_ALGORITHM_VERSION, taskId: id,
        //   request: structuredClone(request), checkpoint: emptyPlannerCheckpoint(), progress: { taskId: id, status: "waiting",
        //     phase: "preparing", startedAt: Date.now(), elapsedMs: 0, estimatedProgress: null, candidateCount: 0,
        //     evaluatedProposals: 0, roundEvaluatedProposals: 0,
        //     validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: null } });
        const task = materialize(parsePlannerTaskFile(createTaskFile(request, id), workspace.registry));
        tasks.set(id, task);
        launch(task, request.options.evaluationsPerRound);
        return id;
      },
      continuePlanning(id, evaluations, concurrency, gpu) {
        assertReady();
        if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
        if (deferredTasks.has(id)) {
          deferredOperation = restoreDeferred(id).then(task => launch(task, evaluations, concurrency, gpu)).catch(error => {
            const task = tasks.get(id);
            if (task) publish(task, { status: "failed", message: errorMessage(error) });
          }).finally(() => { deferredOperation = null; });
          return;
        }
        launch(requireTask(id), evaluations, concurrency, gpu);
      },
      cancel(id) {
        if (restoringTask?.id === id) { restoringTask.abort.abort(); return; }
        if (deferredTasks.has(id)) return;
        const task = recognitionTasks.get(id) ?? requireTask(id);
        if (task.file.progress.status === "running") task.abort.abort();
      },
      save: async id => save(await restoreDeferred(id)),
      retrySave: async id => save(await restoreDeferred(id)),
      async deleteTask(id) {
        assertReady();
        const task = blockedTasks.has(id) || deferredTasks.has(id) ? null : recognitionTasks.get(id) ?? requireTask(id);
        if (state.activeTaskId === id || task?.running != null) throw new Error("请先暂停任务并等待计算结束。");
        await writes;
        await storage?.delete(id);
        tasks.delete(id);
        recognitionTasks.delete(id);
        blockedTasks.delete(id);
        deferredTasks.delete(id);
        notify();
      },
// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: importTaskFile 与 migrateIncomingData
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// // AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: importTaskFile 延迟恢复
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//       async importTask(file) {
// //         if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
// //         importing = true;
// //         try {
// //           await ready;
// //           assertReady();
// //           let task: PlannerTask | BlueprintRecognitionTask;
// //           try { task = file?.request && isBlueprintRecognitionRequest(file.request)
// //             ? recognitionRuntime(parseRecognitionTaskFile(file, workspace.registry)) : await restore(file); } catch (error) {
// //             if (disposed) throw error;
// //             if (!file || typeof file !== "object" || typeof file.taskId !== "string" || !file.taskId) throw error;
// //             const id = createUuid();
// //             const retained = { ...structuredClone(file), taskId: id };
// //             // 独立导入的编号须同步内部引用，否则原文导出后仍会因编号不匹配而无法重试恢复。
// //             if (retained.progress && typeof retained.progress === "object" && !Array.isArray(retained.progress)) {
// //               retained.progress = { ...retained.progress, taskId: id };
// //             }
// //             const point = retained.checkpoint;
// //             if (point && typeof point === "object" && "result" in point && point.result
// //               && typeof point.result === "object" && !Array.isArray(point.result)) Object.assign(point.result, { taskId: id });
// //             await storage?.save(retained);
// //             retainBlocked(retained, error);
// //             latestId = id;
// //             notify();
// //             return id;
// //           }
// //           // 导入始终创建独立任务，不能覆盖正在计算的同名任务或本机历史。
// //           // AI-CORRECTION 2026-10-05：活动任务存在时禁止导入；导入提交前也禁止启动、续算和保存。
// //           const id = createUuid();
// //           if (!("portfolio" in task)) {
// //             task.file = { ...task.file, taskId: id, progress: { ...task.file.progress, taskId: id, status: "waiting",
// //               message: withBlueprintDisconnectionWarning(workspace.registry, task.file.request.input, "识别任务已导入，可以继续识别。"), estimatedProgress: null } };
// //             await storage?.save(snapshot(task)); recognitionTasks.set(id, task); latestId = id; notify(); return id;
// //           }
// //           task.file = { ...task.file, taskId: id, progress: { ...task.file.progress, taskId: id, status: "waiting",
// //             message: file.algorithmVersion === task.file.algorithmVersion ? "任务已导入，可以继续计算。" : task.file.progress.message, estimatedProgress: null } };
// //           const result = task.file.checkpoint.result;
// //           const blueprint = task.file.checkpoint.best?.candidate.execution.blueprint;
// //           if (blueprint) {
// //             const best = task.file.checkpoint.best!.candidate;
// //             const previousTarget = candidateSearchTarget(best);
// //             blueprint.blueprintId = createUuid();
// //             const target = candidateSearchTarget(best);
// //             // 导入创建独立身份，但对应当前最优的已完成搜索机会仍然有效。
// //             for (const shard of task.file.checkpoint.parallel?.shards ?? []) {
// //               if (shard.searchTarget === previousTarget) shard.searchTarget = target;
// //             }
// //           }
// //           const pendingBlueprint = task.file.checkpoint.pendingCandidate?.execution.blueprint;
// //           if (pendingBlueprint && pendingBlueprint !== blueprint) pendingBlueprint.blueprintId = createUuid();
// //           if (result !== null) task.file.checkpoint.result = { ...result, taskId: id, folderId: null,
// //             blueprint: { ...result.blueprint, blueprintId: blueprint!.blueprintId } };
// //           task.file.checkpoint.savedBlueprintId = null;
// //           await storage?.save(snapshot(task));
// //           tasks.set(id, task);
// //           latestId = id;
// //           notify();
// //           return id;
// //         } finally { importing = false; }
// //       },
//       async importTask(file) {
//         if (!hasDataMigrationController() || !taskNeedsMigration(file)) return await importTaskFile(file);
//         assertReady();
//         let id = "";
//         await migrateIncomingData([{ label: "计算任务", run: async () => { id = await importTaskFile(file, true); } }]);
//         return id;
//       },
      importTask: importTaskFile,
    },
    queries: {
      listTasks: () => [...[...tasks.values(), ...recognitionTasks.values()].map(task => ({ ...task.file.progress, elapsedMs: elapsed(task) })),
        ...[...blockedTasks.values(), ...deferredTasks.values()].map(task => ({ ...task.progress }))].sort((a, b) => b.startedAt - a.startedAt),
      getTask: (id = state.activeTaskId ?? latestId) => {
        const task = id === undefined ? undefined : tasks.get(id) ?? recognitionTasks.get(id);
        return task ? { ...task.file.progress, elapsedMs: elapsed(task) }
          : id !== undefined && (blockedTasks.has(id) || deferredTasks.has(id))
            ? { ...(blockedTasks.get(id) ?? deferredTasks.get(id))!.progress } : null;
      },
      getLastRequest: (id = state.activeTaskId ?? latestId) => {
        const task = id === undefined ? undefined : tasks.get(id) ?? recognitionTasks.get(id);
        return task ? structuredClone(task.file.request) : id !== undefined ? structuredClone(deferredTasks.get(id)?.file.request ?? null) : null;
      },
      getResult: id => structuredClone(tasks.get(id)?.file.checkpoint.result
        ?? (deferredTasks.get(id)?.file.checkpoint as PlannerCheckpoint | undefined)?.result ?? null),
      exportTask: id => {
        assertReady();
        return blockedTasks.has(id) || deferredTasks.has(id)
          ? structuredClone((blockedTasks.get(id) ?? deferredTasks.get(id))!.file) : snapshot(recognitionTasks.get(id) ?? requireTask(id));
      },
      exportDraft: request => {
        assertReady();
        return createTaskFile(request);
      },
    },
    dispose() {
      disposed = true;
      if (notificationTimer !== null) { clearTimeout(notificationTimer); notificationTimer = null; }
      restorationAbort.abort();
      for (const task of [...tasks.values(), ...recognitionTasks.values()]) { task.abort.abort(); persist(task); }
      for (const current of new Set([worker, ...workers.values()])) current.dispose();
      if (workspace.blueprintPlanner === host) workspace.blueprintPlanner = null;
    },
  };
  workspace.blueprintPlanner = host;
  return host;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

// AI-REMOVED 2026-09-30:
// Reason: 单一内存任务替换为跨浏览器与无头客户端共用的持久化多任务状态机。
// Trigger: 用户授权任务历史、导出续算和独立预览。
// Evidence: 原 Host 仅持有一个 task，getResult 仅保存后返回。
// Replacement: 本文件 createBlueprintPlannerHost 与 task-checkpoint.ts。
// Risk: 检查点仅兼容明确声明的算法版本；中断时未完成搜索可能重做。
// Human Review: Required
// Original code:
// import { observable, runInAction } from "mobx";
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// import type {
//   BlueprintPlannerContract, BlueprintPlannerProgress, BlueprintPlannerRequest, BlueprintPlannerResult,
// } from "@/domain/blueprint-planner";
// import { createUuid } from "@/domain/shared/uuid";
// import type { SimulationBlueprintRunReport } from "@/domain/simulation";
// import { createBlueprintFolder, listBlueprintDirectory, saveBlueprintDocument } from "@/shared/storage/blueprint-storage";
// import type { PlannerCandidate } from "./candidate";
// import { PlannerWorkerClient } from "./worker-client";
// import { PlannerCandidateError, PlanningBudgetExhausted } from "./model";
// import { meetsOperatingLimits, meetsProductionTargets } from "./verification";
// import { validatePlannerRequest } from "./production-network";
// import { PlannerSearchPortfolio } from "./search-portfolio";
//
// interface PlannerTask {
//   readonly id: string;
//   readonly request: BlueprintPlannerRequest;
//   readonly abort: AbortController;
//   readonly startedAt: number;
//   resumedAt: number | null;
//   spentMs: number;
//   progress: BlueprintPlannerProgress;
//   deadline: number;
//   budgetMs: number;
//   evaluationsPerRound: number;
//   attempt: number;
//   best: { candidate: PlannerCandidate; report: SimulationBlueprintRunReport } | null;
//   savedCandidate: PlannerCandidate | null;
//   result: BlueprintPlannerResult | null;
//   saving: Promise<void> | null;
//   pendingCandidate: PlannerCandidate | null;
//   readonly portfolio: PlannerSearchPortfolio;
// }
//
// // AI-REMOVED 2026-09-16:
// // Reason: 超时类型由 Worker 客户端与 Host 共用。
// // Trigger: 用户要求规划在 Worker 执行，并提供可重复的 Vitest 规划入口。
// // Evidence: 原 Host 直接调用 createPlannerCandidate；验证判定需要由生产与批量入口共用。
// // Replacement: ./model.ts
// // Risk: Low
// // Human Review: Required
// // Original code:
// // class PlanningBudgetExhausted extends Error {}
//
// export interface BlueprintPlannerHost extends BlueprintPlannerContract { dispose(): void; }
//
// export function createBlueprintPlannerHost(workspace: WorkspaceContract): BlueprintPlannerHost {
//   const state = observable<{ activeTaskId: string | null; revision: number }>({ activeTaskId: null, revision: 0 });
//   let task: PlannerTask | null = null;
//   let disposed = false;
//   const candidateWorker = new PlannerWorkerClient();
//   const elapsed = (current: PlannerTask) => current.spentMs + (current.resumedAt === null ? 0 : performance.now() - current.resumedAt);
//   const publish = (current: PlannerTask, patch: Partial<BlueprintPlannerProgress>) => {
//     if (patch.status !== undefined) {
//       const active = patch.status === "running" || patch.status === "saving";
//       if (!active && current.resumedAt !== null) { current.spentMs = elapsed(current); current.resumedAt = null; }
//       if (active && current.resumedAt === null) current.resumedAt = performance.now();
//     }
//     current.progress = { ...current.progress, ...patch, elapsedMs: elapsed(current) };
//     if (task === current) runInAction(() => { state.revision++; });
//   };
//   const finishActive = (current: PlannerTask) => {
//     if (task === current) runInAction(() => { state.activeTaskId = null; state.revision++; });
//   };
//   const checkBudget = (current: PlannerTask) => {
//     if (current.abort.signal.aborted || disposed) throw new DOMException("规划已取消", "AbortError");
//     if (performance.now() >= current.deadline) throw new PlanningBudgetExhausted();
//   };
//
//   async function save(current: PlannerTask): Promise<void> {
//     if (current.best === null || current.abort.signal.aborted) return;
//     publish(current, { status: "saving", phase: "saving", message: "正在保存蓝图", estimatedProgress: 0.99 });
//     try {
//       const directory = await listBlueprintDirectory();
//       const folder = directory.folders.find((entry) => entry.name === "自动规划") ?? await createBlueprintFolder({ name: "自动规划" });
//       if (folder === null) throw new Error("无法创建自动规划文件夹。");
//       const { candidate, report } = current.best;
//       const measuredOutputs = report.probes.filter(probe => current.request.plan.targets.some(target => target.itemId === probe.id))
//         .map((probe) => ({ itemId: probe.id, perMinute: probe.perMinute }));
//       const saved = await saveBlueprintDocument(candidate.execution.blueprint, { parentFolderId: folder.folderId });
//       if (saved === null) throw new Error("蓝图保存失败，请重试保存。");
//       current.result = {
//         taskId: current.id, blueprint: candidate.execution.blueprint, folderId: folder.folderId,
//         metrics: candidate.metrics, connections: candidate.connections, measuredOutputs,
//         warmupSeconds: candidate.execution.warmupSeconds, observationSeconds: report.observationSeconds,
//         elapsedMs: elapsed(current),
//       };
//       current.savedCandidate = candidate;
//       publish(current, { status: "completed", message: "规划完毕，蓝图已保存到用户蓝图/自动规划", estimatedProgress: 1 });
//     } catch (error) {
//       publish(current, { status: "save-failed", message: errorMessage(error), estimatedProgress: null });
//     } finally {
//       finishActive(current);
//     }
//   }
//
//   async function run(current: PlannerTask): Promise<void> {
//     let lastFailure = "尚未找到通过验证的布局";
//     try {
//       while (!current.abort.signal.aborted && !disposed) {
//         checkBudget(current);
//         const attempt = current.attempt++;
//         publish(current, { candidateCount: current.attempt, message: `正在搜索第 ${current.attempt} 个布局` });
//         try {
//           const search = current.portfolio.next(attempt);
//           const candidate = current.pendingCandidate ?? await candidateWorker.build(search.request, search.variant,
//             Math.max(1, current.deadline - performance.now()), current.evaluationsPerRound, current.abort.signal,
//             (phase, message) => publish(current, { phase, message, estimatedProgress: Math.min(0.95, 1 - Math.max(0, current.deadline - performance.now()) / current.budgetMs) }),
//             search.seed, search.continuationStep, search.maximumArea);
//           checkBudget(current);
//           const simulation = workspace.simulation;
//           if (simulation === null) throw new Error("仿真服务不可用。");
//           publish(current, { phase: "verification", message: "正在验证产量与循环运行" });
//           const report = await simulation.actions.runBlueprint({ ...candidate.execution, maxWallTimeMs: Math.max(1, current.deadline - performance.now()) }, current.abort.signal);
//           if (current.abort.signal.aborted) break;
//           if (!meetsProductionTargets(current.request, report) || !meetsOperatingLimits(candidate.supplyAudit, report)) {
//             current.pendingCandidate = report.status === "timeout" ? candidate : null;
//             lastFailure = report.diagnostics.find((entry) => entry.severity === "error")?.message
//               ?? (report.status === "timeout" ? "本轮验证达到时间预算" : "本轮布局的实际产量未达到目标");
//             continue;
//           }
//           current.pendingCandidate = null;
//           current.portfolio.remember(candidate.seed);
//           publish(current, { validatedCandidateCount: current.progress.validatedCandidateCount + 1, phase: "optimization", message: "已找到可用产线，正在比较更紧凑的布局" });
//           if (current.best === null || candidate.metrics.area < current.best.candidate.metrics.area
//             || (candidate.metrics.area === current.best.candidate.metrics.area
//               && (candidate.search.quality?.secondary ?? candidate.metrics.score)
//                 < (current.best.candidate.search.quality?.secondary ?? current.best.candidate.metrics.score))) {
//             current.best = { candidate, report };
//             publish(current, { bestArea: candidate.metrics.area });
//           }
//         } catch (error) {
//           if (!(error instanceof PlannerCandidateError) || current.abort.signal.aborted) throw error;
//           lastFailure = errorMessage(error);
//           publish(current, { message: lastFailure });
//         }
//         await new Promise<void>((resolve) => setTimeout(resolve, 0));
//       }
//     } catch (error) {
//       if (!(error instanceof PlanningBudgetExhausted) && !current.abort.signal.aborted) {
//         publish(current, { status: "failed", message: errorMessage(error), estimatedProgress: null });
//         finishActive(current);
//         return;
//       }
//     }
//     if (current.abort.signal.aborted || disposed) {
//       publish(current, { status: "cancelled", message: "规划已取消", estimatedProgress: null });
//       finishActive(current);
//     // AI-REMOVED 2026-09-22:
//     // Reason: 找到候选后自动保存会终止交互，用户无法在同一任务上手动追加无限轮计算。
//     // Trigger: 用户要求结果生成后手动保存，保存后按钮禁用，同时仍可继续规划下一轮。
//     // Evidence: 原分支直接调用 save(current)，save 成功后发布 completed；UI 只能显示“重新规划”。
//     // Replacement: 下方按“是否有未保存最佳候选”发布 waiting/completed，保存仅由 actions.save 触发。
//     // Risk: 结果现在必须由用户主动保存；关闭对话框不会自动落盘。
//     // Human Review: Required
//     //
//     // Original code:
//     // } else if (current.best !== null) {
//     //   current.saving = save(current);
//     //   await current.saving;
//     //   current.saving = null;
//     // } else {
//     //   publish(current, { status: "waiting", message: `本轮时间已用完；${lastFailure}。可以继续规划。`, estimatedProgress: null });
//     // }
//     } else if (current.best !== null && current.best.candidate !== current.savedCandidate) {
//       publish(current, { status: "waiting", message: "本轮规划完成；已找到新的最优结果，可以保存蓝图或继续规划。", estimatedProgress: null });
//       finishActive(current);
//     } else if (current.best !== null) {
//       publish(current, { status: "completed", message: "本轮规划完成；当前最优蓝图已保存，可以继续规划。", estimatedProgress: null });
//       finishActive(current);
//     } else {
//       publish(current, { status: "waiting", message: `本轮时间已用完；${lastFailure}。可以继续规划。`, estimatedProgress: null });
//       finishActive(current);
//     }
//   }
//
// AI-REMOVED 2026-10-08:
// Reason: 移动函数时误匹配归档文本而重复插入活动代码。
// Trigger: ESLint / TypeScript 语法错误。
// Evidence: 文件尾部归档中出现第二份 importTaskFile。
// Replacement: 上方唯一活动实现。
// Risk: Low
// Human Review: Required
// Original code:
// //   const importTaskFile = async (file: BlueprintPlannerTaskFile, duringMigration = false): Promise<string> => {
//         if (state.activeTaskId !== null || importing) throw new Error("已有任务正在计算、保存或导入。");
//         importing = true;
//         try {
//           await ready;
//           if (!duringMigration) assertReady();
//           file = migrateTaskBlueprintSchemas(file);
//           let task: PlannerTask | BlueprintRecognitionTask;
//           try { task = file?.request && isBlueprintRecognitionRequest(file.request)
//             ? recognitionRuntime(parseRecognitionTaskFile(file, workspace.registry)) : await restore(file); } catch (error) {
//             if (disposed) throw error;
//             if (!file || typeof file !== "object" || typeof file.taskId !== "string" || !file.taskId) throw error;
//             const id = createUuid();
//             const retained = { ...structuredClone(file), taskId: id };
//             // 独立导入的编号须同步内部引用，否则原文导出后仍会因编号不匹配而无法重试恢复。
//             if (retained.progress && typeof retained.progress === "object" && !Array.isArray(retained.progress)) {
//               retained.progress = { ...retained.progress, taskId: id };
//             }
//             const point = retained.checkpoint;
//             if (point && typeof point === "object" && "result" in point && point.result
//               && typeof point.result === "object" && !Array.isArray(point.result)) Object.assign(point.result, { taskId: id });
//             await storage?.save(retained);
//             retainBlocked(retained, error);
//             latestId = id;
//             notify();
//             return id;
//           }
//           // 导入始终创建独立任务，不能覆盖正在计算的同名任务或本机历史。
//           // AI-CORRECTION 2026-10-05：活动任务存在时禁止导入；导入提交前也禁止启动、续算和保存。
//           const id = createUuid();
//           if (!("portfolio" in task)) {
//             task.file = { ...task.file, taskId: id, progress: { ...task.file.progress, taskId: id, status: "waiting",
//               message: withBlueprintDisconnectionWarning(workspace.registry, task.file.request.input, "识别任务已导入，可以继续识别。"), estimatedProgress: null } };
//             await storage?.save(snapshot(task)); recognitionTasks.set(id, task); latestId = id; notify(); return id;
//           }
//           task.file = { ...task.file, taskId: id, progress: { ...task.file.progress, taskId: id, status: "waiting",
//             message: file.algorithmVersion === task.file.algorithmVersion ? "任务已导入，可以继续计算。" : task.file.progress.message, estimatedProgress: null } };
//           const result = task.file.checkpoint.result;
//           const blueprint = task.file.checkpoint.best?.candidate.execution.blueprint;
//           if (blueprint) {
//             const best = task.file.checkpoint.best!.candidate;
//             const previousTarget = candidateSearchTarget(best);
//             blueprint.blueprintId = createUuid();
//             const target = candidateSearchTarget(best);
//             // 导入创建独立身份，但对应当前最优的已完成搜索机会仍然有效。
//             for (const shard of task.file.checkpoint.parallel?.shards ?? []) {
//               if (shard.searchTarget === previousTarget) shard.searchTarget = target;
//             }
//           }
//           const pendingBlueprint = task.file.checkpoint.pendingCandidate?.execution.blueprint;
//           if (pendingBlueprint && pendingBlueprint !== blueprint) pendingBlueprint.blueprintId = createUuid();
//           if (result !== null) task.file.checkpoint.result = { ...result, taskId: id, folderId: null,
//             blueprint: { ...result.blueprint, blueprintId: blueprint!.blueprintId } };
//           task.file.checkpoint.savedBlueprintId = null;
//           await storage?.save(snapshot(task));
//           tasks.set(id, task);
//           latestId = id;
//           notify();
//           return id;
//         } finally { importing = false; }
//   };
//
//   const taskNeedsMigration = (file: BlueprintPlannerTaskFile): boolean =>
//     file.algorithmVersion !== (isBlueprintRecognitionRequest(file.request) ? BLUEPRINT_RECOGNITION_VERSION : PLANNER_ALGORITHM_VERSION)
//     || createStableJsonHash(file) !== createStableJsonHash(migrateTaskBlueprintSchemas(file));
//
//   const host: BlueprintPlannerHost = {
//   const host: BlueprintPlannerHost = {
//     state,
//     actions: {
//       start(request) {
//         if (disposed) throw new Error("规划器已关闭。");
//         if (state.activeTaskId !== null) throw new Error("已有规划任务，请先取消或等待完成。");
//         validatePlannerRequest(workspace.registry, request);
//         if (workspace.simulation === null) throw new Error("仿真服务不可用。");
//         const snapshot = structuredClone(request);
//         workspace.simulation.actions.stop();
//         const id = createUuid(), startedAt = Date.now();
//         const current: PlannerTask = {
//           id, request: snapshot, abort: new AbortController(), startedAt, resumedAt: performance.now(), spentMs: 0,
//           deadline: performance.now() + snapshot.options.budgetMs, budgetMs: snapshot.options.budgetMs,
//           evaluationsPerRound: snapshot.options.evaluationsPerRound,
//           attempt: 0, best: null, savedCandidate: null, result: null, saving: null, pendingCandidate: null,
//           portfolio: new PlannerSearchPortfolio(snapshot),
//           progress: { taskId: id, status: "running", phase: "preparing", startedAt, elapsedMs: 0, estimatedProgress: 0,
//             candidateCount: 0, validatedCandidateCount: 0, bestArea: null, message: null },
//         };
//         task = current;
//         runInAction(() => { state.activeTaskId = id; state.revision++; });
//         void run(current);
//         return id;
//       },
//       continuePlanning(taskId, additionalBudgetMs, evaluationsPerRound) {
//         if (task?.id !== taskId || !["waiting", "completed"].includes(task.progress.status)) throw new Error("任务当前不能继续。");
//         if (!Number.isFinite(additionalBudgetMs) || additionalBudgetMs <= 0) throw new Error("追加时间必须大于零。");
//         if (!Number.isSafeInteger(evaluationsPerRound) || evaluationsPerRound < 1_000
//           || evaluationsPerRound % 1_000 !== 0) throw new Error("每轮计算次数必须是大于零的 1000 整数倍。");
//         const current = task;
//         current.budgetMs = additionalBudgetMs;
//         current.evaluationsPerRound = evaluationsPerRound;
//         current.deadline = performance.now() + current.budgetMs;
//         runInAction(() => { state.activeTaskId = current.id; state.revision++; });
//         publish(current, { status: "running", message: "继续搜索布局", estimatedProgress: 0 });
//         void run(current);
//       },
//       async save(taskId) {
//         if (task?.id !== taskId || task.progress.status !== "waiting" || task.best === null
//           || task.best.candidate === task.savedCandidate) throw new Error("当前没有可保存的新结果。");
//         const current = task;
//         runInAction(() => { state.activeTaskId = current.id; state.revision++; });
//         current.saving ??= save(current);
//         try { await current.saving; } finally { current.saving = null; }
//       },
//       cancel(taskId) {
//         if (task?.id !== taskId || !["running", "waiting"].includes(task.progress.status)) return;
//         task.abort.abort();
//         publish(task, { status: "cancelled", message: "规划已取消", estimatedProgress: null });
//         finishActive(task);
//       },
//       async retrySave(taskId) {
//         if (task?.id !== taskId || task.progress.status !== "save-failed") throw new Error("任务当前不能重试保存。");
//         const current = task;
//         runInAction(() => { state.activeTaskId = current.id; state.revision++; });
//         current.saving ??= save(current);
//         try { await current.saving; } finally { current.saving = null; }
//       },
//     },
//     queries: {
//       getTask: () => task === null ? null : { ...task.progress, elapsedMs: elapsed(task) },
//       getLastRequest: () => task === null ? null : structuredClone(task.request),
//       getResult: (taskId) => task?.id === taskId && task.result !== null ? structuredClone(task.result) : null,
//     },
//     dispose() {
//       disposed = true;
//       candidateWorker.dispose();
//       task?.abort.abort();
//       if (workspace.blueprintPlanner === host) workspace.blueprintPlanner = null;
//     },
//   };
//   workspace.blueprintPlanner = host;
//   return host;
// }
//
// // AI-REMOVED 2026-09-16:
// // Reason: 生产任务与批量测试必须使用同一可用性门槛。
// // Trigger: 用户要求规划在 Worker 执行，并提供可重复的 Vitest 规划入口。
// // Evidence: 原 Host 直接调用 createPlannerCandidate；验证判定需要由生产与批量入口共用。
// // Replacement: ./verification.ts
// // Risk: Low
// // Human Review: Required
// // Original code:
// // function meetsProductionTargets(request: BlueprintPlannerRequest, report: SimulationBlueprintRunReport): boolean {
// //   if (report.status !== "completed" || report.observationSeconds <= 0
// //     || report.diagnostics.some((entry) => entry.severity === "error")
// //     || report.deviceStatuses.some((entry) => entry.status === "not-in-power-net" || entry.status === "no-power")) return false;
// //   return request.plan.targets.every((target) => (report.probes.find((probe) => probe.id === target.itemId)?.perMinute ?? 0) + 1e-6 >= target.perMinute * 0.98);
// // }
//
// function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
