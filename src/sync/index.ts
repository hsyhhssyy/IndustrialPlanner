export {
  createSyncHost,
  type SyncHost,
  type SyncHostOptions,
} from "./sync-host";

// ============================================================
// Engine: sync-adapters (通用适配器，独立于具体存储后端)
// ============================================================
export {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createPatchWithRevisionAdapter,
} from "./engine/sync-adapters";
export type {
  FullNoRevisionAdapterOptions,
  FullWithRevisionAdapterOptions,
  FullWithRevisionEntry,
  PatchCollectionWithRevisionAdapterOptions,
  PatchWithRevisionAdapterOptions,
  PatchWithRevisionEntry,
  SyncAdapter,
  SyncAdapterConflict,
  SyncAdapterConflictDecision,
  SyncAdapterConflictResolution,
  SyncAdapterMode,
  SyncAdapterResult,
  SyncAdapterScope,
  SyncAdapterStatus,
} from "./engine/sync-adapters";

// AI-CORRECTION 2026-07-30: 以下旧名称保持向后兼容。
import type {
  SyncAdapter,
  SyncAdapterConflict,
  SyncAdapterConflictDecision,
  SyncAdapterConflictResolution,
  SyncAdapterMode,
  SyncAdapterResult,
  SyncAdapterScope,
  SyncAdapterStatus,
} from "./engine/sync-adapters";
export type WebDavSyncAdapter = SyncAdapter;
export type WebDavSyncConflict<TValue = unknown> = SyncAdapterConflict<TValue>;
export type WebDavSyncConflictDecision = SyncAdapterConflictDecision;
export type WebDavConflictResolution = SyncAdapterConflictResolution;
export type WebDavSyncMode = SyncAdapterMode;
export type WebDavSyncAdapterResult = SyncAdapterResult;
export type WebDavSyncAdapterScope = SyncAdapterScope;
export type WebDavSyncAdapterStatus = SyncAdapterStatus;

// ============================================================
// Engine: sync-service (通用同步服务，独立于具体存储后端)
// ============================================================
export {
  createSyncService,
} from "./engine/sync-service";
export type {
  SyncService,
  SyncServiceOptions,
  SyncServicePhase,
  SyncServiceStatus,
  SyncMaintenanceTask,
  SyncRequestActivity,
  SyncLocalChange,
  SyncInitialPlan,
  SyncInitialBatch,
  SyncAdapterRequest,
  SyncClientRequestOptions,
  SyncServiceSaveState,
} from "./engine/sync-service";

// AI-CORRECTION 2026-07-30: 旧名称向后兼容。
import type {
  SyncService,
  SyncServiceOptions,
  SyncServicePhase,
  SyncServiceStatus,
  SyncMaintenanceTask,
  SyncRequestActivity,
  SyncLocalChange,
  SyncInitialPlan,
  SyncInitialBatch,
  SyncAdapterRequest,
  SyncClientRequestOptions,
  SyncServiceSaveState,
} from "./engine/sync-service";
import { createSyncService } from "./engine/sync-service";
export const createWebDavSyncService = createSyncService;
export type WebDavSyncService = SyncService;
export type WebDavSyncServiceOptions = SyncServiceOptions;
export type WebDavSyncServicePhase = SyncServicePhase;
export type WebDavSyncServiceStatus = SyncServiceStatus;
export type WebDavSyncMaintenanceTask = SyncMaintenanceTask;
export type WebDavSyncRequestActivity = SyncRequestActivity;
export type WebDavLocalChange = SyncLocalChange;
export type WebDavInitialSyncPlan = SyncInitialPlan;
export type WebDavInitialSyncBatch = SyncInitialBatch;
export type WebDavSyncAdapterRequest = SyncAdapterRequest;
export type WebDavSyncClientRequestOptions = SyncClientRequestOptions;
export type WebDavSyncSaveState = SyncServiceSaveState;
export type WebDavSyncTrigger = import("@/domain/sync").SyncRunReason;

// ============================================================
// Clients: 通用存储客户端接口
// ============================================================
export type {
  SyncStorageClient,
  SyncClientOptions,
  SyncWriteOptions,
  SyncReadOptions,
  SyncTextFile,
  SyncResourceStat,
} from "./clients/types";

// AI-CORRECTION 2026-07-30: 旧名称向后兼容。
import type {
  SyncStorageClient,
  SyncClientOptions,
  SyncWriteOptions,
  SyncReadOptions,
  SyncTextFile,
  SyncResourceStat,
} from "./clients/types";
export type WebDavStorageClient = SyncStorageClient;
export type WebDavClientOptions = SyncClientOptions;
export type WebDavWriteOptions = SyncWriteOptions;
export type WebDavReadOptions = SyncReadOptions;
export type WebDavTextFile = SyncTextFile;
export type WebDavResourceStat = SyncResourceStat;

// ============================================================
// Clients: WebDAV 具体实现
// ============================================================
export {
  createWebDavStorageClient,
} from "./clients/webdav/webdav-client";

export {
  createWebDavWorkerStorageClient,
} from "./clients/webdav/webdav-worker-client";
export type {
  WebDavWorkerRequestActivity,
  WebDavWorkerStorageClientOptions,
} from "./clients/webdav/webdav-worker-client";

// ============================================================
// Storage
// ============================================================
export {
  clearWebDavLastSeenRemoteEtag,
  clearWebDavLastSyncedContentHash,
  readWebDavLastSeenRemoteEtag,
  readWebDavLastSeenRemoteRevision,
  readWebDavLastSyncedContentHash,
  WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY,
  writeWebDavLastSeenRemoteEtag,
  writeWebDavLastSeenRemoteRevision,
  writeWebDavLastSyncedContentHash,
} from "./storage/webdav-sync-metadata";

export {
  DEFAULT_WEBDAV_MAX_CONCURRENT_REQUESTS,
  MAX_WEBDAV_MAX_CONCURRENT_REQUESTS,
  MIN_WEBDAV_MAX_CONCURRENT_REQUESTS,
  readWebDavSyncSettings,
  subscribeToWebDavSyncSettingsChanges,
  writeWebDavSyncSettings,
} from "./storage/webdav-sync-settings";
export type {
  WebDavSyncSettings,
  WebDavSyncSettingsChangeListener,
} from "./storage/webdav-sync-settings";
