export {
  createWebDavStorageClient,
  normalizeWebDavRootPath,
  // AI-CORRECTION 2026-07-30: 以下类型别名指向 ../types 的通用接口。
  type WebDavStorageClient,
  type WebDavWriteOptions,
  type WebDavClientOptions,
  type WebDavReadOptions,
  type WebDavTextFile,
  type WebDavResourceStat,
} from "./webdav-client";

export {
  createWebDavSyncRemote,
  WebDavSyncRemote,
  type WebDavSyncRemoteOptions,
} from "./webdav-remote";
