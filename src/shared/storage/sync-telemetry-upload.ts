// AI-REMOVED 2026-08-08:
// Reason: Sync Shadow 基础设施已整体移除（ST2-RQ-008）。遥测上传逻辑已迁移到 sync-telemetry-worker.ts。
// Trigger: 遥测数据源（Shadow diagnostics）已移除。ENABLE_LOCAL_SYNC_TELEMETRY_UPLOAD flag 已在 9dcccc16 中移除。
// Evidence: 所有调用方（document-storage.ts、sync-shadow-replay-validator.ts）已在 9dcccc16 和 ST2-RQ-008 中移除。
// Replacement: src/shared/storage/sync-telemetry-worker.ts — 独立 Worker，通过 postMessage 推送 payload。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { ENABLE_LOCAL_SYNC_TELEMETRY_UPLOAD } from "./sync-shadow-build-flags";
// import { createLocalSyncOwnerScopeKey, ensureLocalSyncOwnerState } from "./sync-owner-storage";
// import { createStableJsonHash, listLocalSyncCompactSummaries, listLocalSyncDiagnosticEvents } from "./sync-shadow-storage";
// import { resolveBackendApiBaseUrl } from "./backend-api-address";
//
// export type LocalSyncTelemetryUploadStatus = "disabled" | "skipped" | "unavailable" | "uploaded" | "failed";
// export interface LocalSyncTelemetryUploadResult { ... }
// export interface LocalSyncTelemetryPayload { ... }
// export interface LocalSyncTelemetryDiagnosticEvent { ... }
// export interface LocalSyncTelemetryCompactSummary { ... }
// export async function tryUploadLocalSyncTelemetry(options): Promise<LocalSyncTelemetryUploadResult> { ... }
// export async function createLocalSyncTelemetryPayload(options): Promise<LocalSyncTelemetryPayload> { ... }
// (complete original omitted; see git history)
