// AI-REMOVED 2026-08-08:
// Reason: Sync Shadow 基础设施已整体移除（ST2-RQ-008）。
// Trigger: Shadow replay 验证不再需要。
// Evidence: createSyncShadowReplayValidator 调用已从 document-storage.ts 移除。
// Replacement: None。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { appendLocalSyncDiagnosticEvent, compactWorldDocumentShadowOutbox,
//   markWorldDocumentShadowEntryValidated, type LocalSyncDataOwner,
//   type LocalSyncOutboxEntry } from "@/shared/storage";
// import { ENABLE_LOCAL_SYNC_SHADOW_MODE } from "@/shared/storage/sync-shadow-build-flags";
// import type { WorldDocument } from "@/domain/document/world-document";
// import type { SyncShadowReplayWorkerRequest, SyncShadowReplayWorkerResponse } from "./sync-shadow-replay-worker";
//
// export interface SyncShadowReplayValidationInput { ... }
// export interface SyncShadowReplayValidator { validate(input): void; dispose(): void; }
// export function createSyncShadowReplayValidator(): SyncShadowReplayValidator { ... }
// (complete original omitted; see git history)
