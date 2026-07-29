import { createLogger } from "@/shared/logging/logger";
import type { WebDavStorageClient } from "../webdav";
import type { WebDavSyncSettings } from "../storage";
import type {
  WebDavSyncAdapter,
  WebDavSyncAdapterResult,
} from "./webdav-sync-adapters";

const logger = createLogger("webdav-sync");

export type WebDavSyncServicePhase = "idle" | "uploading" | "downloading" | "error";
export type WebDavSyncSaveState = "idle" | "pending" | "saving" | "error";
export type WebDavSyncTrigger = "startup" | "interval" | "local-change" | "settings-change" | "manual";

export interface WebDavSyncServiceStatus {
  readonly phase: WebDavSyncServicePhase;
  readonly saveState: WebDavSyncSaveState;
  readonly pendingLocalChangeCount: number;
  readonly saveError: string | null;
  readonly lastUploadAt: string | null;
  readonly lastDownloadAt: string | null;
  readonly lastError: string | null;
  readonly lastResults: readonly WebDavSyncAdapterResult[];
}

export interface WebDavSyncServiceOptions {
  readonly readSettings: () => WebDavSyncSettings;
  readonly createClient: (settings: WebDavSyncSettings) => WebDavStorageClient;
  readonly adapters: readonly WebDavSyncAdapter[];
  readonly beforeSync?: (client: WebDavStorageClient, settings: WebDavSyncSettings) => Promise<void> | void;
  readonly afterSync?: (client: WebDavStorageClient, settings: WebDavSyncSettings, results: readonly WebDavSyncAdapterResult[]) => Promise<void> | void;
  readonly intervalMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly onStatusChange?: (status: WebDavSyncServiceStatus) => void;
  readonly onConflict?: (results: readonly WebDavSyncAdapterResult[]) => void;
}

export interface WebDavSyncService {
  start(): void;
  stop(): void;
  syncNow(trigger: WebDavSyncTrigger): Promise<WebDavSyncServiceStatus>;
  notifyLocalChange(): void;
  getStatus(): WebDavSyncServiceStatus;
}

const DEFAULT_INTERVAL_MS = 60_000;
const LOCAL_CHANGE_IDLE_UPLOAD_MS = 5_000;
const LOCAL_CHANGE_MAX_UPLOAD_MS = 30_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export function createWebDavSyncService(options: WebDavSyncServiceOptions): WebDavSyncService {
  let status: WebDavSyncServiceStatus = createIdleStatus([]);
  let started = false;
  let syncing = false;
  let intervalId: ReturnType<typeof globalThis.setInterval> | null = null;
  let idleTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let maxTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let activeClient: WebDavStorageClient | null = null;
  let pendingTrigger: WebDavSyncTrigger | null = null;
  let localChangeVersion = 0;
  let acknowledgedLocalChangeVersion = 0;

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

  const syncNow = async (trigger: WebDavSyncTrigger): Promise<WebDavSyncServiceStatus> => {
    logger.info(`sync triggered: ${trigger}`);

    if (syncing) {
      if (trigger === "interval") {
        logger.debug("periodic sync skipped — another sync is already in progress");
        return status;
      }

      pendingTrigger = trigger;
      logger.debug(`sync queued — already in progress (trigger=${trigger})`);
      return status;
    }

    const settings = options.readSettings();
    if (!settings.enabled) {
      logger.info("sync skipped — disabled");
      acknowledgedLocalChangeVersion = localChangeVersion;
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
      pendingLocalChangeCount: getPendingLocalChangeCount(),
      lastError: null,
    });
    logger.info(`sync phase: ${activePhase} (${options.adapters.length} adapter(s))`);

    try {
      const results = await retryWebDavSync(
        async () => {
          const client = options.createClient(settings);
          activeClient = client;
          try {
            return await withWebDavSyncLock(async () => {
              await options.beforeSync?.(client, settings);
              logger.info(`sync starting — ${options.adapters.length} adapter(s)`);
              const adapterResults: WebDavSyncAdapterResult[] = [];
              for (const adapter of options.adapters) {
                const beforeMs = Date.now();
                const result = await adapter.sync(client);
                const elapsed = Date.now() - beforeMs;
                logger.info(
                  `adapter "${result.adapterId}" → ${result.status} ` +
                  `(mode=${result.mode}, changed=${result.changedAssetIds.length}, ${elapsed}ms)`,
                );
                adapterResults.push(result);
              }
              await options.afterSync?.(client, settings, adapterResults);

              return adapterResults;
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
        logger.debug("sync conflict detected, triggering onConflict callback");
        options.onConflict?.(results);
        const pendingLocalChangeCount = getPendingLocalChangeCount();
        return setStatus({
          phase: "error",
          saveState: pendingLocalChangeCount > 0 ? "error" : status.saveState,
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
      const pendingLocalChangeCount = getPendingLocalChangeCount();

      return setStatus({
        phase: "idle",
        saveState: pendingLocalChangeCount > 0 ? "pending" : "idle",
        pendingLocalChangeCount,
        saveError: null,
        lastUploadAt: didUpload || hasPendingLocalChanges ? timestamp : status.lastUploadAt,
        lastDownloadAt: didDownload ? timestamp : status.lastDownloadAt,
        lastError: null,
        lastResults: results,
      });
    } catch (error) {
      logger.debug(
        `sync failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      const pendingLocalChangeCount = getPendingLocalChangeCount();
      return setStatus({
        ...status,
        phase: "error",
        saveState: pendingLocalChangeCount > 0 ? "error" : status.saveState,
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

  return {
    start: () => {
      if (started) {
        return;
      }

      started = true;
      logger.info("sync service started");
      void syncNow("startup");
      intervalId = globalThis.setInterval(() => {
        void syncNow("interval");
      }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
      unrefTimer(intervalId);
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
    },
    syncNow,
    notifyLocalChange: () => {
      if (!started || !options.readSettings().enabled) {
        return;
      }

      logger.debug("local change notified — scheduling upload");
      localChangeVersion += 1;
      setStatus({
        ...status,
        saveState: status.saveState === "error" ? "error" : "pending",
        pendingLocalChangeCount: getPendingLocalChangeCount(),
      });

      if (idleTimerId !== null) {
        globalThis.clearTimeout(idleTimerId);
      }

      idleTimerId = globalThis.setTimeout(() => {
        void syncNow("local-change");
      }, LOCAL_CHANGE_IDLE_UPLOAD_MS);
      unrefTimer(idleTimerId);

      if (maxTimerId === null) {
        maxTimerId = globalThis.setTimeout(() => {
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
    pendingLocalChangeCount: 0,
    saveError: null,
    lastUploadAt: null,
    lastDownloadAt: null,
    lastError: null,
    lastResults,
  };
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
