// AI-REMOVED 2026-08-08:
// Reason: Sync Shadow 基础设施已整体移除（ST2-RQ-008）。
// Trigger: WebDAV 和 Cloudflare Worker 同步已成型，Shadow 预演机制（outbox entry、diagnostic event、compact summary、replay 验证）不再需要。
// Evidence: document-storage.ts 和 sync-shadow-replay-validator.ts 中的 Shadow 调用已全部移除。
// Replacement:
//   - createStableJsonHash + createSha256CanonicalHash → src/shared/storage/hash-utils.ts
//   - 遥测上传 → src/shared/storage/sync-telemetry-worker.ts
// Risk: Low。同步模块（sync-host.ts、sync-adapters.ts、webdav-remote.ts、cloudflare-worker-runtime.ts）已改为从 hash-utils.ts 导入。
// Human Review: Required
//
// Original file contained:
// - IndexedDB store locations (SYNC_SHADOW_OUTBOX_STORE_LOCATION, etc.)
// - LocalSyncOutboxEntry / LocalSyncOutboxEntryStatus types
// - WorldDocumentShadowOperationPayload / WorldDocumentShadowSnapshotPayload / WorldDocumentShadowDeltaPayload types
// - LocalDocumentSyncState type
// - LocalSyncDiagnosticEvent / LocalSyncCompactSummary types
// - writeWorldDocumentWithShadowSave / writeWorldDocumentShadowSave / writeWorldDocumentShadowSaveWithResult
// - readLocalDocumentSyncState / listLocalSyncOutboxEntriesForAsset
// - markWorldDocumentShadowEntriesValidated / markWorldDocumentShadowEntryValidated
// - compactWorldDocumentShadowOutbox
// - appendLocalSyncDiagnosticEvent / listLocalSyncDiagnosticEvents / listLocalSyncCompactSummaries
// - createStableJsonHash / createSha256CanonicalHash (extracted to hash-utils.ts)
// - Internal helpers: stableStringify, hashStringFNV1a32, normalizeTimestamp, etc.
// (complete original omitted; see git history)
