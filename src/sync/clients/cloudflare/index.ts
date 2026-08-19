// AI-REMOVED 2026-08-12:
// Reason: 该入口指向主线程直连 HTTP 的 cf-sync-v2 实现。
// Trigger: Cloudflare 同步计算与上传必须迁入 Dedicated Worker，并在标签页隐藏后继续执行。
// Evidence: cloudflare-v2-remote.ts 只保留值语义适配，网络与内容处理由 v2 Worker runtime 执行。
// Replacement: 下方 cloudflare-v2-remote 导出。
// Risk: Low；旧文件保留为未启用历史实现，便于审计。
// Human Review: Required
//
// Original code:
// export { CloudflareSyncRemote, createCloudflareSyncRemote } from "./cloudflare-remote";
// export type { CloudflareSyncRemoteOptions } from "./cloudflare-remote";
export { CloudflareSyncRemote, createCloudflareSyncRemote } from "./cloudflare-v2-remote";
export type { CloudflareSyncRemoteOptions } from "./cloudflare-v2-remote";
export {
  CloudflareV2WorkerClient,
  type CloudflareV2WorkerActivity,
  type CloudflareV2WorkerBridge,
  type CloudflareV2WorkerClientOptions,
} from "./cloudflare-v2-worker-client";
export {
  initializeCloudflareSpaceSettings,
  type InitializeCloudflareSpaceSettingsOptions,
} from "./cloudflare-space-settings";
