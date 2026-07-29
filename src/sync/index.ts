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
  WebDavWorkerStorageClientOptions,
} from "./webdav/webdav-worker-client";

export {
  createWebDavSyncService,
} from "./engine/webdav-sync-service";
export type {
  WebDavSyncService,
  WebDavSyncServiceOptions,
  WebDavSyncServicePhase,
  WebDavSyncSaveState,
  WebDavSyncServiceStatus,
  WebDavSyncTrigger,
} from "./engine/webdav-sync-service";

export {
  clearWebDavLastSyncedContentHash,
  readWebDavLastSyncedContentHash,
  WEBDAV_SYNC_METADATA_LOCAL_STORAGE_KEY,
  writeWebDavLastSyncedContentHash,
} from "./storage/webdav-sync-metadata";

export {
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
