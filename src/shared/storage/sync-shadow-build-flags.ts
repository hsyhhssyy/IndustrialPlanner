// AI-REMOVED 2026-08-08:
// Reason: Sync Shadow 基础设施已整体移除（ST2-RQ-008）。
// Trigger: WebDAV 和 Cloudflare Worker 同步已成型，Shadow 预演机制不再需要。
// Evidence: ENABLE_LOCAL_SYNC_SHADOW_MODE 在 document-storage.ts 和 replay-validator.ts 中的使用已全部移除。
// Replacement: None。
// Risk: Low。
// Human Review: Required
//
// Original code:
// export const ENABLE_LOCAL_SYNC_SHADOW_MODE = true;
