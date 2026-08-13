export {
  createWebDavStorageClient,
  normalizeWebDavRootPath,
  // AI-CORRECTION 2026-07-30: 以下类型别名指向 ../types 的通用接口。
  // AI-CORRECTION 2026-08-13: 别名已删除（见 webdav-client.ts 的 AI-REMOVED 2026-08-13），
  // 通用类型请直接从 ../types 或顶层 sync 公共出口导入。
} from "./webdav-client";

export {
  createWebDavSyncRemote,
  WebDavSyncRemote,
  type WebDavSyncRemoteOptions,
} from "./webdav-remote";
