export {
  applyIndexedDbTransactionMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export {
  clearAllStorageAndReload,
  estimateTotalStorageBytes,
  formatStorageBytesToMB,
} from "@/shared/storage/browser-storage-estimate";

export type {
  BlueprintDirectoryListing,
  BlueprintFolderRecord,
  BlueprintReadOptions,
  BlueprintRecord,
  BlueprintStorageEntry,
  CreateBlueprintFolderInput,
  RenameBlueprintFolderInput,
  SaveBlueprintOptions,
  UpsertBlueprintFolderInput,
} from "@/shared/storage/blueprint-storage";

export {
  createBlueprintFolder,
  deleteBlueprintFolder,
  deleteBlueprintDocument,
  listBlueprintDirectory,
  listBlueprintStorageEntries,
  readBlueprintFolder,
  readBlueprintRecord,
  renameBlueprintFolder,
  saveBlueprintDocument,
  upsertBlueprintStorageEntry,
  upsertBlueprintFolder,
  BLUEPRINT_STORE_LOCATION,
} from "@/shared/storage/blueprint-storage";

export type {
  ConvertLegacyBlueprintOptions,
  LegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

export {
  convertLegacyBlueprintJson,
  normalizeLegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

export type {
  LegacyV2BlueprintLinkSnapshot,
  LegacyV2BlueprintSnapshot,
  LegacyV2DeviceSnapshot,
  LegacyV2LayoutLinkSnapshot,
  LegacyV2LayoutSnapshot,
} from "@/shared/storage/legacy-v2-blueprint-migration";

export {
  convertLegacyV2LayoutToBlueprintDocument,
  convertLegacyV2LayoutToWorldDocument,
  createLegacyBlueprintJsonFromV2BlueprintSnapshot,
  createLegacyBlueprintJsonFromV2Layout,
  createWorldDocumentFromMigratedBlueprint,
  filterLegacyV2LayoutBaseBuiltinEntities,
  normalizeLegacyV2BlueprintSnapshotsStorage,
  normalizeLegacyV2LayoutsByBaseStorage,
} from "@/shared/storage/legacy-v2-blueprint-migration";

export type {
  IndexedDbDatabaseLocation,
  IndexedDbStoreMutationBatch,
  IndexedDbStoreLocation,
  IndexedDbStorageLocation,
  IndexedDbMutationOperation,
  JsonStorageCodec,
} from "@/shared/storage/browser-storage";

export type {
  LocalAccountImportRequiredDecision,
  LocalAccountImportResolution,
  LocalAccountRemoteDatasetStatus,
  LocalSyncDataOwner,
  LocalSyncOwnerKind,
  LocalSyncOwnerState,
  LocalPendingAccountImport,
  LocalCompletedAccountImport,
} from "@/shared/storage/sync-owner-storage";

export {
  activateAccountOwnerAfterImport,
  areLocalSyncDataOwnersEqual,
  createLocalSyncOwnerScopeKey,
  ensureLocalSyncOwnerState,
  normalizeLocalSyncDataOwner,
  readLocalSyncOwnerState,
  recordPendingAccountImportDecision,
  SYNC_OWNER_STATE_STORE_LOCATION,
} from "@/shared/storage/sync-owner-storage";

export type {
  LocalDocumentSyncState,
  LocalSyncCompactSummary,
  LocalSyncDiagnosticCategory,
  LocalSyncDiagnosticEvent,
  LocalSyncDiagnosticSeverity,
  LocalSyncShadowSaveResult,
  LocalSyncOutboxEntry,
  LocalSyncOutboxEntryStatus,
  WorldDocumentShadowDeltaPayload,
  WorldDocumentShadowOperationPayload,
  WorldDocumentShadowSnapshotPayload,
} from "@/shared/storage/sync-shadow-storage";

export {
  appendLocalSyncDiagnosticEvent,
  compactWorldDocumentShadowOutbox,
  createSha256CanonicalHash,
  createStableJsonHash,
  listLocalSyncCompactSummaries,
  listLocalSyncDiagnosticEvents,
  listLocalSyncOutboxEntriesForAsset,
  markWorldDocumentShadowEntryValidated,
  markWorldDocumentShadowEntriesValidated,
  readLocalDocumentSyncState,
  SYNC_SHADOW_COMPACT_SUMMARY_STORE_LOCATION,
  SYNC_SHADOW_DIAGNOSTIC_STORE_LOCATION,
  SYNC_SHADOW_OUTBOX_STORE_LOCATION,
  SYNC_SHADOW_STATE_STORE_LOCATION,
  writeWorldDocumentShadowSave,
  writeWorldDocumentShadowSaveWithResult,
  writeWorldDocumentWithShadowSave,
} from "@/shared/storage/sync-shadow-storage";

export {
  ENABLE_LOCAL_SYNC_SHADOW_MODE,
  ENABLE_LOCAL_SYNC_TELEMETRY_UPLOAD,
} from "@/shared/storage/sync-shadow-build-flags";

export type {
  JsonPatchOperation,
} from "@/shared/storage/json-patch-codec";

export {
  applyJsonPatch,
  generateJsonPatch,
} from "@/shared/storage/json-patch-codec";

// AI-REMOVED 2026-07-29:
// Reason: WebDAV 客户端、worker、同步引擎和设置存储属于顶层 sync 模块，不是跨业务共享工具。
// Trigger: 用户要求同步模块自行订阅业务快照，并禁止 app/editor 主动驱动 WebDAV 客户端。
// Evidence: 这些导出会允许任意模块绕过 SyncContract 直接发起网络请求。
// Replacement: src/sync/index.ts；业务 UI 通过 WorkspaceContract.sync 访问公开状态与 action。
// Risk: Low；原实现完整迁移到 src/sync，shared 仍保留纯存储、patch 与 hash 能力。
// Human Review: Required
//
// Original code:
// export type { WebDavClientOptions, WebDavReadOptions, WebDavResourceStat,
//   WebDavStorageClient, WebDavTextFile, WebDavWriteOptions } from "@/shared/storage/webdav-client";
// export { createWebDavStorageClient } from "@/shared/storage/webdav-client";
// export type { WebDavWorkerStorageClientOptions } from "@/shared/storage/webdav-worker-client";
// export { createWebDavWorkerStorageClient } from "@/shared/storage/webdav-worker-client";
// export type { FullNoRevisionAdapterOptions, FullWithRevisionAdapterOptions,
//   FullWithRevisionEntry, PatchWithRevisionAdapterOptions, WebDavConflictResolution,
//   WebDavSyncAdapter, WebDavSyncAdapterResult, WebDavSyncAdapterStatus,
//   WebDavSyncConflict, WebDavSyncMode, PatchCollectionWithRevisionAdapterOptions,
//   PatchWithRevisionEntry } from "@/shared/storage/webdav-sync-adapters";
// export { createFullNoRevisionAdapter, createFullWithRevisionAdapter,
//   createPatchCollectionWithRevisionAdapter,
//   createPatchWithRevisionAdapter } from "@/shared/storage/webdav-sync-adapters";

export type {
  StorageAssetType,
  StorageChangeEvent,
  StorageChangeListener,
} from "@/shared/storage/storage-change-event";

export {
  emitStorageChange,
  subscribeToStorageChanges,
} from "@/shared/storage/storage-change-event";

// AI-REMOVED 2026-07-29:
// Reason: 同步服务、同步元数据和 WebDAV 设置已迁移到顶层 sync 模块。
// Trigger: 同步生命周期与公开状态必须由独立模块持有。
// Evidence: shared 聚合导出会破坏顶层模块隔离并让设置页直接操作持久化实现。
// Replacement: src/sync/index.ts；设置页使用 SyncAction.updateSettings。
// Risk: Low；仅收紧导出边界，持久化 key 与数据兼容性保持不变。
// Human Review: Required
//
// Original code:
// export type { WebDavSyncService, WebDavSyncServiceOptions, WebDavSyncServicePhase,
//   WebDavSyncSaveState, WebDavSyncServiceStatus,
//   WebDavSyncTrigger } from "@/shared/storage/webdav-sync-service";
// export { createWebDavSyncService } from "@/shared/storage/webdav-sync-service";
// export { clearWebDavLastSyncedContentHash, readWebDavLastSyncedContentHash,
//   WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY,
//   writeWebDavLastSyncedContentHash } from "@/shared/storage/webdav-sync-metadata";
// export type { WebDavSyncSettings,
//   WebDavSyncSettingsChangeListener } from "@/shared/storage/webdav-sync-settings";
// export { readWebDavSyncEnabled, readWebDavSyncPassword, readWebDavSyncSettings,
//   readWebDavSyncUrl, readWebDavSyncUsername, WEBDAV_SYNC_SETTINGS_LOCAL_STORAGE_KEY,
//   subscribeToWebDavSyncSettingsChanges, writeWebDavSyncEnabled,
//   writeWebDavSyncPassword, writeWebDavSyncSettings, writeWebDavSyncUrl,
//   writeWebDavSyncUsername } from "@/shared/storage/webdav-sync-settings";

export type {
  LocalSyncTelemetryCompactSummary,
  LocalSyncTelemetryDiagnosticEvent,
  LocalSyncTelemetryPayload,
  LocalSyncTelemetryUploadResult,
  LocalSyncTelemetryUploadStatus,
} from "@/shared/storage/sync-telemetry-upload";

export {
  createLocalSyncTelemetryPayload,
  tryUploadLocalSyncTelemetry,
} from "@/shared/storage/sync-telemetry-upload";

export type {
  EditorPersistState,
} from "@/shared/storage/editor-persist-state-storage";

export {
  EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
  normalizeEditorPersistState,
  readEditorPersistState,
  writeEditorPersistState,
} from "@/shared/storage/editor-persist-state-storage";

export {
  listLatestWorldDocumentsByBase,
  listWorldDocuments,
  normalizeWorldDocument,
  readWorldDocument,
  replaceWorldDocuments,
  resolveLatestWorldDocumentForBase,
  writeWorldDocument,
  WORLD_DOCUMENT_DATABASE_LOCATION,
} from "@/shared/storage/world-document-storage";

export {
  readFromIndexedDbWithMigration,
  readFromLocalStorageWithMigration,
  saveToIndexedDbWithVersion,
  saveToLocalStorageWithVersion,
} from "@/shared/storage/migration";

export type {
  StorageMigration,
} from "@/shared/storage/migration";

export type {
  PlannerFlowViewportState,
  PlannerPersistedState,
  PlannerSessionState,
} from "@/shared/storage/planner-storage";

export {
  createDefaultPlannerSessionState,
  loadPlannerState,
  normalizePlannerPersistedState,
  normalizePlannerSessionState,
  savePlannerState,
} from "@/shared/storage/planner-storage";
