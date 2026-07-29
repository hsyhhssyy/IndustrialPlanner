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
  clearWebDavLastSeenRemoteEtag,
  readWebDavLastSeenRemoteEtag,
  readWebDavLastSeenRemoteRevision,
  readWebDavLastSyncedContentHash,
  writeWebDavLastSeenRemoteEtag,
  writeWebDavLastSeenRemoteRevision,
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
  readonly remoteValue: TValue | null;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
}

export interface WebDavSyncConflictDecision {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localHash: string;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly resolution: WebDavConflictResolution;
}

export interface WebDavSyncAdapter {
  readonly id: string;
  readonly mode: WebDavSyncMode;
  sync(
    client: WebDavStorageClient,
    scope?: WebDavSyncAdapterScope,
  ): Promise<WebDavSyncAdapterResult>;
  inspectConflicts?(
    client: WebDavStorageClient,
    scope?: WebDavSyncAdapterScope,
  ): Promise<readonly WebDavSyncConflict<unknown>[]>;
}

export interface WebDavSyncAdapterScope {
  readonly includeAssetIds?: readonly string[];
  readonly excludeAssetIds?: readonly string[];
  readonly onProgress?: (progress: number) => void;
  readonly conflictDecisions?: readonly WebDavSyncConflictDecision[];
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
  readonly listLocal: (
    scope?: WebDavSyncAdapterScope,
  ) => Promise<readonly FullWithRevisionEntry<TValue>[]>;
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
  readonly listLocal: (
    scope?: WebDavSyncAdapterScope,
  ) => Promise<readonly PatchWithRevisionEntry<TValue>[]>;
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
  readonly canonicalEtag: string | null;
  readonly lastModified: string | null;
}

interface RemoteIndexEntry {
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
  readonly lastModified: string | null;
}

export function createFullNoRevisionAdapter<TValue>(
  options: FullNoRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "full-no-revision",
    sync: async (client, scope) => await syncFullNoRevision(
      client,
      options,
      scope,
    ),
    inspectConflicts: async (client, scope) =>
      await inspectFullNoRevisionConflicts(client, options, scope),
  };
}

export function createFullWithRevisionAdapter<TValue>(
  options: FullWithRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "full-with-revision",
    sync: async (client, scope) => await syncFullWithRevision(client, options, scope),
    inspectConflicts: async (client, scope) =>
      await inspectFullWithRevisionConflicts(client, options, scope),
  };
}

export function createPatchWithRevisionAdapter<TValue>(
  options: PatchWithRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "patch-with-revision",
    sync: async (client, scope) => await syncPatchWithRevision(
      client,
      options,
      scope,
    ),
    inspectConflicts: async (client, scope) =>
      await inspectPatchWithRevisionConflicts(client, options, scope),
  };
}

export function createPatchCollectionWithRevisionAdapter<TValue>(
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
): WebDavSyncAdapter {
  return {
    id: options.id,
    mode: "patch-with-revision",
    sync: async (client, scope) => await syncPatchCollectionWithRevision(
      client,
      options,
      scope,
    ),
    inspectConflicts: async (client, scope) =>
      await inspectPatchCollectionWithRevisionConflicts(client, options, scope),
  };
}

async function inspectFullNoRevisionConflicts<TValue>(
  client: WebDavStorageClient,
  options: FullNoRevisionAdapterOptions<TValue>,
  scope?: WebDavSyncAdapterScope,
): Promise<readonly WebDavSyncConflict<TValue>[]> {
  if (!isAssetIncludedInScope("single", scope)) {
    return [];
  }

  const localValuePromise = options.readLocal();
  const remoteFilePromise = readRemoteJsonFile(
    client,
    options.remotePath,
    options.normalizeRemote,
  );
  const localValue = await localValuePromise;
  const remoteFile = await remoteFilePromise;
  const conflict = createValueConflict<TValue>({
    adapterId: options.id,
    assetId: "single",
    localValue,
    remoteValue: remoteFile?.value ?? null,
    lastSyncedHash: readWebDavLastSyncedContentHash(`${options.id}:single`),
    remoteDeletedAt: null,
    remoteUpdatedAt: remoteFile?.lastModified ?? null,
  });

  return conflict === null ? [] : [conflict];
}

async function inspectFullWithRevisionConflicts<TValue>(
  client: WebDavStorageClient,
  options: FullWithRevisionAdapterOptions<TValue>,
  scope?: WebDavSyncAdapterScope,
): Promise<readonly WebDavSyncConflict<TValue>[]> {
  const [localEntries, remoteIndexState] = await Promise.all([
    options.listLocal(scope),
    readRemoteIndexState(client, options.indexPath),
  ]);
  const includedLocalEntries = localEntries.filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const remoteValues = new Map(await Promise.all(
    includedLocalEntries.flatMap((entry) => {
      const remoteEntry = remoteIndexState.index.entries[entry.id];
      return remoteEntry === undefined || remoteEntry.deletedAt !== null
        ? []
        : [readRemoteJson(
          client,
          options.entryPath(entry.id),
          options.normalizeRemote,
        ).then((value) => [entry.id, value] as const)];
    }),
  ));

  return inspectCollectionConflicts({
    adapterId: options.id,
    localEntries: includedLocalEntries,
    remoteIndexState,
    readRemoteValue: (entryId) => remoteValues.get(entryId) ?? null,
    readRemoteUpdatedAt: (entryId) =>
      remoteIndexState.index.entries[entryId]?.committedAt
      ?? remoteIndexState.lastModified,
  });
}

async function inspectPatchWithRevisionConflicts<TValue>(
  client: WebDavStorageClient,
  options: PatchWithRevisionAdapterOptions<TValue>,
  scope?: WebDavSyncAdapterScope,
): Promise<readonly WebDavSyncConflict<TValue>[]> {
  if (!isAssetIncludedInScope("snapshot", scope)) {
    return [];
  }

  const localValuePromise = options.readLocal();
  const remoteStatePromise = readRemotePatchState(
    client,
    options.directoryPath,
    options.normalizeRemote,
  );
  const localValue = await localValuePromise;
  const remoteState = await remoteStatePromise;
  const conflict = createValueConflict<TValue>({
    adapterId: options.id,
    assetId: "snapshot",
    localValue,
    remoteValue: remoteState?.value ?? null,
    lastSyncedHash: readWebDavLastSyncedContentHash(
      `${options.id}:snapshot`,
    ),
    remoteDeletedAt: null,
    remoteUpdatedAt: remoteState?.remoteUpdatedAt ?? null,
  });

  return conflict === null ? [] : [conflict];
}

async function inspectPatchCollectionWithRevisionConflicts<TValue>(
  client: WebDavStorageClient,
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
  scope?: WebDavSyncAdapterScope,
): Promise<readonly WebDavSyncConflict<TValue>[]> {
  const [localEntries, remoteIndexState] = await Promise.all([
    options.listLocal(scope),
    readRemoteIndexState(client, options.indexPath),
  ]);
  const includedLocalEntries = localEntries.filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const remoteStates = new Map(await Promise.all(
    includedLocalEntries.flatMap((entry) => {
      const remoteEntry = remoteIndexState.index.entries[entry.id];
      return remoteEntry === undefined || remoteEntry.deletedAt !== null
        ? []
        : [readRemotePatchState(
          client,
          options.directoryPath(entry.id),
          options.normalizeRemote,
        ).then((state) => [entry.id, state] as const)];
    }),
  ));

  return inspectCollectionConflicts({
    adapterId: options.id,
    localEntries: includedLocalEntries,
    remoteIndexState,
    readRemoteValue: (entryId) =>
      remoteStates.get(entryId)?.value ?? null,
    readRemoteUpdatedAt: (entryId) =>
      remoteStates.get(entryId)?.remoteUpdatedAt
      ?? remoteIndexState.index.entries[entryId]?.committedAt
      ?? remoteIndexState.lastModified,
  });
}

function inspectCollectionConflicts<TValue>(options: {
  readonly adapterId: string;
  readonly localEntries: readonly {
    readonly id: string;
    readonly value: TValue;
    readonly deletedAt: string | null;
  }[];
  readonly remoteIndexState: RemoteIndexState;
  readonly readRemoteValue: (entryId: string) => TValue | null;
  readonly readRemoteUpdatedAt: (entryId: string) => string | null;
}): readonly WebDavSyncConflict<TValue>[] {
  return options.localEntries.flatMap((localEntry) => {
    const remoteEntry =
      options.remoteIndexState.index.entries[localEntry.id] ?? null;
    if (remoteEntry === null) {
      return [];
    }

    const localHash = createStableJsonHash(localEntry.value);
    const lastSyncedHash = readWebDavLastSyncedContentHash(
      `${options.adapterId}:${localEntry.id}`,
    );
    if (remoteEntry.deletedAt !== null) {
      if (
        localEntry.deletedAt !== null
        || lastSyncedHash === localHash
        || localHash === remoteEntry.contentHash
      ) {
        return [];
      }

      return [{
        adapterId: options.adapterId,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue: null,
        localHash,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
      }];
    }

    const remoteValue = options.readRemoteValue(localEntry.id);
    if (localEntry.deletedAt !== null) {
      if (remoteValue === null) {
        return [];
      }
      const remoteHash = createStableJsonHash(remoteValue);
      if (
        localHash === remoteHash
        || lastSyncedHash === remoteHash
      ) {
        return [];
      }

      return [{
        adapterId: options.adapterId,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue,
        localHash,
        remoteHash,
        remoteDeletedAt: null,
        remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
      }];
    }

    const conflict = createValueConflict({
      adapterId: options.adapterId,
      assetId: localEntry.id,
      localValue: localEntry.value,
      remoteValue,
      lastSyncedHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
    });

    return conflict === null ? [] : [conflict];
  });
}

function createValueConflict<TValue>(options: {
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue | null;
  readonly remoteValue: TValue | null;
  readonly lastSyncedHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
}): WebDavSyncConflict<TValue> | null {
  if (options.localValue === null || options.remoteValue === null) {
    return null;
  }

  const localHash = createStableJsonHash(options.localValue);
  const remoteHash = createStableJsonHash(options.remoteValue);
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
  scope: WebDavSyncAdapterScope | undefined,
  fallback:
    | ((
      conflict: WebDavSyncConflict<TValue>,
    ) => Promise<WebDavConflictResolution> | WebDavConflictResolution)
    | undefined,
): (
  conflict: WebDavSyncConflict<TValue>,
) => Promise<WebDavConflictResolution> | WebDavConflictResolution {
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
  client: WebDavStorageClient,
  options: FullNoRevisionAdapterOptions<TValue>,
  scope?: WebDavSyncAdapterScope,
): Promise<WebDavSyncAdapterResult> {
  const assetKey = `${options.id}:single`;
  const localValue = await options.readLocal();
  const remoteFile = await readRemoteJsonFile(
    client,
    options.remotePath,
    options.normalizeRemote,
  );
  const remoteValue = remoteFile?.value ?? null;
  const status = await syncSingleValue({
    adapterId: options.id,
    assetId: "single",
    localValue,
    remoteValue,
    remoteUpdatedAt: remoteFile?.lastModified ?? null,
    readLastSyncedHash: () => readWebDavLastSyncedContentHash(assetKey),
    writeLastSyncedHash: (contentHash) => writeWebDavLastSyncedContentHash(assetKey, contentHash),
    writeLocal: options.writeLocal,
    writeRemote: async (value) => {
      await ensureRemoteParentDirectory(client, options.remotePath);
      await client.writeTextFile(options.remotePath, JSON.stringify(value));
    },
    resolveConflict: createScopedConflictResolver(
      scope,
      options.resolveConflict,
    ),
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
  scope?: WebDavSyncAdapterScope,
): Promise<WebDavSyncAdapterResult> {
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  if (await isRemoteIndexUnchangedForCleanLocalEntries({
    adapterId: options.id,
    client,
    indexPath: options.indexPath,
    localEntries,
  })) {
    return {
      adapterId: options.id,
      mode: "full-with-revision",
      status: "idle",
      changedAssetIds: [],
    };
  }
  const remoteIndexState = await readRemoteIndexState(client, options.indexPath);
  const remoteIndex = remoteIndexState.index;
  const changedAssetIds: string[] = [];
  let nextIndex = remoteIndex;
  let status: WebDavSyncAdapterStatus = "idle";
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

    return [readRemoteJson(
      client,
      options.entryPath(entry.id),
      options.normalizeRemote,
    ).then((value) => [entry.id, value] as const)];
  })));

  for (const localEntry of localEntries) {
    const remoteEntry = remoteIndex.entries[localEntry.id] ?? null;
    const assetKey = `${options.id}:${localEntry.id}`;
    const localContentHash = createStableJsonHash(localEntry.value);
    const lastSyncedHash = readWebDavLastSyncedContentHash(assetKey);
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
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
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
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
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
          remoteEntry.committedAt ?? remoteIndexState.lastModified,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        const entryPath = options.entryPath(localEntry.id);
        await ensureRemoteParentDirectory(client, entryPath);
        await client.writeTextFile(entryPath, JSON.stringify(localEntry.value));
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: null,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
      } else {
        status = mergeStatus(status, "conflict");
      }
      changedAssetIds.push(localEntry.id);
      continue;
    }

    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null || remoteValue === null) {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: localEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = createStableJsonHash(remoteValue);
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: localEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const resolution = await resolveCollectionConflict({
        adapterId: options.id,
        assetId: localEntry.id,
        localValue: localEntry.value,
        remoteValue,
        localHash: localContentHash,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.lastModified,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: localEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: remoteValue,
          deletedAt: null,
        });
        writeWebDavLastSyncedContentHash(assetKey, remoteContentHash);
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
      writeWebDavLastSyncedContentHash(
        assetKey,
        remoteEntry.contentHash,
      );
      continue;
    }

    const entryStatus = await syncSingleValue({
      adapterId: options.id,
      assetId: localEntry.id,
      localValue: localEntry.value,
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
        const entryPath = options.entryPath(localEntry.id);
        await ensureRemoteParentDirectory(client, entryPath);
        await client.writeTextFile(entryPath, JSON.stringify(value));
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash,
          deletedAt: null,
        });
      },
      remoteUpdatedAt:
        remoteEntry?.committedAt ?? remoteIndexState.lastModified,
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
        ? [readRemoteJson(
          client,
          options.entryPath(entryId),
          options.normalizeRemote,
        ).then((value) => ({ entryId, value }))]
        : []
    ),
  );
  for (const { entryId, value: remoteValue } of remoteOnlyValues) {
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
    clearWebDavLastSeenRemoteEtag(options.indexPath);
    logger.info(`${options.id}: writing index.json → rev=${remoteIndex.revision + 1} (was ${remoteIndex.revision}), entries=${Object.keys(nextIndex.entries).length}`);
    await writeRemoteIndex(
      client,
      options.indexPath,
      nextIndex,
      remoteIndex.revision,
      remoteIndexState.etag,
    );
  } else if (
    status !== "conflict"
    && remoteIndexState.canonicalEtag !== null
  ) {
    writeWebDavLastSeenRemoteEtag(
      options.indexPath,
      remoteIndexState.canonicalEtag,
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
  scope?: WebDavSyncAdapterScope,
): Promise<WebDavSyncAdapterResult> {
  const assetKey = `${options.id}:snapshot`;
  const localValue = await options.readLocal();
  const remoteState = await readRemotePatchState(client, options.directoryPath, options.normalizeRemote);
  const status = await syncSingleValue({
    adapterId: options.id,
    assetId: "snapshot",
    localValue,
    remoteValue: remoteState?.value ?? null,
    remoteUpdatedAt: remoteState?.remoteUpdatedAt ?? null,
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
    resolveConflict: createScopedConflictResolver(
      scope,
      options.resolveConflict,
    ),
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
  scope?: WebDavSyncAdapterScope,
): Promise<WebDavSyncAdapterResult> {
  reportSyncProgress(scope, 0);
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  reportSyncProgress(scope, 10);
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  if (await isRemoteIndexUnchangedForCleanLocalEntries({
    adapterId: options.id,
    client,
    indexPath: options.indexPath,
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
  const remoteIndexState = await readRemoteIndexState(client, options.indexPath);
  reportSyncProgress(scope, 35);
  const remoteIndex = remoteIndexState.index;
  const changedAssetIds: string[] = [];
  let nextIndex = remoteIndex;
  let status: WebDavSyncAdapterStatus = "idle";
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

    return [readRemotePatchState(
      client,
      options.directoryPath(entry.id),
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
    const assetKey = `${options.id}:${localEntry.id}`;
    const localContentHash = createStableJsonHash(localEntry.value);
    const lastSyncedHash = readWebDavLastSyncedContentHash(assetKey);
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
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
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
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
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
          remoteEntry.committedAt ?? remoteIndexState.lastModified,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        const previousState = await readRemotePatchState(
          client,
          options.directoryPath(localEntry.id),
          options.normalizeRemote,
        );
        await writeRemotePatchState({
          client,
          directoryPath: options.directoryPath(localEntry.id),
          value: localEntry.value,
          previousState,
          deltaThreshold: options.deltaThreshold ?? 50,
        });
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: null,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
        status = mergeStatus(status, "downloaded");
      } else {
        status = mergeStatus(status, "conflict");
      }
      changedAssetIds.push(localEntry.id);
      continue;
    }

    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null || remoteState === null) {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: localEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = createStableJsonHash(remoteState.value);
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: localEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
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
          remoteState.remoteUpdatedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.lastModified,
        resolveConflict: createScopedConflictResolver(
          scope,
          options.resolveConflict,
        ),
      });
      if (resolution === "use-local") {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: localContentHash,
          deletedAt: localEntry.deletedAt,
        });
        writeWebDavLastSyncedContentHash(assetKey, localContentHash);
        status = mergeStatus(status, "uploaded");
      } else if (resolution === "use-remote") {
        await options.writeLocal({
          id: localEntry.id,
          value: remoteState.value,
          deletedAt: null,
        });
        writeWebDavLastSyncedContentHash(assetKey, remoteContentHash);
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
      writeWebDavLastSyncedContentHash(assetKey, remoteEntry.contentHash);
      continue;
    }

    const entryStatus = await syncSingleValue({
      adapterId: options.id,
      assetId: localEntry.id,
      localValue: localEntry.value,
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
      remoteUpdatedAt:
        remoteState?.remoteUpdatedAt
        ?? remoteEntry?.committedAt
        ?? remoteIndexState.lastModified,
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
      const normalizedRemoteHash = createStableJsonHash(remoteState.value);
      if (remoteEntry.contentHash !== normalizedRemoteHash) {
        nextIndex = upsertRemoteIndexEntry(nextIndex, localEntry.id, {
          contentHash: normalizedRemoteHash,
          deletedAt: null,
        });
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
        ? [readRemotePatchState(
          client,
          options.directoryPath(entryId),
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
    writeWebDavLastSyncedContentHash(`${options.id}:${entryId}`, createStableJsonHash(remoteState.value));
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }
  reportSyncProgress(scope, 94);

  if (nextIndex.revision !== remoteIndex.revision) {
    reportSyncProgress(scope, 96);
    clearWebDavLastSeenRemoteEtag(options.indexPath);
    logger.info(`${options.id}: writing collection index.json → rev=${remoteIndex.revision + 1} (was ${remoteIndex.revision}), entries=${Object.keys(nextIndex.entries).length}`);
    await writeRemoteIndex(
      client,
      options.indexPath,
      nextIndex,
      remoteIndex.revision,
      remoteIndexState.etag,
    );
  } else if (
    status !== "conflict"
    && remoteIndexState.canonicalEtag !== null
  ) {
    writeWebDavLastSeenRemoteEtag(
      options.indexPath,
      remoteIndexState.canonicalEtag,
    );
  }
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
  scope: WebDavSyncAdapterScope | undefined,
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
  scope: WebDavSyncAdapterScope | undefined,
  progress: number,
): void {
  scope?.onProgress?.(Math.min(100, Math.max(0, progress)));
}

async function isRemoteIndexUnchangedForCleanLocalEntries<TValue>(options: {
  readonly adapterId: string;
  readonly client: WebDavStorageClient;
  readonly indexPath: string;
  readonly localEntries: readonly {
    readonly id: string;
    readonly value: TValue;
    readonly deletedAt: string | null;
  }[];
}): Promise<boolean> {
  const lastSeenEtag = readWebDavLastSeenRemoteEtag(options.indexPath);
  if (
    lastSeenEtag === null
    || options.localEntries.length === 0
    || options.localEntries.some((entry) =>
      entry.deletedAt !== null
      || readWebDavLastSyncedContentHash(
        `${options.adapterId}:${entry.id}`,
      ) !== createStableJsonHash(entry.value)
    )
  ) {
    return false;
  }

  const remoteStat = await options.client.stat(options.indexPath);
  const unchanged = remoteStat?.type === "file"
    && remoteStat.etag !== null
    && remoteStat.etag === lastSeenEtag;
  if (unchanged) {
    logger.debug(
      `${options.adapterId}: canonical index ETag unchanged and local hashes clean → idle`,
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
    conflict: WebDavSyncConflict<TValue>,
  ) => Promise<WebDavConflictResolution> | WebDavConflictResolution;
}): Promise<WebDavConflictResolution> {
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
  readonly adapterId: string;
  readonly assetId: string;
  readonly localValue: TValue | null;
  readonly remoteValue: TValue | null;
  readonly remoteUpdatedAt: string | null;
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
    remoteDeletedAt: null,
    remoteUpdatedAt: options.remoteUpdatedAt,
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
  return (await readRemoteJsonFile(
    client,
    remotePath,
    normalizeRemote,
  ))?.value ?? null;
}

async function readRemoteJsonFile<TValue>(
  client: WebDavStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{
  readonly value: TValue;
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
        lastModified: normalizeRemoteTimestamp(file.lastModified),
      };
  } catch {
    return null;
  }
}

async function readRemoteIndexState(
  client: WebDavStorageClient,
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
    lastModified: normalizeRemoteTimestamp(file?.lastModified ?? null),
  };
  const selectedState = journalState !== null
    && journalState.value.revision >= canonicalFallback.index.revision
    ? { index: journalState.value, etag: journalState.etag }
    : canonicalFallback;
  const result: RemoteIndexState = {
    ...selectedState,
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

async function writeRemoteIndex(
  client: WebDavStorageClient,
  indexPath: string,
  index: RemoteIndexFile,
  expectedRevision: number,
  _etag: string | null,
): Promise<void> {
  clearWebDavLastSeenRemoteEtag(indexPath);
  const committedIndex: RemoteIndexFile = {
    ...index,
    revision: expectedRevision + 1,
  };
  await writeRevisionJournalState(client, indexPath, committedIndex);
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

function upsertRemoteIndexEntry(
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

async function readRemotePatchState<TValue>(
  client: WebDavStorageClient,
  directoryPath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<{
  readonly meta: RemotePatchMetaFile;
  readonly value: TValue;
  readonly etag: string | null;
  readonly remoteUpdatedAt: string | null;
} | null> {
  const metaState = await readRemotePatchMetaState(client, directoryPath);
  if (metaState === null) {
    return null;
  }
  const meta = metaState.meta;

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
  };
}

async function readRemotePatchMetaState(
  client: WebDavStorageClient,
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
      committedAt: new Date().toISOString(),
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
      committedAt: new Date().toISOString(),
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
    committedAt: new Date().toISOString(),
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
  const metaPath = resolvePath(directoryPath, "meta.json");
  await writeRevisionJournalState(
    client,
    metaPath,
    meta,
    writeOptions,
  );
  writeWebDavLastSeenRemoteRevision(metaPath, meta.revision);
}

function areRemotePatchMetaFilesEqual(
  left: RemotePatchMetaFile,
  right: RemotePatchMetaFile,
): boolean {
  return left.revision === right.revision
    && left.currentFullHash === right.currentFullHash
    && left.deltaThreshold === right.deltaThreshold
    && left.committedAt === right.committedAt
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
//   client: WebDavStorageClient,
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

async function ensureRemoteParentDirectory(
  client: WebDavStorageClient,
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
