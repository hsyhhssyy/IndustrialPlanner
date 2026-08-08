import { createStableJsonHash } from "@/shared/storage/hash-utils";
import {
  applyJsonPatch,
  generateJsonPatch,
  type JsonPatchOperation,
} from "@/shared/storage/json-patch-codec";
import type {
  RemoteApplyResult,
  RemoteAssetContent,
  RemoteAssetPutParams,
  RemoteAssetRef,
  RemoteAssetTombstoneParams,
  RemoteCheckResult,
  RemoteCollectionIndex,
  RemoteWriteBatchResult,
  RemoteWriteResult,
  SyncLocalState,
  SyncRemote,
  SyncRemoteCollection,
  SyncRemoteSession,
  SyncRemoteSessionContext,
  SyncRemoteWriteBatch,
} from "../remote-types";
import type {
  SyncStorageClient,
  SyncWriteOptions,
} from "../types";
import {
  clearWebDavLastSeenRemoteEtag,
  clearWebDavLastSeenRemoteRevision,
  clearWebDavLastSyncedContentHash,
  readWebDavLastSeenRemoteEtag,
  readWebDavLastSeenRemoteRevision,
  readWebDavLastSyncedContentHash,
  writeWebDavLastSeenRemoteEtag,
  writeWebDavLastSeenRemoteRevision,
  writeWebDavLastSyncedContentHash,
} from "../../storage";

export interface WebDavSyncRemoteOptions {
  readonly client: SyncStorageClient;
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

interface RemotePatchState<TValue> {
  readonly meta: RemotePatchMetaFile;
  readonly value: TValue;
  readonly etag: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly canonicalMissing: boolean;
}

type WebDavWriteMutation =
  | {
      readonly type: "put";
      readonly params: RemoteAssetPutParams;
    }
  | {
      readonly type: "tombstone";
      readonly params: RemoteAssetTombstoneParams;
    };

export function createWebDavSyncRemote(options: WebDavSyncRemoteOptions): SyncRemote {
  return new WebDavSyncRemote(options.client);
}

export class WebDavSyncRemote implements SyncRemote {
  public readonly localState = new WebDavSyncLocalState();

  public constructor(private readonly client: SyncStorageClient) {}

  public async beginSession(
    context: SyncRemoteSessionContext,
  ): Promise<SyncRemoteSession> {
    return new WebDavSyncRemoteSession(this.client, this.localState, context);
  }

  public async resetRemote(): Promise<void> {
    await this.client.deleteResource("");
  }

  public dispose(): void {
    this.client.dispose?.();
  }
}

class WebDavSyncLocalState implements SyncLocalState {
  public async getLastSyncedHash(assetKey: string): Promise<string | null> {
    return readWebDavLastSyncedContentHash(assetKey);
  }

  public async setLastSyncedHash(assetKey: string, hash: string | null): Promise<void> {
    if (hash === null) {
      clearWebDavLastSyncedContentHash(assetKey);
      return;
    }

    writeWebDavLastSyncedContentHash(assetKey, hash);
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    return readWebDavLastSeenRemoteRevision(key);
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    if (revision === null) {
      clearWebDavLastSeenRemoteRevision(key);
      return;
    }

    writeWebDavLastSeenRemoteRevision(key, revision);
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    return readWebDavLastSeenRemoteEtag(key);
  }

  public async setRemoteEtag(key: string, etag: string | null): Promise<void> {
    if (etag === null) {
      clearWebDavLastSeenRemoteEtag(key);
      return;
    }

    writeWebDavLastSeenRemoteEtag(key, etag);
  }
}

class WebDavSyncRemoteSession implements SyncRemoteSession {
  private readonly indexStateCache = new Map<string, RemoteIndexState>();
  private readonly indexCache = new Map<string, RemoteCollectionIndex>();
  private readonly assetCache = new Map<string, RemoteAssetContent | null>();
  private readonly patchStateCache = new Map<string, RemotePatchState<unknown> | null>();

  public constructor(
    private readonly client: SyncStorageClient,
    public readonly localState: SyncLocalState,
    private readonly context: SyncRemoteSessionContext,
  ) {}

  public async prefetchIndexes(collections: readonly SyncRemoteCollection[]): Promise<void> {
    await Promise.all(collections.map(async (collection) => {
      await this.readIndex(collection);
    }));
  }

  public async readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex> {
    const cached = this.indexCache.get(collection.adapterId);
    if (cached !== undefined) {
      return cached;
    }

    const binding = requireWebDavBinding(collection);
    if (binding.kind === "full-with-revision" || binding.kind === "patch-collection-with-revision") {
      const state = await this.readWebDavIndexState(collection);
      const index = toRemoteCollectionIndex(state);
      this.indexCache.set(collection.adapterId, index);

      return index;
    }

    const assetId = binding.kind === "full-no-revision" ? "single" : "snapshot";
    const asset = await this.readAsset({ collection, assetId });
    const index: RemoteCollectionIndex = {
      revision: asset?.revision ?? 0,
      entries: asset === null
        ? {}
        : {
            [assetId]: {
              revision: asset.revision,
              contentHash: asset.contentHash,
              deletedAt: null,
              committedAt: asset.committedAt,
            },
          },
      committedAt: asset?.committedAt ?? null,
      etag: asset?.etag ?? null,
    };
    this.indexCache.set(collection.adapterId, index);

    return index;
  }

  public async readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null> {
    const cacheKey = createAssetCacheKey(params.collection, params.assetId);
    if (this.assetCache.has(cacheKey)) {
      return this.assetCache.get(cacheKey) ?? null;
    }

    const binding = requireWebDavBinding(params.collection);
    const content = await this.readAssetByBinding(params.collection, binding, params.assetId);
    this.assetCache.set(cacheKey, content);

    return content;
  }

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    const changedCollections = (await Promise.all(collections.map(async (collection) => {
      const binding = requireWebDavBinding(collection);
      const statPath = resolveWebDavCheckPath(binding);
      const lastEtag = await this.localState.getRemoteEtag(collection.stateKey);
      if (lastEtag === null) {
        return collection.adapterId;
      }

      const stat = await this.client.stat(statPath);
      return stat?.etag === lastEtag ? null : collection.adapterId;
    }))).filter((adapterId): adapterId is string => adapterId !== null);

    return { changedCollections };
  }

  public beginWriteBatch(): SyncRemoteWriteBatch {
    return new WebDavSyncRemoteWriteBatch(this);
  }

  public async markApplied(result: RemoteApplyResult): Promise<void> {
    if (result.collectionRevision !== null) {
      await this.localState.setRemoteRevision(
        result.collection.stateKey,
        result.collectionRevision,
      );
    }
    if (result.collectionEtag !== undefined) {
      await this.localState.setRemoteEtag(result.collection.stateKey, result.collectionEtag);
    }
  }

  public async prepareCollections(collections: readonly SyncRemoteCollection[]): Promise<void> {
    const directoryPaths = new Set<string>([""]);
    for (const collection of collections) {
      addWebDavBindingDirectoryPaths(directoryPaths, requireWebDavBinding(collection));
    }

    const pathsByDepth = new Map<number, string[]>();
    for (const path of directoryPaths) {
      const depth = path === "" ? 0 : path.split("/").length;
      const paths = pathsByDepth.get(depth) ?? [];
      paths.push(path);
      pathsByDepth.set(depth, paths);
    }
    for (const depth of Array.from(pathsByDepth.keys()).sort((left, right) => left - right)) {
      await Promise.all(
        (pathsByDepth.get(depth) ?? []).map(async (path) => {
          await this.client.makeDirectory(path);
        }),
      );
    }
  }

  public dispose(): void {}

  public async readWebDavIndexState(collection: SyncRemoteCollection): Promise<RemoteIndexState> {
    const cached = this.indexStateCache.get(collection.adapterId);
    if (cached !== undefined) {
      return cached;
    }

    const binding = requireWebDavBinding(collection);
    if (binding.kind !== "full-with-revision" && binding.kind !== "patch-collection-with-revision") {
      throw new Error(`Collection "${collection.adapterId}" does not expose a WebDAV index.`);
    }

    const state = await readRemoteIndexState(this.client, binding.indexPath);
    this.indexStateCache.set(collection.adapterId, state);

    return state;
  }

  public async readWebDavPatchState(
    collection: SyncRemoteCollection,
    assetId: string,
  ): Promise<RemotePatchState<unknown> | null> {
    const cacheKey = createAssetCacheKey(collection, assetId);
    if (this.patchStateCache.has(cacheKey)) {
      return this.patchStateCache.get(cacheKey) ?? null;
    }

    const binding = requireWebDavBinding(collection);
    const directoryPath = binding.kind === "patch-with-revision"
      ? binding.directoryPath
      : binding.kind === "patch-collection-with-revision"
        ? binding.directoryPath(assetId)
        : null;
    if (directoryPath === null) {
      throw new Error(`Collection "${collection.adapterId}" is not a WebDAV patch asset.`);
    }

    const state = await readRemotePatchState(this.client, directoryPath);
    this.patchStateCache.set(cacheKey, state);

    return state;
  }

  public getClient(): SyncStorageClient {
    return this.client;
  }

  private async readAssetByBinding(
    collection: SyncRemoteCollection,
    binding: ReturnType<typeof requireWebDavBinding>,
    assetId: string,
  ): Promise<RemoteAssetContent | null> {
    if (binding.kind === "full-no-revision") {
      return await readRemoteTextAsset(this.client, binding.remotePath, 0, null);
    }

    if (binding.kind === "full-with-revision") {
      const index = await this.readIndex(collection);
      const meta = index.entries[assetId] ?? null;
      if (meta === null || meta.deletedAt !== null) {
        return null;
      }

      return await readRemoteTextAsset(
        this.client,
        binding.entryPath(assetId),
        meta.revision,
        meta.committedAt ?? index.committedAt,
      );
    }

    const patchState = await this.readWebDavPatchState(collection, assetId);
    if (patchState === null) {
      return null;
    }

    const content = JSON.stringify(patchState.value);
    return {
      revision: patchState.meta.revision,
      content,
      contentHash: createStableJsonHash(patchState.value),
      committedAt: patchState.remoteUpdatedAt,
      etag: patchState.etag,
    };
  }
}

class WebDavSyncRemoteWriteBatch implements SyncRemoteWriteBatch {
  private readonly mutations: WebDavWriteMutation[] = [];

  public constructor(private readonly session: WebDavSyncRemoteSession) {}

  public putAsset(params: RemoteAssetPutParams): void {
    this.mutations.push({ type: "put", params });
  }

  public putTombstone(params: RemoteAssetTombstoneParams): void {
    this.mutations.push({ type: "tombstone", params });
  }

  public async commit(): Promise<RemoteWriteBatchResult> {
    const writes: RemoteWriteResult[] = [];
    const mutationsByAdapter = new Map<string, WebDavWriteMutation[]>();
    for (const mutation of this.mutations) {
      const adapterMutations = mutationsByAdapter.get(mutation.params.collection.adapterId) ?? [];
      adapterMutations.push(mutation);
      mutationsByAdapter.set(mutation.params.collection.adapterId, adapterMutations);
    }

    for (const mutations of mutationsByAdapter.values()) {
      writes.push(...await this.commitCollectionMutations(mutations));
    }

    this.mutations.length = 0;
    return { writes };
  }

  public async discard(): Promise<void> {
    this.mutations.length = 0;
  }

  private async commitCollectionMutations(
    mutations: readonly WebDavWriteMutation[],
  ): Promise<RemoteWriteResult[]> {
    const collection = mutations[0]?.params.collection;
    if (collection === undefined) {
      return [];
    }

    const binding = requireWebDavBinding(collection);
    switch (binding.kind) {
      case "full-no-revision":
        return await this.commitFullNoRevisionMutations(binding.remotePath, mutations);
      case "full-with-revision":
        return await this.commitFullCollectionMutations(collection, binding, mutations);
      case "patch-with-revision":
        return await this.commitPatchMutations(
          collection,
          binding.directoryPath,
          binding.deltaThreshold ?? 50,
          mutations,
        );
      case "patch-collection-with-revision":
        return await this.commitPatchCollectionMutations(collection, binding, mutations);
    }
  }

  private async commitFullNoRevisionMutations(
    remotePath: string,
    mutations: readonly WebDavWriteMutation[],
  ): Promise<RemoteWriteResult[]> {
    const client = this.session.getClient();
    const writes: RemoteWriteResult[] = [];
    for (const mutation of mutations) {
      if (mutation.type !== "put") {
        continue;
      }

      await ensureRemoteParentDirectory(client, remotePath);
      await client.writeTextFile(remotePath, mutation.params.content);
      writes.push({
        collection: mutation.params.collection,
        assetId: mutation.params.assetId,
        revision: 0,
        contentHash: mutation.params.contentHash,
        deletedAt: null,
        committedAt: new Date().toISOString(),
      });
      await this.session.localState.setRemoteEtag(mutation.params.collection.stateKey, null);
    }

    return writes;
  }

  private async commitFullCollectionMutations(
    collection: SyncRemoteCollection,
    binding: Extract<NonNullable<SyncRemoteCollection["webDav"]>, { readonly kind: "full-with-revision" }>,
    mutations: readonly WebDavWriteMutation[],
  ): Promise<RemoteWriteResult[]> {
    const client = this.session.getClient();
    const indexState = await this.session.readWebDavIndexState(collection);
    let nextIndex = indexState.index;
    const writes: RemoteWriteResult[] = [];

    for (const mutation of mutations) {
      if (mutation.type === "put") {
        const entryPath = binding.entryPath(mutation.params.assetId);
        await ensureRemoteParentDirectory(client, entryPath);
        await client.writeTextFile(entryPath, mutation.params.content);
        nextIndex = upsertRemoteIndexEntry(nextIndex, mutation.params.assetId, {
          contentHash: mutation.params.contentHash,
          deletedAt: null,
        });
        writes.push(createWriteResult(mutation.params, nextIndex.revision, null));
      } else {
        nextIndex = upsertRemoteIndexEntry(nextIndex, mutation.params.assetId, {
          contentHash: mutation.params.targetContentHash ?? mutation.params.baseContentHash ?? "",
          deletedAt: mutation.params.deletedAt,
        });
        writes.push(createTombstoneResult(mutation.params, nextIndex.revision));
      }
    }

    if (nextIndex.revision !== indexState.index.revision) {
      await this.session.localState.setRemoteEtag(collection.stateKey, null);
      await writeRemoteIndex(
        client,
        binding.indexPath,
        nextIndex,
        indexState.index.revision,
        indexState.canonicalMissing,
      );
    }

    return writes;
  }

  private async commitPatchMutations(
    collection: SyncRemoteCollection,
    directoryPath: string,
    deltaThreshold: number,
    mutations: readonly WebDavWriteMutation[],
  ): Promise<RemoteWriteResult[]> {
    const client = this.session.getClient();
    const writes: RemoteWriteResult[] = [];
    for (const mutation of mutations) {
      if (mutation.type !== "put") {
        continue;
      }

      const previousState = await this.session.readWebDavPatchState(
        collection,
        mutation.params.assetId,
      );
      const value = parseJsonContent(mutation.params.content);
      await writeRemotePatchState({
        client,
        directoryPath,
        value,
        previousState,
        deltaThreshold,
      });
      writes.push(createWriteResult(
        mutation.params,
        (previousState?.meta.revision ?? 0) + 1,
        null,
      ));
      await this.session.localState.setRemoteEtag(collection.stateKey, null);
    }

    return writes;
  }

  private async commitPatchCollectionMutations(
    collection: SyncRemoteCollection,
    binding: Extract<NonNullable<SyncRemoteCollection["webDav"]>, { readonly kind: "patch-collection-with-revision" }>,
    mutations: readonly WebDavWriteMutation[],
  ): Promise<RemoteWriteResult[]> {
    const client = this.session.getClient();
    const indexState = await this.session.readWebDavIndexState(collection);
    let nextIndex = indexState.index;
    const writes: RemoteWriteResult[] = [];
    const pendingMetaWrites: Promise<void>[] = [];

    for (const mutation of mutations) {
      if (mutation.type === "put") {
        const previousState = await this.session.readWebDavPatchState(
          collection,
          mutation.params.assetId,
        );
        const value = parseJsonContent(mutation.params.content);
        const { nextMeta, metaWriteOptions } = await writeRemotePatchContent({
          client,
          directoryPath: binding.directoryPath(mutation.params.assetId),
          value,
          previousState,
          deltaThreshold: binding.deltaThreshold ?? 50,
        });
        nextIndex = upsertRemoteIndexEntry(nextIndex, mutation.params.assetId, {
          contentHash: mutation.params.contentHash,
          deletedAt: null,
        });
        pendingMetaWrites.push(
          writeRemotePatchMeta(
            client,
            binding.directoryPath(mutation.params.assetId),
            nextMeta,
            metaWriteOptions,
          ),
        );
        writes.push(createWriteResult(mutation.params, nextMeta.revision, null));
      } else {
        nextIndex = upsertRemoteIndexEntry(nextIndex, mutation.params.assetId, {
          contentHash: mutation.params.targetContentHash ?? mutation.params.baseContentHash ?? "",
          deletedAt: mutation.params.deletedAt,
        });
        writes.push(createTombstoneResult(mutation.params, nextIndex.revision));
      }
    }

    const indexWritePromise = nextIndex.revision !== indexState.index.revision
      ? writeRemoteIndex(
          client,
          binding.indexPath,
          nextIndex,
          indexState.index.revision,
          indexState.canonicalMissing,
        )
      : null;
    await this.session.localState.setRemoteEtag(collection.stateKey, null);
    await Promise.all([
      ...pendingMetaWrites,
      ...(indexWritePromise === null ? [] : [indexWritePromise]),
    ]);

    return writes;
  }
}

function requireWebDavBinding(collection: SyncRemoteCollection): NonNullable<SyncRemoteCollection["webDav"]> {
  if (collection.webDav === undefined) {
    throw new Error(`Collection "${collection.adapterId}" has no WebDAV binding.`);
  }

  return collection.webDav;
}

function resolveWebDavCheckPath(binding: NonNullable<SyncRemoteCollection["webDav"]>): string {
  switch (binding.kind) {
    case "full-no-revision":
      return binding.remotePath;
    case "full-with-revision":
    case "patch-collection-with-revision":
      return binding.indexPath;
    case "patch-with-revision":
      return resolvePath(binding.directoryPath, "meta.json");
  }
}

function toRemoteCollectionIndex(state: RemoteIndexState): RemoteCollectionIndex {
  return {
    revision: state.index.revision,
    entries: Object.fromEntries(
      Object.entries(state.index.entries).map(([assetId, entry]) => [assetId, {
        revision: state.index.revision,
        contentHash: entry.contentHash,
        deletedAt: entry.deletedAt,
        committedAt: entry.committedAt,
      }]),
    ),
    committedAt: state.lastModified,
    etag: state.canonicalEtag,
  };
}

async function readRemoteTextAsset(
  client: SyncStorageClient,
  remotePath: string,
  revision: number,
  committedAt: string | null,
): Promise<RemoteAssetContent | null> {
  const file = await client.readTextFile(remotePath);
  if (file === null) {
    return null;
  }

  return {
    revision,
    content: file.content,
    contentHash: createRemoteContentHash(file.content),
    committedAt: committedAt ?? normalizeRemoteTimestamp(file.lastModified),
    etag: file.etag,
  };
}

function createRemoteContentHash(content: string): string {
  try {
    return createStableJsonHash(JSON.parse(content));
  } catch {
    return createStableJsonHash(content);
  }
}

function createWriteResult(
  params: RemoteAssetPutParams,
  revision: number,
  deletedAt: string | null,
): RemoteWriteResult {
  return {
    collection: params.collection,
    assetId: params.assetId,
    revision,
    contentHash: params.contentHash,
    deletedAt,
    committedAt: new Date().toISOString(),
  };
}

function createTombstoneResult(
  params: RemoteAssetTombstoneParams,
  revision: number,
): RemoteWriteResult {
  return {
    collection: params.collection,
    assetId: params.assetId,
    revision,
    contentHash: params.targetContentHash,
    deletedAt: params.deletedAt,
    committedAt: new Date().toISOString(),
  };
}

function parseJsonContent(content: string): unknown {
  return JSON.parse(content);
}

async function readRemoteJson<TValue>(
  client: SyncStorageClient,
  remotePath: string,
  normalizeRemote: ((value: unknown) => TValue | null) | undefined,
): Promise<TValue | null> {
  const file = await client.readTextFile(remotePath);
  if (file === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(file.content);
    return normalizeRemote === undefined
      ? parsed as TValue
      : normalizeRemote(parsed);
  } catch {
    return null;
  }
}

async function readRemoteIndexState(
  client: SyncStorageClient,
  indexPath: string,
): Promise<RemoteIndexState> {
  const lastSeenRevision = readWebDavLastSeenRemoteRevision(indexPath);
  const file = await client.readTextFile(indexPath);
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

async function writeRemoteIndex(
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

async function readRemotePatchState(
  client: SyncStorageClient,
  directoryPath: string,
): Promise<RemotePatchState<unknown> | null> {
  const metaState = await readRemotePatchMetaState(client, directoryPath);
  if (metaState === null) {
    return null;
  }
  const meta = metaState.meta;
  const [fullValue, patches] = await Promise.all([
    readRemoteJson(
      client,
      resolvePatchFullPath(directoryPath, meta.currentFullHash),
      undefined,
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

  return {
    meta,
    value,
    etag: metaState.etag,
    remoteUpdatedAt: meta.committedAt ?? metaState.lastModified,
    canonicalMissing: metaState.canonicalMissing,
  };
}

async function readRemotePatchMetaState(
  client: SyncStorageClient,
  directoryPath: string,
): Promise<RemotePatchMetaState | null> {
  const metaPath = resolvePath(directoryPath, "meta.json");
  const lastSeenRevision = readWebDavLastSeenRemoteRevision(metaPath);
  const file = await client.readTextFile(metaPath);
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

async function writeRemotePatchContent(options: {
  readonly client: SyncStorageClient;
  readonly directoryPath: string;
  readonly value: unknown;
  readonly previousState: RemotePatchState<unknown> | null;
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

async function writeRemotePatchState(options: {
  readonly client: SyncStorageClient;
  readonly directoryPath: string;
  readonly value: unknown;
  readonly previousState: RemotePatchState<unknown> | null;
  readonly deltaThreshold: number;
}): Promise<void> {
  const { nextMeta, metaWriteOptions } = await writeRemotePatchContent(options);
  await writeRemotePatchMeta(options.client, options.directoryPath, nextMeta, metaWriteOptions);
}

function createAtomicWriteOptions(canonicalMissing: boolean): SyncWriteOptions {
  return canonicalMissing ? {} : { ifNoneMatch: "*" };
}

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

  await Promise.all([
    client.writeTextFile(revisionPath, serializedValue, writeOptions),
    client.writeTextFile(canonicalPath, serializedValue),
  ]);
}

function addWebDavBindingDirectoryPaths(
  paths: Set<string>,
  binding: NonNullable<SyncRemoteCollection["webDav"]>,
): void {
  switch (binding.kind) {
    case "full-no-revision":
      addPathAncestors(paths, binding.remotePath);
      return;
    case "full-with-revision":
    case "patch-collection-with-revision":
      addPathAncestors(paths, binding.indexPath);
      return;
    case "patch-with-revision":
      paths.add(binding.directoryPath);
      addPathAncestors(paths, binding.directoryPath);
      return;
  }
}

function addPathAncestors(paths: Set<string>, filePath: string): void {
  const segments = filePath.split("/").filter(Boolean);
  segments.pop();
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    paths.add(current);
  }
}

function createAssetCacheKey(collection: SyncRemoteCollection, assetId: string): string {
  return `${collection.adapterId}:${assetId}`;
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