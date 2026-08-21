import { createLogger } from "@/shared/logging/logger";
import { type SyncConnectionSettings } from "../storage";
import type {
  SyncConflictDecision,
  SyncInitialSyncStage,
  SyncRunReason,
  SyncTaskDirection,
  SyncTaskKind,
  SyncTaskStatus,
} from "@/domain/sync";
import type {
  SyncRemote,
  SyncRemoteSession,
} from "../clients";
import {
  isRemoteSyncStaleError,
  RemoteWriteConflictError,
  type RemoteAssetPutParams,
  type RemoteAssetTombstoneParams,
  type RemoteWriteBatchResult,
} from "../clients";
import type {
  SyncAdapter,
  SyncAdapterConflict,
  SyncAdapterConflictDecision,
  SyncAdapterResult,
  SyncAdapterScope,
  SyncAdapterStatus,
  SyncAdapterSyncOptions,
} from "./sync-adapters";
import {
  SyncDownloadDirtyAbortError,
  type SyncEngineTransaction,
  type SyncPlanItem,
  type SyncPlanUpload,
} from "./sync-adapters";

const logger = createLogger("sync-service");

export type SyncServicePhase = "idle" | "uploading" | "downloading" | "error";
export type SyncServiceSaveState = "idle" | "pending" | "saving" | "error";
export { type SyncRunReason };

export interface SyncAdapterRequest {
  readonly adapterId: string;
  readonly scope?: SyncAdapterScope;
}

export interface SyncInitialBatch {
  readonly stage: Exclude<SyncInitialSyncStage, "ready">;
  readonly requests: readonly SyncAdapterRequest[];
}

export interface SyncInitialPlan {
  readonly batches: readonly SyncInitialBatch[];
  readonly backgroundRequests?: readonly SyncAdapterRequest[];
}

export interface SyncLocalChange {
  readonly adapterId: string;
  readonly assetId?: string;
}

export interface SyncRequestActivity {
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
}

export interface SyncClientRequestOptions {
  readonly requestTimeoutMs?: number;
}

export interface SyncMaintenanceTask {
  readonly kind: SyncTaskKind;
  readonly run: (
    session: SyncRemoteSession,
    settings: SyncConnectionSettings,
  ) => Promise<void> | void;
}

export interface SyncServiceStatus {
  readonly phase: SyncServicePhase;
  readonly saveState: SyncServiceSaveState;
  readonly initialSyncStage: SyncInitialSyncStage;
  readonly hasCompletedInitialFeatureSync: boolean;
  readonly currentRunReason: SyncRunReason | null;
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
  readonly tasks: readonly SyncTaskStatus[];
  readonly pendingLocalChangeCount: number;
  readonly saveError: string | null;
  readonly lastUploadAt: string | null;
  readonly lastDownloadAt: string | null;
  readonly lastError: string | null;
  readonly lastSmallCheckAt: string | null;
  /** 下载不容忍中止后锁定画布，阻断继续编辑直到本轮同步结束。 */
  readonly canvasLocked: boolean;
  // AI-REMOVED 2026-08-10:
  // Reason: 大检查功能已删除。
  // Trigger: 用户确认大检查无额外价值。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // readonly lastBigCheckAt: string | null;
  readonly lastResults: readonly SyncAdapterResult[];
}

/**
 * 脏标代际第一代快照：脏标集合 + 通知版本（区分“同一集合的二代脏标”）。
 */
interface FrozenDirtyEntry {
  readonly assetIds: Set<string> | null;
  readonly version: number;
}

/**
 * 引擎侧事务扩展：SyncEngineTransaction 的创建者闭包内可访问的完整状态。
 * 引擎在单轮 pass 内收集条目、上传登记、touch 暂存与二段删除。
 */
interface EngineTransaction extends SyncEngineTransaction {
  readonly items: readonly SyncPlanItem[];
  readonly uploads: readonly SyncPlanUpload[];
  readonly stagedTouches: ReadonlyMap<string, string | null>;
  readonly stagedDeletions: ReadonlyMap<string, {
    readonly adapterId: string;
    readonly assetId: string;
    readonly apply: () => Promise<void>;
  }>;
}

export interface SyncServiceOptions {
  readonly readSettings: () => SyncConnectionSettings;
  readonly validateSettings?: (settings: SyncConnectionSettings) => string | null;
  readonly createRemote: (
    settings: SyncConnectionSettings,
    onRequestActivityChange: (
      activity: SyncRequestActivity,
    ) => void,
    requestOptions: SyncClientRequestOptions,
  ) => SyncRemote;
  readonly adapters: readonly SyncAdapter[];
  readonly createInitialSyncPlan?: () => SyncInitialPlan;
  readonly maintenanceTasks?: readonly SyncMaintenanceTask[];
  readonly resolveAdapterTaskKind?: (adapterId: string) => SyncTaskKind;
  readonly canRunInterval?: () => boolean;
  readonly beforeSync?: (session: SyncRemoteSession, settings: SyncConnectionSettings) => Promise<void> | void;
  readonly afterSync?: (session: SyncRemoteSession, settings: SyncConnectionSettings, results: readonly SyncAdapterResult[]) => Promise<void> | void;
  readonly intervalMs?: number;
  // AI-REMOVED 2026-08-10:
  // Reason: 大检查功能已删除。
  // Trigger: 用户确认大检查无额外价值。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // readonly bigCheckIntervalMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly onStatusChange?: (status: SyncServiceStatus) => void;
  readonly onConflictDiscoveryStart?: () => void;
  readonly resolveConflicts?: (
    conflicts: readonly SyncAdapterConflict<unknown>[],
  ) => Promise<readonly SyncConflictDecision[]>;
  readonly onConflictWorkflowFinished?: () => void;
  // AI-REMOVED 2026-07-29:
  // Reason: 适配器结果只包含 asset id，无法支撑一次性范围探测与逐项决议。
  // Trigger: 用户要求检测到首个冲突后普查全部业务资源，只弹一个汇总窗口。
  // Evidence: onConflict 在同步已经结束后触发，且每个适配器内部此前已逐个等待弹窗。
  // Replacement: onConflictDiscoveryStart / resolveConflicts / onConflictWorkflowFinished。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // readonly onConflict?: (results: readonly SyncAdapterResult[]) => void;
}

export interface SyncService {
  start(): void;
  stop(): void;
  syncNow(trigger: SyncRunReason): Promise<SyncServiceStatus>;
  /** 存在等待中的本地变更且尚未开始上传（5s 空闲去抖期内）时，立即触发上传。 */
  flushPendingChanges(): void;
  notifyLocalChange(change: SyncLocalChange): void;
  notifyConflictDetected(conflict: SyncAdapterConflict<unknown>): void;
  getStatus(): SyncServiceStatus;
}

const DEFAULT_INTERVAL_MS = 60_000;
// AI-REMOVED 2026-08-10:
// Reason: 大检查功能已删除。
// Trigger: 用户确认大检查无额外价值。
// Replacement: None。
// Risk: Low。
// Human Review: Required
//
// Original code:
// const DEFAULT_BIG_CHECK_INTERVAL_MS = 10 * 60_000;
const LOCAL_CHANGE_IDLE_UPLOAD_MS = 5_000;
const LOCAL_CHANGE_MAX_UPLOAD_MS = 30_000;
const INITIAL_SYNC_REQUEST_TIMEOUT_MS = 8_000;
// AI-CORRECTION 2026-08-13: 下载/写 409 与下载不容忍的整轮重启次数上限，避免异常场景死循环。
const MAX_STALE_RESTARTS = 5;
// AI-REMOVED 2026-07-29:
// Reason: 对整个同步事务做六轮退避重试会把一次 30 秒请求超时放大为数分钟，并重复已经成功的写入步骤。
// Trigger: 用户要求首次网络失败后立即解除画布锁定并显示错误状态。
// Evidence: retrySync 包裹 beforeSync、全部 adapter 和 maintenance，而不是单个幂等 GET。
// Replacement: 默认不做事务级重试；一分钟轮询、切回前台和用户手动重试提供新的独立同步机会。
// Risk: Low；短暂网络抖动会更早显示错误，但不会阻塞用户或重复部分提交。
// Human Review: Required
//
// Original code:
// const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [];
const SYNC_TASK_KINDS: readonly SyncTaskKind[] = [
  "canvas",
  "blueprints",
  "modules",
  "toolbox",
  "background-documents",
  "directory-maintenance",
  "interval-check",
];
// AI-REMOVED 2026-08-10:
// Reason: 大检查任务类型已删除。
// Trigger: 用户确认大检查无额外价值。
// Replacement: 仅保留 interval-check。
// Risk: Low。
// Human Review: Required
//
// Original code:
//   "big-check",
// AI-REMOVED 2026-07-29:
// Reason: 设备心跳和设备列表已退出同步任务。
// Trigger: 用户确认设备列表没有意义，仅展示 revision 的远端上传时间。
// Evidence: 设备枚举不能提供可靠 revision 归因，且真实服务器读取约 17.9 秒。
// Replacement: 业务资源冲突元数据 committedAt。
// Risk: Low。
// Human Review: Required
//
// Original code:
// "device-registration",
// "remote-devices",

export function createSyncService(options: SyncServiceOptions): SyncService {
  let status: SyncServiceStatus = createIdleStatus([]);
  let started = false;
  let syncing = false;
  let intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  // AI-REMOVED 2026-08-10:
  // Reason: 大检查定时器已删除。
  // Trigger: 用户确认大检查无额外价值。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // let bigCheckIntervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  let smallCheckRunning = false;
  let idleTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let maxTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let activeRemote: SyncRemote | null = null;
  let pendingTrigger: SyncRunReason | null = null;
  let localChangeVersion = 0;
  let acknowledgedLocalChangeVersion = 0;
  const getSettingsError = (settings: SyncConnectionSettings): string | null =>
    options.validateSettings === undefined
      ? settings.url.trim() === "" ? "Sync URL is empty" : null
      : options.validateSettings(settings);
  let conflictOverlayVisible = false;
  let syncSuppressImmediate = false;
  const dirtyAssetIdsByAdapter = new Map<string, Set<string> | null>();
  // AI-CORRECTION 2026-08-13: 脏标代际——第一代快照（每轮 pass 开始时固化）
  // 携带每个 adapter 的脏标集合与通知版本；同步期间的新编辑会推进版本（第二代脏标），
  // 清理时集合相同但版本已推进的 adapter 保留脏标。
  const dirtyVersionsByAdapter = new Map<string, number>();
  let activeFrozenDirty = new Map<string, FrozenDirtyEntry>();
  let passRequestScopes = new Map<string, SyncAdapterScope | undefined>();

  const setStatus = (nextStatus: SyncServiceStatus): SyncServiceStatus => {
    status = nextStatus;
    options.onStatusChange?.(status);

    return status;
  };

  const clearLocalChangeTimers = (): void => {
    if (idleTimerId !== null) {
      globalThis.clearTimeout(idleTimerId);
      idleTimerId = null;
    }

    if (maxTimerId !== null) {
      globalThis.clearTimeout(maxTimerId);
      maxTimerId = null;
    }
  };

  const resetTasks = (): readonly SyncTaskStatus[] =>
    SYNC_TASK_KINDS.map((kind) => {
      // AI-CORRECTION 2026-08-10: big-check 已删除，仅保留 interval-check 的跳过逻辑。
      if (kind === "interval-check") {
        const existing = status.tasks.find((t) => t.kind === kind);
        if (existing !== undefined && existing.lastStartedAt !== null) {
          return existing;
        }
      }
      return createIdleTaskStatus(kind);
    });

  const updateTask = (
    kind: SyncTaskKind,
    patch: Partial<Omit<SyncTaskStatus, "kind">>,
  ): void => {
    setStatus({
      ...status,
      tasks: status.tasks.map((task) =>
        task.kind === kind ? { ...task, ...patch } : task
      ),
    });
  };

  const beginTask = (kind: SyncTaskKind, totalUnitCount: number, direction?: SyncTaskDirection): void => {
    updateTask(kind, {
      phase: "running",
      direction: direction ?? null,
      completedUnitCount: 0,
      totalUnitCount,
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: null,
      lastError: null,
    });
  };

  const queueTask = (kind: SyncTaskKind, totalUnitCount: number): void => {
    updateTask(kind, {
      phase: "queued",
      completedUnitCount: 0,
      totalUnitCount,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastError: null,
    });
  };

  const finishTask = (
    kind: SyncTaskKind,
    totalUnitCount: number,
    error: unknown = null,
    direction?: SyncTaskDirection,
  ): void => {
    updateTask(kind, {
      phase: error === null ? "success" : "error",
      direction: direction ?? null,
      completedUnitCount: error === null ? totalUnitCount : getTaskCompletedUnitCount(kind),
      totalUnitCount,
      lastFinishedAt: new Date().toISOString(),
      lastError: error === null
        ? null
        : error instanceof Error ? error.message : String(error),
    });
  };

  const getTaskCompletedUnitCount = (kind: SyncTaskKind): number =>
    status.tasks.find((task) => task.kind === kind)?.completedUnitCount ?? 0;

  const syncNow = async (trigger: SyncRunReason): Promise<SyncServiceStatus> => {
    logger.info(`sync triggered: ${trigger}`);
    const isInitialSync = trigger === "startup" || trigger === "foreground";

    // AI-REMOVED 2026-07-29:
    // Reason: 排队判定前切回 canvas 会让尚未开始的前台检查提前锁住画布。
    // Trigger: 同步进行中切后台再切回时，进度遮罩出现但没有对应网络请求。
    // Evidence: syncing 分支只排队，实际 queued trigger 要到当前 run 的 finally 后才执行。
    // Replacement: 设置校验通过且当前 run 真正开始前再切换 initialSyncStage。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (isInitialSync && status.initialSyncStage === "ready") {
    //   setStatus({
    //     ...status,
    //     initialSyncStage: "canvas",
    //   });
    // }

    if (syncing) {
      if (trigger === "interval") {
        logger.debug("periodic sync skipped — another sync is already in progress");
        return status;
      }

      if (
        trigger === "foreground"
        && (
          status.currentRunReason === "startup"
          || status.currentRunReason === "foreground"
        )
      ) {
        logger.debug("foreground sync coalesced — initial sync is already in progress");
        return status;
      }

      pendingTrigger = selectQueuedTrigger(pendingTrigger, trigger);
      logger.debug(`sync queued — already in progress (trigger=${trigger})`);
      return status;
    }

    const settings = options.readSettings();
    if (!settings.enabled) {
      logger.info("sync skipped — disabled");
      acknowledgedLocalChangeVersion = localChangeVersion;
      dirtyAssetIdsByAdapter.clear();
      dirtyVersionsByAdapter.clear();
      clearLocalChangeTimers();
      return setStatus(createIdleStatus(status.lastResults));
    }

    const settingsError = getSettingsError(settings);
    if (settingsError !== null) {
      const saveError = settingsError;
      logger.info(`sync skipped — invalid settings: ${settingsError}`);
      clearLocalChangeTimers();
      return setStatus({
        ...status,
        phase: "error",
        saveState: getPendingLocalChangeCount() > 0 ? "error" : "idle",
        pendingLocalChangeCount: getPendingLocalChangeCount(),
        saveError: getPendingLocalChangeCount() > 0 ? saveError : null,
        lastError: saveError,
      });
    }

    if (isInitialSync && status.initialSyncStage === "ready") {
      setStatus({
        ...status,
        initialSyncStage: "canvas",
      });
    }

    syncing = true;
    clearLocalChangeTimers();
    const syncLocalChangeVersion = localChangeVersion;
    const hasPendingLocalChanges = syncLocalChangeVersion > acknowledgedLocalChangeVersion;
    const activePhase: SyncServicePhase = hasPendingLocalChanges || trigger === "local-change"
      ? "uploading"
      : "downloading";
    setStatus({
      ...status,
      phase: activePhase,
      saveState: hasPendingLocalChanges
        ? status.saveState === "error" ? "error" : "saving"
        : status.saveState,
      currentRunReason: trigger,
      activeRequestCount: 0,
      queuedRequestCount: 0,
      tasks: resetTasks(),
      pendingLocalChangeCount: getPendingLocalChangeCount(),
      lastError: null,
    });
    logger.info(`sync phase: ${activePhase}`);

    try {
      // AI-CORRECTION 2026-08-13: 下载 409 / commit 写 409 / 下载不容忍 → 丢弃整轮
      // 并回到流程起点（重新 beginSession + 重新拉 plan）。脏标代际在每轮开始时重新固化
      // （第二代脏标在重跑中被升格为新一代快照）。重试次数封顶避免异常场景死循环。
      let staleRestarts = 0;
      let transientAttempt = 0;
      let results: SyncAdapterResult[] = [];
      while (true) {
        try {
          results = await runSyncPass(settings, trigger, isInitialSync);
          break;
        } catch (error) {
          if (
            error instanceof SyncDownloadDirtyAbortError
          ) {
            if (staleRestarts >= MAX_STALE_RESTARTS) {
              throw error;
            }
            staleRestarts += 1;
            logger.info(
              `sync restart — download aborted by concurrent edit ` +
              `(${error.adapterId}/${error.assetId}) (attempt=${staleRestarts})`,
            );
            setStatus({
              ...status,
              canvasLocked: true,
              phase: "downloading",
            });
            continue;
          }
          if (isRemoteSyncStaleError(error)) {
            if (staleRestarts >= MAX_STALE_RESTARTS) {
              throw error;
            }
            staleRestarts += 1;
            logger.info(
              `sync restart — remote stale (attempt=${staleRestarts}): ` +
              `${error instanceof Error ? error.message : String(error)}`,
            );
            if (error instanceof RemoteWriteConflictError) {
              // 释放远端空间锁并丢弃本地上传日志，保证重跑时 plan 可读且不会重放旧批次。
              await activeRemote?.abortTransaction?.();
            }
            continue;
          }
          const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
          const delayMs = retryDelays[transientAttempt];
          if (delayMs === undefined) {
            throw error;
          }
          transientAttempt += 1;
          await wait(delayMs);
        }
      }

      const timestamp = new Date().toISOString();
      const didUpload = results.some((result) => result.status === "uploaded");
      const didDownload = results.some((result) => result.status === "downloaded");
      const didConflict = results.some((result) => result.status === "conflict");
      logger.info(
        `sync done — upload=${didUpload} download=${didDownload} conflict=${didConflict}`,
      );

      if (didConflict) {
        const pendingLocalChangeCount = getPendingLocalChangeCount();
        return setStatus({
          phase: "error",
          saveState: pendingLocalChangeCount > 0 ? "error" : status.saveState,
          initialSyncStage: isInitialSync ? "ready" : status.initialSyncStage,
          hasCompletedInitialFeatureSync:
            status.hasCompletedInitialFeatureSync,
          currentRunReason: null,
          activeRequestCount: 0,
          queuedRequestCount: 0,
          tasks: status.tasks,
          pendingLocalChangeCount,
          saveError: pendingLocalChangeCount > 0 ? "Sync conflict" : status.saveError,
          lastUploadAt: status.lastUploadAt,
          lastDownloadAt: status.lastDownloadAt,
          lastError: "Sync conflict",
          lastSmallCheckAt: status.lastSmallCheckAt,
          canvasLocked: false,
          lastResults: results,
        });
      }

      acknowledgedLocalChangeVersion = Math.max(
        acknowledgedLocalChangeVersion,
        syncLocalChangeVersion,
      );
      clearStaleDirtyAssets();
      const pendingLocalChangeCount = getPendingLocalChangeCount();

      // AI-CORRECTION 2026-07-30: 无挂起改动时复位 syncSuppressImmediate，
      // 使得下次从 idle 编辑能再次立即上传。
      // AI-CORRECTION 2026-08-12: 同步中包含下载（含冲突 use-remote）时，
      // 写入本地会触发 notifyLocalChange → 立即 syncNow 会把刚下载的数据重新上传 →
      // 远端 revision 已变化 → 必然失败。因此在有下载时保持 syncSuppressImmediate=true，
      // 让后续通知走 5s idle timer（此时 hash 匹配，不会造成无意义上传）。
      // AI-CORRECTION 2026-08-12: 上述延迟规避已被变更来源 contract 取代；
      // remote-sync 落地不会进入 notifyLocalChange，因此正常复位立即上传门禁即可。
      // AI-REMOVED 2026-08-12:
      // Reason: didDownload 不再需要延迟释放本地编辑的立即上传能力。
      // Trigger: storage/snapshot 远端落地均以 remote-sync origin 在通知边界被过滤。
      // Evidence: 冲突 use-remote 不再增加 localChangeVersion 或 dirtyAssetIdsByAdapter。
      // Replacement: 下方仅依赖 pendingLocalChangeCount 的状态复位。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // if (pendingLocalChangeCount === 0 && !didDownload) {
      if (pendingLocalChangeCount === 0) {
        syncSuppressImmediate = false;
      }

      return setStatus({
        phase: "idle",
        saveState: pendingLocalChangeCount > 0 ? "pending" : "idle",
        initialSyncStage: status.initialSyncStage,
        hasCompletedInitialFeatureSync:
          status.hasCompletedInitialFeatureSync,
        currentRunReason: null,
        activeRequestCount: 0,
        queuedRequestCount: 0,
        tasks: status.tasks,
        pendingLocalChangeCount,
        saveError: null,
        lastUploadAt: didUpload || hasPendingLocalChanges ? timestamp : status.lastUploadAt,
        lastDownloadAt: didDownload ? timestamp : status.lastDownloadAt,
        lastError: null,
        lastSmallCheckAt: status.lastSmallCheckAt,
        canvasLocked: false,
        lastResults: results,
      });
    } catch (error) {
      if (conflictOverlayVisible) {
        options.onConflictWorkflowFinished?.();
        conflictOverlayVisible = false;
      }
      logger.debug(
        `sync failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      const pendingLocalChangeCount = getPendingLocalChangeCount();
      return setStatus({
        ...status,
        phase: "error",
        saveState: pendingLocalChangeCount > 0 ? "error" : status.saveState,
        initialSyncStage: isInitialSync ? "ready" : status.initialSyncStage,
        currentRunReason: null,
        activeRequestCount: 0,
        queuedRequestCount: 0,
        pendingLocalChangeCount,
        saveError: pendingLocalChangeCount > 0
          ? error instanceof Error ? error.message : String(error)
          : status.saveError,
        lastError: error instanceof Error ? error.message : String(error),
        canvasLocked: false,
      });
    } finally {
      syncing = false;
      if (trigger === "local-change" && localChangeVersion === syncLocalChangeVersion) {
        clearLocalChangeTimers();
      }

      const queuedTrigger = pendingTrigger;
      pendingTrigger = null;
      if (queuedTrigger !== null && started) {
        globalThis.queueMicrotask(() => {
          void syncNow(queuedTrigger);
        });
      }
    }
  };

  const runInitialSyncPlan = async (
    session: SyncRemoteSession,
    transaction: EngineTransaction,
  ): Promise<SyncAdapterResult[]> => {
    const plan: SyncInitialPlan = options.createInitialSyncPlan?.() ?? {
      batches: [{
        stage: "canvas",
        requests: options.adapters.map((adapter) => ({ adapterId: adapter.id })),
      }],
    };
    const results: SyncAdapterResult[] = [];

    for (const batch of plan.batches) {
      queueTask(
        batch.stage,
        getAdapterTaskTotalUnitCount(batch.stage, batch.requests.length),
      );
    }
    if (plan.backgroundRequests !== undefined) {
      queueTask("background-documents", plan.backgroundRequests.length);
    }
    for (const task of options.maintenanceTasks ?? []) {
      queueTask(task.kind, 1);
    }

    for (const batch of plan.batches) {
      setStatus({
        ...status,
        initialSyncStage: batch.stage,
      });
      logger.info(
        `initial sync stage: ${batch.stage} (${batch.requests.length} request(s))`,
      );
      const batchResults = await runAdapterRequests(
        session,
        transaction,
        batch.requests,
        batch.stage,
      );
      results.push(...batchResults);
      // AI-CORRECTION 2026-08-13: 冲突不再中断后续批次；
      // 全部资产分类与下载完成后统一弹框决议（sync-model.md“先下载、后上传”）。
    }

    setStatus({
      ...status,
      initialSyncStage: "ready",
    });
    logger.info("initial sync stage: ready");

    if (plan.backgroundRequests !== undefined) {
      results.push(...await runAdapterRequests(
        session,
        transaction,
        plan.backgroundRequests,
        "background-documents",
      ));
    }

    return results;
  };

  const runAdapterRequests = async (
    session: SyncRemoteSession,
    transaction: EngineTransaction,
    requests: readonly SyncAdapterRequest[],
    taskKind?: SyncTaskKind,
  ): Promise<SyncAdapterResult[]> => {
    logger.info(`sync starting — ${requests.length} adapter request(s)`);
    const adapterResults: SyncAdapterResult[] = [];
    const requestedAdapters = requests.flatMap((request) => {
      const adapter = options.adapters.find((candidate) =>
        candidate.id === request.adapterId,
      );

      return adapter === undefined ? [] : [adapter];
    });
    const totalUnitCount = taskKind === undefined
      ? 0
      : getAdapterTaskTotalUnitCount(taskKind, requests.length);
    const tracksProtocolProgress = taskKind === "canvas" && requests.length === 1;
    // 同一批次的任务方向一致（全上传或全下载），从全局 phase 推导
    const taskDirection: SyncTaskDirection | undefined =
      status.phase === "uploading" ? "upload"
      : status.phase === "downloading" ? "download"
      : undefined;
    if (taskKind !== undefined) {
      beginTask(taskKind, totalUnitCount, taskDirection);
    }
    try {
      await session.prefetchIndexes(requestedAdapters.map((adapter) => adapter.collection));
      for (const request of requests) {
        const adapter = options.adapters.find((candidate) =>
          candidate.id === request.adapterId,
        );
        if (adapter === undefined) {
          logger.debug(`adapter request skipped — unknown adapter "${request.adapterId}"`);
          if (taskKind !== undefined) {
            updateTask(taskKind, {
              completedUnitCount: tracksProtocolProgress
                ? totalUnitCount
                : getTaskCompletedUnitCount(taskKind) + 1,
            });
          }
          continue;
        }

        const beforeMs = Date.now();
        const requestScope = tracksProtocolProgress
          ? {
            ...request.scope,
            onProgress: (progress: number) => {
              request.scope?.onProgress?.(progress);
              updateTask("canvas", {
                completedUnitCount: Math.max(
                  getTaskCompletedUnitCount("canvas"),
                  Math.min(totalUnitCount, Math.max(0, progress)),
                ),
              });
            },
          }
          : request.scope;
        passRequestScopes.set(adapter.id, requestScope);
        const syncOptions: SyncAdapterSyncOptions = {
          scope: requestScope,
          transaction,
        };
        // AI-REMOVED 2026-08-13:
        // Reason: 单适配器“刷新索引后重试一次”的局部修复已被整轮重启取代。
        // Trigger: sync-model.md 要求下载 409 与 commit 写 409 一律丢弃本次完整操作，
        //   从流程起点重新拉 plan；局部刷新会造成部分已下载、部分未下载的中间态。
        // Evidence: 上传先于下载时刷新索引无法恢复同 run 后续下载的过期票据。
        // Replacement: syncNow 的 stale 重启循环（isRemoteSyncStaleError）。
        // Risk: Low。
        // Human Review: Required
        //
        // Original code:
        // let result: SyncAdapterResult;
        // try {
        //   result = await adapter.sync(session, requestScope);
        // } catch (error) {
        //   if (!(error instanceof RemoteWriteConflictError) || session.refreshIndexes === undefined) {
        //     throw error;
        //   }
        //   // AI-CORRECTION 2026-08-08: revision 竞争不是网络重试；先刷新权威索引，再让适配器重新做一次三方判断。
        //   logger.info(`adapter "${adapter.id}" remote revision changed → refreshing index once`);
        //   await session.refreshIndexes([adapter.collection]);
        //   result = await adapter.sync(session, requestScope);
        // }
        const result: SyncAdapterResult = await adapter.sync(session, syncOptions);
        const elapsed = Date.now() - beforeMs;
        logger.info(
          `adapter "${result.adapterId}" → ${result.status} ` +
          `(mode=${result.mode}, changed=${result.changedAssetIds.length}, ${elapsed}ms)`,
        );
        adapterResults.push(result);
        if (taskKind !== undefined) {
          updateTask(taskKind, {
            completedUnitCount: tracksProtocolProgress
              ? totalUnitCount
              : getTaskCompletedUnitCount(taskKind) + 1,
          });
        }
        // AI-CORRECTION 2026-08-13: 冲突不再中断批次，继续完成全部下载后再统一弹框。
      }
    } catch (error) {
      if (taskKind !== undefined) {
        finishTask(taskKind, totalUnitCount, error, taskDirection);
      }
      throw error;
    }
    if (taskKind !== undefined) {
      finishTask(taskKind, totalUnitCount, undefined, taskDirection);
    }

    return adapterResults;
  };

  const resolveRegularSyncRequests = (
    trigger: SyncRunReason,
  ): readonly SyncAdapterRequest[] => {
    if (trigger !== "local-change") {
      return options.adapters.map((adapter) => ({ adapterId: adapter.id }));
    }

    return Array.from(dirtyAssetIdsByAdapter, ([adapterId, assetIds]) => ({
      adapterId,
      scope: assetIds === null
        ? undefined
        : { includeAssetIds: Array.from(assetIds) },
    }));
  };

  const runRegularSyncRequests = async (
    session: SyncRemoteSession,
    transaction: EngineTransaction,
    requests: readonly SyncAdapterRequest[],
  ): Promise<SyncAdapterResult[]> => {
    const requestsByTask = new Map<SyncTaskKind, SyncAdapterRequest[]>();
    for (const request of requests) {
      const taskKind = options.resolveAdapterTaskKind?.(request.adapterId)
        ?? "canvas";
      const taskRequests = requestsByTask.get(taskKind) ?? [];
      taskRequests.push(request);
      requestsByTask.set(taskKind, taskRequests);
    }
    for (const [taskKind, taskRequests] of requestsByTask) {
      queueTask(
        taskKind,
        getAdapterTaskTotalUnitCount(taskKind, taskRequests.length),
      );
    }

    const results: SyncAdapterResult[] = [];
    for (const [taskKind, taskRequests] of requestsByTask) {
      const taskResults = await runAdapterRequests(
        session,
        transaction,
        taskRequests,
        taskKind,
      );
      results.push(...taskResults);
      // AI-CORRECTION 2026-08-13: 冲突不再中断任务链，全部完成后统一弹框。
    }

    return results;
  };

  // ============================================================================
  // 单轮同步 pass：先下载、后上传、单次 commit
  // ============================================================================

  const runSyncPass = async (
    passSettings: SyncConnectionSettings,
    passTrigger: SyncRunReason,
    passIsInitialSync: boolean,
  ): Promise<SyncAdapterResult[]> => {
    const remote = options.createRemote(
      passSettings,
      (activity) => {
        setStatus({
          ...status,
          activeRequestCount: activity.activeRequestCount,
          queuedRequestCount: activity.queuedRequestCount,
        });
      },
      {
        requestTimeoutMs: passIsInitialSync
          ? INITIAL_SYNC_REQUEST_TIMEOUT_MS
          : undefined,
      },
    );
    activeRemote = remote;
    const session = await remote.beginSession({
      reason: passTrigger,
      collections: options.adapters.map((adapter) => adapter.collection),
    });
    // 脏标代际：每轮 pass 开始时固化第一代快照；
    // 重跑时第二代脏标被升格为新一代快照的一部分。
    activeFrozenDirty = freezeDirtySnapshot();
    passRequestScopes = new Map();
    const transaction = createEngineTransaction(session, activeFrozenDirty);
    try {
      return await withSyncLock(async () => {
        await options.beforeSync?.(session, passSettings);
        const adapterResults = passIsInitialSync
          ? await runInitialSyncPlan(session, transaction)
          : await runRegularSyncRequests(
            session,
            transaction,
            resolveRegularSyncRequests(passTrigger),
          );
        const resolution = await resolvePlanItems(
          transaction,
          adapterResults,
        );
        if (resolution.hasUnresolvedConflict) {
          // 冲突未决：不执行上传 commit，本地同步状态一律不推进。
          await transaction.writeBatch.discard();
          return resolution.results;
        }

        // AI-CORRECTION 2026-08-10: big-check 已删除，目录维护仅在初始同步时执行。
        if (passIsInitialSync) {
          for (const task of options.maintenanceTasks ?? []) {
            queueTask(task.kind, 1);
          }
          await runMaintenanceTasks(session, passSettings);
        }

        const commitResult = await commitTransactionUploads(transaction);
        await finalizeTransaction(
          session,
          transaction,
          adapterResults,
          commitResult,
        );

        if (passIsInitialSync) {
          setStatus({
            ...status,
            initialSyncStage: "ready",
            hasCompletedInitialFeatureSync: true,
          });
        }
        await options.afterSync?.(session, passSettings, resolution.results);
        await session.complete?.();

        return resolution.results;
      });
    } finally {
      session.dispose?.();
      if (activeRemote === remote) {
        activeRemote = null;
      }
      remote.dispose?.();
    }
  };

  const freezeDirtySnapshot = (): Map<string, FrozenDirtyEntry> =>
    new Map(Array.from(dirtyAssetIdsByAdapter, ([adapterId, assetIds]) => [
      adapterId,
      {
        assetIds: assetIds === null ? null : new Set(assetIds),
        version: dirtyVersionsByAdapter.get(adapterId) ?? 0,
      },
    ]));

  const clearStaleDirtyAssets = (): void => {
    // 脏标清理：仅当实时脏标集合与版本都与第一代快照一致（同步期间无新编辑）时清除；
    // 第二代脏标保留，供下一轮同步重新参与判定。
    for (const [adapterId, assetIds] of dirtyAssetIdsByAdapter) {
      const frozen = activeFrozenDirty.get(adapterId);
      if (
        frozen !== undefined
        && (dirtyVersionsByAdapter.get(adapterId) ?? 0) === frozen.version
        && areDirtySetsEquivalent(assetIds, frozen.assetIds)
      ) {
        dirtyAssetIdsByAdapter.delete(adapterId);
        dirtyVersionsByAdapter.delete(adapterId);
      }
    }
  };

  const createEngineTransaction = (
    session: SyncRemoteSession,
    frozenDirty: Map<string, FrozenDirtyEntry>,
  ): EngineTransaction => {
    const items: SyncPlanItem[] = [];
    const uploads: SyncPlanUpload[] = [];
    const stagedTouches = new Map<string, string | null>();
    const stagedDeletions = new Map<string, {
      readonly adapterId: string;
      readonly assetId: string;
      readonly apply: () => Promise<void>;
    }>();
    const writeBatch = session.beginWriteBatch();

    return {
      writeBatch,
      items,
      uploads,
      stagedTouches,
      stagedDeletions,
      stageTouch: (assetKey, contentHash) => {
        stagedTouches.set(assetKey, contentHash);
      },
      stageDeletion: (adapterId, assetId, apply) => {
        stagedDeletions.set(createSyncItemKey(adapterId, assetId), {
          adapterId,
          assetId,
          apply,
        });
      },
      recordItem: (item) => {
        items.push(item);
      },
      recordUpload: (upload) => {
        uploads.push(upload);
      },
      assertDownloadAllowed: async (adapterId, assetId) => {
        // 下载不容忍：下载资产在分类时必然不在第一代脏标中；
        // 若实时脏标包含该资产，说明同步期间发生了第二代编辑 → 中止整轮。
        const frozen = frozenDirty.get(adapterId)?.assetIds;
        if (frozen === null) {
          // 该 adapter 整片脏：下载分类不可能产生，直接放行。
          return;
        }
        if (frozen !== undefined && frozen.has(assetId)) {
          return;
        }
        // AI-CORRECTION 2026-08-13: 未记录（undefined）≠ 整片脏（null）；
        // 只有实时脏标整片置位或明确包含该资产时才中止。
        const live = dirtyAssetIdsByAdapter.get(adapterId);
        if (live === null || (live !== undefined && live.has(assetId))) {
          throw new SyncDownloadDirtyAbortError(adapterId, assetId);
        }
      },
    };
  };

  const resolvePlanItems = async (
    transaction: EngineTransaction,
    adapterResults: readonly SyncAdapterResult[],
  ): Promise<{
    readonly results: SyncAdapterResult[];
    readonly hasUnresolvedConflict: boolean;
  }> => {
    const items = transaction.items;
    const uploads = items.filter((item) => item.kind === "upload");
    const downloads = items.filter((item) => item.kind === "download");
    const conflicts = items.filter((item) => item.kind === "conflict");
    // adapter 报告了冲突但没有可决议条目（异常兜底）：按未解决处理。
    const reportOnlyConflict = conflicts.length === 0
      && adapterResults.some((result) => result.status === "conflict");
    // 弹框条件：存在冲突资产，或上传与下载混合。纯上传、纯下载不弹框。
    const dialogNeeded = conflicts.length > 0
      || (uploads.length > 0 && downloads.length > 0);

    if (dialogNeeded) {
      if (!conflictOverlayVisible) {
        options.onConflictDiscoveryStart?.();
        conflictOverlayVisible = true;
      }
      try {
        const choices = await (
          options.resolveConflicts?.(items.map(toConflictShape))
          ?? Promise.resolve([])
        );
        const decisions = createItemDecisions(items, choices);
        await executeItemDecisions(items, decisions);
        const hasPause = decisions.some(
          (decision) => decision.resolution === "pause",
        );
        const results = computeResolvedResults(
          transaction,
          adapterResults,
          decisions,
          hasPause || reportOnlyConflict,
        );
        return {
          results,
          hasUnresolvedConflict: hasPause || reportOnlyConflict,
        };
      } finally {
        if (conflictOverlayVisible) {
          options.onConflictWorkflowFinished?.();
          conflictOverlayVisible = false;
        }
      }
    }

    if (reportOnlyConflict) {
      return {
        results: [...adapterResults],
        hasUnresolvedConflict: true,
      };
    }

    // 无需弹框：纯上传 → 全部按“用我的”登记；纯下载已完成落地。
    for (const item of uploads) {
      await item.applyUpload();
    }
    const decisions = createItemDecisions(items, defaultItemChoices(items));
    return {
      results: computeResolvedResults(
        transaction,
        adapterResults,
        decisions,
        false,
      ),
      hasUnresolvedConflict: false,
    };
  };

  const executeItemDecisions = async (
    items: readonly SyncPlanItem[],
    decisions: readonly SyncAdapterConflictDecision[],
  ): Promise<void> => {
    for (const decision of decisions) {
      if (decision.resolution === "pause") {
        continue;
      }
      const item = items.find((candidate) =>
        candidate.adapterId === decision.adapterId
        && candidate.assetId === decision.assetId
      );
      if (item === undefined) {
        continue;
      }
      if (item.kind === "download") {
        if (decision.resolution === "use-local") {
          await item.applyLocalRestore();
          await item.applyUpload();
        }
        // use-remote：下载已在分类阶段落地，无需操作。
        continue;
      }
      if (decision.resolution === "use-local") {
        await item.applyUpload();
        continue;
      }
      if (item.kind === "upload") {
        // AI-CORRECTION 2026-08-14: 上传条目 × 用远端 = 放弃本地新增，
        // 不再走 applyDownload（远端资产不存在会静默跳过，制造“已同步”假象），
        // 改为 applyDiscardLocal：二段删除本地资产 + touch 清空。
        await item.applyDiscardLocal();
        continue;
      }
      await item.applyDownload();
    }
  };

  const commitTransactionUploads = async (
    transaction: EngineTransaction,
  ): Promise<RemoteWriteBatchResult | null> => {
    if (transaction.uploads.length === 0) {
      await transaction.writeBatch.discard();
      return null;
    }
    for (const upload of transaction.uploads) {
      if ("deletedAt" in upload.params) {
        transaction.writeBatch.putTombstone(
          upload.params as RemoteAssetTombstoneParams,
        );
      } else {
        transaction.writeBatch.putAsset(
          upload.params as RemoteAssetPutParams,
        );
      }
    }
    return await transaction.writeBatch.commit();
  };

  const finalizeTransaction = async (
    session: SyncRemoteSession,
    transaction: EngineTransaction,
    adapterResults: readonly SyncAdapterResult[],
    commitResult: RemoteWriteBatchResult | null,
  ): Promise<void> => {
    // 二段删除落地（下载墓碑）：落地前再次检查二代脏标（下载不容忍）。
    for (const deletion of transaction.stagedDeletions.values()) {
      await transaction.assertDownloadAllowed(
        deletion.adapterId,
        deletion.assetId,
      );
    }
    for (const deletion of transaction.stagedDeletions.values()) {
      await deletion.apply();
    }
    // touch 落盘：commit 成功后才推进本地同步状态。
    for (const [assetKey, contentHash] of transaction.stagedTouches) {
      await session.localState.setLastSyncedHash(assetKey, contentHash);
    }
    // markApplied：本 collection 有已提交上传时不写 etag，使下次检查重新探测。
    for (const result of adapterResults) {
      const adapter = options.adapters.find((candidate) =>
        candidate.id === result.adapterId
      );
      if (adapter === undefined) {
        continue;
      }
      const hasUploads = commitResult?.writes.some((write) =>
        write.collection.adapterId === adapter.id
      ) ?? false;
      await session.markApplied({
        collection: adapter.collection,
        assetIds: result.changedAssetIds,
        scopeComplete: resolveRequestScopeComplete(adapter.id),
        collectionRevision: result.collectionRevision ?? null,
        collectionEtag: hasUploads
          ? null
          : result.collectionEtag ?? undefined,
      });
    }
  };

  const resolveRequestScopeComplete = (adapterId: string): boolean => {
    const scope = passRequestScopes.get(adapterId);
    return scope?.includeAssetIds === undefined
      && scope?.excludeAssetIds === undefined;
  };

  const computeResolvedResults = (
    transaction: EngineTransaction,
    adapterResults: readonly SyncAdapterResult[],
    decisions: readonly SyncAdapterConflictDecision[],
    forceConflict: boolean,
  ): SyncAdapterResult[] => {
    const resolutionByKey = new Map(decisions.map((decision) => [
      createSyncItemKey(decision.adapterId, decision.assetId),
      decision.resolution,
    ]));

    return adapterResults.map((result) => {
      const adapterItems = transaction.items.filter((item) =>
        item.adapterId === result.adapterId
      );
      if (adapterItems.length === 0) {
        return result;
      }
      let nextStatus: SyncAdapterStatus = "idle";
      const changedAssetIds = new Set(result.changedAssetIds);
      for (const item of adapterItems) {
        changedAssetIds.add(item.assetId);
        const resolution = resolutionByKey.get(
          createSyncItemKey(item.adapterId, item.assetId),
        ) ?? "pause";
        if (item.kind === "download") {
          nextStatus = mergeStatuses(
            nextStatus,
            resolution === "use-local" ? "uploaded" : "downloaded",
          );
        } else if (item.kind === "upload") {
          nextStatus = mergeStatuses(
            nextStatus,
            resolution === "use-remote" ? "downloaded" : "uploaded",
          );
        } else if (resolution === "use-local") {
          nextStatus = mergeStatuses(nextStatus, "uploaded");
        } else if (resolution === "use-remote") {
          nextStatus = mergeStatuses(nextStatus, "downloaded");
        } else {
          nextStatus = mergeStatuses(nextStatus, "conflict");
        }
      }
      if (forceConflict) {
        nextStatus = mergeStatuses(nextStatus, "conflict");
      }
      return {
        ...result,
        status: nextStatus,
        changedAssetIds: Array.from(changedAssetIds),
      };
    });
  };

  // AI-REMOVED 2026-08-13:
  // Reason: 报告型冲突（无条目）直接透传结果（状态已含 conflict），不再需要整体改写。
  // Trigger: resolvePlanItems 的 reportOnlyConflict 分支。
  // Replacement: 结果透传。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const markAdapterConflicts = (
  //   adapterResults: readonly SyncAdapterResult[],
  // ): SyncAdapterResult[] =>
  //   adapterResults.map((result) =>
  //     result.status === "conflict"
  //       ? result
  //       : { ...result, status: "conflict" as const }
  //   );

  // AI-REMOVED 2026-08-13:
  // Reason: 旧“同步后探测冲突 + 循环弹框 + 分阶段执行决议”工作流已移除。
  // Trigger: sync-model.md 要求上传/下载/冲突资产全部进入对话框逐项选择，
  //   且决议执行与单次 commit 统一由引擎编排。
  // Evidence: runConflictWorkflow 依赖已删除的 adapter.inspectConflicts /
  //   executeConflictDecisions；deferredConflictFingerprints 只在旧循环中使用。
  // Replacement: resolvePlanItems / executeItemDecisions / computeResolvedResults。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  //
  // const runConflictWorkflow = async (
  //   session: SyncRemoteSession,
  //   initialResults: readonly SyncAdapterResult[],
  // ): Promise<SyncAdapterResult[]> => {
  //   const completedResults = initialResults.filter(
  //     (result) => result.status !== "conflict",
  //   );
  //
  //   try {
  //     while (true) {
  //       if (
  //         !conflictOverlayVisible
  //         && deferredConflictFingerprints.size === 0
  //       ) {
  //         options.onConflictDiscoveryStart?.();
  //         conflictOverlayVisible = true;
  //       }
  //
  //       const discoveredConflicts = deduplicateConflicts(
  //         (await Promise.all(options.adapters.map(async (adapter) =>
  //           adapter.inspectConflicts === undefined
  //             ? []
  //             : await adapter.inspectConflicts(session)
  //         ))).flat(),
  //       );
  //       discardResolvedDeferredConflicts(
  //         deferredConflictFingerprints,
  //         discoveredConflicts,
  //       );
  //       const actionableConflicts = discoveredConflicts.filter((conflict) =>
  //         deferredConflictFingerprints.get(createConflictKey(conflict))
  //         !== createConflictFingerprint(conflict)
  //       );
  //
  //       if (actionableConflicts.length === 0) {
  //         return [
  //           ...completedResults,
  //           ...initialResults.filter((result) => result.status === "conflict"),
  //         ];
  //       }
  //
  //       if (!conflictOverlayVisible) {
  //         options.onConflictDiscoveryStart?.();
  //         conflictOverlayVisible = true;
  //       }
  //
  //       const choices = await (
  //         options.resolveConflicts?.(actionableConflicts)
  //         ?? Promise.resolve([])
  //       );
  //       const decisions = createConflictDecisions(
  //         actionableConflicts,
  //         choices,
  //       );
  //       for (const decision of decisions) {
  //         const key = createConflictKey(decision);
  //         if (decision.resolution === "pause") {
  //           deferredConflictFingerprints.set(
  //             key,
  //             createConflictFingerprint(decision),
  //           );
  //         } else {
  //           deferredConflictFingerprints.delete(key);
  //         }
  //       }
  //
  //       const resolutionResults = await runConflictDecisionRequests(
  //         session,
  //         decisions,
  //       );
  //       completedResults.push(...resolutionResults);
  //       const hasDeferredDecision = decisions.some(
  //         (decision) => decision.resolution === "pause",
  //       );
  //       const hasUnexpectedConflict = resolutionResults.some(
  //         (result) => result.status === "conflict",
  //       ) && !hasDeferredDecision;
  //       if (!hasUnexpectedConflict) {
  //         return completedResults;
  //       }
  //
  //       options.onConflictDiscoveryStart?.();
  //     }
  //   } finally {
  //     if (conflictOverlayVisible) {
  //       options.onConflictWorkflowFinished?.();
  //       conflictOverlayVisible = false;
  //     }
  //   }
  // };
  //
  // const runConflictDecisionRequests = async (
  //   session: SyncRemoteSession,
  //   decisions: readonly SyncAdapterConflictDecision[],
  // ): Promise<SyncAdapterResult[]> => {
  //   if (decisions.length === 0) return [];
  //
  //   // 按 adapter 分组决策
  //   const decisionsByAdapter = new Map<string, SyncAdapterConflictDecision[]>();
  //   for (const decision of decisions) {
  //     const list = decisionsByAdapter.get(decision.adapterId) ?? [];
  //     list.push(decision);
  //     decisionsByAdapter.set(decision.adapterId, list);
  //   }
  //
  //   // 收集涉及的 adapter
  //   const involvedAdapterIds = new Set(decisionsByAdapter.keys());
  //   const involvedAdapters = options.adapters.filter((a) => involvedAdapterIds.has(a.id));
  //
  //   // 任务追踪
  //   const adaptersByTask = new Map<SyncTaskKind, SyncAdapter[]>();
  //   for (const adapter of involvedAdapters) {
  //     const taskKind = options.resolveAdapterTaskKind?.(adapter.id) ?? "canvas";
  //     const taskAdapters = adaptersByTask.get(taskKind) ?? [];
  //     taskAdapters.push(adapter);
  //     adaptersByTask.set(taskKind, taskAdapters);
  //   }
  //   for (const [taskKind, taskAdapters] of adaptersByTask) {
  //     beginTask(taskKind, getAdapterTaskTotalUnitCount(taskKind, taskAdapters.length));
  //   }
  //
  //   let results: SyncAdapterResult[];
  //   try {
  //     const useRemoteDecisions = decisions.filter((d) => d.resolution === "use-remote");
  //     const useLocalDecisions = decisions.filter((d) => d.resolution === "use-local");
  //
  //     // Phase 1: 并行下载所有 "use-remote"
  //     const downloadResults: SyncAdapterResult[] = [];
  //     if (useRemoteDecisions.length > 0) {
  //       const byAdapter = new Map<string, SyncAdapterConflictDecision[]>();
  //       for (const d of useRemoteDecisions) {
  //         const list = byAdapter.get(d.adapterId) ?? [];
  //         list.push(d);
  //         byAdapter.set(d.adapterId, list);
  //       }
  //       const downloaded = await Promise.all(
  //         Array.from(byAdapter.entries()).map(async ([adapterId, adapterDecisions]) => {
  //           const adapter = options.adapters.find((a) => a.id === adapterId);
  //           if (adapter?.executeConflictDecisions !== undefined) {
  //             return await adapter.executeConflictDecisions(session, adapterDecisions);
  //           }
  //           // 回退：使用 sync() + conflictDecisions（仅 use-remote）
  //           return await adapter!.sync(session, { conflictDecisions: adapterDecisions });
  //         }),
  //       );
  //       downloadResults.push(...downloaded);
  //     }
  //
  //     // Phase 2: 共享批次上传所有 "use-local"
  //     const uploadResults: SyncAdapterResult[] = [];
  //     if (useLocalDecisions.length > 0) {
  //       const batch = session.beginWriteBatch();
  //       const byAdapter = new Map<string, SyncAdapterConflictDecision[]>();
  //       for (const d of useLocalDecisions) {
  //         const list = byAdapter.get(d.adapterId) ?? [];
  //         list.push(d);
  //         byAdapter.set(d.adapterId, list);
  //       }
  //       const uploaded = await Promise.all(
  //         Array.from(byAdapter.entries()).map(async ([adapterId, adapterDecisions]) => {
  //           const adapter = options.adapters.find((a) => a.id === adapterId);
  //           if (adapter?.executeConflictDecisions !== undefined) {
  //             return await adapter.executeConflictDecisions(session, adapterDecisions, batch);
  //           }
  //           // 回退：使用 sync() + conflictDecisions（仅 use-local）
  //           return await adapter!.sync(session, { conflictDecisions: adapterDecisions });
  //         }),
  //       );
  //       await batch.commit();
  //       for (const decision of useLocalDecisions) {
  //         const adapter = options.adapters.find((item) => item.id === decision.adapterId);
  //         if (adapter === undefined) continue;
  //         await session.localState.setLastSyncedHash(
  //           createSyncAssetKey(adapter.collection, decision.assetId),
  //           decision.localHash,
  //         );
  //       }
  //       uploadResults.push(...uploaded);
  //     }
  //
  //     // pause 决策的 adapter 标记为 conflict
  //     const pauseAdapterIds = new Set(
  //       decisions.filter((d) => d.resolution === "pause").map((d) => d.adapterId),
  //     );
  //     for (const adapterId of pauseAdapterIds) {
  //       if (!downloadResults.some((r) => r.adapterId === adapterId)
  //         && !uploadResults.some((r) => r.adapterId === adapterId)) {
  //         const adapter = options.adapters.find((a) => a.id === adapterId);
  //         if (adapter !== undefined) {
  //           uploadResults.push({
  //             adapterId: adapter.id,
  //             mode: adapter.mode,
  //             status: "conflict",
  //             changedAssetIds: [],
  //           });
  //         }
  //       }
  //     }
  //
  //     // 合并结果：download + upload，同一 adapter 的结果合并
  //     const merged = new Map<string, SyncAdapterResult>();
  //     for (const r of [...downloadResults, ...uploadResults]) {
  //       const existing = merged.get(r.adapterId);
  //       if (existing === undefined) {
  //         merged.set(r.adapterId, r);
  //       } else {
  //         merged.set(r.adapterId, {
  //           adapterId: r.adapterId,
  //           mode: r.mode,
  //           status: existing.status === "conflict" || r.status === "conflict"
  //             ? "conflict"
  //             : existing.status === "uploaded" || r.status === "uploaded"
  //               ? "uploaded"
  //               : existing.status === "downloaded" || r.status === "downloaded"
  //                 ? "downloaded"
  //                 : "idle",
  //           changedAssetIds: Array.from(new Set([...existing.changedAssetIds, ...r.changedAssetIds])),
  //         });
  //       }
  //     }
  //     results = Array.from(merged.values());
  //   } catch (error) {
  //     for (const [taskKind, taskAdapters] of adaptersByTask) {
  //       finishTask(
  //         taskKind,
  //         getAdapterTaskTotalUnitCount(taskKind, taskAdapters.length),
  //         error,
  //       );
  //     }
  //     throw error;
  //   }
  //   for (const [taskKind, taskAdapters] of adaptersByTask) {
  //     const taskAdapterIds = new Set(taskAdapters.map((adapter) => adapter.id));
  //     const taskResults = results.filter((result) => taskAdapterIds.has(result.adapterId));
  //     const totalUnitCount = getAdapterTaskTotalUnitCount(taskKind, taskAdapters.length);
  //     finishTask(
  //       taskKind,
  //       totalUnitCount,
  //       taskResults.some((result) => result.status === "conflict")
  //         ? new Error("Sync conflict")
  //         : null,
  //     );
  //   }
  //
  //   return results;
  // };

  const runMaintenanceTasks = async (
    session: SyncRemoteSession,
    settings: SyncConnectionSettings,
  ): Promise<void> => {
    for (const task of options.maintenanceTasks ?? []) {
      beginTask(task.kind, 1);
      try {
        await task.run(session, settings);
        finishTask(task.kind, 1);
      } catch (error) {
        finishTask(task.kind, 1, error);
        throw error;
      }
    }
  };

  const runSmallCheck = async (): Promise<boolean> => {
    const settings = options.readSettings();
    const remote = options.createRemote(settings, () => {}, {});
    const session = await remote.beginSession({
      reason: "interval",
      collections: options.adapters.map((adapter) => adapter.collection),
    });
    try {
      const result = await session.checkCollections(
        options.adapters.map((adapter) => adapter.collection),
      );
      return result.changedCollections.length === 0;
    } catch {
      return false;
    } finally {
      session.dispose?.();
      remote.dispose?.();
    }
  };

  const runIntervalCheck = async (): Promise<void> => {
    if (smallCheckRunning) return;
    smallCheckRunning = true;
    const now = new Date().toISOString();

    // 任务初始化为 running 态
    beginTask("interval-check", 1);
    try {
      const settings = options.readSettings();
      if (!settings.enabled || getSettingsError(settings) !== null) {
        finishTask("interval-check", 1);
        setStatus({
          ...status,
          lastSmallCheckAt: now,
        });
        return;
      }

      // 有脏数据等上传 → 走完整同步
      if (localChangeVersion > acknowledgedLocalChangeVersion) {
        finishTask("interval-check", 1);
        setStatus({
          ...status,
          lastSmallCheckAt: now,
        });
        await syncNow("interval");
        return;
      }

      const unchanged = await runSmallCheck();
      if (unchanged) {
        logger.debug("small check: remote unchanged → idle");
        finishTask("interval-check", 1);
        setStatus({
          ...status,
          phase: "idle",
          saveState: "idle",
          currentRunReason: null,
          pendingLocalChangeCount: 0,
          saveError: null,
          lastError: null,
          lastSmallCheckAt: now,
        });
        return;
      }

      logger.info("small check: remote changed → triggering full sync");
      finishTask("interval-check", 1);
      setStatus({
        ...status,
        lastSmallCheckAt: now,
      });
      await syncNow("interval");
    } catch (error) {
      finishTask("interval-check", 1, error);
      setStatus({
        ...status,
        lastSmallCheckAt: now,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      smallCheckRunning = false;
    }
  };

  return {
    start: () => {
      if (started) {
        return;
      }

      started = true;
      syncSuppressImmediate = false;
      logger.info("sync service started");
      void syncNow("startup");
      intervalId = globalThis.setInterval(() => {
        if (options.canRunInterval?.() !== false && !syncing) {
          void runIntervalCheck();
        }
      }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
      unrefTimer(intervalId);
    },
    stop: () => {
      started = false;
      logger.info("sync service stopped");
      pendingTrigger = null;
      clearLocalChangeTimers();
      activeRemote?.dispose?.();
      activeRemote = null;
      if (intervalId !== null) {
        globalThis.clearInterval(intervalId);
        intervalId = null;
      }
    },
    syncNow,
    flushPendingChanges: () => {
      if (
        !started
        || status.pendingLocalChangeCount <= 0
        || status.saveState !== "pending"
      ) {
        return;
      }
      // 页面切后台时跳过 5s 空闲去抖，立即把等待中的本地变更排入上传。
      // syncNow 开头会清掉 idle/max 定时器；若另一轮同步正在执行则自动排队。
      void syncNow("local-change");
    },
    notifyConflictDetected: () => {
      if (conflictOverlayVisible) {
        return;
      }

      conflictOverlayVisible = true;
      options.onConflictDiscoveryStart?.();
    },
    notifyLocalChange: (change) => {
      if (!started || !options.readSettings().enabled) {
        return;
      }

      logger.debug(
        `local change notified — scheduling upload ` +
        `(adapter=${change.adapterId}, asset=${change.assetId ?? "*"})`,
      );
      dirtyVersionsByAdapter.set(
        change.adapterId,
        (dirtyVersionsByAdapter.get(change.adapterId) ?? 0) + 1,
      );
      const currentDirtyAssetIds = dirtyAssetIdsByAdapter.get(change.adapterId);
      if (change.assetId === undefined) {
        dirtyAssetIdsByAdapter.set(change.adapterId, null);
      } else if (currentDirtyAssetIds !== null) {
        const nextDirtyAssetIds = currentDirtyAssetIds ?? new Set<string>();
        nextDirtyAssetIds.add(change.assetId);
        dirtyAssetIdsByAdapter.set(change.adapterId, nextDirtyAssetIds);
      }
      localChangeVersion += 1;
      // AI-CORRECTION 2026-07-30: setStatus 同步修改 status.saveState，
      // 原判断 status.saveState === "idle" 永远为 false；先捕获 prevSaveState 再判断。
      const prevSaveState = status.saveState;
      setStatus({
        ...status,
        saveState: prevSaveState === "error" ? "error" : "pending",
        pendingLocalChangeCount: getPendingLocalChangeCount(),
      });

      // AI-CORRECTION 2026-07-29: 从 idle 状态的首次编辑立即触发保存，不再等待 5 秒空闲；
      // 后续编辑沿用 5 秒空闲 + 30 秒上限防抖策略。
      if (!syncSuppressImmediate && prevSaveState === "idle") {
        syncSuppressImmediate = true;
        void syncNow("local-change");
        return;
      }

      if (idleTimerId !== null) {
        globalThis.clearTimeout(idleTimerId);
      }

      idleTimerId = globalThis.setTimeout(() => {
        idleTimerId = null;
        if (maxTimerId !== null) {
          globalThis.clearTimeout(maxTimerId);
          maxTimerId = null;
        }
        void syncNow("local-change");
      }, LOCAL_CHANGE_IDLE_UPLOAD_MS);
      unrefTimer(idleTimerId);

      if (maxTimerId === null) {
        maxTimerId = globalThis.setTimeout(() => {
          maxTimerId = null;
          if (idleTimerId !== null) {
            globalThis.clearTimeout(idleTimerId);
            idleTimerId = null;
          }
          void syncNow("local-change");
        }, LOCAL_CHANGE_MAX_UPLOAD_MS);
        unrefTimer(maxTimerId);
      }
    },
    getStatus: () => status,
  };

  function getPendingLocalChangeCount(): number {
    return Math.max(0, localChangeVersion - acknowledgedLocalChangeVersion);
  }
}

// AI-REMOVED 2026-08-13:
// Reason: 事务级重试已内联进 syncNow 的重启循环（瞬态错误走 retryDelaysMs，stale 错误走重启上限）。
// Trigger: 旧 retrySync 无法区分“需要换新 plan 的重启”与“原地重试”。
// Replacement: syncNow 内的 while 循环。
// Risk: Low。
// Human Review: Required
//
// Original code:
// async function retrySync<TValue>(
//   task: () => Promise<TValue>,
//   retryDelaysMs: readonly number[],
// ): Promise<TValue> {
//   let lastError: unknown = null;
//   for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
//     try {
//       return await task();
//     } catch (error) {
//       lastError = error;
//       const delayMs = retryDelaysMs[attempt];
//       if (delayMs === undefined) {
//         break;
//       }
//
//       await wait(delayMs);
//     }
//   }
//
//   throw lastError;
// }

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, delayMs);
    unrefTimer(timer);
  });
}

function createIdleStatus(lastResults: readonly SyncAdapterResult[]): SyncServiceStatus {
  return {
    phase: "idle",
    saveState: "idle",
    initialSyncStage: "ready",
    hasCompletedInitialFeatureSync: false,
    currentRunReason: null,
    activeRequestCount: 0,
    queuedRequestCount: 0,
    tasks: SYNC_TASK_KINDS.map((kind) => createIdleTaskStatus(kind)),
    pendingLocalChangeCount: 0,
    saveError: null,
    lastUploadAt: null,
    lastDownloadAt: null,
    lastError: null,
    lastSmallCheckAt: null,
    canvasLocked: false,
    lastResults,
  };
}

function createIdleTaskStatus(kind: SyncTaskKind): SyncTaskStatus {
  return {
    kind,
    phase: "idle",
    direction: null,
    completedUnitCount: 0,
    totalUnitCount: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
  };
}

function getAdapterTaskTotalUnitCount(
  taskKind: SyncTaskKind,
  requestCount: number,
): number {
  return taskKind === "canvas" && requestCount === 1
    ? 100
    : requestCount;
}

function selectQueuedTrigger(
  current: SyncRunReason | null,
  incoming: SyncRunReason,
): SyncRunReason {
  if (current === null) {
    return incoming;
  }

  const priority: Record<SyncRunReason, number> = {
    interval: 0,
    manual: 1,
    "local-change": 2,
    foreground: 3,
    startup: 3,
    "settings-change": 4,
  };

  return priority[incoming] > priority[current] ? incoming : current;
}

// AI-REMOVED 2026-08-13:
// Reason: 旧冲突工作流的决策/去重/指纹工具已随 runConflictWorkflow 一并移除。
// Trigger: sync-model.md 引擎级弹框按条目逐项决议，不再需要跨轮指纹去重。
// Replacement: createItemDecisions（下方）。
// Risk: Low。
// Human Review: Required
//
// Original code:
//
// function createConflictDecisions(
//   conflicts: readonly SyncAdapterConflict<unknown>[],
//   choices: readonly SyncConflictDecision[],
// ): SyncAdapterConflictDecision[] {
//   return conflicts.map((conflict) => ({
//     adapterId: conflict.adapterId,
//     assetId: conflict.assetId,
//     localHash: conflict.localHash,
//     remoteHash: conflict.remoteHash,
//     remoteDeletedAt: conflict.remoteDeletedAt,
//     resolution: choices.find((choice) =>
//       choice.adapterId === conflict.adapterId
//       && choice.assetId === conflict.assetId
//     )?.resolution ?? "pause",
//   }));
// }
//
// function deduplicateConflicts(
//   conflicts: readonly SyncAdapterConflict<unknown>[],
// ): SyncAdapterConflict<unknown>[] {
//   return Array.from(
//     new Map(conflicts.map((conflict) => [
//       createConflictKey(conflict),
//       conflict,
//     ])).values(),
//   );
// }
//
// function discardResolvedDeferredConflicts(
//   deferredFingerprints: Map<string, string>,
//   conflicts: readonly SyncAdapterConflict<unknown>[],
// ): void {
//   const currentFingerprints = new Map(conflicts.map((conflict) => [
//     createConflictKey(conflict),
//     createConflictFingerprint(conflict),
//   ]));
//   for (const [key, fingerprint] of deferredFingerprints) {
//     if (currentFingerprints.get(key) !== fingerprint) {
//       deferredFingerprints.delete(key);
//     }
//   }
// }
//
// function createConflictKey(value: {
//   readonly adapterId: string;
//   readonly assetId: string;
// }): string {
//   return `${value.adapterId}\u0000${value.assetId}`;
// }
//
// function createConflictFingerprint(value: {
//   readonly localHash: string;
//   readonly remoteHash: string | null;
//   readonly remoteDeletedAt: string | null;
// }): string {
//   return JSON.stringify([
//     value.localHash,
//     value.remoteHash,
//     value.remoteDeletedAt,
//   ]);
// }

function toConflictShape(item: SyncPlanItem): SyncAdapterConflict<unknown> {
  return {
    adapterId: item.adapterId,
    assetId: item.assetId,
    kind: item.kind,
    localValue: item.localValue,
    remoteValue: item.remoteValue,
    localHash: item.localHash ?? "",
    remoteHash: item.remoteHash,
    remoteDeletedAt: item.remoteDeletedAt,
    remoteUpdatedAt: item.remoteUpdatedAt,
  };
}

function createItemDecisions(
  items: readonly SyncPlanItem[],
  choices: readonly SyncConflictDecision[],
): SyncAdapterConflictDecision[] {
  return items.map((item) => ({
    adapterId: item.adapterId,
    assetId: item.assetId,
    localHash: item.localHash ?? "",
    remoteHash: item.remoteHash,
    remoteDeletedAt: item.remoteDeletedAt,
    resolution: choices.find((choice) =>
      choice.adapterId === item.adapterId
      && choice.assetId === item.assetId
    )?.resolution ?? "pause",
  }));
}

function defaultItemChoices(
  items: readonly SyncPlanItem[],
): readonly SyncConflictDecision[] {
  return items.flatMap((item): SyncConflictDecision[] =>
    item.kind === "download"
      ? [{ adapterId: item.adapterId, assetId: item.assetId, resolution: "use-remote" }]
      : item.kind === "upload"
        ? [{ adapterId: item.adapterId, assetId: item.assetId, resolution: "use-local" }]
        : []
  );
}

function createSyncItemKey(adapterId: string, assetId: string): string {
  return `${adapterId}\u0000${assetId}`;
}

function areDirtySetsEquivalent(
  live: Set<string> | null,
  frozen: Set<string> | null | undefined,
): boolean {
  if (live === null) {
    // 整片脏：只有冻结快照同样整片脏才等价。
    return frozen === null;
  }
  if (frozen === null || frozen === undefined) {
    return false;
  }
  if (live.size !== frozen.size) {
    return false;
  }
  for (const assetId of live) {
    if (!frozen.has(assetId)) {
      return false;
    }
  }
  return true;
}

function mergeStatuses(
  left: SyncAdapterStatus,
  right: SyncAdapterStatus,
): SyncAdapterStatus {
  if (left === "conflict" || right === "conflict") {
    return "conflict";
  }
  if (left === "uploaded" || right === "uploaded") {
    return "uploaded";
  }
  if (left === "downloaded" || right === "downloaded") {
    return "downloaded";
  }
  if (left === "skipped" || right === "skipped") {
    return "skipped";
  }
  return "idle";
}

async function withSyncLock<TValue>(task: () => Promise<TValue>): Promise<TValue> {
  const locks = typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & {
      readonly locks?: {
        request<TLockValue>(name: string, callback: () => Promise<TLockValue>): Promise<TLockValue>;
      };
    }).locks;

  if (locks === undefined) {
    return await task();
  }

  return await locks.request("sync-service", task);
}

function unrefTimer(timer: ReturnType<typeof globalThis.setInterval> | ReturnType<typeof globalThis.setTimeout>): void {
  const nodeTimer = timer as {
    readonly unref?: () => void;
  };

  nodeTimer.unref?.();
}
