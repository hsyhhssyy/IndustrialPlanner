import type { WorldDocument } from "@/domain/document/world-document";
import { createUuid } from "@/domain/shared/uuid";

import {
  applyIndexedDbTransactionMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbStoreLocation,
} from "./browser-storage";

const SYNC_SHADOW_DATABASE_NAME = "v3-industrial-planner";
const SYNC_SHADOW_OUTBOX_STORE_NAME = "sync-shadow-outbox";
const SYNC_SHADOW_STATE_STORE_NAME = "sync-shadow-state";
const SYNC_SHADOW_MAX_OUTBOX_ENTRIES_PER_ASSET = 200;
const SYNC_SHADOW_SCHEMA_VERSION = 1;

export const SYNC_SHADOW_OUTBOX_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_SHADOW_DATABASE_NAME,
  storeName: SYNC_SHADOW_OUTBOX_STORE_NAME,
};

export const SYNC_SHADOW_STATE_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_SHADOW_DATABASE_NAME,
  storeName: SYNC_SHADOW_STATE_STORE_NAME,
};

export type LocalSyncOutboxEntryStatus =
  | "pending"
  | "uploading"
  | "synced"
  | "conflicted";

export interface LocalSyncOutboxEntry {
  readonly schemaVersion: number;
  readonly id: string;
  readonly deviceId: string;
  readonly assetType: "world-document";
  readonly assetId: string;
  readonly localChangeId: string;
  readonly localSequence: number;
  readonly baseRemoteRevision: string | null;
  readonly remoteRevision: string | null;
  readonly operationPayload: WorldDocumentShadowSnapshotPayload;
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

export interface LocalDocumentSyncState {
  readonly schemaVersion: number;
  readonly documentKey: string;
  readonly syncedRemoteRevision: string | null;
  readonly localHeadHash: string;
  readonly nextLocalSequence: number;
  readonly pendingOutboxCount: number;
  readonly hasUnsyncedChanges: boolean;
  readonly updatedAt: string;
}

export async function writeWorldDocumentWithShadowSave(options: {
  readonly document: WorldDocument;
  readonly documentStoreLocation: IndexedDbStoreLocation;
  readonly deviceId?: string;
  readonly now?: string;
}): Promise<boolean> {
  return await writeWorldDocumentShadowSaveInternal(options, options.documentStoreLocation);
}

export async function writeWorldDocumentShadowSave(options: {
  readonly document: WorldDocument;
  readonly deviceId?: string;
  readonly now?: string;
}): Promise<boolean> {
  return await writeWorldDocumentShadowSaveInternal(options, null);
}

async function writeWorldDocumentShadowSaveInternal(
  options: {
    readonly document: WorldDocument;
    readonly deviceId?: string;
    readonly now?: string;
  },
  documentStoreLocation: IndexedDbStoreLocation | null,
): Promise<boolean> {
  const document = options.document;
  const timestamp = options.now ?? new Date().toISOString();
  const existingState = await readLocalDocumentSyncState(document.documentKey);
  const existingOutboxEntries = await listLocalSyncOutboxEntriesForAsset({
    assetType: "world-document",
    assetId: document.documentKey,
  });
  const localSequence = normalizeNextLocalSequence(existingState?.nextLocalSequence);
  const contentHash = createStableJsonHash(document);
  const localChangeId = createUuid();
  const outboxEntry: LocalSyncOutboxEntry = {
    schemaVersion: SYNC_SHADOW_SCHEMA_VERSION,
    id: createOutboxEntryId(document.documentKey, localSequence, localChangeId),
    deviceId: options.deviceId ?? "local-shadow",
    assetType: "world-document",
    assetId: document.documentKey,
    localChangeId,
    localSequence,
    baseRemoteRevision: existingState?.syncedRemoteRevision ?? null,
    remoteRevision: null,
    operationPayload: {
      type: "world-document.shadow-snapshot",
      documentKey: document.documentKey,
      baseId: document.baseId,
      schemaVersion: document.schemaVersion,
      entityCount: Object.keys(document.entities).length,
      slotLinkCount: document.slotLinks.length,
      documentUpdatedAt: document.meta.updatedAt,
    },
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
    syncedRemoteRevision: existingState?.syncedRemoteRevision ?? null,
    localHeadHash: contentHash,
    nextLocalSequence: localSequence + 1,
    pendingOutboxCount,
    hasUnsyncedChanges: pendingOutboxCount > 0,
    updatedAt: timestamp,
  };

  return await applyIndexedDbTransactionMutations<unknown>(
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
          key: createDocumentSyncStateKey(document.documentKey),
          value: syncState,
        }],
      },
    ],
  );
}

export async function readLocalDocumentSyncState(
  documentKey: string,
): Promise<LocalDocumentSyncState | null> {
  const rawState = await readFromIndexedDb<unknown>({
    ...SYNC_SHADOW_STATE_STORE_LOCATION,
    key: createDocumentSyncStateKey(documentKey),
  });

  return normalizeLocalDocumentSyncState(rawState);
}

export async function listLocalSyncOutboxEntriesForAsset(options: {
  readonly assetType: "world-document";
  readonly assetId: string;
}): Promise<LocalSyncOutboxEntry[]> {
  const rawEntries = await listFromIndexedDb<unknown>(
    SYNC_SHADOW_OUTBOX_STORE_LOCATION,
  );

  return rawEntries
    .map(normalizeLocalSyncOutboxEntry)
    .flatMap((entry) => {
      if (
        entry === null
        || entry.assetType !== options.assetType
        || entry.assetId !== options.assetId
      ) {
        return [];
      }

      return [entry];
    })
    .sort((left, right) => left.localSequence - right.localSequence);
}

export function createStableJsonHash(value: unknown): string {
  return `fnv1a32:${hashStringFNV1a32(stableStringify(value)).toString(16).padStart(8, "0")}`;
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
  documentKey: string,
  localSequence: number,
  localChangeId: string,
): string {
  return `world-document:${documentKey}:${localSequence}:${localChangeId}`;
}

function createDocumentSyncStateKey(documentKey: string): string {
  return `world-document:${documentKey}`;
}

function normalizeLocalDocumentSyncState(value: unknown): LocalDocumentSyncState | null {
  if (!isRecord(value)) {
    return null;
  }

  const documentKey = normalizeNonEmptyString(value.documentKey);
  const localHeadHash = normalizeNonEmptyString(value.localHeadHash);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (documentKey === null || localHeadHash === null || updatedAt === null) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion, SYNC_SHADOW_SCHEMA_VERSION),
    documentKey,
    syncedRemoteRevision: normalizeNullableString(value.syncedRemoteRevision),
    localHeadHash,
    nextLocalSequence: normalizeNextLocalSequence(value.nextLocalSequence),
    pendingOutboxCount: normalizeNonNegativeInteger(value.pendingOutboxCount, 0),
    hasUnsyncedChanges: value.hasUnsyncedChanges === true,
    updatedAt,
  };
}

function normalizeLocalSyncOutboxEntry(value: unknown): LocalSyncOutboxEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeNonEmptyString(value.id);
  const deviceId = normalizeNonEmptyString(value.deviceId);
  const assetId = normalizeNonEmptyString(value.assetId);
  const localChangeId = normalizeNonEmptyString(value.localChangeId);
  const contentHash = normalizeNonEmptyString(value.contentHash);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  const operationPayload = normalizeWorldDocumentShadowSnapshotPayload(value.operationPayload);

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

function isLocalSyncOutboxEntryStatus(value: unknown): value is LocalSyncOutboxEntryStatus {
  return (
    value === "pending"
    || value === "uploading"
    || value === "synced"
    || value === "conflicted"
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
