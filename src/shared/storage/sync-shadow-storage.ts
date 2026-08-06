import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorHistoryDocumentDelta } from "@/domain/editor/editor-history";
import { createUuid } from "@/domain/shared/uuid";

import {
  applyIndexedDbTransactionMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbStoreLocation,
} from "./browser-storage";
import { ENABLE_LOCAL_SYNC_SHADOW_MODE } from "./sync-shadow-build-flags";
import {
  areLocalSyncDataOwnersEqual,
  createLocalSyncOwnerScopeKey,
  ensureLocalSyncOwnerState,
  normalizeLocalSyncDataOwner,
  type LocalSyncDataOwner,
} from "./sync-owner-storage";

const SYNC_SHADOW_DATABASE_NAME = "v3-industrial-planner";
const SYNC_SHADOW_OUTBOX_STORE_NAME = "sync-shadow-outbox";
const SYNC_SHADOW_STATE_STORE_NAME = "sync-shadow-state";
const SYNC_SHADOW_DIAGNOSTIC_STORE_NAME = "sync-shadow-diagnostics";
const SYNC_SHADOW_COMPACT_SUMMARY_STORE_NAME = "sync-shadow-compact-summary";
const SYNC_SHADOW_MAX_OUTBOX_ENTRIES_PER_ASSET = 200;
const SYNC_SHADOW_MAX_DIAGNOSTIC_EVENTS = 1000;
const SYNC_SHADOW_MAX_REPLAY_MISMATCH_EVENTS = 100;
const SYNC_SHADOW_MAX_COMPACT_SUMMARIES = 200;
const SYNC_SHADOW_DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const SYNC_SHADOW_REPLAY_MISMATCH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_SHADOW_SCHEMA_VERSION = 1;

export const SYNC_SHADOW_OUTBOX_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_SHADOW_DATABASE_NAME,
  storeName: SYNC_SHADOW_OUTBOX_STORE_NAME,
};

export const SYNC_SHADOW_STATE_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_SHADOW_DATABASE_NAME,
  storeName: SYNC_SHADOW_STATE_STORE_NAME,
};

export const SYNC_SHADOW_DIAGNOSTIC_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_SHADOW_DATABASE_NAME,
  storeName: SYNC_SHADOW_DIAGNOSTIC_STORE_NAME,
};

export const SYNC_SHADOW_COMPACT_SUMMARY_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_SHADOW_DATABASE_NAME,
  storeName: SYNC_SHADOW_COMPACT_SUMMARY_STORE_NAME,
};

export type LocalSyncOutboxEntryStatus =
  | "pending"
  | "validated"
  | "uploading"
  | "synced"
  | "conflicted";

export interface LocalSyncOutboxEntry {
  readonly schemaVersion: number;
  readonly id: string;
  readonly owner: LocalSyncDataOwner;
  readonly deviceId: string;
  readonly assetType: "world-document";
  readonly assetId: string;
  readonly localChangeId: string;
  readonly localSequence: number;
  readonly baseRemoteRevision: string | null;
  readonly remoteRevision: string | null;
  readonly operationPayload: WorldDocumentShadowOperationPayload;
  readonly contentHash: string;
  readonly status: LocalSyncOutboxEntryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly retryAfter: string | null;
}

export interface WorldDocumentShadowSnapshotPayload {
  readonly type: "world-document.shadow-snapshot";
  readonly documentKey: string;
  readonly baseId: string;
  readonly schemaVersion: number;
  readonly entityCount: number;
  readonly slotLinkCount: number;
  readonly documentUpdatedAt: string;
}

export interface WorldDocumentShadowDeltaPayload {
  readonly type: "world-document.history-delta";
  readonly documentKey: string;
  readonly baseId: string;
  readonly schemaVersion: number;
  readonly entityCount: number;
  readonly slotLinkCount: number;
  readonly documentUpdatedAt: string;
  readonly baseContentHash: string;
  readonly targetContentHash: string;
  readonly delta: EditorHistoryDocumentDelta;
  readonly targetMeta: WorldDocument["meta"];
}

export type WorldDocumentShadowOperationPayload =
  | WorldDocumentShadowSnapshotPayload
  | WorldDocumentShadowDeltaPayload;

export interface LocalDocumentSyncState {
  readonly schemaVersion: number;
  readonly documentKey: string;
  readonly owner: LocalSyncDataOwner;
  readonly syncedRemoteRevision: string | null;
  readonly localHeadHash: string;
  readonly nextLocalSequence: number;
  readonly pendingOutboxCount: number;
  readonly hasUnsyncedChanges: boolean;
  readonly updatedAt: string;
}

export type LocalSyncDiagnosticSeverity = "info" | "warning" | "error";

export type LocalSyncDiagnosticCategory =
  | "shadow-save"
  | "replay"
  | "storage"
  | "account-import"
  | "compaction";

export interface LocalSyncDiagnosticEvent {
  readonly schemaVersion: number;
  readonly id: string;
  readonly owner: LocalSyncDataOwner;
  readonly severity: LocalSyncDiagnosticSeverity;
  readonly category: LocalSyncDiagnosticCategory;
  readonly code: string;
  readonly assetType: "world-document" | "sync-owner" | "unknown";
  readonly assetId: string | null;
  readonly localSequence: number | null;
  readonly details: Record<string, string | number | boolean | null>;
  readonly createdAt: string;
}

export interface LocalSyncCompactSummary {
  readonly schemaVersion: number;
  readonly id: string;
  readonly owner: LocalSyncDataOwner;
  readonly assetType: "world-document";
  readonly assetId: string;
  readonly fromLocalSequence: number;
  readonly toLocalSequence: number;
  readonly operationCount: number;
  readonly baseContentHash: string;
  readonly compactedAt: string;
}

export interface LocalSyncShadowSaveResult {
  readonly outboxEntry: LocalSyncOutboxEntry;
  readonly syncState: LocalDocumentSyncState;
}

export async function writeWorldDocumentWithShadowSave(options: {
  readonly document: WorldDocument;
  readonly documentStoreLocation: IndexedDbStoreLocation;
  readonly baseDocument?: WorldDocument;
  readonly delta?: EditorHistoryDocumentDelta | null;
  readonly deviceId?: string;
  readonly now?: string;
}): Promise<boolean> {
  return (await writeWorldDocumentShadowSaveInternal(options, options.documentStoreLocation)) !== null;
}

export async function writeWorldDocumentShadowSave(options: {
  readonly document: WorldDocument;
  readonly baseDocument?: WorldDocument;
  readonly delta?: EditorHistoryDocumentDelta | null;
  readonly deviceId?: string;
  readonly now?: string;
}): Promise<boolean> {
  return (await writeWorldDocumentShadowSaveInternal(options, null)) !== null;
}

export async function writeWorldDocumentShadowSaveWithResult(options: {
  readonly document: WorldDocument;
  readonly baseDocument?: WorldDocument;
  readonly delta?: EditorHistoryDocumentDelta | null;
  readonly deviceId?: string;
  readonly now?: string;
}): Promise<LocalSyncShadowSaveResult | null> {
  return await writeWorldDocumentShadowSaveInternal(options, null);
}

async function writeWorldDocumentShadowSaveInternal(
  options: {
    readonly document: WorldDocument;
    readonly baseDocument?: WorldDocument;
    readonly delta?: EditorHistoryDocumentDelta | null;
    readonly deviceId?: string;
    readonly now?: string;
  },
  documentStoreLocation: IndexedDbStoreLocation | null,
): Promise<LocalSyncShadowSaveResult | null> {
  if (!ENABLE_LOCAL_SYNC_SHADOW_MODE) {
    return null;
  }

  const document = options.document;
  const timestamp = options.now ?? new Date().toISOString();
  const ownerState = await ensureLocalSyncOwnerState({ now: timestamp });
  const owner = ownerState.activeOwner;
  const existingState = await readLocalDocumentSyncState(document.documentKey, { owner });
  const existingOutboxEntries = await listLocalSyncOutboxEntriesForAsset({
    assetType: "world-document",
    assetId: document.documentKey,
    owner,
  });
  const localSequence = normalizeNextLocalSequence(existingState?.nextLocalSequence);
  const contentHash = createStableJsonHash(document);
  const localChangeId = createUuid();
  const operationPayload = createWorldDocumentShadowOperationPayload({
    document,
    baseDocument: options.baseDocument,
    delta: options.delta,
    contentHash,
  });
  const outboxEntry: LocalSyncOutboxEntry = {
    schemaVersion: SYNC_SHADOW_SCHEMA_VERSION,
    id: createOutboxEntryId(owner, document.documentKey, localSequence, localChangeId),
    owner,
    deviceId: options.deviceId ?? ownerState.deviceId,
    assetType: "world-document",
    assetId: document.documentKey,
    localChangeId,
    localSequence,
    baseRemoteRevision: existingState?.syncedRemoteRevision ?? null,
    remoteRevision: null,
    operationPayload,
    contentHash,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    retryAfter: null,
  };
  const outboxEntryIdsToDelete = resolveShadowOutboxEntryIdsToDelete(
    existingOutboxEntries,
    SYNC_SHADOW_MAX_OUTBOX_ENTRIES_PER_ASSET - 1,
  );
  const pendingOutboxCount = existingOutboxEntries.length + 1 - outboxEntryIdsToDelete.length;
  const syncState: LocalDocumentSyncState = {
    schemaVersion: SYNC_SHADOW_SCHEMA_VERSION,
    documentKey: document.documentKey,
    owner,
    syncedRemoteRevision: existingState?.syncedRemoteRevision ?? null,
    localHeadHash: contentHash,
    nextLocalSequence: localSequence + 1,
    pendingOutboxCount,
    hasUnsyncedChanges: pendingOutboxCount > 0,
    updatedAt: timestamp,
  };

  const saved = await applyIndexedDbTransactionMutations<unknown>(
    {
      databaseName: documentStoreLocation?.databaseName ?? SYNC_SHADOW_DATABASE_NAME,
      version: documentStoreLocation?.version,
    },
    [
      ...(documentStoreLocation === null
        ? []
        : [{
          storeName: documentStoreLocation.storeName,
          operations: [{
            type: "put" as const,
            key: document.documentKey,
            value: document,
          }],
        }]),
      {
        storeName: SYNC_SHADOW_OUTBOX_STORE_NAME,
        operations: [
          ...outboxEntryIdsToDelete.map((entryId) => ({
            type: "delete" as const,
            key: entryId,
          })),
          {
            type: "put",
            key: outboxEntry.id,
            value: outboxEntry,
          },
        ],
      },
      {
        storeName: SYNC_SHADOW_STATE_STORE_NAME,
        operations: [{
          type: "put",
          key: createDocumentSyncStateKey(owner, document.documentKey),
          value: syncState,
        }],
      },
    ],
  );

  return saved
    ? {
      outboxEntry,
      syncState,
    }
    : null;
}

export async function readLocalDocumentSyncState(
  documentKey: string,
  options: {
    readonly owner?: LocalSyncDataOwner;
  } = {},
): Promise<LocalDocumentSyncState | null> {
  const owner = options.owner ?? (await ensureLocalSyncOwnerState()).activeOwner;
  const rawState = await readFromIndexedDb<unknown>({
    ...SYNC_SHADOW_STATE_STORE_LOCATION,
    key: createDocumentSyncStateKey(owner, documentKey),
  });
  const state = normalizeLocalDocumentSyncState(rawState, owner);

  if (state !== null) {
    return state;
  }

  const legacyRawState = await readFromIndexedDb<unknown>({
    ...SYNC_SHADOW_STATE_STORE_LOCATION,
    key: createLegacyDocumentSyncStateKey(documentKey),
  });

  return normalizeLocalDocumentSyncState(legacyRawState, owner);
}

export async function listLocalSyncOutboxEntriesForAsset(options: {
  readonly assetType: "world-document";
  readonly assetId: string;
  readonly owner?: LocalSyncDataOwner;
}): Promise<LocalSyncOutboxEntry[]> {
  const owner = options.owner ?? (await ensureLocalSyncOwnerState()).activeOwner;
  const rawEntries = await listFromIndexedDb<unknown>(
    SYNC_SHADOW_OUTBOX_STORE_LOCATION,
  );

  return rawEntries
    .map((entry) => normalizeLocalSyncOutboxEntry(entry, owner))
    .flatMap((entry) => {
      if (
        entry === null
        || entry.assetType !== options.assetType
        || entry.assetId !== options.assetId
        || !areLocalSyncDataOwnersEqual(entry.owner, owner)
      ) {
        return [];
      }

      return [entry];
    })
    .sort((left, right) => left.localSequence - right.localSequence);
}

export async function markWorldDocumentShadowEntriesValidated(options: {
  readonly documentKey: string;
  readonly throughLocalSequence: number;
  readonly owner?: LocalSyncDataOwner;
  readonly now?: string;
}): Promise<number> {
  const timestamp = options.now ?? new Date().toISOString();
  const owner = options.owner ?? (await ensureLocalSyncOwnerState({ now: timestamp })).activeOwner;
  const entries = await listLocalSyncOutboxEntriesForAsset({
    assetType: "world-document",
    assetId: options.documentKey,
    owner,
  });
  const entriesToUpdate = entries
    .filter((entry) => (
      entry.localSequence <= options.throughLocalSequence
      && entry.status === "pending"
    ))
    .map((entry) => ({
      ...entry,
      status: "validated" as const,
      updatedAt: timestamp,
    }));

  if (entriesToUpdate.length === 0) {
    return 0;
  }

  const saved = await applyIndexedDbTransactionMutations<unknown>(
    { databaseName: SYNC_SHADOW_DATABASE_NAME },
    [{
      storeName: SYNC_SHADOW_OUTBOX_STORE_NAME,
      operations: entriesToUpdate.map((entry) => ({
        type: "put" as const,
        key: entry.id,
        value: entry,
      })),
    }],
  );

  return saved ? entriesToUpdate.length : 0;
}

export async function markWorldDocumentShadowEntryValidated(options: {
  readonly documentKey: string;
  readonly localSequence: number;
  readonly owner?: LocalSyncDataOwner;
  readonly now?: string;
}): Promise<boolean> {
  const timestamp = options.now ?? new Date().toISOString();
  const owner = options.owner ?? (await ensureLocalSyncOwnerState({ now: timestamp })).activeOwner;
  const entries = await listLocalSyncOutboxEntriesForAsset({
    assetType: "world-document",
    assetId: options.documentKey,
    owner,
  });
  const entry = entries.find((candidate) => (
    candidate.localSequence === options.localSequence
    && candidate.status === "pending"
  ));

  if (entry === undefined) {
    return false;
  }

  return await applyIndexedDbTransactionMutations<unknown>(
    { databaseName: SYNC_SHADOW_DATABASE_NAME },
    [{
      storeName: SYNC_SHADOW_OUTBOX_STORE_NAME,
      operations: [{
        type: "put" as const,
        key: entry.id,
        value: {
          ...entry,
          status: "validated" as const,
          updatedAt: timestamp,
        },
      }],
    }],
  );
}

export async function compactWorldDocumentShadowOutbox(options: {
  readonly documentKey: string;
  readonly throughLocalSequence: number;
  readonly baseContentHash: string;
  readonly owner?: LocalSyncDataOwner;
  readonly now?: string;
}): Promise<LocalSyncCompactSummary | null> {
  const timestamp = options.now ?? new Date().toISOString();
  const owner = options.owner ?? (await ensureLocalSyncOwnerState({ now: timestamp })).activeOwner;
  const entries = await listLocalSyncOutboxEntriesForAsset({
    assetType: "world-document",
    assetId: options.documentKey,
    owner,
  });
  const compactableEntries = entries.filter((entry) => (
    entry.localSequence <= options.throughLocalSequence
    && (entry.status === "validated" || entry.status === "synced")
  ));

  if (compactableEntries.length === 0) {
    return null;
  }

  const sortedCompactableEntries = [...compactableEntries]
    .sort((left, right) => left.localSequence - right.localSequence);
  const firstEntry = sortedCompactableEntries[0];
  const lastEntry = sortedCompactableEntries.at(-1);

  if (firstEntry === undefined || lastEntry === undefined) {
    return null;
  }

  const existingState = await readLocalDocumentSyncState(options.documentKey, { owner });
  const retainedEntryCount = entries.length - compactableEntries.length;
  const summary: LocalSyncCompactSummary = {
    schemaVersion: SYNC_SHADOW_SCHEMA_VERSION,
    id: createCompactSummaryId(
      owner,
      options.documentKey,
      firstEntry.localSequence,
      lastEntry.localSequence,
    ),
    owner,
    assetType: "world-document",
    assetId: options.documentKey,
    fromLocalSequence: firstEntry.localSequence,
    toLocalSequence: lastEntry.localSequence,
    operationCount: compactableEntries.length,
    baseContentHash: options.baseContentHash,
    compactedAt: timestamp,
  };
  const existingSummaries = await listLocalSyncCompactSummaries({ owner });
  const compactSummaryIdsToDelete = resolveCompactSummaryIdsToDelete(
    [...existingSummaries, summary],
    SYNC_SHADOW_MAX_COMPACT_SUMMARIES,
  );

  const saved = await applyIndexedDbTransactionMutations<unknown>(
    { databaseName: SYNC_SHADOW_DATABASE_NAME },
    [
      {
        storeName: SYNC_SHADOW_OUTBOX_STORE_NAME,
        operations: compactableEntries.map((entry) => ({
          type: "delete" as const,
          key: entry.id,
        })),
      },
      {
        storeName: SYNC_SHADOW_STATE_STORE_NAME,
        operations: existingState === null
          ? []
          : [{
            type: "put" as const,
            key: createDocumentSyncStateKey(owner, options.documentKey),
            value: {
              ...existingState,
              pendingOutboxCount: retainedEntryCount,
              hasUnsyncedChanges: retainedEntryCount > 0,
              updatedAt: timestamp,
            } satisfies LocalDocumentSyncState,
          }],
      },
      {
        storeName: SYNC_SHADOW_COMPACT_SUMMARY_STORE_NAME,
        operations: [
          ...compactSummaryIdsToDelete.map((summaryId) => ({
            type: "delete" as const,
            key: summaryId,
          })),
          {
            type: "put" as const,
            key: summary.id,
            value: summary,
          },
        ],
      },
    ],
  );

  return saved ? summary : null;
}

export async function appendLocalSyncDiagnosticEvent(options: {
  readonly severity: LocalSyncDiagnosticSeverity;
  readonly category: LocalSyncDiagnosticCategory;
  readonly code: string;
  readonly assetType?: "world-document" | "sync-owner" | "unknown";
  readonly assetId?: string | null;
  readonly localSequence?: number | null;
  readonly details?: Record<string, string | number | boolean | null>;
  readonly owner?: LocalSyncDataOwner;
  readonly now?: string;
}): Promise<LocalSyncDiagnosticEvent | null> {
  const timestamp = options.now ?? new Date().toISOString();
  const owner = options.owner ?? (await ensureLocalSyncOwnerState({ now: timestamp })).activeOwner;
  const code = normalizeNonEmptyString(options.code);

  if (code === null) {
    return null;
  }

  const event: LocalSyncDiagnosticEvent = {
    schemaVersion: SYNC_SHADOW_SCHEMA_VERSION,
    id: createDiagnosticEventId(owner, timestamp),
    owner,
    severity: options.severity,
    category: options.category,
    code,
    assetType: options.assetType ?? "unknown",
    assetId: options.assetId ?? null,
    localSequence: normalizeNullableNonNegativeInteger(options.localSequence),
    details: sanitizeDiagnosticDetails(options.details),
    createdAt: timestamp,
  };
  const existingEvents = await listLocalSyncDiagnosticEvents({ owner });
  const diagnosticEventIdsToDelete = resolveDiagnosticEventIdsToDelete(
    [...existingEvents, event],
    timestamp,
  );
  const saved = await applyIndexedDbTransactionMutations<unknown>(
    { databaseName: SYNC_SHADOW_DATABASE_NAME },
    [{
      storeName: SYNC_SHADOW_DIAGNOSTIC_STORE_NAME,
      operations: [
        ...diagnosticEventIdsToDelete.map((eventId) => ({
          type: "delete" as const,
          key: eventId,
        })),
        {
          type: "put" as const,
          key: event.id,
          value: event,
        },
      ],
    }],
  );

  return saved ? event : null;
}

export async function listLocalSyncDiagnosticEvents(options: {
  readonly owner?: LocalSyncDataOwner;
} = {}): Promise<LocalSyncDiagnosticEvent[]> {
  const owner = options.owner ?? (await ensureLocalSyncOwnerState()).activeOwner;
  const rawEvents = await listFromIndexedDb<unknown>(
    SYNC_SHADOW_DIAGNOSTIC_STORE_LOCATION,
  );

  return rawEvents
    .map((event) => normalizeLocalSyncDiagnosticEvent(event, owner))
    .flatMap((event) => {
      if (event === null || !areLocalSyncDataOwnersEqual(event.owner, owner)) {
        return [];
      }

      return [event];
    })
    .sort((left, right) => timestampToNumber(left.createdAt) - timestampToNumber(right.createdAt));
}

export async function listLocalSyncCompactSummaries(options: {
  readonly owner?: LocalSyncDataOwner;
} = {}): Promise<LocalSyncCompactSummary[]> {
  const owner = options.owner ?? (await ensureLocalSyncOwnerState()).activeOwner;
  const rawSummaries = await listFromIndexedDb<unknown>(
    SYNC_SHADOW_COMPACT_SUMMARY_STORE_LOCATION,
  );

  return rawSummaries
    .map((summary) => normalizeLocalSyncCompactSummary(summary, owner))
    .flatMap((summary) => {
      if (summary === null || !areLocalSyncDataOwnersEqual(summary.owner, owner)) {
        return [];
      }

      return [summary];
    })
    .sort((left, right) => (
      timestampToNumber(left.compactedAt) - timestampToNumber(right.compactedAt)
    ));
}

export function createStableJsonHash(value: unknown): string {
  return `fnv1a32:${hashStringFNV1a32(stableStringify(value)).toString(16).padStart(8, "0")}`;
}

export async function createSha256CanonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function createWorldDocumentShadowOperationPayload(options: {
  readonly document: WorldDocument;
  readonly baseDocument?: WorldDocument;
  readonly delta?: EditorHistoryDocumentDelta | null;
  readonly contentHash: string;
}): WorldDocumentShadowOperationPayload {
  const document = options.document;

  if (
    options.baseDocument !== undefined
    && options.delta !== undefined
    && options.delta !== null
    && options.baseDocument.documentKey === document.documentKey
  ) {
    return {
      type: "world-document.history-delta",
      documentKey: document.documentKey,
      baseId: document.baseId,
      schemaVersion: document.schemaVersion,
      entityCount: Object.keys(document.entities).length,
      slotLinkCount: document.slotLinks.length,
      documentUpdatedAt: document.meta.updatedAt,
      baseContentHash: createStableJsonHash(options.baseDocument),
      targetContentHash: options.contentHash,
      delta: options.delta,
      targetMeta: cloneWorldDocumentMeta(document.meta),
    };
  }

  return {
    type: "world-document.shadow-snapshot",
    documentKey: document.documentKey,
    baseId: document.baseId,
    schemaVersion: document.schemaVersion,
    entityCount: Object.keys(document.entities).length,
    slotLinkCount: document.slotLinks.length,
    documentUpdatedAt: document.meta.updatedAt,
  };
}

function resolveShadowOutboxEntryIdsToDelete(
  existingEntries: readonly LocalSyncOutboxEntry[],
  retainedExistingEntryCount: number,
): string[] {
  if (existingEntries.length <= retainedExistingEntryCount) {
    return [];
  }

  return [...existingEntries]
    .sort((left, right) => right.localSequence - left.localSequence)
    .slice(retainedExistingEntryCount)
    .map((entry) => entry.id);
}

function normalizeNextLocalSequence(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 1;
}

function createOutboxEntryId(
  owner: LocalSyncDataOwner,
  documentKey: string,
  localSequence: number,
  localChangeId: string,
): string {
  return `world-document:${createLocalSyncOwnerScopeKey(owner)}:${documentKey}:${localSequence}:${localChangeId}`;
}

function createDocumentSyncStateKey(owner: LocalSyncDataOwner, documentKey: string): string {
  return `world-document:${createLocalSyncOwnerScopeKey(owner)}:${documentKey}`;
}

function createLegacyDocumentSyncStateKey(documentKey: string): string {
  return `world-document:${documentKey}`;
}

function createDiagnosticEventId(owner: LocalSyncDataOwner, timestamp: string): string {
  return `diagnostic:${createLocalSyncOwnerScopeKey(owner)}:${timestamp}:${createUuid()}`;
}

function createCompactSummaryId(
  owner: LocalSyncDataOwner,
  documentKey: string,
  fromLocalSequence: number,
  toLocalSequence: number,
): string {
  return `compact:${createLocalSyncOwnerScopeKey(owner)}:${documentKey}:${fromLocalSequence}-${toLocalSequence}:${createUuid()}`;
}

function normalizeLocalDocumentSyncState(
  value: unknown,
  fallbackOwner: LocalSyncDataOwner,
): LocalDocumentSyncState | null {
  if (!isRecord(value)) {
    return null;
  }

  const documentKey = normalizeNonEmptyString(value.documentKey);
  const owner = normalizeLocalSyncDataOwner(value.owner) ?? fallbackOwner;
  const localHeadHash = normalizeNonEmptyString(value.localHeadHash);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (documentKey === null || localHeadHash === null || updatedAt === null) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion, SYNC_SHADOW_SCHEMA_VERSION),
    documentKey,
    owner,
    syncedRemoteRevision: normalizeNullableString(value.syncedRemoteRevision),
    localHeadHash,
    nextLocalSequence: normalizeNextLocalSequence(value.nextLocalSequence),
    pendingOutboxCount: normalizeNonNegativeInteger(value.pendingOutboxCount, 0),
    hasUnsyncedChanges: value.hasUnsyncedChanges === true,
    updatedAt,
  };
}

function normalizeLocalSyncOutboxEntry(
  value: unknown,
  fallbackOwner: LocalSyncDataOwner,
): LocalSyncOutboxEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const owner = normalizeLocalSyncDataOwner(value.owner) ?? fallbackOwner;
  const deviceId = normalizeNonEmptyString(value.deviceId);
  const assetId = normalizeNonEmptyString(value.assetId);
  const localChangeId = normalizeNonEmptyString(value.localChangeId);
  const contentHash = normalizeNonEmptyString(value.contentHash);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  const operationPayload = normalizeWorldDocumentShadowOperationPayload(value.operationPayload);

  if (
    id === null
    || deviceId === null
    || value.assetType !== "world-document"
    || assetId === null
    || localChangeId === null
    || contentHash === null
    || createdAt === null
    || updatedAt === null
    || operationPayload === null
    || !isLocalSyncOutboxEntryStatus(value.status)
  ) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion, SYNC_SHADOW_SCHEMA_VERSION),
    id,
    owner,
    deviceId,
    assetType: "world-document",
    assetId,
    localChangeId,
    localSequence: normalizeNextLocalSequence(value.localSequence),
    baseRemoteRevision: normalizeNullableString(value.baseRemoteRevision),
    remoteRevision: normalizeNullableString(value.remoteRevision),
    operationPayload,
    contentHash,
    status: value.status,
    createdAt,
    updatedAt,
    retryAfter: normalizeNullableTimestamp(value.retryAfter),
  };
}

function normalizeWorldDocumentShadowOperationPayload(
  value: unknown,
): WorldDocumentShadowOperationPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type === "world-document.history-delta") {
    return normalizeWorldDocumentShadowDeltaPayload(value);
  }

  return normalizeWorldDocumentShadowSnapshotPayload(value);
}

function normalizeWorldDocumentShadowSnapshotPayload(
  value: unknown,
): WorldDocumentShadowSnapshotPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const documentKey = normalizeNonEmptyString(value.documentKey);
  const baseId = normalizeNonEmptyString(value.baseId);
  const documentUpdatedAt = normalizeTimestamp(value.documentUpdatedAt);

  if (
    value.type !== "world-document.shadow-snapshot"
    || documentKey === null
    || baseId === null
    || documentUpdatedAt === null
  ) {
    return null;
  }

  return {
    type: "world-document.shadow-snapshot",
    documentKey,
    baseId,
    schemaVersion: normalizePositiveInteger(value.schemaVersion, 1),
    entityCount: normalizeNonNegativeInteger(value.entityCount, 0),
    slotLinkCount: normalizeNonNegativeInteger(value.slotLinkCount, 0),
    documentUpdatedAt,
  };
}

function normalizeWorldDocumentShadowDeltaPayload(
  value: Record<string, unknown>,
): WorldDocumentShadowDeltaPayload | null {
  const documentKey = normalizeNonEmptyString(value.documentKey);
  const baseId = normalizeNonEmptyString(value.baseId);
  const documentUpdatedAt = normalizeTimestamp(value.documentUpdatedAt);
  const baseContentHash = normalizeNonEmptyString(value.baseContentHash);
  const targetContentHash = normalizeNonEmptyString(value.targetContentHash);
  const targetMeta = normalizeWorldDocumentMeta(value.targetMeta);

  if (
    documentKey === null
    || baseId === null
    || documentUpdatedAt === null
    || baseContentHash === null
    || targetContentHash === null
    || targetMeta === null
    || !isRecord(value.delta)
  ) {
    return null;
  }

  return {
    type: "world-document.history-delta",
    documentKey,
    baseId,
    schemaVersion: normalizePositiveInteger(value.schemaVersion, 1),
    entityCount: normalizeNonNegativeInteger(value.entityCount, 0),
    slotLinkCount: normalizeNonNegativeInteger(value.slotLinkCount, 0),
    documentUpdatedAt,
    baseContentHash,
    targetContentHash,
    delta: value.delta as unknown as EditorHistoryDocumentDelta,
    targetMeta,
  };
}

function isLocalSyncOutboxEntryStatus(value: unknown): value is LocalSyncOutboxEntryStatus {
  return (
    value === "pending"
    || value === "validated"
    || value === "uploading"
    || value === "synced"
    || value === "conflicted"
  );
}

function normalizeLocalSyncDiagnosticEvent(
  value: unknown,
  fallbackOwner: LocalSyncDataOwner,
): LocalSyncDiagnosticEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const owner = normalizeLocalSyncDataOwner(value.owner) ?? fallbackOwner;
  const code = normalizeNonEmptyString(value.code);
  const createdAt = normalizeTimestamp(value.createdAt);

  if (
    id === null
    || code === null
    || createdAt === null
    || !isLocalSyncDiagnosticSeverity(value.severity)
    || !isLocalSyncDiagnosticCategory(value.category)
    || !isLocalSyncDiagnosticAssetType(value.assetType)
  ) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion, SYNC_SHADOW_SCHEMA_VERSION),
    id,
    owner,
    severity: value.severity,
    category: value.category,
    code,
    assetType: value.assetType,
    assetId: normalizeNullableString(value.assetId),
    localSequence: normalizeNullableNonNegativeInteger(value.localSequence),
    details: sanitizeDiagnosticDetails(
      isRecord(value.details) ? value.details : undefined,
    ),
    createdAt,
  };
}

function normalizeLocalSyncCompactSummary(
  value: unknown,
  fallbackOwner: LocalSyncDataOwner,
): LocalSyncCompactSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const owner = normalizeLocalSyncDataOwner(value.owner) ?? fallbackOwner;
  const assetId = normalizeNonEmptyString(value.assetId);
  const baseContentHash = normalizeNonEmptyString(value.baseContentHash);
  const compactedAt = normalizeTimestamp(value.compactedAt);

  if (
    id === null
    || value.assetType !== "world-document"
    || assetId === null
    || baseContentHash === null
    || compactedAt === null
  ) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion, SYNC_SHADOW_SCHEMA_VERSION),
    id,
    owner,
    assetType: "world-document",
    assetId,
    fromLocalSequence: normalizeNextLocalSequence(value.fromLocalSequence),
    toLocalSequence: normalizeNextLocalSequence(value.toLocalSequence),
    operationCount: normalizeNonNegativeInteger(value.operationCount, 0),
    baseContentHash,
    compactedAt,
  };
}

function resolveDiagnosticEventIdsToDelete(
  events: readonly LocalSyncDiagnosticEvent[],
  now: string,
): string[] {
  const nowTimestamp = timestampToNumber(now);
  const expiredEventIds = events
    .filter((event) => {
      const age = nowTimestamp - timestampToNumber(event.createdAt);
      const retentionMs = event.code === "replay.mismatch"
        ? SYNC_SHADOW_REPLAY_MISMATCH_RETENTION_MS
        : SYNC_SHADOW_DIAGNOSTIC_RETENTION_MS;

      return age > retentionMs;
    })
    .map((event) => event.id);
  const nonExpiredEvents = events.filter((event) => !expiredEventIds.includes(event.id));
  const excessAllEventIds = selectOldestEventIds(
    nonExpiredEvents,
    SYNC_SHADOW_MAX_DIAGNOSTIC_EVENTS,
  );
  const replayMismatchEvents = nonExpiredEvents.filter((event) => event.code === "replay.mismatch");
  const excessReplayMismatchEventIds = selectOldestEventIds(
    replayMismatchEvents,
    SYNC_SHADOW_MAX_REPLAY_MISMATCH_EVENTS,
  );

  return Array.from(new Set([
    ...expiredEventIds,
    ...excessAllEventIds,
    ...excessReplayMismatchEventIds,
  ]));
}

function resolveCompactSummaryIdsToDelete(
  summaries: readonly LocalSyncCompactSummary[],
  retainedSummaryCount: number,
): string[] {
  if (summaries.length <= retainedSummaryCount) {
    return [];
  }

  return [...summaries]
    .sort((left, right) => timestampToNumber(right.compactedAt) - timestampToNumber(left.compactedAt))
    .slice(retainedSummaryCount)
    .map((summary) => summary.id);
}

function selectOldestEventIds(
  events: readonly LocalSyncDiagnosticEvent[],
  retainedEventCount: number,
): string[] {
  if (events.length <= retainedEventCount) {
    return [];
  }

  return [...events]
    .sort((left, right) => timestampToNumber(right.createdAt) - timestampToNumber(left.createdAt))
    .slice(retainedEventCount)
    .map((event) => event.id);
}

function sanitizeDiagnosticDetails(
  details: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  if (details === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details).flatMap(([key, value]) => {
      if (
        value === null
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
      ) {
        return [[key, value]];
      }

      return [];
    }),
  );
}

function cloneWorldDocumentMeta(meta: WorldDocument["meta"]): WorldDocument["meta"] {
  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function normalizeWorldDocumentMeta(value: unknown): WorldDocument["meta"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const name = typeof value.name === "string" ? value.name : null;
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (id === null || name === null || createdAt === null || updatedAt === null) {
    return null;
  }

  return {
    id,
    name,
    createdAt,
    updatedAt,
  };
}

function isLocalSyncDiagnosticSeverity(
  value: unknown,
): value is LocalSyncDiagnosticSeverity {
  return value === "info" || value === "warning" || value === "error";
}

function isLocalSyncDiagnosticCategory(
  value: unknown,
): value is LocalSyncDiagnosticCategory {
  return (
    value === "shadow-save"
    || value === "replay"
    || value === "storage"
    || value === "account-import"
    || value === "compaction"
  );
}

function isLocalSyncDiagnosticAssetType(
  value: unknown,
): value is LocalSyncDiagnosticEvent["assetType"] {
  return value === "world-document" || value === "sync-owner" || value === "unknown";
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashStringFNV1a32(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function normalizeNullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : normalizeTimestamp(value);
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizeNullableNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function timestampToNumber(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
