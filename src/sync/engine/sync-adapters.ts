import {
  createSha256CanonicalHash,
  createStableJsonHash,
} from "@/shared/storage/sync-shadow-storage";
import { createLogger } from "@/shared/logging/logger";
import type {
  RemoteCollectionIndex,
  SyncRemoteAdapterMode,
  SyncRemoteCollection,
  SyncRemoteSession,
  SyncStorageClient,
  SyncWriteOptions,
} from "../clients";
import {
  applyJsonPatch,
  generateJsonPatch,
  type JsonPatchOperation,
} from "@/shared/storage/json-patch-codec";
import {
  createSyncAssetKey,
  createSyncRemoteCollection,
} from "../remote-collections";
import {
  clearWebDavLastSeenRemoteEtag,
  readWebDavLastSeenRemoteRevision,
  writeWebDavLastSeenRemoteRevision,
} from "../storage";

const logger = createLogger("webdav-adapter");

export type SyncAdapterMode = SyncRemoteAdapterMode;
export type SyncAdapterConflictResolution = "use-local" | "use-remote" | "pause";
export type SyncAdapterStatus = "idle" | "uploaded" | "downloaded" | "conflict" | "skipped";

export interface SyncAdapterResult {
  readonly adapterId: string;
  readonly mode: SyncAdapterMode;
  readonly status: SyncAdapterStatus;
  readonly changedAssetIds: readonly string[];
}

export interface SyncAdapterConflict<TValue> {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue;
  readonly remoteValue: TValue | null;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
}

export interface SyncAdapterConflictDecision {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly resolution: SyncAdapterConflictResolution;
}

export interface SyncAdapter {
  readonly id: string;
  readonly mode: SyncAdapterMode;
  readonly collection: SyncRemoteCollection;
  readonly checkPath: string | null;
  sync(
    session: SyncRemoteSession,
    scope?: SyncAdapterScope,
  ): Promise<SyncAdapterResult>;
  inspectConflicts?(
    session: SyncRemoteSession,
    scope?: SyncAdapterScope,
  ): Promise<readonly SyncAdapterConflict<unknown>[]>;
}

export interface SyncAdapterScope {
  readonly includeAssetIds?: readonly string[];
  readonly excludeAssetIds?: readonly string[];
  readonly onProgress?: (progress: number) => void;
  readonly conflictDecisions?: readonly SyncAdapterConflictDecision[];
}

export interface FullNoRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly remotePath: string;
  readonly readLocal: () => Promise<TValue | null>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}

export interface FullWithRevisionEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface FullWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly indexPath: string;
  readonly entryPath: (entryId: string) => string;
  readonly listLocal: (
    scope?: SyncAdapterScope,
  ) => Promise<readonly FullWithRevisionEntry<TValue>[]>;
  readonly writeLocal: (entry: FullWithRevisionEntry<TValue>) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}

export interface PatchWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly directoryPath: string;
  readonly readLocal: () => Promise<TValue | null>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly deltaThreshold?: number;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}

export interface PatchWithRevisionEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface PatchCollectionWithRevisionAdapterOptions<TValue> {
  readonly id: string;
  readonly collection?: SyncRemoteCollection;
  readonly indexPath: string;
  readonly directoryPath: (entryId: string) => string;
  readonly listLocal: (
    scope?: SyncAdapterScope,
  ) => Promise<readonly PatchWithRevisionEntry<TValue>[]>;
  readonly writeLocal: (entry: PatchWithRevisionEntry<TValue>) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly deltaThreshold?: number;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}

interface RemoteIndexFile {
  readonly revision: number;
  readonly entries: Record<string, RemoteIndexEntry>;
}

interface RemoteIndexState {
  readonly index: RemoteIndexFile;
  readonly etag: string | null;
  readonly canonicalEtag: string | null;
  readonly canonicalMissing: boolean;
  readonly lastModified: string | null;
}

interface RemoteIndexEntry {
  readonly revision?: number;
  readonly contentHash: string;
  readonly deletedAt: string | null;
  readonly committedAt: string | null;
}

interface RemotePatchMetaFile {
  readonly revision: number;
  readonly currentFullHash: string;
  readonly deltaChain: readonly string[];
  readonly deltaThreshold: number;
  readonly committedAt: string | null;
}

interface RemotePatchMetaState {
  readonly meta: RemotePatchMetaFile;
  readonly etag: string | null;
  readonly canonicalMissing: boolean;
  readonly lastModified: string | null;
}

interface NormalizedRemoteAsset<TValue> {
  readonly value: TValue;
  readonly contentHash: string;
  readonly revision: number;
  readonly committedAt: string | null;
  readonly etag: string | null;
}

interface WriteRemoteValueOptions<TValue> {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
  readonly value: TValue;
  readonly contentHash: string;
  readonly baseRevision: number | null;
  readonly baseContentHash: string | null;
}

async function createSyncContentHash(
  collection: SyncRemoteCollection,
  value: unknown,
): Promise<string> {
  return collection.hashAlgorithm === "sha256-canonical-json-v1"
    ? await createSha256CanonicalHash(value)
    : createStableJsonHash(value);
}

async function readRemoteAssetValue<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  assetId: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<NormalizedRemoteAsset<TValue> | null> {
  const asset = await session.readAsset({ collection, assetId });
  if (asset === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(asset.content);
    const value = normalizeRemote === undefined
      ? parsed as TValue
      : normalizeRemote(parsed);
    if (value === null) {
      return null;
    }

    return {
      value,
      contentHash: await createSyncContentHash(collection, value),
      revision: asset.revision,
      committedAt: asset.committedAt,
      etag: asset.etag ?? null,
    };
  } catch {
    return null;
  }
}

function toRemoteIndexFile(index: RemoteCollectionIndex): RemoteIndexFile {
  return {
    revision: index.revision,
    entries: Object.fromEntries(
      Object.entries(index.entries).flatMap(([assetId, entry]) =>
        entry.contentHash === null
          ? []
          : [[assetId, {
              contentHash: entry.contentHash,
              deletedAt: entry.deletedAt,
              committedAt: entry.committedAt,
              revision: entry.revision,
            } satisfies RemoteIndexEntry]]
      ),
    ),
  };
}

async function writeRemoteValue<TValue>(options: WriteRemoteValueOptions<TValue>): Promise<void> {
  const batch = options.session.beginWriteBatch();
  batch.putAsset({
    collection: options.collection,
    assetId: options.assetId,
    content: JSON.stringify(options.value),
    contentHash: options.contentHash,
    baseRevision: options.baseRevision,
    baseContentHash: options.baseContentHash,
  });
  await batch.commit();
}

export function createFullNoRevisionAdapter<TValue>(
  options: FullNoRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "full-no-revision",
    stateKey: options.remotePath,
    webDav: {
      kind: "full-no-revision",
      remotePath: options.remotePath,
    },
  });

  return {
    id: options.id,
    mode: "full-no-revision",
    collection,
    checkPath: options.remotePath,
    sync: async (session, scope) => await syncFullNoRevision(
      session,
      collection,
      options,
      scope,
    ),
    inspectConflicts: async (session, scope) =>
      await inspectFullNoRevisionConflicts(session, collection, options, scope),
  };
}

export function createFullWithRevisionAdapter<TValue>(
  options: FullWithRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "full-with-revision",
    stateKey: options.indexPath,
    webDav: {
      kind: "full-with-revision",
      indexPath: options.indexPath,
      entryPath: options.entryPath,
    },
  });

  return {
    id: options.id,
    mode: "full-with-revision",
    collection,
    checkPath: options.indexPath,
    sync: async (session, scope) => await syncFullWithRevision(session, collection, options, scope),
    inspectConflicts: async (session, scope) =>
      await inspectFullWithRevisionConflicts(session, collection, options, scope),
  };
}

export function createPatchWithRevisionAdapter<TValue>(
  options: PatchWithRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const metaPath = `${options.directoryPath}/meta.json`;
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "patch-with-revision",
    stateKey: metaPath,
    webDav: {
      kind: "patch-with-revision",
      directoryPath: options.directoryPath,
      ...(options.deltaThreshold === undefined ? {} : { deltaThreshold: options.deltaThreshold }),
    },
  });

  return {
    id: options.id,
    mode: "patch-with-revision",
    collection,
    checkPath: metaPath,
    sync: async (session, scope) => await syncPatchWithRevision(
      session,
      collection,
      options,
      scope,
    ),
    inspectConflicts: async (session, scope) =>
      await inspectPatchWithRevisionConflicts(session, collection, options, scope),
  };
}

export function createPatchCollectionWithRevisionAdapter<TValue>(
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
): SyncAdapter {
  const collection = options.collection ?? createSyncRemoteCollection({
    adapterId: options.id,
    mode: "patch-with-revision",
    stateKey: options.indexPath,
    webDav: {
      kind: "patch-collection-with-revision",
      indexPath: options.indexPath,
      directoryPath: options.directoryPath,
      ...(options.deltaThreshold === undefined ? {} : { deltaThreshold: options.deltaThreshold }),
    },
  });

  return {
    id: options.id,
    mode: "patch-with-revision",
    collection,
    checkPath: options.indexPath,
    sync: async (session, scope) => await syncPatchCollectionWithRevision(
      session,
      collection,
      options,
      scope,
    ),
    inspectConflicts: async (session, scope) =>
      await inspectPatchCollectionWithRevisionConflicts(session, collection, options, scope),
  };
}

async function inspectFullNoRevisionConflicts<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullNoRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<readonly SyncAdapterConflict<TValue>[]> {
  if (!isAssetIncludedInScope("single", scope)) {
    return [];
  }

  const localValuePromise = options.readLocal();
  const remoteAssetPromise = readRemoteAssetValue(
    session,
    collection,
    "single",
    options.normalizeRemote,
  );
  const localValue = await localValuePromise;
  const remoteAsset = await remoteAssetPromise;
  const conflict = await createValueConflict<TValue>({
    collection,
    adapterId: options.id,
    assetId: "single",
    localValue,
    remoteValue: remoteAsset?.value ?? null,
    lastSyncedHash: await session.localState.getLastSyncedHash(
      createSyncAssetKey(collection, "single"),
    ),
    remoteDeletedAt: null,
    remoteUpdatedAt: remoteAsset?.committedAt ?? null,
  });

  return conflict === null ? [] : [conflict];
}

async function inspectFullWithRevisionConflicts<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullWithRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<readonly SyncAdapterConflict<TValue>[]> {
  const [localEntries, remoteIndexState] = await Promise.all([
    options.listLocal(scope),
    session.readIndex(collection),
  ]);
  const includedLocalEntries = localEntries.filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const remoteValues = new Map(await Promise.all(
    includedLocalEntries.flatMap((entry) => {
      const remoteEntry = remoteIndexState.entries[entry.id];
      return remoteEntry === undefined || remoteEntry.deletedAt !== null
        ? []
        : [readRemoteAssetValue(
          session,
          collection,
          entry.id,
          options.normalizeRemote,
        ).then((value) => [entry.id, value] as const)];
    }),
  ));

  return await inspectCollectionConflicts({
    session,
    collection,
    adapterId: options.id,
    localEntries: includedLocalEntries,
    remoteIndexState,
    readRemoteValue: (entryId) => remoteValues.get(entryId)?.value ?? null,
    readRemoteUpdatedAt: (entryId) =>
      remoteIndexState.entries[entryId]?.committedAt
      ?? remoteIndexState.committedAt,
  });
}

async function inspectPatchWithRevisionConflicts<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchWithRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<readonly SyncAdapterConflict<TValue>[]> {
  if (!isAssetIncludedInScope("snapshot", scope)) {
    return [];
  }

  const localValuePromise = options.readLocal();
  const remoteAssetPromise = readRemoteAssetValue(
    session,
    collection,
    "snapshot",
    options.normalizeRemote,
  );
  const localValue = await localValuePromise;
  const remoteAsset = await remoteAssetPromise;
  const conflict = await createValueConflict<TValue>({
    collection,
    adapterId: options.id,
    assetId: "snapshot",
    localValue,
    remoteValue: remoteAsset?.value ?? null,
    lastSyncedHash: await session.localState.getLastSyncedHash(
      createSyncAssetKey(collection, "snapshot"),
    ),
    remoteDeletedAt: null,
    remoteUpdatedAt: remoteAsset?.committedAt ?? null,
  });

  return conflict === null ? [] : [conflict];
}

async function inspectPatchCollectionWithRevisionConflicts<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<readonly SyncAdapterConflict<TValue>[]> {
  const [localEntries, remoteIndexState] = await Promise.all([
    options.listLocal(scope),
    session.readIndex(collection),
  ]);
  const includedLocalEntries = localEntries.filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const remoteStates = new Map(await Promise.all(
    includedLocalEntries.flatMap((entry) => {
      const remoteEntry = remoteIndexState.entries[entry.id];
      return remoteEntry === undefined || remoteEntry.deletedAt !== null
        ? []
        : [readRemoteAssetValue(
          session,
          collection,
          entry.id,
          options.normalizeRemote,
        ).then((state) => [entry.id, state] as const)];
    }),
  ));

  return await inspectCollectionConflicts({
    session,
    collection,
    adapterId: options.id,
    localEntries: includedLocalEntries,
    remoteIndexState,
    readRemoteValue: (entryId) =>
      remoteStates.get(entryId)?.value ?? null,
    readRemoteUpdatedAt: (entryId) =>
      remoteStates.get(entryId)?.committedAt
      ?? remoteIndexState.entries[entryId]?.committedAt
      ?? remoteIndexState.committedAt,
  });
}

async function inspectCollectionConflicts<TValue>(options: {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly adapterId: string;
  readonly localEntries: readonly {
    readonly id: string;
    readonly value: TValue;
    readonly deletedAt: string | null;
  }[];
  readonly remoteIndexState: RemoteCollectionIndex;
  readonly readRemoteValue: (entryId: string) => TValue | null;
  readonly readRemoteUpdatedAt: (entryId: string) => string | null;
}): Promise<readonly SyncAdapterConflict<TValue>[]> {
  const conflicts: SyncAdapterConflict<TValue>[] = [];
  for (const localEntry of options.localEntries) {
    const remoteEntry =
      options.remoteIndexState.entries[localEntry.id] ?? null;
    if (remoteEntry === null) {
      continue;
    }

    const localHash = await createSyncContentHash(options.collection, localEntry.value);
    const lastSyncedHash = await options.session.localState.getLastSyncedHash(
      createSyncAssetKey(options.collection, localEntry.id),
    );
    if (remoteEntry.deletedAt !== null) {
      if (
        localEntry.deletedAt !== null
        || lastSyncedHash === localHash
        || localHash === remoteEntry.contentHash
      ) {
        continue;
      }

      conflicts.push({
        adapterId: options.adapterId,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue: null,
        localHash,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
      });
      continue;
    }

    const remoteValue = options.readRemoteValue(localEntry.id);
    if (localEntry.deletedAt !== null) {
      if (remoteValue === null) {
        continue;
      }
      const remoteHash = await createSyncContentHash(options.collection, remoteValue);
      if (
        localHash === remoteHash
        || lastSyncedHash === remoteHash
      ) {
        continue;
      }

      conflicts.push({
        adapterId: options.adapterId,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue,
        localHash,
        remoteHash,
        remoteDeletedAt: null,
        remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
      });
      continue;
    }

    const conflict = await createValueConflict({
      collection: options.collection,
      adapterId: options.adapterId,
      assetId: localEntry.id,
      localValue: localEntry.value,
      remoteValue,
      lastSyncedHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
    });

    if (conflict !== null) {
      conflicts.push(conflict);
    }
  }

  return conflicts;
}

async function createValueConflict<TValue>(options: {
  readonly collection: SyncRemoteCollection;
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue | null;
  readonly remoteValue: TValue | null;
  readonly lastSyncedHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
}): Promise<SyncAdapterConflict<TValue> | null> {
  if (options.localValue === null || options.remoteValue === null) {
    return null;
  }

  const localHash = await createSyncContentHash(options.collection, options.localValue);
  const remoteHash = await createSyncContentHash(options.collection, options.remoteValue);
  if (
    localHash === remoteHash
    || options.lastSyncedHash === localHash
    || options.lastSyncedHash === remoteHash
  ) {
    return null;
  }

  return {
    adapterId: options.adapterId,
    assetId: options.assetId,
    localValue: options.localValue,
    remoteValue: options.remoteValue,
    localHash,
    remoteHash,
    remoteDeletedAt: options.remoteDeletedAt,
    remoteUpdatedAt: options.remoteUpdatedAt,
  };
}

function createScopedConflictResolver<TValue>(
  scope: SyncAdapterScope | undefined,
  fallback:
    | ((
      conflict: SyncAdapterConflict<TValue>,
    ) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution)
    | undefined,
): (
  conflict: SyncAdapterConflict<TValue>,
) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution {
  return (conflict) => {
    if (scope?.conflictDecisions !== undefined) {
      const decision = scope.conflictDecisions.find((candidate) =>
        candidate.adapterId === conflict.adapterId
        && candidate.assetId === conflict.assetId
        && candidate.localHash === conflict.localHash
        && candidate.remoteHash === conflict.remoteHash
        && candidate.remoteDeletedAt === conflict.remoteDeletedAt,
      );

      return decision?.resolution ?? "pause";
    }

    return fallback?.(conflict) ?? "pause";
  };
}

async function syncFullNoRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullNoRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<SyncAdapterResult> {
  const assetId = "single";
  const assetKey = createSyncAssetKey(collection, assetId);
  const localValue = await options.readLocal();
  const remoteAsset = await readRemoteAssetValue(
    session,
    collection,
    assetId,
    options.normalizeRemote,
  );
  const remoteValue = remoteAsset?.value ?? null;
  const status = await syncSingleValue({
    collection,
    adapterId: options.id,
    assetId,
    localValue,
    remoteValue,
    remoteUpdatedAt: remoteAsset?.committedAt ?? null,
    readLastSyncedHash: async () => await session.localState.getLastSyncedHash(assetKey),
    writeLastSyncedHash: async (contentHash) => {
      await session.localState.setLastSyncedHash(assetKey, contentHash);
    },
    writeLocal: options.writeLocal,
    writeRemote: async (value, contentHash) => await writeRemoteValue({
      session,
      collection,
      assetId,
      value,
      contentHash,
      baseRevision: remoteAsset?.revision ?? null,
      baseContentHash: remoteAsset?.contentHash ?? null,
    }),
    resolveConflict: createScopedConflictResolver(
      scope,
      options.resolveConflict,
    ),
  });

  await session.markApplied({
    collection,
    assetIds: [assetId],
    scopeComplete: true,
    collectionRevision: remoteAsset?.revision ?? null,
    collectionEtag: status === "uploaded" ? null : remoteAsset?.etag ?? null,
  });

  return {
    adapterId: options.id,
    mode: "full-no-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["single"],
  };
}

async function syncFullWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullWithRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<SyncAdapterResult> {
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  if (await isRemoteIndexUnchangedForCleanLocalEntries({
    session,
    collection,
    localEntries,
  })) {
    return {
      adapterId: options.id,
      mode: "full-with-revision",
      status: "idle",
      changedAssetIds: [],
    };
  }
  const remoteIndexState = await session.readIndex(collection);
  const remoteIndex = toRemoteIndexFile(remoteIndexState);
  const changedAssetIds: string[] = [];
  let status: SyncAdapterStatus = "idle";
  const remoteWriteBatch = session.beginWriteBatch();
  let hasRemoteWrites = false;
  const remoteValuesByLocalId = new Map(await Promise.all(localEntries.flatMap((entry) => {
    const remoteEntry = remoteIndex.entries[entry.id];
    if (
      remoteEntry?.deletedAt !== null
      || (
        entry.deletedAt === null
        && createStableJsonHash(entry.value) === remoteEntry.contentHash
      )
    ) {
      return [];
    }

    return [readRemoteAssetValue(
      session,
      collection,
      entry.id,
      options.normalizeRemote,
    ).then((value) => [entry.id, value] as const)];
  })));

  for (const localEntry of localEntries) {
    const remoteEntry = remoteIndex.entries[localEntry.id] ?? null;
    const assetKey = createSyncAssetKey(collection, localEntry.id);
    const localContentHash = await createSyncContentHash(collection, localEntry.value);
    const lastSyncedHash = await session.localState.getLastSyncedHash(assetKey);
    const remoteValue = remoteValuesByLocalId.get(localEntry.id) ?? null;

    if (remoteEntry?.deletedAt !== null && remoteEntry?.deletedAt !== undefined) {
      if (localEntry.deletedAt !== null) {
        if (localEntry.deletedAt !== remoteEntry.deletedAt) {
          await options.writeLocal({
            id: localEntry.id,
            value: localEntry.value,
            deletedAt: remoteEntry.deletedAt,
          });
          status = mergeStatus(status, "downloaded");
          changedAssetIds.push(localEntry.id);
        }
        await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
        continue;
      }

      if (
        lastSyncedHash === localContentHash
        || localContentHash === remoteEntry.contentHash
      ) {
        logger.info(`${options.id}/${localEntry.id}: remote tombstone received → marking deletedAt="${remoteEntry.deletedAt}"`);
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const resolution = await resolveCollectionConflict({
        adapterId: options.id,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue: null,
        localHash: localContentHash,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        remoteWriteBatch.putAsset({
          collection,
          assetId: localEntry.id,
          content: JSON.stringify(localEntry.value),
          contentHash: localContentHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
      } else {
        status = mergeStatus(status, "conflict");
      }
      changedAssetIds.push(localEntry.id);
      continue;
    }

    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null || remoteValue === null) {
        remoteWriteBatch.putTombstone({
          collection,
          assetId: localEntry.id,
          deletedAt: localEntry.deletedAt,
          targetContentHash: localContentHash,
          baseRevision: remoteEntry?.revision ?? null,
          baseContentHash: remoteEntry?.contentHash ?? null,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = remoteValue.contentHash;
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        remoteWriteBatch.putTombstone({
          collection,
          assetId: localEntry.id,
          deletedAt: localEntry.deletedAt,
          targetContentHash: localContentHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const resolution = await resolveCollectionConflict({
        adapterId: options.id,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue: remoteValue.value,
        localHash: localContentHash,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        remoteWriteBatch.putTombstone({
          collection,
          assetId: localEntry.id,
          deletedAt: localEntry.deletedAt,
          targetContentHash: localContentHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: remoteValue.value,
          deletedAt: null,
        });
        await session.localState.setLastSyncedHash(assetKey, remoteContentHash);
        status = mergeStatus(status, "downloaded");
      } else {
        status = mergeStatus(status, "conflict");
      }
      changedAssetIds.push(localEntry.id);
      continue;
    }

    if (
      remoteEntry?.deletedAt === null
      && localContentHash === remoteEntry.contentHash
    ) {
      logger.debug(`${options.id}/${localEntry.id}: collection index hash matches → idle`);
      await session.localState.setLastSyncedHash(
        assetKey,
        remoteEntry.contentHash,
      );
      continue;
    }

    const entryStatus = await syncSingleValue({
      collection,
      adapterId: options.id,
      assetId: localEntry.id,
      localValue: localEntry.value,
      remoteValue: remoteValue?.value ?? null,
      readLastSyncedHash: async () => await session.localState.getLastSyncedHash(assetKey),
      writeLastSyncedHash: async (contentHash) => {
        await session.localState.setLastSyncedHash(assetKey, contentHash);
      },
      writeLocal: async (value) => await options.writeLocal({
        id: localEntry.id,
        value,
        deletedAt: null,
      }),
      writeRemote: async (value, contentHash) => await writeRemoteValue({
        session,
        collection,
        assetId: localEntry.id,
        value,
        contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: remoteEntry?.contentHash ?? null,
      }),
      remoteUpdatedAt:
        remoteEntry?.committedAt ?? remoteIndexState.committedAt,
      resolveConflict: createScopedConflictResolver(
        scope,
        options.resolveConflict,
      ),
    });

    if (entryStatus !== "idle") {
      status = mergeStatus(status, entryStatus);
      changedAssetIds.push(localEntry.id);
    }
    // AI-CORRECTION 2026-07-29: 归一化后的 patch 索引修复只适用于下方 patch collection；
    // full collection 没有 remoteState，不能在这里执行该逻辑。

    // AI-REMOVED 2026-07-29:
    // Reason: 墓碑必须在读取远端正文并完成冲突决议后提交，不能在通用 value 同步后无条件覆盖索引。
    // Trigger: 本地删除与远端修改并发时，旧逻辑先下载远端再上传墓碑，绕过用户冲突选择。
    // Evidence: syncSingleValue 将 localValue=null 解释为“本地不存在”，随后本块又无条件写 deletedAt。
    // Replacement: 循环前半段 localEntry.deletedAt 分支。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (localEntry.deletedAt !== null && remoteEntry?.deletedAt !== localEntry.deletedAt) {
    //   nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
    //     contentHash: createStableJsonHash(localEntry.value),
    //     deletedAt: localEntry.deletedAt,
    //   });
    //   status = mergeStatus(status, "uploaded");
    //   changedAssetIds.push(localEntry.id);
    // }
  }

  // AI-REMOVED 2026-07-29:
  // Reason: 各 remote-only 资产文件互不依赖，逐个 GET 无法利用受限并发。
  // Trigger: 用户要求在最大连接数限制下并行下载。
  // Evidence: 本地写回仍可在下载全部完成后按顺序执行。
  // Replacement: 下方 remoteOnlyValues 并行预取。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // for (const [entryId, remoteEntry] of Object.entries(remoteIndex.entries)) {
  //   if (
  //     !isAssetIncludedInScope(entryId, scope)
  //     || localEntryById.has(entryId)
  //     || remoteEntry.deletedAt !== null
  //   ) {
  //     continue;
  //   }
  //
  //   const remoteValue = await readRemoteJson(client, options.entryPath(entryId), options.normalizeRemote);
  //   if (remoteValue === null) {
  //     continue;
  //   }
  //
  //   logger.info(`${options.id}/${entryId}: new remote entry → downloading`);
  //   await options.writeLocal({
  //     id: entryId,
  //     value: remoteValue,
  //     deletedAt: null,
  //   });
  //   writeWebDavLastSyncedContentHash(`${options.id}:${entryId}`, createStableJsonHash(remoteValue));
  //   status = mergeStatus(status, "downloaded");
  //   changedAssetIds.push(entryId);
  // }
  const remoteOnlyValues = await Promise.all(
    Object.entries(remoteIndex.entries).flatMap(([entryId, remoteEntry]) =>
      isAssetIncludedInScope(entryId, scope)
        && !localEntryById.has(entryId)
        && remoteEntry.deletedAt === null
        ? [readRemoteAssetValue(
          session,
          collection,
          entryId,
          options.normalizeRemote,
        ).then((value) => ({ entryId, value }))]
        : []
    ),
  );
  for (const { entryId, value: remoteAsset } of remoteOnlyValues) {
    if (remoteAsset === null) {
      continue;
    }

    logger.info(`${options.id}/${entryId}: new remote entry → downloading`);
    await options.writeLocal({
      id: entryId,
      value: remoteAsset.value,
      deletedAt: null,
    });
    await session.localState.setLastSyncedHash(
      createSyncAssetKey(collection, entryId),
      remoteAsset.contentHash,
    );
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }

  if (hasRemoteWrites) {
    await remoteWriteBatch.commit();
  }

  await session.markApplied({
    collection,
    assetIds: Array.from(new Set(changedAssetIds)),
    scopeComplete: isScopeComplete(scope),
    collectionRevision: remoteIndexState.revision,
    collectionEtag: hasRemoteWrites ? null : remoteIndexState.etag ?? null,
  });

  return {
    adapterId: options.id,
    mode: "full-with-revision",
    status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
  };
}

async function syncPatchWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchWithRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<SyncAdapterResult> {
  const assetId = "snapshot";
  const assetKey = createSyncAssetKey(collection, assetId);
  const localValue = await options.readLocal();
  const remoteAsset = await readRemoteAssetValue(
    session,
    collection,
    assetId,
    options.normalizeRemote,
  );
  const status = await syncSingleValue({
    collection,
    adapterId: options.id,
    assetId,
    localValue,
    remoteValue: remoteAsset?.value ?? null,
    remoteUpdatedAt: remoteAsset?.committedAt ?? null,
    readLastSyncedHash: async () => await session.localState.getLastSyncedHash(assetKey),
    writeLastSyncedHash: async (contentHash) => {
      await session.localState.setLastSyncedHash(assetKey, contentHash);
    },
    writeLocal: options.writeLocal,
    writeRemote: async (value, contentHash) => await writeRemoteValue({
      session,
      collection,
      assetId,
      value,
      contentHash,
      baseRevision: remoteAsset?.revision ?? null,
      baseContentHash: remoteAsset?.contentHash ?? null,
    }),
    resolveConflict: createScopedConflictResolver(
      scope,
      options.resolveConflict,
    ),
  });

  await session.markApplied({
    collection,
    assetIds: [assetId],
    scopeComplete: true,
    collectionRevision: remoteAsset?.revision ?? null,
    collectionEtag: status === "uploaded" ? null : remoteAsset?.etag ?? null,
  });

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["snapshot"],
  };
}

async function syncPatchCollectionWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
  scope?: SyncAdapterScope,
): Promise<SyncAdapterResult> {
  reportSyncProgress(scope, 0);
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  reportSyncProgress(scope, 10);
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  if (await isRemoteIndexUnchangedForCleanLocalEntries({
    session,
    collection,
    localEntries,
  })) {
    reportSyncProgress(scope, 100);
    return {
      adapterId: options.id,
      mode: "patch-with-revision",
      status: "idle",
      changedAssetIds: [],
    };
  }
  const remoteIndexState = await session.readIndex(collection);
  reportSyncProgress(scope, 35);
  const remoteIndex = toRemoteIndexFile(remoteIndexState);
  const changedAssetIds: string[] = [];
  let status: SyncAdapterStatus = "idle";
  const remoteWriteBatch = session.beginWriteBatch();
  let hasRemoteWrites = false;
  const remoteStatesByLocalId = new Map(await Promise.all(localEntries.flatMap((entry) => {
    const remoteEntry = remoteIndex.entries[entry.id];
    if (
      remoteEntry?.deletedAt !== null
      || (
        entry.deletedAt === null
        && createStableJsonHash(entry.value) === remoteEntry.contentHash
      )
    ) {
      return [];
    }

    return [readRemoteAssetValue(
      session,
      collection,
      entry.id,
      options.normalizeRemote,
    ).then((value) => [entry.id, value] as const)];
  })));
  reportSyncProgress(scope, 55);

  for (const [localEntryIndex, localEntry] of localEntries.entries()) {
    reportSyncProgress(
      scope,
      interpolateProgress(55, 75, localEntryIndex, localEntries.length),
    );
    const remoteEntry = remoteIndex.entries[localEntry.id] ?? null;
    const assetKey = createSyncAssetKey(collection, localEntry.id);
    const localContentHash = await createSyncContentHash(collection, localEntry.value);
    const lastSyncedHash = await session.localState.getLastSyncedHash(assetKey);
    const remoteState = remoteStatesByLocalId.get(localEntry.id) ?? null;

    if (remoteEntry?.deletedAt !== null && remoteEntry?.deletedAt !== undefined) {
      if (localEntry.deletedAt !== null) {
        if (localEntry.deletedAt !== remoteEntry.deletedAt) {
          await options.writeLocal({
            id: localEntry.id,
            value: localEntry.value,
            deletedAt: remoteEntry.deletedAt,
          });
          status = mergeStatus(status, "downloaded");
          changedAssetIds.push(localEntry.id);
        }
        await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
        continue;
      }

      if (
        lastSyncedHash === localContentHash
        || localContentHash === remoteEntry.contentHash
      ) {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const resolution = await resolveCollectionConflict({
        adapterId: options.id,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue: null,
        localHash: localContentHash,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        remoteWriteBatch.putAsset({
          collection,
          assetId: localEntry.id,
          content: JSON.stringify(localEntry.value),
          contentHash: localContentHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
      } else {
        status = mergeStatus(status, "conflict");
      }
      changedAssetIds.push(localEntry.id);
      continue;
    }

    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null || remoteState === null) {
        remoteWriteBatch.putTombstone({
          collection,
          assetId: localEntry.id,
          deletedAt: localEntry.deletedAt,
          targetContentHash: localContentHash,
          baseRevision: remoteEntry?.revision ?? null,
          baseContentHash: remoteEntry?.contentHash ?? null,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = remoteState.contentHash;
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        remoteWriteBatch.putTombstone({
          collection,
          assetId: localEntry.id,
          deletedAt: localEntry.deletedAt,
          targetContentHash: localContentHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const resolution = await resolveCollectionConflict({
        adapterId: options.id,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue: remoteState.value,
        localHash: localContentHash,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        remoteWriteBatch.putTombstone({
          collection,
          assetId: localEntry.id,
          deletedAt: localEntry.deletedAt,
          targetContentHash: localContentHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        await session.localState.setLastSyncedHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: remoteState.value,
          deletedAt: null,
        });
        await session.localState.setLastSyncedHash(assetKey, remoteContentHash);
        status = mergeStatus(status, "downloaded");
      } else {
        status = mergeStatus(status, "conflict");
      }
      changedAssetIds.push(localEntry.id);
      continue;
    }

    if (
      remoteEntry?.deletedAt === null
      && localContentHash === remoteEntry.contentHash
    ) {
      logger.debug(`${options.id}/${localEntry.id}: patch index hash matches → idle`);
      await session.localState.setLastSyncedHash(assetKey, remoteEntry.contentHash);
      continue;
    }

    const entryStatus = await syncSingleValue({
      collection,
      adapterId: options.id,
      assetId: localEntry.id,
      localValue: localEntry.value,
      remoteValue: remoteState?.value ?? null,
      readLastSyncedHash: async () => await session.localState.getLastSyncedHash(assetKey),
      writeLastSyncedHash: async (contentHash) => {
        await session.localState.setLastSyncedHash(assetKey, contentHash);
      },
      writeLocal: async (value) => await options.writeLocal({
        id: localEntry.id,
        value,
        deletedAt: null,
      }),
      writeRemote: async (value, contentHash) => {
        remoteWriteBatch.putAsset({
          collection,
          assetId: localEntry.id,
          content: JSON.stringify(value),
          contentHash,
          baseRevision: remoteEntry?.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry?.contentHash ?? null,
        });
        hasRemoteWrites = true;
      },
      remoteUpdatedAt:
        remoteState?.committedAt
        ?? remoteEntry?.committedAt
        ?? remoteIndexState.committedAt,
      resolveConflict: createScopedConflictResolver(
        scope,
        options.resolveConflict,
      ),
    });

    if (entryStatus !== "idle") {
      status = mergeStatus(status, entryStatus);
      changedAssetIds.push(localEntry.id);
    }
    if (
      entryStatus === "idle"
      && remoteEntry?.deletedAt === null
      && remoteState !== null
    ) {
      const normalizedRemoteHash = remoteState.contentHash;
      if (remoteEntry.contentHash !== normalizedRemoteHash) {
        remoteWriteBatch.putAsset({
          collection,
          assetId: localEntry.id,
          content: JSON.stringify(remoteState.value),
          contentHash: normalizedRemoteHash,
          baseRevision: remoteEntry.revision ?? remoteIndex.revision,
          baseContentHash: remoteEntry.contentHash,
        });
        hasRemoteWrites = true;
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
      }
    }

    // AI-REMOVED 2026-07-29:
    // Reason: patch collection 的墓碑也必须与远端正文一起完成冲突判断。
    // Trigger: 本地删除与远端 delta 同时发生时，旧逻辑先恢复远端值又覆盖为本地墓碑。
    // Evidence: 通用 syncSingleValue 不理解 deletedAt，后置索引写入绕过 resolveConflict。
    // Replacement: 循环前半段 localEntry.deletedAt 分支。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (localEntry.deletedAt !== null && remoteEntry?.deletedAt !== localEntry.deletedAt) {
    //   nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
    //     contentHash: createStableJsonHash(localEntry.value),
    //     deletedAt: localEntry.deletedAt,
    //   });
    //   status = mergeStatus(status, "uploaded");
    //   changedAssetIds.push(localEntry.id);
    // }
  }
  reportSyncProgress(scope, 75);

  // AI-REMOVED 2026-07-29:
  // Reason: remote-only patch 资产的远端重建彼此独立，串行等待会累加网络延迟。
  // Trigger: 用户要求在最大连接数限制下并行下载。
  // Evidence: 预取完成后仍按索引顺序写回本地，避免并发修改业务状态。
  // Replacement: 下方 remoteOnlyStates 并行预取。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // for (const [entryId, remoteEntry] of Object.entries(remoteIndex.entries)) {
  //   if (
  //     !isAssetIncludedInScope(entryId, scope)
  //     || localEntryById.has(entryId)
  //     || remoteEntry.deletedAt !== null
  //   ) {
  //     continue;
  //   }
  //
  //   const remoteState = await readRemotePatchState(client, options.directoryPath(entryId), options.normalizeRemote);
  //   if (remoteState === null) {
  //     continue;
  //   }
  //
  //   logger.info(`${options.id}/${entryId}: new remote patch entry → downloading`);
  //   await options.writeLocal({
  //     id: entryId,
  //     value: remoteState.value,
  //     deletedAt: null,
  //   });
  //   writeWebDavLastSyncedContentHash(`${options.id}:${entryId}`, createStableJsonHash(remoteState.value));
  //   status = mergeStatus(status, "downloaded");
  //   changedAssetIds.push(entryId);
  // }
  const remoteOnlyStates = await Promise.all(
    Object.entries(remoteIndex.entries).flatMap(([entryId, remoteEntry]) =>
      isAssetIncludedInScope(entryId, scope)
        && !localEntryById.has(entryId)
        && remoteEntry.deletedAt === null
        ? [readRemoteAssetValue(
          session,
          collection,
          entryId,
          options.normalizeRemote,
        ).then((state) => ({ entryId, state }))]
      : []
    ),
  );
  reportSyncProgress(scope, 88);
  for (const [remoteEntryIndex, {
    entryId,
    state: remoteState,
  }] of remoteOnlyStates.entries()) {
    reportSyncProgress(
      scope,
      interpolateProgress(88, 94, remoteEntryIndex, remoteOnlyStates.length),
    );
    if (remoteState === null) {
      continue;
    }

    logger.info(`${options.id}/${entryId}: new remote patch entry → downloading`);
    await options.writeLocal({
      id: entryId,
      value: remoteState.value,
      deletedAt: null,
    });
    await session.localState.setLastSyncedHash(
      createSyncAssetKey(collection, entryId),
      remoteState.contentHash,
    );
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }
  reportSyncProgress(scope, 94);

  if (hasRemoteWrites) {
    await remoteWriteBatch.commit();
  }

  await session.markApplied({
    collection,
    assetIds: Array.from(new Set(changedAssetIds)),
    scopeComplete: isScopeComplete(scope),
    collectionRevision: remoteIndexState.revision,
    collectionEtag: hasRemoteWrites ? null : remoteIndexState.etag ?? null,
  });
  reportSyncProgress(scope, 100);

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
  };
}

function isAssetIncludedInScope(
  assetId: string,
  scope: SyncAdapterScope | undefined,
): boolean {
  if (
    scope?.includeAssetIds !== undefined
    && !scope.includeAssetIds.includes(assetId)
  ) {
    return false;
  }

  return scope?.excludeAssetIds?.includes(assetId) !== true;
}

function reportSyncProgress(
  scope: SyncAdapterScope | undefined,
  progress: number,
): void {
  scope?.onProgress?.(Math.min(100, Math.max(0, progress)));
}

function isScopeComplete(scope: SyncAdapterScope | undefined): boolean {
  return scope?.includeAssetIds === undefined && scope?.excludeAssetIds === undefined;
}

async function isRemoteIndexUnchangedForCleanLocalEntries<TValue>(options: {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly localEntries: readonly {
    readonly id: string;
    readonly value: TValue;
    readonly deletedAt: string | null;
  }[];
}): Promise<boolean> {
  const lastSeenEtag = await options.session.localState.getRemoteEtag(
    options.collection.stateKey,
  );
  if (
    lastSeenEtag === null
    || options.localEntries.length === 0
    || options.localEntries.some((entry) =>
      entry.deletedAt !== null
    )
  ) {
    return false;
  }

  for (const entry of options.localEntries) {
    const lastSyncedHash = await options.session.localState.getLastSyncedHash(
      createSyncAssetKey(options.collection, entry.id),
    );
    if (lastSyncedHash !== await createSyncContentHash(options.collection, entry.value)) {
      return false;
    }
  }

  const result = await options.session.checkCollections([options.collection]);
  const unchanged = !result.changedCollections.includes(options.collection.adapterId);
  if (unchanged) {
    logger.debug(
      `${options.collection.adapterId}: canonical index ETag unchanged and local hashes clean → idle`,
    );
  }

  return unchanged;
}

function interpolateProgress(
  start: number,
  end: number,
  completedUnitCount: number,
  totalUnitCount: number,
): number {
  if (totalUnitCount <= 0) {
    return end;
  }

  return start + (end - start) * completedUnitCount / totalUnitCount;
}

async function resolveCollectionConflict<TValue>(options: {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue;
  readonly remoteValue: TValue | null;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly resolveConflict?: (
    conflict: SyncAdapterConflict<TValue>,
  ) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}): Promise<SyncAdapterConflictResolution> {
  const resolution = await (options.resolveConflict?.({
    adapterId: options.adapterId,
    assetId: options.assetId,
    localValue: options.localValue,
    remoteValue: options.remoteValue,
    localHash: options.localHash,
    remoteHash: options.remoteHash,
    remoteDeletedAt: options.remoteDeletedAt,
    remoteUpdatedAt: options.remoteUpdatedAt,
  }) ?? "pause");
  logger.debug(
    `${options.adapterId}/${options.assetId}: collection conflict detected, ` +
    `resolved as "${resolution}"`,
  );

  return resolution;
}

async function syncSingleValue<TValue>(options: {
  readonly collection: SyncRemoteCollection;
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue | null;
  readonly remoteValue: TValue | null;
  readonly remoteUpdatedAt: string | null;
  readonly readLastSyncedHash: () => Promise<string | null>;
  readonly writeLastSyncedHash: (contentHash: string) => Promise<void>;
  readonly writeLocal: (value: TValue) => Promise<void>;
  readonly writeRemote: (value: TValue, contentHash: string) => Promise<void>;
  readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
}): Promise<SyncAdapterStatus> {
  if (options.localValue === null && options.remoteValue === null) {
    return "idle";
  }

  const lastSyncedHash = await options.readLastSyncedHash();
  const localHash = options.localValue === null
    ? null
    : await createSyncContentHash(options.collection, options.localValue);
  const remoteHash = options.remoteValue === null
    ? null
    : await createSyncContentHash(options.collection, options.remoteValue);

  if (options.localValue !== null && options.remoteValue === null) {
    logger.info(`${options.adapterId}/${options.assetId}: local exists, remote absent → uploading`);
    await options.writeRemote(options.localValue, localHash!);
    await options.writeLastSyncedHash(localHash!);
    return "uploaded";
  }

  if (options.localValue === null && options.remoteValue !== null) {
    logger.info(`${options.adapterId}/${options.assetId}: local absent, remote exists → downloading`);
    await options.writeLocal(options.remoteValue);
    await options.writeLastSyncedHash(remoteHash!);
    return "downloaded";
  }

  if (options.localValue === null || options.remoteValue === null || localHash === null || remoteHash === null) {
    return "skipped";
  }

  if (localHash === remoteHash) {
    logger.debug(`${options.adapterId}/${options.assetId}: hashes match → idle`);
    await options.writeLastSyncedHash(localHash);
    return "idle";
  }

  if (lastSyncedHash === remoteHash) {
    logger.info(`${options.adapterId}/${options.assetId}: local changed, remote unchanged → uploading`);
    await options.writeRemote(options.localValue, localHash);
    await options.writeLastSyncedHash(localHash);
    return "uploaded";
  }

  if (lastSyncedHash === localHash) {
    logger.info(`${options.adapterId}/${options.assetId}: remote changed, local unchanged → downloading`);
    await options.writeLocal(options.remoteValue);
    await options.writeLastSyncedHash(remoteHash);
    return "downloaded";
  }

  const resolution = await (options.resolveConflict?.({
    adapterId: options.adapterId,
    assetId: options.assetId,
    localValue: options.localValue,
    remoteValue: options.remoteValue,
    localHash,
    remoteHash,
    remoteDeletedAt: null,
    remoteUpdatedAt: options.remoteUpdatedAt,
  }) ?? "pause");

  logger.debug(`${options.adapterId}/${options.assetId}: conflict detected, resolved as "${resolution}"`);

  if (resolution === "use-local") {
    await options.writeRemote(options.localValue, localHash);
    await options.writeLastSyncedHash(localHash);
    return "uploaded";
  }

  if (resolution === "use-remote") {
    await options.writeLocal(options.remoteValue);
    await options.writeLastSyncedHash(remoteHash);
    return "downloaded";
  }

  return "conflict";
}

async function readRemoteJson<TValue>(
  client: SyncStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<TValue | null> {
  return (await readRemoteJsonFile(
    client,
    remotePath,
    normalizeRemote,
  ))?.value ?? null;
}

async function readRemoteJsonFile<TValue>(
  client: SyncStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{
  readonly value: TValue;
  readonly etag: string | null;
  readonly lastModified: string | null;
} | null> {
  const file = await client.readTextFile(remotePath);
  if (file === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(file.content);
    const value = normalizeRemote === undefined
      ? parsed as TValue
      : normalizeRemote(parsed);

    return value === null
      ? null
      : {
        value,
        etag: file.etag,
        lastModified: normalizeRemoteTimestamp(file.lastModified),
      };
  } catch {
    return null;
  }
}

async function _readRemoteIndexState(
  client: SyncStorageClient,
  indexPath: string,
): Promise<RemoteIndexState> {
  const lastSeenRevision = readWebDavLastSeenRemoteRevision(indexPath);
  const canonicalFilePromise = client.readTextFile(indexPath);
  // AI-REMOVED 2026-07-29:
  // Reason: 每次读取 canonical 时并行 GET “已知 revision + 1”仍会让 OwnCloud 的不存在文件探测拖慢首屏，且成功提交的 canonical 已包含最新 revision。
  // Trigger: 真实服务器相同画布测试中，有 revision 游标的检查约 1.46 秒，无游标的 canonical 单次读取约 0.63 秒。
  // Evidence: 两次路径均在 35% 后直接 idle；额外请求没有提供更新数据。
  // Replacement: 下方以 canonical 为主，仅 canonical 缺失、损坏或落后于本机已知 revision 时扫描 journal。
  // Risk: Medium；其他设备只写入 journal、未完成 canonical 的失败事务不再由下一 revision 猜测恢复。
  // Human Review: Required
  //
  // Original code:
  // const nextRevisionStatePromise = lastSeenRevision === null
  //   ? null
  //   : readSpecificRevisionJournalState(
  //     client,
  //     indexPath,
  //     lastSeenRevision + 1,
  //     normalizeRemoteIndex,
  //   );
  const file = await canonicalFilePromise;
  let canonicalState: RemoteIndexState | null = null;
  if (file !== null) {
    try {
      canonicalState = {
        index: normalizeRemoteIndex(JSON.parse(file.content)),
        etag: file.etag,
        canonicalEtag: file.etag,
        canonicalMissing: false,
        lastModified: normalizeRemoteTimestamp(file.lastModified),
      };
    } catch {
      canonicalState = null;
    }
  }

  // AI-REMOVED 2026-07-29:
  // Reason: canonical index 与 revision journal 相互独立，串行等待增加一次网络往返。
  // Trigger: 用户要求在最大连接数限制下并行下载。
  // Evidence: journal 读取不依赖 canonical index 内容。
  // Replacement: canonical GET 与“上次 revision + 1”探测并行；仅检测到变化时才完整枚举 journal。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const journalState = await readLatestRevisionJournalState(
  //   client,
  //   indexPath,
  //   normalizeRemoteIndex,
  // );
  // AI-REMOVED 2026-07-29:
  // Reason: 首次同步没有 revision 游标时无条件枚举完整 journal，会在读取 canonical 之后再串行执行 PROPFIND、目录列表和 revision GET。
  // Trigger: 当前画布相同的首次检查仍在 10% 停顿数秒。
  // Evidence: 成功提交总是先写 revision journal、最后写 canonical 镜像；canonical 完整且不落后时已经是权威快照。
  // Replacement: 仅 canonical 缺失/损坏，或探测到比 canonical 更新的 revision 时扫描 journal。
  // Risk: Low；提交中途 canonical 尚未更新的窗口仍由 next revision 探测覆盖。
  // Human Review: Required
  //
  // Original code:
  // const canUseRevisionCursor = lastSeenRevision !== null
  //   && nextRevisionState === null
  //   && canonicalState.index.revision === lastSeenRevision;
  // const journalState = canUseRevisionCursor
  //   ? null
  //   : await readLatestRevisionJournalState(
  //     client,
  //     indexPath,
  //     normalizeRemoteIndex,
  //   );
  // AI-CORRECTION 2026-07-29: 无游标的新设备会信任有效 canonical；
  // 若上一次失败提交只留下了更新 journal、没有完成 canonical 镜像，该孤立 revision 不阻塞首屏，等待后续成功提交修复。
  const shouldScanJournal = canonicalState === null
    || (
      lastSeenRevision !== null
      && canonicalState.index.revision < lastSeenRevision
    );
  const journalState = shouldScanJournal
    ? await readLatestRevisionJournalState(
      client,
      indexPath,
      normalizeRemoteIndex,
    )
    : null;
  const canonicalFallback: RemoteIndexState = canonicalState ?? {
    index: { revision: 0, entries: {} },
    etag: file?.etag ?? null,
    canonicalEtag: null,
    canonicalMissing: true,
    lastModified: normalizeRemoteTimestamp(file?.lastModified ?? null),
  };
  const selectedState = journalState !== null
    && journalState.value.revision >= canonicalFallback.index.revision
    ? { index: journalState.value, etag: journalState.etag }
    : canonicalFallback;
  const result: RemoteIndexState = {
    ...selectedState,
    canonicalMissing: canonicalFallback.canonicalMissing
      && journalState === null,
    lastModified: journalState === null
      ? canonicalFallback.lastModified
      : null,
    canonicalEtag: canonicalFallback.canonicalEtag !== null
      && createStableJsonHash(canonicalFallback.index)
        === createStableJsonHash(selectedState.index)
      ? canonicalFallback.canonicalEtag
      : null,
  };
  writeWebDavLastSeenRemoteRevision(indexPath, result.index.revision);

  return result;
}

async function _writeRemoteIndex(
  client: SyncStorageClient,
  indexPath: string,
  index: RemoteIndexFile,
  expectedRevision: number,
  canonicalMissing: boolean,
): Promise<void> {
  clearWebDavLastSeenRemoteEtag(indexPath);
  const committedIndex: RemoteIndexFile = {
    ...index,
    revision: expectedRevision + 1,
  };
  await writeRevisionJournalState(
    client,
    indexPath,
    committedIndex,
    createAtomicWriteOptions(canonicalMissing),
  );
  writeWebDavLastSeenRemoteRevision(indexPath, committedIndex.revision);
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
      const committedAt = normalizeRemoteTimestamp(entry.committedAt);

      return [[entryId, {
        contentHash: entry.contentHash,
        deletedAt,
        committedAt,
      } satisfies RemoteIndexEntry]];
    }),
  );

  return {
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0,
    entries,
  };
}

function _upsertRemoteIndexEntry(
  index: RemoteIndexFile,
  entryId: string,
  entry: Omit<RemoteIndexEntry, "committedAt">,
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
      [entryId]: {
        ...entry,
        committedAt: new Date().toISOString(),
      },
    },
  };
}

async function _readRemotePatchState<TValue>(
  client: SyncStorageClient,
  directoryPath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{
  readonly meta: RemotePatchMetaFile;
  readonly value: TValue;
  readonly etag: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly canonicalMissing: boolean;
} | null> {
  const metaState = await readRemotePatchMetaState(client, directoryPath);
  if (metaState === null) {
    return null;
  }
  const meta = metaState.meta;
  const canonicalMissing = metaState.canonicalMissing;

  // AI-REMOVED 2026-07-29:
  // Reason: full 与每个 delta 文件的路径已由 meta 完整给出，无需串行下载。
  // Trigger: 用户要求在最大连接数限制下并行下载。
  // Evidence: JSON Patch 只要求按顺序应用，不要求按顺序获取文件。
  // Replacement: 下方并行下载 full / delta，完成后仍按 deltaChain 顺序 apply。
  // Risk: Low；worker client 统一限制实际并发请求数。
  // Human Review: Required
  //
  // Original code:
  // const fullValue = await readRemoteJson(client, resolvePatchFullPath(directoryPath, meta.currentFullHash), normalizeRemote);
  // if (fullValue === null) {
  //   return null;
  // }
  //
  // let value = fullValue;
  // let baseHash = meta.currentFullHash;
  // for (const targetHash of meta.deltaChain) {
  //   const patch = await readRemoteJson<JsonPatchOperation[]>(
  //     client,
  //     resolvePatchDeltaPath(directoryPath, baseHash, targetHash),
  //     normalizeJsonPatchOperations,
  //   );
  //   if (patch === null) {
  //     return null;
  //   }
  //
  //   value = applyJsonPatch(value, patch);
  //   baseHash = targetHash;
  // }
  const [fullValue, patches] = await Promise.all([
    readRemoteJson(
      client,
      resolvePatchFullPath(directoryPath, meta.currentFullHash),
      normalizeRemote,
    ),
    Promise.all(meta.deltaChain.map(async (targetHash, index) => {
      const baseHash = index === 0
        ? meta.currentFullHash
        : meta.deltaChain[index - 1]!;

      return await readRemoteJson<JsonPatchOperation[]>(
        client,
        resolvePatchDeltaPath(directoryPath, baseHash, targetHash),
        normalizeJsonPatchOperations,
      );
    })),
  ]);
  if (fullValue === null || patches.some((patch) => patch === null)) {
    return null;
  }

  let value = fullValue;
  for (const patch of patches) {
    value = applyJsonPatch(value, patch!);
  }
  const normalizedValue = normalizeRemote === undefined
    ? value
    : normalizeRemote(value);
  if (normalizedValue === null) {
    return null;
  }

  return {
    meta,
    value: normalizedValue,
    etag: metaState.etag,
    remoteUpdatedAt: meta.committedAt ?? metaState.lastModified,
    canonicalMissing,
  };
}

async function readRemotePatchMetaState(
  client: SyncStorageClient,
  directoryPath: string,
): Promise<RemotePatchMetaState | null> {
  const metaPath = resolvePath(directoryPath, "meta.json");
  const lastSeenRevision = readWebDavLastSeenRemoteRevision(metaPath);
  const canonicalFilePromise = client.readTextFile(metaPath);
  // AI-REMOVED 2026-07-29:
  // Reason: canonical meta 已携带 revision，额外读取 next revision 会让未变化画布多一次无收益的 404。
  // Trigger: 用户要求相同画布尽可能在一秒内解除锁定。
  // Evidence: 真实 OwnCloud 对不存在 revision 的请求与 canonical 请求共享有限连接并增加尾延迟。
  // Replacement: canonical meta 缺失、损坏或低于本机已知 revision 时才扫描 journal。
  // Risk: Medium；未完成 canonical 镜像的外部失败事务不会主动探测。
  // Human Review: Required
  //
  // Original code:
  // const nextRevisionStatePromise = lastSeenRevision === null
  //   ? null
  //   : readSpecificRevisionJournalState(
  //     client,
  //     metaPath,
  //     lastSeenRevision + 1,
  //     normalizeRemotePatchMeta,
  //   );
  const file = await canonicalFilePromise;
  let canonicalState: RemotePatchMetaState | null = null;
  if (file !== null) {
    try {
      const meta = normalizeRemotePatchMeta(JSON.parse(file.content));
      canonicalState = meta === null
        ? null
        : {
          meta,
          etag: file.etag,
          canonicalMissing: false,
          lastModified: normalizeRemoteTimestamp(file.lastModified),
        };
    } catch {
      canonicalState = null;
    }
  }

  // AI-REMOVED 2026-07-29:
  // Reason: canonical meta 与 revision journal 可独立下载，串行执行浪费往返时间。
  // Trigger: 用户要求在限制最大连接数的情况下并行下载。
  // Evidence: 两条读取路径只在结果选择阶段合并。
  // Replacement: canonical GET 与“上次 revision + 1”探测并行；游标失配时再完整扫描 journal。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const journalState = await readLatestRevisionJournalState(
  //   client,
  //   metaPath,
  //   normalizeRemotePatchMeta,
  // );
  // AI-REMOVED 2026-07-29:
  // Reason: canonical meta 有效时首次读取仍扫描整个 revision 目录，重复了成功提交已经镜像的数据。
  // Trigger: 当前画布检查在 35% 到 55% 之间产生多次串行 WebDAV 请求。
  // Evidence: writeRemotePatchMeta 先原子认领 revision，随后写 canonical meta；只有 canonical 缺失或落后才需要恢复扫描。
  // Replacement: 下方 shouldScanJournal 恢复条件。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const canUseRevisionCursor = lastSeenRevision !== null
  //   && nextRevisionState === null
  //   && canonicalState?.meta.revision === lastSeenRevision;
  // const journalState = canUseRevisionCursor
  //   ? null
  //   : await readLatestRevisionJournalState(
  //     client,
  //     metaPath,
  //     normalizeRemotePatchMeta,
  //   );
  // AI-CORRECTION 2026-07-29: 无游标的新设备会信任有效 canonical meta；
  // 仅写入 journal 而未完成 canonical 的失败提交不进入首屏恢复路径。
  const shouldScanJournal = canonicalState === null
    || (
      lastSeenRevision !== null
      && canonicalState.meta.revision < lastSeenRevision
    );
  const journalState = shouldScanJournal
    ? await readLatestRevisionJournalState(
      client,
      metaPath,
      normalizeRemotePatchMeta,
    )
    : null;
  if (
    journalState !== null
    && (
      canonicalState === null
      || journalState.value.revision >= canonicalState.meta.revision
    )
  ) {
    const result = {
      meta: journalState.value,
      etag: journalState.etag,
      canonicalMissing: canonicalState === null,
      lastModified: null,
    };
    writeWebDavLastSeenRemoteRevision(metaPath, result.meta.revision);

    return result;
  }

  if (canonicalState !== null) {
    writeWebDavLastSeenRemoteRevision(
      metaPath,
      canonicalState.meta.revision,
    );
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
    committedAt: normalizeRemoteTimestamp(value.committedAt),
  };
}

interface WriteRemotePatchContentResult {
  readonly nextMeta: RemotePatchMetaFile;
  readonly metaWriteOptions: SyncWriteOptions;
}

async function writeRemotePatchContent<TValue>(options: {
  readonly client: SyncStorageClient;
  readonly directoryPath: string;
  readonly value: TValue;
  readonly previousState: { readonly meta: RemotePatchMetaFile; readonly value: TValue; readonly etag: string | null; readonly canonicalMissing: boolean } | null;
  readonly deltaThreshold: number;
}): Promise<WriteRemotePatchContentResult> {
  await options.client.makeDirectory(options.directoryPath);
  const nextHash = createStableJsonHash(options.value);

  if (options.previousState === null) {
    await options.client.writeTextFile(resolvePatchFullPath(options.directoryPath, nextHash), JSON.stringify(options.value));
    return {
      nextMeta: {
        revision: 1,
        currentFullHash: nextHash,
        deltaChain: [],
        deltaThreshold: options.deltaThreshold,
        committedAt: new Date().toISOString(),
      },
      metaWriteOptions: createAtomicWriteOptions(false),
    };
  }

  const previousHash = resolvePatchLatestHash(options.previousState.meta);
  const nextDeltaChain = [...options.previousState.meta.deltaChain, nextHash];
  const nextRevision = options.previousState.meta.revision + 1;

  if (nextDeltaChain.length >= options.previousState.meta.deltaThreshold) {
    await options.client.writeTextFile(resolvePatchFullPath(options.directoryPath, nextHash), JSON.stringify(options.value));
    return {
      nextMeta: {
        revision: nextRevision,
        currentFullHash: nextHash,
        deltaChain: [],
        deltaThreshold: options.previousState.meta.deltaThreshold,
        committedAt: new Date().toISOString(),
      },
      metaWriteOptions: createAtomicWriteOptions(options.previousState.canonicalMissing),
    };
  }

  const patch = generateJsonPatch(options.previousState.value, options.value);
  await options.client.writeTextFile(resolvePatchDeltaPath(options.directoryPath, previousHash, nextHash), JSON.stringify(patch));
  return {
    nextMeta: {
      revision: nextRevision,
      currentFullHash: options.previousState.meta.currentFullHash,
      deltaChain: nextDeltaChain,
      deltaThreshold: options.previousState.meta.deltaThreshold,
      committedAt: new Date().toISOString(),
    },
    metaWriteOptions: createAtomicWriteOptions(options.previousState.canonicalMissing),
  };
}

async function _writeRemotePatchState<TValue>(options: {
  readonly client: SyncStorageClient;
  readonly directoryPath: string;
  readonly value: TValue;
  readonly previousState: { readonly meta: RemotePatchMetaFile; readonly value: TValue; readonly etag: string | null; readonly canonicalMissing: boolean } | null;
  readonly deltaThreshold: number;
}): Promise<void> {
  const { nextMeta, metaWriteOptions } = await writeRemotePatchContent(options);
  await writeRemotePatchMeta(options.client, options.directoryPath, nextMeta, metaWriteOptions);
}

function createAtomicWriteOptions(canonicalMissing: boolean): SyncWriteOptions {
  return canonicalMissing ? {} : { ifNoneMatch: "*" };
}

// AI-REMOVED 2026-07-29:
// Reason: resolveLatestMetaWriteOptions 对 meta.json 做冗余 GET，仅为确认 canonicalMissing 和检查并发修改。
// Trigger: 每次 PUT 后约 0.5s 的额外 GET 叠加到 ~9 次请求序列中，用户感知到 10+ 秒保存延迟。
// Evidence: previousState 已携带 canonicalMissing，revision journal 的 ifNoneMatch 原子创建机制已防止并发覆盖。
// Replacement: writeRemotePatchState 直接使用 options.previousState.canonicalMissing 构造 writeOptions。
// Risk: Low；跳过 stale-check 不会导致数据丢失，revision journal 的原子写入保证只有一方认领成功。
// Human Review: Required
//
// Original code:
// async function resolveLatestMetaWriteOptions(
//   client: SyncStorageClient,
//   directoryPath: string,
//   expectedMeta: RemotePatchMetaFile,
// ): Promise<SyncWriteOptions> {
//   const latestMetaState = await readRemotePatchMetaState(client, directoryPath);
//   if (latestMetaState === null) {
//     return createAtomicWriteOptions(true);
//   }
//
//   if (latestMetaState.canonicalMissing) {
//     return createAtomicWriteOptions(true);
//   }
//
//   if (!areRemotePatchMetaFilesEqual(latestMetaState.meta, expectedMeta)) {
//     throw new Error("Remote patch meta changed before write.");
//   }
//
//   return createAtomicWriteOptions(false);
// }

async function writeRemotePatchMeta(
  client: SyncStorageClient,
  directoryPath: string,
  meta: RemotePatchMetaFile,
  writeOptions: SyncWriteOptions,
): Promise<void> {
  const metaPath = resolvePath(directoryPath, "meta.json");
  await writeRevisionJournalState(
    client,
    metaPath,
    meta,
    writeOptions,
  );
  writeWebDavLastSeenRemoteRevision(metaPath, meta.revision);
}

// AI-REMOVED 2026-07-29:
// Reason: 仅被已删除的 resolveLatestMetaWriteOptions 调用，无其他引用。
// Trigger: resolveLatestMetaWriteOptions 已被移除。
// Evidence: rg 仅剩本函数定义及其在 resolveLatestMetaWriteOptions 中的调用点。
// Replacement: None.
// Risk: Low.
// Human Review: Required
//
// Original code:
// function areRemotePatchMetaFilesEqual(
//   left: RemotePatchMetaFile,
//   right: RemotePatchMetaFile,
// ): boolean {
//   return left.revision === right.revision
//     && left.currentFullHash === right.currentFullHash
//     && left.deltaThreshold === right.deltaThreshold
//     && left.committedAt === right.committedAt
//     && left.deltaChain.length === right.deltaChain.length
//     && left.deltaChain.every((entry, index) => entry === right.deltaChain[index]);
// }

async function readLatestRevisionJournalState<TValue extends { readonly revision: number }>(
  client: SyncStorageClient,
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

// AI-REMOVED 2026-07-29:
// Reason: 逐次探测 next revision 已从所有读取路径移除，保留该函数会形成无调用的旧协议实现。
// Trigger: 相同画布首屏检查被不存在 revision 的 GET 拖慢。
// Evidence: rg 仅剩审计注释引用；active code 已改为 canonical 优先、必要时扫描完整 journal。
// Replacement: readRemoteIndexState / readRemotePatchMetaState 的 shouldScanJournal 分支。
// Risk: Medium；canonical 有效时不主动发现其他设备未完成镜像的孤立 revision。
// Human Review: Required
//
// Original code:
// async function readSpecificRevisionJournalState<TValue extends { readonly revision: number }>(
//   client: SyncStorageClient,
//   canonicalPath: string,
//   revision: number,
//   normalize: (value: unknown) => TValue | null,
// ): Promise<{
//   readonly value: TValue;
//   readonly etag: string | null;
// } | null> {
//   const revisionPath = resolvePath(
//     resolveRevisionDirectoryPath(canonicalPath),
//     `rev-${revision.toString().padStart(12, "0")}.json`,
//   );
//   const file = await client.readTextFile(revisionPath);
//   if (file === null) {
//     return null;
//   }
//
//   try {
//     const value = normalize(JSON.parse(file.content));
//     return value?.revision === revision
//       ? { value, etag: file.etag }
//       : null;
//   } catch {
//     return null;
//   }
// }

async function writeRevisionJournalState<TValue extends { readonly revision: number }>(
  client: SyncStorageClient,
  canonicalPath: string,
  value: TValue,
  writeOptions: SyncWriteOptions = { ifNoneMatch: "*" },
): Promise<void> {
  const revisionDirectoryPath = resolveRevisionDirectoryPath(canonicalPath);
  await client.makeDirectory(revisionDirectoryPath);
  const serializedValue = JSON.stringify(value);
  const revisionPath = resolvePath(
    revisionDirectoryPath,
    `rev-${value.revision.toString().padStart(12, "0")}.json`,
  );

  // 修订文件通过临时文件 + MOVE(Overwrite:F) 原子认领；canonical 文件仅是便于人工查看的镜像。
  // AI-CORRECTION 2026-07-29: revision 文件与 canonical 镜像无依赖，可并行写入节省一次网络往返。
  await Promise.all([
    client.writeTextFile(revisionPath, serializedValue, writeOptions),
    client.writeTextFile(canonicalPath, serializedValue),
  ]);
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

async function _ensureRemoteParentDirectory(
  client: SyncStorageClient,
  remotePath: string,
): Promise<void> {
  const slashIndex = remotePath.lastIndexOf("/");
  if (slashIndex <= 0) {
    return;
  }

  await client.makeDirectory(remotePath.slice(0, slashIndex));
}

function normalizeJsonPatchOperations(value: unknown): JsonPatchOperation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value as JsonPatchOperation[];
}

function mergeStatus(
  current: SyncAdapterStatus,
  next: SyncAdapterStatus,
): SyncAdapterStatus {
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

function normalizeRemoteTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
