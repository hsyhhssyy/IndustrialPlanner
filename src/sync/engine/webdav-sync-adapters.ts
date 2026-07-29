import { createStableJsonHash } from "@/shared/storage/sync-shadow-storage";
import { createLogger } from "@/shared/logging/logger";
import type {
  WebDavStorageClient,
  WebDavWriteOptions,
} from "../webdav";
import {
  applyJsonPatch,
  generateJsonPatch,
  type JsonPatchOperation,
} from "@/shared/storage/json-patch-codec";
import {
  readWebDavLastSyncedContentHash,
  writeWebDavLastSyncedContentHash,
} from "../storage";

const logger = createLogger("webdav-adapter");

export type WebDavSyncMode = "patch-with-revision" | "full-with-revision" | "full-no-revision";
export type WebDavConflictResolution = "use-local" | "use-remote" | "pause";
export type WebDavSyncAdapterStatus = "idle" | "uploaded" | "downloaded" | "conflict" | "skipped";

export interface WebDavSyncAdapterResult {
  readonly adapterId: string;
  readonly mode: WebDavSyncMode;
  readonly status: WebDavSyncAdapterStatus;
  readonly changedAssetIds: readonly string[];
}

export interface WebDavSyncConflict<TValue> {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue;
  readonly remoteValue: TValue;
  readonly localHash: string;
  readonly remoteHash: string;
}

export interface WebDavSyncAdapter {
  readonly id: string;
  readonly mode: WebDavSyncMode;
  sync(client: WebDavStorageClient): Promise<WebDavSyncAdapterResult>;
}

export interface FullNoRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly remotePath: string;
  readonly readLocal: () => Promise<TValue | null>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly resolveConflict?: (conflict: WebDavSyncConflict<TValue>) => Promise<WebDavConflictResolution> | WebDavConflictResolution;
}

export interface FullWithRevisionEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface FullWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly indexPath: string;
  readonly entryPath: (entryId: string) => string;
  readonly listLocal: () => Promise<readonly FullWithRevisionEntry<TValue>[]>;
  readonly writeLocal: (entry: FullWithRevisionEntry<TValue>) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly resolveConflict?: (conflict: WebDavSyncConflict<TValue>) => Promise<WebDavConflictResolution> | WebDavConflictResolution;
}

export interface PatchWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly directoryPath: string;
  readonly readLocal: () => Promise<TValue | null>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly deltaThreshold?: number;
  readonly resolveConflict?: (conflict: WebDavSyncConflict<TValue>) => Promise<WebDavConflictResolution> | WebDavConflictResolution;
}

export interface PatchWithRevisionEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface PatchCollectionWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly indexPath: string;
  readonly directoryPath: (entryId: string) => string;
  readonly listLocal: () => Promise<readonly PatchWithRevisionEntry<TValue>[]>;
  readonly writeLocal: (entry: PatchWithRevisionEntry<TValue>) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly deltaThreshold?: number;
  readonly resolveConflict?: (conflict: WebDavSyncConflict<TValue>) => Promise<WebDavConflictResolution> | WebDavConflictResolution;
}

interface RemoteIndexFile {
  readonly revision: number;
  readonly entries: Record<string, RemoteIndexEntry>;
}

interface RemoteIndexState {
  readonly index: RemoteIndexFile;
  readonly etag: string | null;
}

interface RemoteIndexEntry {
  readonly contentHash: string;
  readonly deletedAt: string | null;
}

interface RemotePatchMetaFile {
  readonly revision: number;
  readonly currentFullHash: string;
  readonly deltaChain: readonly string[];
  readonly deltaThreshold: number;
}

interface RemotePatchMetaState {
  readonly meta: RemotePatchMetaFile;
  readonly etag: string | null;
}

export function createFullNoRevisionAdapter<TValue>(
  options: FullNoRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "full-no-revision",
    sync: async (client) => await syncFullNoRevision(client, options),
  };
}

export function createFullWithRevisionAdapter<TValue>(
  options: FullWithRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "full-with-revision",
    sync: async (client) => await syncFullWithRevision(client, options),
  };
}

export function createPatchWithRevisionAdapter<TValue>(
  options: PatchWithRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "patch-with-revision",
    sync: async (client) => await syncPatchWithRevision(client, options),
  };
}

export function createPatchCollectionWithRevisionAdapter<TValue>(
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "patch-with-revision",
    sync: async (client) => await syncPatchCollectionWithRevision(client, options),
  };
}

async function syncFullNoRevision<TValue>(
  client: WebDavStorageClient,
  options: FullNoRevisionAdapterOptions<TValue>,
): Promise<WebDavSyncAdapterResult> {
  const assetKey = `${options.id}:single`;
  const localValue = await options.readLocal();
  const remoteValue = await readRemoteJson(client, options.remotePath, options.normalizeRemote);
  const status = await syncSingleValue({
    adapterId: options.id,
    assetId: "single",
    localValue,
    remoteValue,
    readLastSyncedHash: () => readWebDavLastSyncedContentHash(assetKey),
    writeLastSyncedHash: (contentHash) => writeWebDavLastSyncedContentHash(assetKey, contentHash),
    writeLocal: options.writeLocal,
    writeRemote: async (value) => {
      await client.writeTextFile(options.remotePath, JSON.stringify(value));
    },
    resolveConflict: options.resolveConflict,
  });

  return {
    adapterId: options.id,
    mode: "full-no-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["single"],
  };
}

async function syncFullWithRevision<TValue>(
  client: WebDavStorageClient,
  options: FullWithRevisionAdapterOptions<TValue>,
): Promise<WebDavSyncAdapterResult> {
  const localEntries = await options.listLocal();
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remoteIndexState = await readRemoteIndexState(client, options.indexPath);
  const remoteIndex = remoteIndexState.index;
  const changedAssetIds: string[] = [];
  let nextIndex = remoteIndex;
  let status: WebDavSyncAdapterStatus = "idle";

  for (const localEntry of localEntries) {
    const remoteEntry = remoteIndex.entries[localEntry.id] ?? null;
    if (remoteEntry?.deletedAt !== null && remoteEntry?.deletedAt !== undefined) {
      const localContentHash = createStableJsonHash(localEntry.value);
      const lastSyncedHash = readWebDavLastSyncedContentHash(`${options.id}:${localEntry.id}`);
      if (localEntry.deletedAt === null && (lastSyncedHash === localContentHash || lastSyncedHash === remoteEntry.contentHash)) {
        logger.info(`${options.id}/${localEntry.id}: remote tombstone received → marking deletedAt="${remoteEntry.deletedAt}"`);
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(`${options.id}:${localEntry.id}`, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      if (localEntry.deletedAt === null) {
        status = mergeStatus(status, "conflict");
        changedAssetIds.push(localEntry.id);
        continue;
      }
    }

    const remoteValue = remoteEntry?.deletedAt === null
      ? await readRemoteJson(client, options.entryPath(localEntry.id), options.normalizeRemote)
      : null;
    const assetKey = `${options.id}:${localEntry.id}`;
    const entryStatus = await syncSingleValue({
      adapterId: options.id,
      assetId: localEntry.id,
      localValue: localEntry.deletedAt === null ? localEntry.value : null,
      remoteValue,
      readLastSyncedHash: () => readWebDavLastSyncedContentHash(assetKey),
      writeLastSyncedHash: (contentHash) => writeWebDavLastSyncedContentHash(assetKey, contentHash),
      writeLocal: async (value) => await options.writeLocal({
        id: localEntry.id,
        value,
        deletedAt: null,
      }),
      writeRemote: async (value) => {
        const contentHash = createStableJsonHash(value);
        await client.writeTextFile(options.entryPath(localEntry.id), JSON.stringify(value));
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash,
          deletedAt: null,
        });
      },
      resolveConflict: options.resolveConflict,
    });

    if (entryStatus !== "idle") {
      status = mergeStatus(status, entryStatus);
      changedAssetIds.push(localEntry.id);
    }

    if (localEntry.deletedAt !== null && remoteEntry?.deletedAt !== localEntry.deletedAt) {
      nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
        contentHash: createStableJsonHash(localEntry.value),
        deletedAt: localEntry.deletedAt,
      });
      status = mergeStatus(status, "uploaded");
      changedAssetIds.push(localEntry.id);
    }
  }

  for (const [entryId, remoteEntry] of Object.entries(remoteIndex.entries)) {
    if (localEntryById.has(entryId) || remoteEntry.deletedAt !== null) {
      continue;
    }

    const remoteValue = await readRemoteJson(client, options.entryPath(entryId), options.normalizeRemote);
    if (remoteValue === null) {
      continue;
    }

    logger.info(`${options.id}/${entryId}: new remote entry → downloading`);
    await options.writeLocal({
      id: entryId,
      value: remoteValue,
      deletedAt: null,
    });
    writeWebDavLastSyncedContentHash(`${options.id}:${entryId}`, createStableJsonHash(remoteValue));
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }

  if (nextIndex.revision !== remoteIndex.revision) {
    logger.info(`${options.id}: writing index.json → rev=${remoteIndex.revision + 1} (was ${remoteIndex.revision}), entries=${Object.keys(nextIndex.entries).length}`);
    await writeRemoteIndex(
      client,
      options.indexPath,
      nextIndex,
      remoteIndex.revision,
      remoteIndexState.etag,
    );
  }

  return {
    adapterId: options.id,
    mode: "full-with-revision",
    status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
  };
}

async function syncPatchWithRevision<TValue>(
  client: WebDavStorageClient,
  options: PatchWithRevisionAdapterOptions<TValue>,
): Promise<WebDavSyncAdapterResult> {
  const assetKey = `${options.id}:snapshot`;
  const localValue = await options.readLocal();
  const remoteState = await readRemotePatchState(client, options.directoryPath, options.normalizeRemote);
  const status = await syncSingleValue({
    adapterId: options.id,
    assetId: "snapshot",
    localValue,
    remoteValue: remoteState?.value ?? null,
    readLastSyncedHash: () => readWebDavLastSyncedContentHash(assetKey),
    writeLastSyncedHash: (contentHash) => writeWebDavLastSyncedContentHash(assetKey, contentHash),
    writeLocal: options.writeLocal,
    writeRemote: async (value) => {
      await writeRemotePatchState({
        client,
        directoryPath: options.directoryPath,
        value,
        previousState: remoteState,
        deltaThreshold: options.deltaThreshold ?? 50,
      });
    },
    resolveConflict: options.resolveConflict,
  });

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["snapshot"],
  };
}

async function syncPatchCollectionWithRevision<TValue>(
  client: WebDavStorageClient,
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
): Promise<WebDavSyncAdapterResult> {
  const localEntries = await options.listLocal();
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remoteIndexState = await readRemoteIndexState(client, options.indexPath);
  const remoteIndex = remoteIndexState.index;
  const changedAssetIds: string[] = [];
  let nextIndex = remoteIndex;
  let status: WebDavSyncAdapterStatus = "idle";

  for (const localEntry of localEntries) {
    const remoteEntry = remoteIndex.entries[localEntry.id] ?? null;
    const assetKey = `${options.id}:${localEntry.id}`;

    if (remoteEntry?.deletedAt !== null && remoteEntry?.deletedAt !== undefined) {
      const localContentHash = createStableJsonHash(localEntry.value);
      const lastSyncedHash = readWebDavLastSyncedContentHash(assetKey);
      if (localEntry.deletedAt === null && (lastSyncedHash === localContentHash || lastSyncedHash === remoteEntry.contentHash)) {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      if (localEntry.deletedAt === null) {
        status = mergeStatus(status, "conflict");
        changedAssetIds.push(localEntry.id);
        continue;
      }
    }

    const remoteState = remoteEntry?.deletedAt === null
      ? await readRemotePatchState(client, options.directoryPath(localEntry.id), options.normalizeRemote)
      : null;
    const entryStatus = await syncSingleValue({
      adapterId: options.id,
      assetId: localEntry.id,
      localValue: localEntry.deletedAt === null ? localEntry.value : null,
      remoteValue: remoteState?.value ?? null,
      readLastSyncedHash: () => readWebDavLastSyncedContentHash(assetKey),
      writeLastSyncedHash: (contentHash) => writeWebDavLastSyncedContentHash(assetKey, contentHash),
      writeLocal: async (value) => await options.writeLocal({
        id: localEntry.id,
        value,
        deletedAt: null,
      }),
      writeRemote: async (value) => {
        const contentHash = createStableJsonHash(value);
        await writeRemotePatchState({
          client,
          directoryPath: options.directoryPath(localEntry.id),
          value,
          previousState: remoteState,
          deltaThreshold: options.deltaThreshold ?? 50,
        });
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash,
          deletedAt: null,
        });
      },
      resolveConflict: options.resolveConflict,
    });

    if (entryStatus !== "idle") {
      status = mergeStatus(status, entryStatus);
      changedAssetIds.push(localEntry.id);
    }

    if (localEntry.deletedAt !== null && remoteEntry?.deletedAt !== localEntry.deletedAt) {
      nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
        contentHash: createStableJsonHash(localEntry.value),
        deletedAt: localEntry.deletedAt,
      });
      status = mergeStatus(status, "uploaded");
      changedAssetIds.push(localEntry.id);
    }
  }

  for (const [entryId, remoteEntry] of Object.entries(remoteIndex.entries)) {
    if (localEntryById.has(entryId) || remoteEntry.deletedAt !== null) {
      continue;
    }

    const remoteState = await readRemotePatchState(client, options.directoryPath(entryId), options.normalizeRemote);
    if (remoteState === null) {
      continue;
    }

    logger.info(`${options.id}/${entryId}: new remote patch entry → downloading`);
    await options.writeLocal({
      id: entryId,
      value: remoteState.value,
      deletedAt: null,
    });
    writeWebDavLastSyncedContentHash(`${options.id}:${entryId}`, createStableJsonHash(remoteState.value));
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }

  if (nextIndex.revision !== remoteIndex.revision) {
    logger.info(`${options.id}: writing collection index.json → rev=${remoteIndex.revision + 1} (was ${remoteIndex.revision}), entries=${Object.keys(nextIndex.entries).length}`);
    await writeRemoteIndex(
      client,
      options.indexPath,
      nextIndex,
      remoteIndex.revision,
      remoteIndexState.etag,
    );
  }

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
  };
}

async function syncSingleValue<TValue>(options: {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue | null;
  readonly remoteValue: TValue | null;
  readonly readLastSyncedHash: () => string | null;
  readonly writeLastSyncedHash: (contentHash: string) => void;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly writeRemote: (value: TValue) => Promise<void>;
  readonly resolveConflict?: (conflict: WebDavSyncConflict<TValue>) => Promise<WebDavConflictResolution> | WebDavConflictResolution;
}): Promise<WebDavSyncAdapterStatus> {
  if (options.localValue === null && options.remoteValue === null) {
    return "idle";
  }

  const lastSyncedHash = options.readLastSyncedHash();
  const localHash = options.localValue === null ? null : createStableJsonHash(options.localValue);
  const remoteHash = options.remoteValue === null ? null : createStableJsonHash(options.remoteValue);

  if (options.localValue !== null && options.remoteValue === null) {
    logger.info(`${options.adapterId}/${options.assetId}: local exists, remote absent → uploading`);
    await options.writeRemote(options.localValue);
    options.writeLastSyncedHash(localHash!);
    return "uploaded";
  }

  if (options.localValue === null && options.remoteValue !== null) {
    logger.info(`${options.adapterId}/${options.assetId}: local absent, remote exists → downloading`);
    await options.writeLocal(options.remoteValue);
    options.writeLastSyncedHash(remoteHash!);
    return "downloaded";
  }

  if (options.localValue === null || options.remoteValue === null || localHash === null || remoteHash === null) {
    return "skipped";
  }

  if (localHash === remoteHash) {
    logger.debug(`${options.adapterId}/${options.assetId}: hashes match → idle`);
    options.writeLastSyncedHash(localHash);
    return "idle";
  }

  if (lastSyncedHash === remoteHash) {
    logger.info(`${options.adapterId}/${options.assetId}: local changed, remote unchanged → uploading`);
    await options.writeRemote(options.localValue);
    options.writeLastSyncedHash(localHash);
    return "uploaded";
  }

  if (lastSyncedHash === localHash) {
    logger.info(`${options.adapterId}/${options.assetId}: remote changed, local unchanged → downloading`);
    await options.writeLocal(options.remoteValue);
    options.writeLastSyncedHash(remoteHash);
    return "downloaded";
  }

  const resolution = await (options.resolveConflict?.({
    adapterId: options.adapterId,
    assetId: options.assetId,
    localValue: options.localValue,
    remoteValue: options.remoteValue,
    localHash,
    remoteHash,
  }) ?? "pause");

  logger.debug(`${options.adapterId}/${options.assetId}: conflict detected, resolved as "${resolution}"`);

  if (resolution === "use-local") {
    await options.writeRemote(options.localValue);
    options.writeLastSyncedHash(localHash);
    return "uploaded";
  }

  if (resolution === "use-remote") {
    await options.writeLocal(options.remoteValue);
    options.writeLastSyncedHash(remoteHash);
    return "downloaded";
  }

  return "conflict";
}

async function readRemoteJson<TValue>(
  client: WebDavStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<TValue | null> {
  const file = await client.readTextFile(remotePath);
  if (file === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(file.content);
    return normalizeRemote === undefined ? parsed as TValue : normalizeRemote(parsed);
  } catch {
    return null;
  }
}

async function readRemoteIndexState(
  client: WebDavStorageClient,
  indexPath: string,
): Promise<RemoteIndexState> {
  const file = await client.readTextFile(indexPath);
  let canonicalState: RemoteIndexState = {
    index: { revision: 0, entries: {} },
    etag: file?.etag ?? null,
  };
  if (file !== null) {
    try {
      canonicalState = {
        index: normalizeRemoteIndex(JSON.parse(file.content)),
        etag: file.etag,
      };
    } catch {
      canonicalState = {
        index: { revision: 0, entries: {} },
        etag: file.etag,
      };
    }
  }

  const journalState = await readLatestRevisionJournalState(
    client,
    indexPath,
    normalizeRemoteIndex,
  );

  return journalState !== null && journalState.value.revision >= canonicalState.index.revision
    ? { index: journalState.value, etag: journalState.etag }
    : canonicalState;
}

async function writeRemoteIndex(
  client: WebDavStorageClient,
  indexPath: string,
  index: RemoteIndexFile,
  expectedRevision: number,
  _etag: string | null,
): Promise<void> {
  const committedIndex: RemoteIndexFile = {
    ...index,
    revision: expectedRevision + 1,
  };
  await writeRevisionJournalState(client, indexPath, committedIndex);
}

function normalizeRemoteIndex(value: unknown): RemoteIndexFile {
  if (!isRecord(value) || !isRecord(value.entries)) {
    return { revision: 0, entries: {} };
  }

  const entries = Object.fromEntries(
    Object.entries(value.entries).flatMap(([entryId, entry]) => {
      if (!isRecord(entry) || typeof entry.contentHash !== "string") {
        return [];
      }

      const deletedAt = typeof entry.deletedAt === "string" ? entry.deletedAt : null;

      return [[entryId, { contentHash: entry.contentHash, deletedAt } satisfies RemoteIndexEntry]];
    }),
  );

  return {
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0,
    entries,
  };
}

function upsertRemoteIndexEntry(
  index: RemoteIndexFile,
  entryId: string,
  entry: RemoteIndexEntry,
): RemoteIndexFile {
  const existingEntry = index.entries[entryId];

  if (
    existingEntry?.contentHash === entry.contentHash
    && existingEntry.deletedAt === entry.deletedAt
  ) {
    return index;
  }

  return {
    revision: index.revision + 1,
    entries: {
      ...index.entries,
      [entryId]: entry,
    },
  };
}

async function readRemotePatchState<TValue>(
  client: WebDavStorageClient,
  directoryPath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{ readonly meta: RemotePatchMetaFile; readonly value: TValue; readonly etag: string | null } | null> {
  const metaState = await readRemotePatchMetaState(client, directoryPath);
  if (metaState === null) {
    return null;
  }
  const meta = metaState.meta;

  const fullValue = await readRemoteJson(client, resolvePatchFullPath(directoryPath, meta.currentFullHash), normalizeRemote);
  if (fullValue === null) {
    return null;
  }

  let value = fullValue;
  let baseHash = meta.currentFullHash;
  for (const targetHash of meta.deltaChain) {
    const patch = await readRemoteJson<JsonPatchOperation[]>(
      client,
      resolvePatchDeltaPath(directoryPath, baseHash, targetHash),
      normalizeJsonPatchOperations,
    );
    if (patch === null) {
      return null;
    }

    value = applyJsonPatch(value, patch);
    baseHash = targetHash;
  }

  return { meta, value, etag: metaState.etag };
}

async function readRemotePatchMetaState(
  client: WebDavStorageClient,
  directoryPath: string,
): Promise<RemotePatchMetaState | null> {
  const metaPath = resolvePath(directoryPath, "meta.json");
  const file = await client.readTextFile(metaPath);
  let canonicalState: RemotePatchMetaState | null = null;
  if (file !== null) {
    try {
      const meta = normalizeRemotePatchMeta(JSON.parse(file.content));
      canonicalState = meta === null ? null : { meta, etag: file.etag };
    } catch {
      canonicalState = null;
    }
  }

  const journalState = await readLatestRevisionJournalState(
    client,
    metaPath,
    normalizeRemotePatchMeta,
  );
  if (
    journalState !== null
    && (
      canonicalState === null
      || journalState.value.revision >= canonicalState.meta.revision
    )
  ) {
    return {
      meta: journalState.value,
      etag: journalState.etag,
    };
  }

  return canonicalState;
}

function normalizeRemotePatchMeta(value: unknown): RemotePatchMetaFile | null {
  if (!isRecord(value) || typeof value.currentFullHash !== "string" || !Array.isArray(value.deltaChain)) {
    return null;
  }

  return {
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0,
    currentFullHash: value.currentFullHash,
    deltaChain: value.deltaChain.filter((entry): entry is string => typeof entry === "string"),
    deltaThreshold: typeof value.deltaThreshold === "number" && Number.isInteger(value.deltaThreshold) && value.deltaThreshold > 0
      ? value.deltaThreshold
      : 50,
  };
}

async function writeRemotePatchState<TValue>(options: {
  readonly client: WebDavStorageClient;
  readonly directoryPath: string;
  readonly value: TValue;
  readonly previousState: { readonly meta: RemotePatchMetaFile; readonly value: TValue; readonly etag: string | null } | null;
  readonly deltaThreshold: number;
}): Promise<void> {
  await options.client.makeDirectory(options.directoryPath);
  const nextHash = createStableJsonHash(options.value);

  if (options.previousState === null) {
    await options.client.writeTextFile(resolvePatchFullPath(options.directoryPath, nextHash), JSON.stringify(options.value));
    const nextMeta = {
      revision: 1,
      currentFullHash: nextHash,
      deltaChain: [],
      deltaThreshold: options.deltaThreshold,
    } satisfies RemotePatchMetaFile;
    await writeRemotePatchMeta(
      options.client,
      options.directoryPath,
      nextMeta,
      createMetaWriteOptions(null),
    );
    return;
  }

  const previousHash = resolvePatchLatestHash(options.previousState.meta);
  const nextDeltaChain = [...options.previousState.meta.deltaChain, nextHash];
  const nextRevision = options.previousState.meta.revision + 1;

  if (nextDeltaChain.length >= options.previousState.meta.deltaThreshold) {
    await options.client.writeTextFile(resolvePatchFullPath(options.directoryPath, nextHash), JSON.stringify(options.value));
    const metaWriteOptions = await resolveLatestMetaWriteOptions(
      options.client,
      options.directoryPath,
      options.previousState.meta,
      options.previousState.etag,
    );
    await writeRemotePatchMeta(options.client, options.directoryPath, {
      revision: nextRevision,
      currentFullHash: nextHash,
      deltaChain: [],
      deltaThreshold: options.previousState.meta.deltaThreshold,
    }, metaWriteOptions);
    return;
  }

  const patch = generateJsonPatch(options.previousState.value, options.value);
  await options.client.writeTextFile(resolvePatchDeltaPath(options.directoryPath, previousHash, nextHash), JSON.stringify(patch));
  const metaWriteOptions = await resolveLatestMetaWriteOptions(
    options.client,
    options.directoryPath,
    options.previousState.meta,
    options.previousState.etag,
  );
  await writeRemotePatchMeta(options.client, options.directoryPath, {
    revision: nextRevision,
    currentFullHash: options.previousState.meta.currentFullHash,
    deltaChain: nextDeltaChain,
    deltaThreshold: options.previousState.meta.deltaThreshold,
  }, metaWriteOptions);
}

function createMetaWriteOptions(_etag: string | null): WebDavWriteOptions {
  return { ifNoneMatch: "*" };
}

async function resolveLatestMetaWriteOptions(
  client: WebDavStorageClient,
  directoryPath: string,
  expectedMeta: RemotePatchMetaFile,
  fallbackEtag: string | null,
): Promise<WebDavWriteOptions> {
  const latestMetaState = await readRemotePatchMetaState(client, directoryPath);
  if (latestMetaState === null) {
    return createMetaWriteOptions(fallbackEtag);
  }

  if (!areRemotePatchMetaFilesEqual(latestMetaState.meta, expectedMeta)) {
    throw new Error("Remote patch meta changed before write.");
  }

  return createMetaWriteOptions(latestMetaState.etag ?? fallbackEtag);
}

async function writeRemotePatchMeta(
  client: WebDavStorageClient,
  directoryPath: string,
  meta: RemotePatchMetaFile,
  writeOptions: WebDavWriteOptions,
): Promise<void> {
  await writeRevisionJournalState(
    client,
    resolvePath(directoryPath, "meta.json"),
    meta,
    writeOptions,
  );
}

function areRemotePatchMetaFilesEqual(
  left: RemotePatchMetaFile,
  right: RemotePatchMetaFile,
): boolean {
  return left.revision === right.revision
    && left.currentFullHash === right.currentFullHash
    && left.deltaThreshold === right.deltaThreshold
    && left.deltaChain.length === right.deltaChain.length
    && left.deltaChain.every((entry, index) => entry === right.deltaChain[index]);
}

async function readLatestRevisionJournalState<TValue extends { readonly revision: number }>(
  client: WebDavStorageClient,
  canonicalPath: string,
  normalize: (value: unknown) => TValue | null,
): Promise<{
  readonly value: TValue;
  readonly etag: string | null;
} | null> {
  const revisionDirectoryPath = resolveRevisionDirectoryPath(canonicalPath);
  const directoryStat = await client.stat(revisionDirectoryPath);
  if (directoryStat?.type !== "directory") {
    return null;
  }

  const entries = await client.listDirectory(revisionDirectoryPath);
  const candidates = entries.flatMap((entry) => {
    const match = /^rev-(\d+)\.json$/.exec(entry.basename);
    if (entry.type !== "file" || match === null) {
      return [];
    }

    const revision = Number(match[1]);
    return Number.isSafeInteger(revision) && revision >= 0
      ? [{ basename: entry.basename, revision }]
      : [];
  }).sort((left, right) => right.revision - left.revision);

  for (const candidate of candidates) {
    const file = await client.readTextFile(
      resolvePath(revisionDirectoryPath, candidate.basename),
    );
    if (file === null) {
      continue;
    }

    try {
      const value = normalize(JSON.parse(file.content));
      if (value?.revision === candidate.revision) {
        return {
          value,
          etag: file.etag,
        };
      }
    } catch {
      // 跳过不完整或损坏的修订文件，继续读取上一个完整修订。
    }
  }

  return null;
}

async function writeRevisionJournalState<TValue extends { readonly revision: number }>(
  client: WebDavStorageClient,
  canonicalPath: string,
  value: TValue,
  writeOptions: WebDavWriteOptions = { ifNoneMatch: "*" },
): Promise<void> {
  const revisionDirectoryPath = resolveRevisionDirectoryPath(canonicalPath);
  await client.makeDirectory(revisionDirectoryPath);
  const serializedValue = JSON.stringify(value);
  const revisionPath = resolvePath(
    revisionDirectoryPath,
    `rev-${value.revision.toString().padStart(12, "0")}.json`,
  );

  // 修订文件通过临时文件 + MOVE(Overwrite:F) 原子认领；canonical 文件仅是便于人工查看的镜像。
  await client.writeTextFile(revisionPath, serializedValue, writeOptions);
  await client.writeTextFile(canonicalPath, serializedValue);
}

function resolveRevisionDirectoryPath(canonicalPath: string): string {
  const slashIndex = canonicalPath.lastIndexOf("/");
  const directoryPath = slashIndex < 0 ? "" : canonicalPath.slice(0, slashIndex);
  const fileName = slashIndex < 0 ? canonicalPath : canonicalPath.slice(slashIndex + 1);
  const stem = fileName.endsWith(".json") ? fileName.slice(0, -".json".length) : fileName;

  return resolvePath(directoryPath, `${stem}-revisions`);
}

function resolvePatchLatestHash(meta: RemotePatchMetaFile): string {
  return meta.deltaChain.at(-1) ?? meta.currentFullHash;
}

function resolvePatchFullPath(directoryPath: string, hash: string): string {
  return resolvePath(directoryPath, `full-${encodeURIComponent(hash)}.json`);
}

function resolvePatchDeltaPath(directoryPath: string, baseHash: string, targetHash: string): string {
  return resolvePath(directoryPath, `delta-${encodeURIComponent(baseHash)}-${encodeURIComponent(targetHash)}.json`);
}

function resolvePath(directoryPath: string, fileName: string): string {
  const normalizedDirectoryPath = directoryPath.replace(/\/+$/, "");

  return normalizedDirectoryPath === "" ? fileName : `${normalizedDirectoryPath}/${fileName}`;
}

function normalizeJsonPatchOperations(value: unknown): JsonPatchOperation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value as JsonPatchOperation[];
}

function mergeStatus(
  current: WebDavSyncAdapterStatus,
  next: WebDavSyncAdapterStatus,
): WebDavSyncAdapterStatus {
  if (current === "conflict" || next === "conflict") {
    return "conflict";
  }

  if (current === "uploaded" || next === "uploaded") {
    return "uploaded";
  }

  if (current === "downloaded" || next === "downloaded") {
    return "downloaded";
  }

  return next === "skipped" ? "skipped" : current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
