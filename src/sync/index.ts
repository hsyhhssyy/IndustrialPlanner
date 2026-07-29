export {
  createSyncHost,
  type SyncHost,
  type SyncHostOptions,
} from "./sync-host";

export {
  createFullNoRevisionAdapter,
  createFullWithRevisionAdapter,
  createPatchCollectionWithRevisionAdapter,
  createPatchWithRevisionAdapter,
} from "./engine/webdav-sync-adapters";
export type {
  FullNoRevisionAdapterOptions,
  FullWithRevisionAdapterOptions,
  FullWithRevisionEntry,
  PatchCollectionWithRevisionAdapterOptions,
  PatchWithRevisionAdapterOptions,
  PatchWithRevisionEntry,
  WebDavConflictResolution,
  WebDavSyncAdapter,
  WebDavSyncAdapterResult,
  WebDavSyncAdapterStatus,
  WebDavSyncConflict,
  WebDavSyncMode,
} from "./engine/webdav-sync-adapters";

export {
  createWebDavStorageClient,
} from "./webdav/webdav-client";

export {
  createWebDavWorkerStorageClient,
} from "./webdav/webdav-worker-client";
export type {
  WebDavWorkerRequestActivity,
  WebDavWorkerStorageClientOptions,
} from "./webdav/webdav-worker-client";

export {
  createWebDavSyncService,
} from "./engine/webdav-sync-service";
export type {
  WebDavSyncService,
  WebDavSyncMaintenanceTask,
  WebDavSyncServiceOptions,
  WebDavSyncServicePhase,
  WebDavSyncRequestActivity,
  WebDavSyncSaveState,
  WebDavSyncServiceStatus,
  WebDavSyncTrigger,
} from "./engine/webdav-sync-service";

export {
  clearWebDavLastSyncedContentHash,
  readWebDavLastSeenRemoteRevision,
  readWebDavLastSyncedContentHash,
  WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY,
  writeWebDavLastSeenRemoteRevision,
  writeWebDavLastSyncedContentHash,
} from "./storage/webdav-sync-metadata";

export {
  DEFAULT_WEBDAV_MAX_CONCURRENT_REQUESTS,
  MAX_WEBDAV_MAX_CONCURRENT_REQUESTS,
  MIN_WEBDAV_MAX_CONCURRENT_REQUESTS,
  readWebDavSyncEnabled,
  readWebDavSyncPassword,
  readWebDavSyncSettings,
  readWebDavSyncUrl,
  readWebDavSyncUsername,
  subscribeToWebDavSyncSettingsChanges,
  WEBDAV_SYNC_SETTINGS_LOCAL_STORAGE_KEY,
  writeWebDavSyncEnabled,
  writeWebDavSyncPassword,
  writeWebDavSyncSettings,
  writeWebDavSyncUrl,
  writeWebDavSyncUsername,
} from "./storage/webdav-sync-settings";
export type {
  WebDavSyncSettings,
  WebDavSyncSettingsChangeListener,
} from "./storage/webdav-sync-settings";
export type {
  WebDavClientOptions,
  WebDavReadOptions,
  WebDavResourceStat,
  WebDavStorageClient,
  WebDavTextFile,
  WebDavWriteOptions,
} from "./webdav/webdav-client";
