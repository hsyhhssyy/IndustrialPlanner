import { createLogger } from "@/shared/logging/logger";
import { readWebDavLastSeenRemoteEtag, type WebDavSyncSettings } from "../storage";
import type {
  SyncConflictDecision,
  SyncInitialSyncStage,
  SyncRunReason,
  SyncTaskKind,
  SyncTaskStatus,
} from "@/domain/sync";
import type { WebDavStorageClient } from "../webdav";
import type {
  WebDavSyncAdapter,
  WebDavSyncConflict,
  WebDavSyncConflictDecision,
  WebDavSyncAdapterScope,
  WebDavSyncAdapterResult,
} from "./webdav-sync-adapters";

const logger = createLogger("webdav-sync");

export type WebDavSyncServicePhase = "idle" | "uploading" | "downloading" | "error";
export type WebDavSyncSaveState = "idle" | "pending" | "saving" | "error";
export type WebDavSyncTrigger = SyncRunReason;

export interface WebDavSyncAdapterRequest {
  readonly adapterId: string;
  readonly scope?: WebDavSyncAdapterScope;
}

export interface WebDavInitialSyncBatch {
  readonly stage: Exclude<SyncInitialSyncStage, "ready">;
  readonly requests: readonly WebDavSyncAdapterRequest[];
}

export interface WebDavInitialSyncPlan {
  readonly batches: readonly WebDavInitialSyncBatch[];
  readonly backgroundRequests?: readonly WebDavSyncAdapterRequest[];
}

export interface WebDavLocalChange {
  readonly adapterId: string;
  readonly assetId?: string;
}

export interface WebDavSyncRequestActivity {
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
}

export interface WebDavSyncClientRequestOptions {
  readonly requestTimeoutMs?: number;
}

export interface WebDavSyncMaintenanceTask {
  readonly kind: SyncTaskKind;
  readonly run: (
    client: WebDavStorageClient,
    settings: WebDavSyncSettings,
  ) => Promise<void> | void;
}

export interface WebDavSyncServiceStatus {
  readonly phase: WebDavSyncServicePhase;
  readonly saveState: WebDavSyncSaveState;
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
  readonly lastResults: readonly WebDavSyncAdapterResult[];
}

export interface WebDavSyncServiceOptions {
  readonly readSettings: () => WebDavSyncSettings;
  readonly createClient: (
    settings: WebDavSyncSettings,
    onRequestActivityChange: (
      activity: WebDavSyncRequestActivity,
    ) => void,
    requestOptions: WebDavSyncClientRequestOptions,
  ) => WebDavStorageClient;
  readonly adapters: readonly WebDavSyncAdapter[];
  readonly createInitialSyncPlan?: () => WebDavInitialSyncPlan;
  readonly maintenanceTasks?: readonly WebDavSyncMaintenanceTask[];
  readonly resolveAdapterTaskKind?: (adapterId: string) => SyncTaskKind;
  readonly canRunInterval?: () => boolean;
  readonly beforeSync?: (client: WebDavStorageClient, settings: WebDavSyncSettings) => Promise<void> | void;
  readonly afterSync?: (client: WebDavStorageClient, settings: WebDavSyncSettings, results: readonly WebDavSyncAdapterResult[]) => Promise<void> | void;
  readonly intervalMs?: number;
  readonly bigCheckIntervalMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly onStatusChange?: (status: WebDavSyncServiceStatus) => void;
  readonly onConflictDiscoveryStart?: () => void;
  readonly resolveConflicts?: (
    conflicts: readonly WebDavSyncConflict<unknown>[],
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
  // readonly onConflict?: (results: readonly WebDavSyncAdapterResult[]) => void;
}

export interface WebDavSyncService {
  start(): void;
  stop(): void;
  syncNow(trigger: WebDavSyncTrigger): Promise<WebDavSyncServiceStatus>;
  notifyLocalChange(change: WebDavLocalChange): void;
  notifyConflictDetected(conflict: WebDavSyncConflict<unknown>): void;
  getStatus(): WebDavSyncServiceStatus;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BIG_CHECK_INTERVAL_MS = 10 * 60_000;
const LOCAL_CHANGE_IDLE_UPLOAD_MS = 5_000;
const LOCAL_CHANGE_MAX_UPLOAD_MS = 30_000;
const INITIAL_SYNC_REQUEST_TIMEOUT_MS = 8_000;
// AI-REMOVED 2026-07-29:
// Reason: 对整个同步事务做六轮退避重试会把一次 30 秒请求超时放大为数分钟，并重复已经成功的写入步骤。
// Trigger: 用户要求首次网络失败后立即解除画布锁定并显示错误状态。
// Evidence: retryWebDavSync 包裹 beforeSync、全部 adapter 和 maintenance，而不是单个幂等 GET。
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
];
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

export function createWebDavSyncService(options: WebDavSyncServiceOptions): WebDavSyncService {
  let status: WebDavSyncServiceStatus = createIdleStatus([]);
  let started = false;
  let syncing = false;
  let intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  let bigCheckIntervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  let smallCheckRunning = false;
  let idleTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let maxTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let activeClient: WebDavStorageClient | null = null;
  let pendingTrigger: WebDavSyncTrigger | null = null;
  let localChangeVersion = 0;
  let acknowledgedLocalChangeVersion = 0;
  let conflictOverlayVisible = false;
  let syncSuppressImmediate = false;
  const dirtyAssetIdsByAdapter = new Map<string, Set<string> | null>();
  const deferredConflictFingerprints = new Map<string, string>();

  const setStatus = (nextStatus: WebDavSyncServiceStatus): WebDavSyncServiceStatus => {
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
    SYNC_TASK_KINDS.map((kind) => createIdleTaskStatus(kind));

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

  const beginTask = (kind: SyncTaskKind, totalUnitCount: number): void => {
    updateTask(kind, {
      phase: "running",
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
  ): void => {
    updateTask(kind, {
      phase: error === null ? "success" : "error",
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

  const syncNow = async (trigger: WebDavSyncTrigger): Promise<WebDavSyncServiceStatus> => {
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
      clearLocalChangeTimers();
      return setStatus(createIdleStatus(status.lastResults));
    }

    if (settings.url.trim() === "") {
      const saveError = "WebDAV URL is empty";
      logger.info("sync skipped — empty URL");
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
    const activePhase: WebDavSyncServicePhase = hasPendingLocalChanges || trigger === "local-change"
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
      const results = await retryWebDavSync(
        async () => {
          const client = options.createClient(
            settings,
            (activity) => {
              setStatus({
                ...status,
                activeRequestCount: activity.activeRequestCount,
                queuedRequestCount: activity.queuedRequestCount,
              });
            },
            {
              requestTimeoutMs: isInitialSync
                ? INITIAL_SYNC_REQUEST_TIMEOUT_MS
                : undefined,
            },
          );
          activeClient = client;
          try {
            return await withWebDavSyncLock(async () => {
              await options.beforeSync?.(client, settings);
              const adapterResults = isInitialSync
                ? await runInitialSyncPlan(client)
                : await runRegularSyncRequests(
                  client,
                  resolveRegularSyncRequests(trigger),
                );
              const resolvedResults = adapterResults.some(
                (result) => result.status === "conflict",
              )
                ? await runConflictWorkflow(client, adapterResults)
                : adapterResults;
              if (
                isInitialSync
                && !resolvedResults.some(
                  (result) => result.status === "conflict",
                )
              ) {
                setStatus({
                  ...status,
                  initialSyncStage: "ready",
                  hasCompletedInitialFeatureSync: true,
                });
              }
              // AI-CORRECTION 2026-07-30: 目录维护仅在初始同步和大检查（interval）时执行，
              // 不再每次 local-change 都防御性创建目录；adapter 自身的 makeDirectory 已处理写入路径。
              if (
                !resolvedResults.some((result) => result.status === "conflict")
                && (isInitialSync || trigger === "big-check")
              ) {
                for (const task of options.maintenanceTasks ?? []) {
                  queueTask(task.kind, 1);
                }
                await runMaintenanceTasks(client, settings);
              }
              await options.afterSync?.(client, settings, resolvedResults);

              return resolvedResults;
            });
          } finally {
            if (activeClient === client) {
              activeClient = null;
            }
            client.dispose?.();
          }
        },
        options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
      );
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
          saveError: pendingLocalChangeCount > 0 ? "WebDAV sync conflict" : status.saveError,
          lastUploadAt: status.lastUploadAt,
          lastDownloadAt: status.lastDownloadAt,
          lastError: "WebDAV sync conflict",
          lastResults: results,
        });
      }

      acknowledgedLocalChangeVersion = Math.max(
        acknowledgedLocalChangeVersion,
        syncLocalChangeVersion,
      );
      if (localChangeVersion === syncLocalChangeVersion) {
        dirtyAssetIdsByAdapter.clear();
      }
      const pendingLocalChangeCount = getPendingLocalChangeCount();

      // AI-CORRECTION 2026-07-30: 无挂起改动时复位 syncSuppressImmediate，
      // 使得下次从 idle 编辑能再次立即上传。
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
    client: WebDavStorageClient,
  ): Promise<WebDavSyncAdapterResult[]> => {
    const plan: WebDavInitialSyncPlan = options.createInitialSyncPlan?.() ?? {
      batches: [{
        stage: "canvas",
        requests: options.adapters.map((adapter) => ({ adapterId: adapter.id })),
      }],
    };
    const results: WebDavSyncAdapterResult[] = [];

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
        client,
        batch.requests,
        batch.stage,
      );
      results.push(...batchResults);
      if (batchResults.some((result) => result.status === "conflict")) {
        return results;
      }
    }

    setStatus({
      ...status,
      initialSyncStage: "ready",
      hasCompletedInitialFeatureSync: true,
    });
    logger.info("initial sync stage: ready");

    if (plan.backgroundRequests !== undefined) {
      results.push(...await runAdapterRequests(
        client,
        plan.backgroundRequests,
        "background-documents",
      ));
    }

    return results;
  };

  const runAdapterRequests = async (
    client: WebDavStorageClient,
    requests: readonly WebDavSyncAdapterRequest[],
    taskKind?: SyncTaskKind,
  ): Promise<WebDavSyncAdapterResult[]> => {
    logger.info(`sync starting — ${requests.length} adapter request(s)`);
    const adapterResults: WebDavSyncAdapterResult[] = [];
    const totalUnitCount = taskKind === undefined
      ? 0
      : getAdapterTaskTotalUnitCount(taskKind, requests.length);
    const tracksProtocolProgress = taskKind === "canvas" && requests.length === 1;
    if (taskKind !== undefined) {
      beginTask(taskKind, totalUnitCount);
    }
    try {
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
        const result = await adapter.sync(client, requestScope);
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
        if (result.status === "conflict") {
          if (taskKind !== undefined) {
            finishTask(
              taskKind,
              totalUnitCount,
              new Error("WebDAV sync conflict"),
            );
          }
          return adapterResults;
        }
      }
    } catch (error) {
      if (taskKind !== undefined) {
        finishTask(taskKind, totalUnitCount, error);
      }
      throw error;
    }
    if (taskKind !== undefined) {
      finishTask(taskKind, totalUnitCount);
    }

    return adapterResults;
  };

  const resolveRegularSyncRequests = (
    trigger: WebDavSyncTrigger,
  ): readonly WebDavSyncAdapterRequest[] => {
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
    client: WebDavStorageClient,
    requests: readonly WebDavSyncAdapterRequest[],
  ): Promise<WebDavSyncAdapterResult[]> => {
    const requestsByTask = new Map<SyncTaskKind, WebDavSyncAdapterRequest[]>();
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

    const results: WebDavSyncAdapterResult[] = [];
    for (const [taskKind, taskRequests] of requestsByTask) {
      const taskResults = await runAdapterRequests(
        client,
        taskRequests,
        taskKind,
      );
      results.push(...taskResults);
      if (taskResults.some((result) => result.status === "conflict")) {
        break;
      }
    }

    return results;
  };

  const runConflictWorkflow = async (
    client: WebDavStorageClient,
    initialResults: readonly WebDavSyncAdapterResult[],
  ): Promise<WebDavSyncAdapterResult[]> => {
    const completedResults = initialResults.filter(
      (result) => result.status !== "conflict",
    );

    try {
      while (true) {
        if (
          !conflictOverlayVisible
          && deferredConflictFingerprints.size === 0
        ) {
          options.onConflictDiscoveryStart?.();
          conflictOverlayVisible = true;
        }

        const discoveredConflicts = deduplicateConflicts(
          (await Promise.all(options.adapters.map(async (adapter) =>
            adapter.inspectConflicts === undefined
              ? []
              : await adapter.inspectConflicts(client)
          ))).flat(),
        );
        discardResolvedDeferredConflicts(
          deferredConflictFingerprints,
          discoveredConflicts,
        );
        const actionableConflicts = discoveredConflicts.filter((conflict) =>
          deferredConflictFingerprints.get(createConflictKey(conflict))
          !== createConflictFingerprint(conflict)
        );

        if (actionableConflicts.length === 0) {
          return [
            ...completedResults,
            ...initialResults.filter((result) => result.status === "conflict"),
          ];
        }

        if (!conflictOverlayVisible) {
          options.onConflictDiscoveryStart?.();
          conflictOverlayVisible = true;
        }

        const choices = await (
          options.resolveConflicts?.(actionableConflicts)
          ?? Promise.resolve([])
        );
        const decisions = createConflictDecisions(
          actionableConflicts,
          choices,
        );
        for (const decision of decisions) {
          const key = createConflictKey(decision);
          if (decision.resolution === "pause") {
            deferredConflictFingerprints.set(
              key,
              createConflictFingerprint(decision),
            );
          } else {
            deferredConflictFingerprints.delete(key);
          }
        }

        const resolutionResults = await runConflictDecisionRequests(
          client,
          decisions,
        );
        completedResults.push(...resolutionResults);
        const hasDeferredDecision = decisions.some(
          (decision) => decision.resolution === "pause",
        );
        const hasUnexpectedConflict = resolutionResults.some(
          (result) => result.status === "conflict",
        ) && !hasDeferredDecision;
        if (!hasUnexpectedConflict) {
          return completedResults;
        }

        options.onConflictDiscoveryStart?.();
      }
    } finally {
      if (conflictOverlayVisible) {
        options.onConflictWorkflowFinished?.();
        conflictOverlayVisible = false;
      }
    }
  };

  const runConflictDecisionRequests = async (
    client: WebDavStorageClient,
    decisions: readonly WebDavSyncConflictDecision[],
  ): Promise<WebDavSyncAdapterResult[]> => {
    const adaptersByTask = new Map<SyncTaskKind, WebDavSyncAdapter[]>();
    for (const adapter of options.adapters) {
      const taskKind = options.resolveAdapterTaskKind?.(adapter.id)
        ?? "canvas";
      const taskAdapters = adaptersByTask.get(taskKind) ?? [];
      taskAdapters.push(adapter);
      adaptersByTask.set(taskKind, taskAdapters);
    }
    for (const [taskKind, taskAdapters] of adaptersByTask) {
      beginTask(
        taskKind,
        getAdapterTaskTotalUnitCount(taskKind, taskAdapters.length),
      );
    }

    let results: WebDavSyncAdapterResult[];
    try {
      results = await Promise.all(options.adapters.map(async (adapter) =>
        await adapter.sync(client, {
          conflictDecisions: decisions.filter(
            (decision) => decision.adapterId === adapter.id,
          ),
        })
      ));
    } catch (error) {
      for (const [taskKind, taskAdapters] of adaptersByTask) {
        finishTask(
          taskKind,
          getAdapterTaskTotalUnitCount(taskKind, taskAdapters.length),
          error,
        );
      }
      throw error;
    }
    for (const [taskKind, taskAdapters] of adaptersByTask) {
      const taskAdapterIds = new Set(
        taskAdapters.map((adapter) => adapter.id),
      );
      const taskResults = results.filter((result) =>
        taskAdapterIds.has(result.adapterId),
      );
      const totalUnitCount = getAdapterTaskTotalUnitCount(
        taskKind,
        taskAdapters.length,
      );
      finishTask(
        taskKind,
        totalUnitCount,
        taskResults.some((result) => result.status === "conflict")
          ? new Error("WebDAV sync conflict")
          : null,
      );
    }

    return results;
  };

  const runMaintenanceTasks = async (
    client: WebDavStorageClient,
    settings: WebDavSyncSettings,
  ): Promise<void> => {
    for (const task of options.maintenanceTasks ?? []) {
      beginTask(task.kind, 1);
      try {
        await task.run(client, settings);
        finishTask(task.kind, 1);
      } catch (error) {
        finishTask(task.kind, 1, error);
        throw error;
      }
    }
  };

  const runSmallCheck = async (): Promise<boolean> => {
    const settings = options.readSettings();
    const client = options.createClient(settings, () => {}, {});
    try {
      for (const adapter of options.adapters) {
        const checkPath = adapter.checkPath;
        if (checkPath === null) continue;

        const lastEtag = readWebDavLastSeenRemoteEtag(checkPath);
        if (lastEtag === null) return false;

        const stat = await client.stat(checkPath);
        if (stat?.etag !== lastEtag) return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      client.dispose?.();
    }
  };

  const runIntervalCheck = async (): Promise<void> => {
    if (smallCheckRunning) return;
    smallCheckRunning = true;
    try {
      const settings = options.readSettings();
      if (!settings.enabled || settings.url.trim() === "") return;

      // 有脏数据等上传 → 走完整同步
      if (localChangeVersion > acknowledgedLocalChangeVersion) {
        await syncNow("interval");
        return;
      }

      const unchanged = await runSmallCheck();
      if (unchanged) {
        logger.debug("small check: remote unchanged → idle");
        return;
      }

      logger.info("small check: remote changed → triggering full sync");
      await syncNow("interval");
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

      bigCheckIntervalId = globalThis.setInterval(() => {
        if (options.canRunInterval?.() !== false) {
          void syncNow("big-check");
        }
      }, options.bigCheckIntervalMs ?? DEFAULT_BIG_CHECK_INTERVAL_MS);
      unrefTimer(bigCheckIntervalId);
    },
    stop: () => {
      started = false;
      logger.info("sync service stopped");
      pendingTrigger = null;
      clearLocalChangeTimers();
      activeClient?.dispose?.();
      activeClient = null;
      if (intervalId !== null) {
        globalThis.clearInterval(intervalId);
        intervalId = null;
      }
      if (bigCheckIntervalId !== null) {
        globalThis.clearInterval(bigCheckIntervalId);
        bigCheckIntervalId = null;
      }
    },
    syncNow,
    notifyConflictDetected: (conflict) => {
      if (
        conflictOverlayVisible
        || deferredConflictFingerprints.get(createConflictKey(conflict))
          === createConflictFingerprint(conflict)
      ) {
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

async function retryWebDavSync<TValue>(
  task: () => Promise<TValue>,
  retryDelaysMs: readonly number[],
): Promise<TValue> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined) {
        break;
      }

      await wait(delayMs);
    }
  }

  throw lastError;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, delayMs);
    unrefTimer(timer);
  });
}

function createIdleStatus(lastResults: readonly WebDavSyncAdapterResult[]): WebDavSyncServiceStatus {
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
    lastResults,
  };
}

function createIdleTaskStatus(kind: SyncTaskKind): SyncTaskStatus {
  return {
    kind,
    phase: "idle",
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
  current: WebDavSyncTrigger | null,
  incoming: WebDavSyncTrigger,
): WebDavSyncTrigger {
  if (current === null) {
    return incoming;
  }

  const priority: Record<WebDavSyncTrigger, number> = {
    interval: 0,
    "big-check": 0,
    manual: 1,
    "local-change": 2,
    foreground: 3,
    startup: 3,
    "settings-change": 4,
  };

  return priority[incoming] > priority[current] ? incoming : current;
}

function createConflictDecisions(
  conflicts: readonly WebDavSyncConflict<unknown>[],
  choices: readonly SyncConflictDecision[],
): WebDavSyncConflictDecision[] {
  return conflicts.map((conflict) => ({
    adapterId: conflict.adapterId,
    assetId: conflict.assetId,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    remoteDeletedAt: conflict.remoteDeletedAt,
    resolution: choices.find((choice) =>
      choice.adapterId === conflict.adapterId
      && choice.assetId === conflict.assetId
    )?.resolution ?? "pause",
  }));
}

function deduplicateConflicts(
  conflicts: readonly WebDavSyncConflict<unknown>[],
): WebDavSyncConflict<unknown>[] {
  return Array.from(
    new Map(conflicts.map((conflict) => [
      createConflictKey(conflict),
      conflict,
    ])).values(),
  );
}

function discardResolvedDeferredConflicts(
  deferredFingerprints: Map<string, string>,
  conflicts: readonly WebDavSyncConflict<unknown>[],
): void {
  const currentFingerprints = new Map(conflicts.map((conflict) => [
    createConflictKey(conflict),
    createConflictFingerprint(conflict),
  ]));
  for (const [key, fingerprint] of deferredFingerprints) {
    if (currentFingerprints.get(key) !== fingerprint) {
      deferredFingerprints.delete(key);
    }
  }
}

function createConflictKey(value: {
  readonly adapterId: string;
  readonly assetId: string;
}): string {
  return `${value.adapterId}\u0000${value.assetId}`;
}

function createConflictFingerprint(value: {
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
}): string {
  return JSON.stringify([
    value.localHash,
    value.remoteHash,
    value.remoteDeletedAt,
  ]);
}

async function withWebDavSyncLock<TValue>(task: () => Promise<TValue>): Promise<TValue> {
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

  return await locks.request("webdav-sync", task);
}

function unrefTimer(timer: ReturnType<typeof globalThis.setInterval> | ReturnType<typeof globalThis.setTimeout>): void {
  const nodeTimer = timer as {
    readonly unref?: () => void;
  };

  nodeTimer.unref?.();
}
