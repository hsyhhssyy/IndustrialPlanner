// AI-REMOVED 2026-08-08:
// Reason: Sync Shadow 基础设施已整体移除（ST2-RQ-008）。
// Trigger: Shadow replay 验证不再需要。
// Evidence: createSyncShadowReplayValidator 调用已从 document-storage.ts 移除。
// Replacement: None。
// Risk: Low。
// Human Review: Required
//
// Original code:
// /// <reference lib="webworker" />
//
// import type { WorldDocument } from "@/domain/document/world-document";
// import type { EditorHistoryDocumentDelta } from "@/domain/editor/editor-history";
// import { createStableJsonHash } from "@/shared/storage/sync-shadow-storage";
// import { applyWorldDocumentDelta } from "./history";
//
// export interface SyncShadowReplayWorkerRequest { ... }
// export type SyncShadowReplayWorkerResponse = ...;
// export function validateWorldDocumentShadowReplay(request) { ... }
// (complete original omitted; see git history)
