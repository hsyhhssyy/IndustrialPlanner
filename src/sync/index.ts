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
  SyncDownloadDirtyAbortError,
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
  SyncAdapterSyncOptions,
  SyncEngineTransaction,
  SyncLocalChangeState,
  SyncPlanItem,
  SyncPlanItemKind,
  SyncPlanUpload,
} from "./engine/sync-adapters";

// AI-CORRECTION 2026-07-30: 以下旧名称保持向后兼容。
// AI-REMOVED 2026-08-13:
// Reason: 删除指向通用引擎类型的 WebDAV 兼容别名。
// Trigger: 用户要求删除带 WebDAV 字样但实为公共内容的命名，项目未上线无需兼容。
// Evidence: 全部消费方（sync-host、测试）已改为直接使用 SyncAdapter 系列类型。
// Replacement: 上方的 SyncAdapter / SyncAdapterConflict / SyncAdapterMode 等通用导出。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import type {
//   SyncAdapter,
//   SyncAdapterConflict,
//   SyncAdapterConflictDecision,
//   SyncAdapterConflictResolution,
//   SyncAdapterMode,
//   SyncAdapterResult,
//   SyncAdapterScope,
//   SyncAdapterStatus,
// } from "./engine/sync-adapters";
// export type WebDavSyncAdapter = SyncAdapter;
// export type WebDavSyncConflict<TValue = unknown> = SyncAdapterConflict<TValue>;
// export type WebDavSyncConflictDecision = SyncAdapterConflictDecision;
// export type WebDavConflictResolution = SyncAdapterConflictResolution;
// export type WebDavSyncMode = SyncAdapterMode;
// export type WebDavSyncAdapterResult = SyncAdapterResult;
// export type WebDavSyncAdapterScope = SyncAdapterScope;
// export type WebDavSyncAdapterStatus = SyncAdapterStatus;

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
// AI-REMOVED 2026-08-13:
// Reason: 删除指向通用同步服务的 WebDAV 兼容别名。
// Trigger: 用户要求删除带 WebDAV 字样但实为公共内容的命名，项目未上线无需兼容。
// Evidence: 全部消费方（sync-host、测试）已改为直接使用 createSyncService / SyncService 系列。
// Replacement: 上方 createSyncService 与 SyncService / SyncServiceOptions 等通用导出。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import type {
//   SyncService,
//   SyncServiceOptions,
//   SyncServicePhase,
//   SyncServiceStatus,
//   SyncMaintenanceTask,
//   SyncRequestActivity,
//   SyncLocalChange,
//   SyncInitialPlan,
//   SyncInitialBatch,
//   SyncAdapterRequest,
//   SyncClientRequestOptions,
//   SyncServiceSaveState,
// } from "./engine/sync-service";
// import { createSyncService } from "./engine/sync-service";
// export const createWebDavSyncService = createSyncService;
// export type WebDavSyncService = SyncService;
// export type WebDavSyncServiceOptions = SyncServiceOptions;
// export type WebDavSyncServicePhase = SyncServicePhase;
// export type WebDavSyncServiceStatus = SyncServiceStatus;
// export type WebDavSyncMaintenanceTask = SyncMaintenanceTask;
// export type WebDavSyncRequestActivity = SyncRequestActivity;
// export type WebDavLocalChange = SyncLocalChange;
// export type WebDavInitialSyncPlan = SyncInitialPlan;
// export type WebDavInitialSyncBatch = SyncInitialBatch;
// export type WebDavSyncAdapterRequest = SyncAdapterRequest;
// export type WebDavSyncClientRequestOptions = SyncClientRequestOptions;
// export type WebDavSyncSaveState = SyncServiceSaveState;

// ============================================================
// Clients: 通用存储客户端接口
// ============================================================
export type {
  RemoteApplyResult,
  RemoteAssetContent,
  RemoteAssetMeta,
  RemoteAssetPutParams,
  RemoteAssetRef,
  RemoteAssetTombstoneParams,
  RemoteCheckResult,
  RemoteCollectionIndex,
  RemoteWriteBatchResult,
  RemoteWriteResult,
  SyncAssetType,
  SyncContentHashRequest,
  SyncHashAlgorithm,
  SyncLocalState,
  SyncRemote,
  SyncRemoteAdapterMode,
  SyncRemoteAssetIdCodec,
  SyncRemoteCollection,
  SyncRemoteSession,
  SyncRemoteSessionContext,
  SyncRemoteWebDavBinding,
  SyncRemoteWriteBatch,
} from "./clients";
export {
  isRemoteSyncStaleError,
  RemoteDownloadStaleError,
  RemoteWriteConflictError,
} from "./clients";

export {
  createSyncAssetKey,
  createSyncRemoteCollection,
} from "./remote-collections";

export type {
  SyncStorageClient,
  SyncClientOptions,
  SyncWriteOptions,
  SyncReadOptions,
  SyncTextFile,
  SyncResourceStat,
} from "./clients/types";

// AI-CORRECTION 2026-07-30: 旧名称向后兼容。
// AI-REMOVED 2026-08-13:
// Reason: 删除指向通用客户端类型的 WebDAV 兼容别名。
// Trigger: 用户要求删除带 WebDAV 字样但实为公共内容的命名，项目未上线无需兼容。
// Evidence: 全部消费方（worker-client、worker-runtime、测试）已改为直接使用 Sync* 类型。
// Replacement: 上方 SyncStorageClient / SyncClientOptions 等通用导出。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import type {
//   SyncStorageClient,
//   SyncClientOptions,
//   SyncWriteOptions,
//   SyncReadOptions,
//   SyncTextFile,
//   SyncResourceStat,
// } from "./clients/types";
// export type WebDavStorageClient = SyncStorageClient;
// export type WebDavClientOptions = SyncClientOptions;
// export type WebDavWriteOptions = SyncWriteOptions;
// export type WebDavReadOptions = SyncReadOptions;
// export type WebDavTextFile = SyncTextFile;
// export type WebDavResourceStat = SyncResourceStat;

export type { SyncRunReason } from "@/domain/sync";

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

export {
  createWebDavSyncRemote,
  WebDavSyncRemote,
  type WebDavSyncRemoteOptions,
} from "./clients/webdav/webdav-remote";

// ============================================================
// Storage
// ============================================================
export {
  clearLastSeenRemoteRevision,
  clearLastSeenRemoteEtag,
  clearLastSyncedContentHash,
  clearSyncMetadata,
  readLastSeenRemoteEtag,
  readLastSeenRemoteRevision,
  readLastSyncedContentHash,
  SYNC_METADATA_LOCAL_STORAGE_KEY,
  writeLastSeenRemoteEtag,
  writeLastSeenRemoteRevision,
  writeLastSyncedContentHash,
} from "./storage/sync-metadata";

export {
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  MAX_MAX_CONCURRENT_REQUESTS,
  MIN_MAX_CONCURRENT_REQUESTS,
  readSyncConnectionSettings,
  subscribeToSyncConnectionSettingsChanges,
  writeSyncConnectionSettings,
} from "./storage/sync-connection-settings";
export type {
  SyncConnectionSettings,
  SyncConnectionSettingsChangeListener,
} from "./storage/sync-connection-settings";
