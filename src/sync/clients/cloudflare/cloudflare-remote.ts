import {
  applyIndexedDbStoreMutations,
  clearIndexedDbStores,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
  type IndexedDbStoreLocation,
  type IndexedDbMutationOperation,
} from "@/shared/storage/browser-storage";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import { CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME } from "@/shared/storage/sync-tombstone-storage";
import { createUuid } from "@/domain/shared/uuid";
import { CfWorkerClient } from "./cloudflare-worker-client";
import type {
  CfWorkerOperation,
  CfPrefetchIndexesResult,
  CfReadAssetResult,
  CfCheckCollectionsResult,
  CfCommitBatchResult,
  CfEnsureSpaceResult,
  CfWorkerPlanResponse,
} from "./cloudflare-worker-protocol";
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
import { RemoteWriteConflictError } from "../remote-types";

// ============================================================================
// IndexedDB 配置
// ============================================================================

const CF_DATABASE_NAME = "v3-industrial-planner";
const CF_STATE_STORE = "cf-sync-state";
const CF_STATE_KEY_PREFIX = "state";
const CF_ASSETS_STORE = "cf-sync-assets";

// AI-REMOVED 2026-08-08:
// Reason: 固定状态键会让不同后端地址、不同用户空间共享 epoch/cursor，造成串号与漏同步。
// Trigger: Cloudflare 空间改为使用本地 ownerId，并允许显式传入开发后端地址。
// Evidence: 原状态位置只有全局 key "state"，没有 apiBase/spaceId 维度。
// Replacement: CloudflareSyncLocalState 构造器生成的 stateLocation。
// Risk: Low；旧的未隔离状态会被忽略，不会删除。
// Human Review: Required
//
// Original code:
// const CF_STATE_LOCATION: IndexedDbStorageLocation = {
//   databaseName: CF_DATABASE_NAME,
//   storeName: CF_STATE_STORE,
//   key: "state",
// };

const CF_ASSETS_LOCATION: IndexedDbStoreLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_ASSETS_STORE,
};

// ============================================================================
// 本地状态
// ============================================================================

interface CfLocalState {
  schemaVersion: 2;
  spaceId: string;
  epoch: string | null;
  appliedHead: number | null;
  generation: string;
}

interface CfAssetState {
  assetKey: string;
  remoteRevision: number | null;
  lastSyncedContentHash: string | null;
  remoteProtocolContentHash: string | null;
  remoteAdapterContentHash: string | null;
}

function defaultState(spaceId: string): CfLocalState {
  return {
    schemaVersion: 2,
    spaceId,
    epoch: null,
    appliedHead: null,
    generation: createUuid(),
  };
}

interface CloudflareWorkerClientLike {
  request<TResult>(operation: CfWorkerOperation): Promise<TResult>;
  dispose(): void;
}

export interface CloudflareSyncRemoteOptions {
  readonly apiBase?: string;
  readonly spaceId?: string;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly onRequestActivityChange?: (activity: {
    readonly activeRequestCount: number;
    readonly queuedRequestCount: number;
  }) => void;
  readonly workerClientFactory?: (
    apiBase: string,
    options: {
      readonly maxConcurrentRequests?: number;
      readonly requestTimeoutMs?: number;
      readonly onRequestActivityChange?: (activity: {
        readonly activeRequestCount: number;
        readonly queuedRequestCount: number;
      }) => void;
    },
  ) => CloudflareWorkerClientLike;
}

// ============================================================================
// CloudflareSyncLocalState（保留在主线程，操作 IndexedDB）
// ============================================================================

class CloudflareSyncLocalState implements SyncLocalState {
  private readonly stateLocation: IndexedDbStorageLocation;
  private cachedState: CfLocalState | null = null;
  private readonly pendingAdapterHashStorageKeys = new Set<string>();

  public constructor(apiBase: string, private readonly spaceId: string) {
    this.stateLocation = {
      databaseName: CF_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: `${CF_STATE_KEY_PREFIX}\u0000${apiBase}\u0000${spaceId}`,
    };
  }

  public async getLastSyncedHash(assetKey: string): Promise<string | null> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    return record?.lastSyncedContentHash ?? null;
  }

  public async setLastSyncedHash(assetKey: string, hash: string | null): Promise<void> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    if (hash === null) {
      if (existing === null) return;
      await this.applyAssetMutations([{
        type: "put",
        key: storageKey,
        value: {
          ...normalizeAssetState(existing, assetKey),
          lastSyncedContentHash: null,
        },
      }]);
      return;
    }
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        assetKey,
        remoteRevision: existing?.remoteRevision ?? null,
        lastSyncedContentHash: hash,
        remoteProtocolContentHash: existing?.remoteProtocolContentHash ?? null,
        remoteAdapterContentHash: this.pendingAdapterHashStorageKeys.has(storageKey)
          ? hash
          : existing?.remoteAdapterContentHash ?? null,
      },
    }]);
    this.pendingAdapterHashStorageKeys.delete(storageKey);
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    const storageKey = await this.createAssetStorageKey(key);
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    return record?.remoteRevision ?? null;
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    const storageKey = await this.createAssetStorageKey(key);
    if (revision === null) {
      await this.applyAssetMutations([{ type: "delete", key: storageKey }]);
      return;
    }
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        assetKey: key,
        remoteRevision: revision,
        lastSyncedContentHash: existing?.lastSyncedContentHash ?? null,
        remoteProtocolContentHash: existing?.remoteProtocolContentHash ?? null,
        remoteAdapterContentHash: existing?.remoteAdapterContentHash ?? null,
      },
    }]);
  }

  public async getComparableRemoteHash(
    assetKey: string,
    protocolContentHash: string,
  ): Promise<string | null> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    return record?.remoteProtocolContentHash === protocolContentHash
      ? record.remoteAdapterContentHash ?? null
      : null;
  }

  public async noteRemoteHashMapping(
    assetKey: string,
    protocolContentHash: string,
    adapterContentHash?: string,
  ): Promise<void> {
    const storageKey = await this.createAssetStorageKey(assetKey);
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: storageKey,
    });
    const normalized = normalizeAssetState(existing, assetKey);
    const protocolUnchanged = normalized.remoteProtocolContentHash === protocolContentHash;
    await this.applyAssetMutations([{
      type: "put",
      key: storageKey,
      value: {
        ...normalized,
        remoteProtocolContentHash: protocolContentHash,
        remoteAdapterContentHash: adapterContentHash
          ?? (protocolUnchanged ? normalized.remoteAdapterContentHash : null),
      },
    }]);
    if (adapterContentHash === undefined) {
      this.pendingAdapterHashStorageKeys.add(storageKey);
    } else {
      this.pendingAdapterHashStorageKeys.delete(storageKey);
    }
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    const revision = await this.getRemoteRevision(key);
    return revision === null ? null : String(revision);
  }

  public async setRemoteEtag(_key: string, _etag: string | null): Promise<void> {
    // Cloudflare 不使用 ETag
  }

  public async readState(): Promise<CfLocalState> {
    if (this.cachedState !== null) return this.cachedState;
    const stored = await readFromIndexedDb<unknown>(this.stateLocation);
    const normalized = normalizeState(stored, this.spaceId);
    const state = normalized ?? defaultState(this.spaceId);
    this.cachedState = state;
    if (normalized === null) {
      await this.writeState(state);
    }
    return state;
  }

  public async writeState(state: CfLocalState): Promise<void> {
    const saved = await applyIndexedDbStoreMutations(this.stateLocation, [
      { type: "put", key: this.stateLocation.key, value: state },
    ]);
    if (!saved) throw new Error("Failed to persist Cloudflare sync state.");
    this.cachedState = state;
  }

  public async replaceEpoch(epoch: string): Promise<CfLocalState> {
    const state = await this.readState();
    if (state.epoch === epoch) return state;
    const nextState: CfLocalState = {
      ...state,
      epoch,
      appliedHead: null,
      generation: createUuid(),
    };
    this.pendingAdapterHashStorageKeys.clear();
    await this.writeState(nextState);
    return nextState;
  }

  public async reset(): Promise<void> {
    this.pendingAdapterHashStorageKeys.clear();
    this.cachedState = null;
    const cleared = await clearIndexedDbStores(
      { databaseName: CF_DATABASE_NAME },
      [
        CF_STATE_STORE,
        CF_ASSETS_STORE,
        CLOUDFLARE_SYNC_TOMBSTONE_STORE_NAME,
      ],
    );
    if (!cleared) {
      throw new Error("Failed to clear Cloudflare sync metadata and cache.");
    }
  }

  private async createAssetStorageKey(assetKey: string): Promise<string> {
    const state = await this.readState();
    return `${state.generation}\u0000${assetKey}`;
  }

  private async applyAssetMutations(
    operations: readonly IndexedDbMutationOperation<CfAssetState>[],
  ): Promise<void> {
    const saved = await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, operations);
    if (!saved) throw new Error("Failed to persist Cloudflare asset sync metadata.");
  }
}

function normalizeState(value: unknown, spaceId: string): CfLocalState | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<CfLocalState>;
  if (
    candidate.schemaVersion !== 2
    || candidate.spaceId !== spaceId
    || (candidate.epoch !== null && typeof candidate.epoch !== "string")
    || (candidate.appliedHead !== null && typeof candidate.appliedHead !== "number")
    || typeof candidate.generation !== "string"
  ) {
    return null;
  }
  return candidate as CfLocalState;
}

function normalizeAssetState(
  value: CfAssetState | null,
  assetKey: string,
): CfAssetState {
  return {
    assetKey,
    remoteRevision: value?.remoteRevision ?? null,
    lastSyncedContentHash: value?.lastSyncedContentHash ?? null,
    remoteProtocolContentHash: value?.remoteProtocolContentHash ?? null,
    remoteAdapterContentHash: value?.remoteAdapterContentHash ?? null,
  };
}

// ============================================================================
// CloudflareSyncRemoteSession（Worker 薄代理）
// ============================================================================

class CloudflareSyncRemoteSession implements SyncRemoteSession {
  // planCache 保留在主线程，供 readIndex() 纯计算使用
  private planCache: CfWorkerPlanResponse | null = null;
  private readonly assetContentCache = new Map<string, Promise<CfReadAssetResult>>();
  private readonly workerClient: CloudflareWorkerClientLike;
  private latestCommittedHead: number | null = null;

  public constructor(
    public readonly localState: CloudflareSyncLocalState,
    private readonly context: SyncRemoteSessionContext,
    apiBase: string,
    options: CloudflareSyncRemoteOptions,
  ) {
    const clientOptions = {
      ...(options.maxConcurrentRequests === undefined
        ? {}
        : { maxConcurrentRequests: options.maxConcurrentRequests }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.onRequestActivityChange === undefined
        ? {}
        : { onRequestActivityChange: options.onRequestActivityChange }),
    };
    this.workerClient = options.workerClientFactory?.(apiBase, clientOptions)
      ?? new CfWorkerClient(apiBase, clientOptions);
  }

  // -- prefetchIndexes: 委托 Worker 获取 plan -- //

  public async prefetchIndexes(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    if (this.planCache !== null) return;
    const state = await this.ensureSpace();
    const result = await this.workerClient.request<CfPrefetchIndexesResult>({
      type: "prefetch-indexes",
      spaceId: state.spaceId,
      appliedHead: state.appliedHead,
      epoch: state.epoch,
    });

    this.planCache = result.plan;
    if (result.plan === null) {
      throw new Error("Cloudflare plan request returned no plan.");
    }
    if (result.epoch && state.epoch !== result.epoch) {
      await this.localState.replaceEpoch(result.epoch);
    }
  }

  public async refreshIndexes(collections: readonly SyncRemoteCollection[]): Promise<void> {
    this.planCache = null;
    this.assetContentCache.clear();
    await this.prefetchIndexes(collections);
  }

  // -- readIndex: 纯内存计算，保留在主线程 -- //

  public async readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex> {
    const plan = this.planCache;
    if (plan === null) return { revision: 0, entries: {}, committedAt: null };

    const modulePlan = plan.modules.find(
      (m) => m.moduleType === collection.assetType,
    );
    if (modulePlan === undefined || modulePlan.assets.length === 0) {
      return { revision: 0, entries: {}, committedAt: null };
    }

    const codec = collection.assetIdCodec;
    const entries: Record<string, RemoteCollectionIndex["entries"][string]> = {};
    let maxRevision = 0;

    await Promise.all(modulePlan.assets.map(async (asset) => {
      const adapterAssetId = codec.toAdapterAssetId(asset.assetId);
      const protocolContentHash = asset.contentHash
        ? toAdapterContentHash(asset.contentHash)
        : null;
      const comparableContentHash = protocolContentHash === null
        ? null
        : await this.localState.getComparableRemoteHash(
            createAssetStateKey(collection, adapterAssetId),
            protocolContentHash,
          ) ?? protocolContentHash;
      entries[adapterAssetId] = {
        revision: asset.revision,
        contentHash: comparableContentHash,
        protocolContentHash,
        deletedAt: asset.deletedAt,
        committedAt: null,
      };
      if (asset.revision > maxRevision) maxRevision = asset.revision;
    }));

    return { revision: maxRevision, entries, committedAt: null };
  }

  // -- readAsset: 主线程查 plan → Worker 下载 + 校验 -- //

  public async readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null> {
    const plan = this.planCache;
    if (plan === null) return null;

    const modulePlan = plan.modules.find(
      (m) => m.moduleType === params.collection.assetType,
    );
    if (modulePlan === undefined) return null;

    const remoteAssetId = params.collection.assetIdCodec.toRemoteAssetId(params.assetId);
    const asset = modulePlan.assets.find((a) => a.assetId === remoteAssetId);
    if (asset === undefined) return null;
    if (asset.deletedAt !== null) return null;

    const contentHash = asset.contentHash ? toAdapterContentHash(asset.contentHash) : null;
    const blobHash = asset.blobHash;

    // 无 blob hash 且无内容 hash — 空资产
    if (!blobHash && !contentHash) {
      return {
        revision: asset.revision,
        content: "",
        contentHash: "",
        committedAt: null,
      };
    }

    // 委托 Worker 做签名 URL 获取 + 下载 + SHA-256 校验
    const state = await this.localState.readState();
    let resultPromise = this.assetContentCache.get(blobHash);
    if (resultPromise === undefined) {
      resultPromise = this.workerClient.request<CfReadAssetResult>({
        type: "read-asset",
        spaceId: state.spaceId,
        assetType: params.collection.assetType,
        assetId: remoteAssetId,
        blobHash,
        contentHash,
        revision: asset.revision,
        deletedAt: asset.deletedAt,
      });
      this.assetContentCache.set(blobHash, resultPromise);
      void resultPromise.catch(() => {
        if (this.assetContentCache.get(blobHash) === resultPromise) {
          this.assetContentCache.delete(blobHash);
        }
      });
    }
    const result = await resultPromise;
    if (contentHash !== null) {
      await this.localState.noteRemoteHashMapping(
        createAssetStateKey(params.collection, params.assetId),
        contentHash,
      );
    }

    return {
      revision: asset.revision,
      content: result.content,
      contentHash: contentHash ?? "",
      committedAt: null,
    };
  }

  // -- checkCollections: 委托 Worker 检查变更 -- //

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    const state = await this.ensureSpace();
    const assetTypes = collections.map((c) => c.assetType);

    const result = await this.workerClient.request<CfCheckCollectionsResult>({
      type: "check-collections",
      spaceId: state.spaceId,
      appliedHead: state.appliedHead,
      epoch: state.epoch,
      assetTypes,
    });

    if (result.epoch && state.epoch !== result.epoch) {
      await this.localState.replaceEpoch(result.epoch);
    }

    if (result.changedAssetTypes.length === 0) {
      return {
        changedCollections: [],
        ...(result.head === null ? {} : { globalCursor: result.head }),
      };
    }

    const changed = new Set<string>();
    for (const assetType of result.changedAssetTypes) {
      for (const c of collections) {
        if (c.assetType === assetType) changed.add(c.adapterId);
      }
    }
    return {
      changedCollections: Array.from(changed),
      ...(result.head === null ? {} : { globalCursor: result.head }),
    };
  }

  public beginWriteBatch(): SyncRemoteWriteBatch {
    return new CloudflareSyncWriteBatch(this);
  }

  public async markApplied(result: RemoteApplyResult): Promise<void> {
    if (result.collectionRevision !== null) {
      await this.localState.setRemoteRevision(
        result.collection.stateKey,
        result.collectionRevision,
      );
    }
  }

  public async prepareCollections(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    // Cloudflare 无目录概念
  }

  public async complete(): Promise<void> {
    // local-change 只处理脏 adapter/asset，不能把全局 cursor 推进到 plan.head，
    // 否则同一 head 内其他集合的远端变更可能被永久跳过。
    if (this.context.reason === "local-change" || this.planCache === null) return;
    const state = await this.localState.readState();
    if (state.epoch !== this.planCache.epoch) return;
    await this.localState.writeState({
      ...state,
      appliedHead: Math.max(this.planCache.head, this.latestCommittedHead ?? 0),
    });
  }

  public dispose(): void {
    this.planCache = null;
    this.assetContentCache.clear();
    this.workerClient.dispose();
  }

  // -- 供 CloudflareSyncWriteBatch 访问 Worker 客户端 -- //

  public getWorkerClient(): CloudflareWorkerClientLike {
    return this.workerClient;
  }

  public registerCommittedHead(head: number): void {
    this.latestCommittedHead = Math.max(this.latestCommittedHead ?? 0, head);
  }

  // -- ensureSpace: 委托 Worker 检测 / 创建空间 -- //

  private async ensureSpace(): Promise<CfLocalState> {
    const state = await this.localState.readState();
    const result = await this.workerClient.request<CfEnsureSpaceResult>({
      type: "ensure-space",
      spaceId: state.spaceId,
    });

    if (result.epoch && state.epoch !== result.epoch) {
      return await this.localState.replaceEpoch(result.epoch);
    }

    return state;
  }
}

// ============================================================================
// CloudflareSyncWriteBatch（commit 委托 Worker）
// ============================================================================

class CloudflareSyncWriteBatch implements SyncRemoteWriteBatch {
  private mutations: Array<{
    clientMutationId: string;
    operation: "put" | "delete";
    collection: SyncRemoteCollection;
    adapterAssetId: string;
    assetType: string;
    assetId: string;
    content: string | null;
    contentHash: string | null;
    deletedAt: string | null;
    targetContentHash: string | null;
    baseRevision: number | null;
    baseContentHash: string | null;
  }> = [];
  private committed = false;

  public constructor(private readonly session: CloudflareSyncRemoteSession) {}

  public putAsset(params: RemoteAssetPutParams): void {
    if (this.committed) return;
    this.mutations.push({
      clientMutationId: createUuid(),
      operation: "put",
      collection: params.collection,
      adapterAssetId: params.assetId,
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      content: params.content,
      contentHash: params.contentHash,
      deletedAt: null,
      targetContentHash: null,
      baseRevision: params.baseRevision,
      baseContentHash: params.baseContentHash,
    });
  }

  public putTombstone(params: RemoteAssetTombstoneParams): void {
    if (this.committed) return;
    this.mutations.push({
      clientMutationId: createUuid(),
      operation: "delete",
      collection: params.collection,
      adapterAssetId: params.assetId,
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      content: null,
      contentHash: null,
      deletedAt: params.deletedAt,
      targetContentHash: params.targetContentHash,
      baseRevision: params.baseRevision,
      baseContentHash: params.baseContentHash,
    });
  }

  public async commit(): Promise<RemoteWriteBatchResult> {
    if (this.committed) return { writes: [] };
    this.committed = true;
    if (this.mutations.length === 0) return { writes: [] };

    const writes: RemoteWriteResult[] = [];
    let globalCursor: number | undefined;

    // 后端 capabilities 当前限制每批最多 32 条；分片按顺序提交，保证后一批使用最新 epoch。
    for (let offset = 0; offset < this.mutations.length; offset += 32) {
      const chunk = this.mutations.slice(offset, offset + 32);
      const state = await this.session.localState.readState();
      try {
        const result = await this.session.getWorkerClient().request<CfCommitBatchResult>({
          type: "commit-batch",
          spaceId: state.spaceId,
          epoch: state.epoch ?? "",
          clientBatchId: createUuid(),
          mutations: chunk.map((mutation) => ({
            clientMutationId: mutation.clientMutationId,
            operation: mutation.operation,
            assetType: mutation.assetType,
            assetId: mutation.assetId,
            content: mutation.content,
            contentHash: mutation.contentHash,
            deletedAt: mutation.deletedAt,
            targetContentHash: mutation.targetContentHash,
            baseRevision: mutation.baseRevision,
            baseContentHash: mutation.baseContentHash,
          })),
        });
        if (result.epoch !== null && result.epoch !== state.epoch) {
          await this.session.localState.replaceEpoch(result.epoch);
        }
        globalCursor = result.head;
        this.session.registerCommittedHead(result.head);
        for (const applied of result.applied) {
          const mutation = chunk.find(
            (candidate) => candidate.clientMutationId === applied.clientMutationId,
          );
          if (mutation === undefined) {
            throw new Error(
              `Cloudflare commit returned unknown mutation "${applied.clientMutationId}".`,
            );
          }
          writes.push({
            collection: mutation.collection,
            assetId: mutation.adapterAssetId,
            revision: applied.revision,
            contentHash: applied.contentHash || null,
            deletedAt: mutation.deletedAt,
            committedAt: result.serverTime,
          });
          if (applied.contentHash) {
            await this.session.localState.noteRemoteHashMapping(
              createAssetStateKey(mutation.collection, mutation.adapterAssetId),
              toAdapterContentHash(applied.contentHash),
              mutation.contentHash ?? undefined,
            );
          }
        }
      } catch (error) {
        throw translateWriteError(error);
      }
    }

    return {
      writes,
      ...(globalCursor === undefined ? {} : { globalCursor }),
    };

    // AI-REMOVED 2026-08-08:
    // Reason: 旧 batch 丢弃 base revision/hash、生成空 mutation id、提前推进 cursor，并返回伪造 collection。
    // Trigger: 开发后端更新提交稳定复现 revision-mismatch，且失败后本地会误认为已同步。
    // Evidence: 真实后端要求 prepare 与 commit 都重复携带同一 baseRevision/baseContentHash。
    // Replacement: 上方 32 条分片、稳定 mutation id、权威结果映射与延迟 cursor 提交。
    // Risk: Medium；写入错误现在会上抛并触发重新判定。
    // Human Review: Required
    //
    // Original code:
    // const state = await this.session.localState.readState();
    // const clientBatchId = createUuid();
    // const result = await this.session.getWorkerClient().request<CfCommitBatchResult>({
    //   type: "commit-batch",
    //   spaceId: state.spaceId,
    //   epoch: state.epoch ?? "",
    //   clientBatchId,
    //   mutations: this.mutations.map((m) => ({
    //     clientMutationId: "",
    //     assetType: m.assetType,
    //     assetId: m.assetId,
    //     content: m.content,
    //     contentHash: m.contentHash,
    //   })),
    // });
    // await this.session.localState.writeState({
    //   ...state,
    //   appliedHead: result.head,
    //   ...(result.epoch === null ? {} : { epoch: result.epoch }),
    // });
    // const results = result.applied.map((a) => ({
    //   collection: { adapterId: "", name: "", stateKey: "", /* ...伪造字段... */ },
    //   assetId: a.assetId,
    //   revision: a.revision,
    //   contentHash: a.contentHash || null,
    //   deletedAt: null,
    //   committedAt: "",
    // }));
    // return { writes: results, globalCursor: result.head };
  }

  public async discard(): Promise<void> {
    this.mutations = [];
    this.committed = true;
  }
}

// ============================================================================
// AI-CORRECTION 2026-08-08: 入口现在接收 apiBase/spaceId/并发与测试 client factory。
// CloudflareSyncRemote
// ============================================================================

export class CloudflareSyncRemote implements SyncRemote {
  public readonly localState: CloudflareSyncLocalState;
  private readonly apiBase: string;
  private readonly options: CloudflareSyncRemoteOptions;

  public constructor(options: CloudflareSyncRemoteOptions = {}) {
    this.apiBase = (options.apiBase ?? resolveBackendApiBaseUrl()).replace(/\/$/, "");
    const spaceId = options.spaceId?.trim() || "default";
    this.options = { ...options, apiBase: this.apiBase, spaceId };
    this.localState = new CloudflareSyncLocalState(this.apiBase, spaceId);
  }

  public async beginSession(
    context: SyncRemoteSessionContext,
  ): Promise<SyncRemoteSession> {
    return new CloudflareSyncRemoteSession(
      this.localState,
      context,
      this.apiBase,
      this.options,
    );
  }

  public async resetRemote(): Promise<void> {
    const state = await this.localState.readState();
    // reset-remote 也委托 Worker
    const clientOptions = {
      ...(this.options.maxConcurrentRequests === undefined
        ? {}
        : { maxConcurrentRequests: this.options.maxConcurrentRequests }),
      ...(this.options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: this.options.requestTimeoutMs }),
      ...(this.options.onRequestActivityChange === undefined
        ? {}
        : { onRequestActivityChange: this.options.onRequestActivityChange }),
    };
    const workerClient = this.options.workerClientFactory?.(this.apiBase, clientOptions)
      ?? new CfWorkerClient(this.apiBase, clientOptions);
    try {
      await workerClient.request<void>({
        type: "reset-remote",
        spaceId: state.spaceId,
      });
    } finally {
      workerClient.dispose();
    }
    await this.localState.reset();
  }

  public dispose(): void { /* no-op */ }
}

export function createCloudflareSyncRemote(
  options: CloudflareSyncRemoteOptions = {},
): SyncRemote {
  return new CloudflareSyncRemote(options);
}

// AI-REMOVED 2026-08-08:
// Reason: 固定 default 空间与全局后端地址会让所有安装共享远端数据和本地 cursor。
// Trigger: 同步空间需要绑定本地/账户 owner scope，并在删除时命中完全相同的目标。
// Evidence: 原构造器无法接收 spaceId，resetRemote 还会重新解析可能已变化的后端地址。
// Replacement: 上方 CloudflareSyncRemoteOptions 与实例级 apiBase/localState。
// Risk: Medium；未显式传参的调用仍兼容 default，仅正式 host 改用 owner scope。
// Human Review: Required
//
// Original code:
// export class CloudflareSyncRemote implements SyncRemote {
//   public readonly localState = new CloudflareSyncLocalState();
//   public async beginSession(context: SyncRemoteSessionContext): Promise<SyncRemoteSession> {
//     return new CloudflareSyncRemoteSession(this.localState, context);
//   }
//   public async resetRemote(): Promise<void> {
//     const state = await this.localState.readState();
//     const apiBase = resolveBackendApiBaseUrl();
//     const workerClient = new CfWorkerClient(apiBase);
//     try {
//       await workerClient.request<void>({ type: "reset-remote", spaceId: state.spaceId });
//     } finally {
//       workerClient.dispose();
//     }
//     await this.localState.writeState(defaultState());
//   }
// }
// export function createCloudflareSyncRemote(): SyncRemote {
//   return new CloudflareSyncRemote();
// }
// AI-CORRECTION 2026-08-08: 上述归档说明中的 owner scope 方案已撤销；正式 host 现在直接使用
// 用户保存的共享空间名称作为 spaceId，本地状态仍由 apiBase + spaceId 隔离。

function translateWriteError(error: unknown): unknown {
  if (
    error instanceof Error
    && (error as Error & { readonly status?: unknown }).status === 409
  ) {
    const details = (error as Error & { readonly details?: unknown }).details;
    if (
      typeof details === "object"
      && details !== null
      && "status" in details
      && details.status === "conflict"
      && "conflicts" in details
      && Array.isArray(details.conflicts)
    ) {
      return new RemoteWriteConflictError(details.conflicts.map((conflict) => {
        const value = conflict as Record<string, unknown>;
        return {
          assetType: typeof value.assetType === "string" ? value.assetType : "",
          assetId: typeof value.assetId === "string" ? value.assetId : "",
          reason: typeof value.reason === "string" ? value.reason : "unknown",
          expectedRevision: typeof value.expectedRevision === "number"
            ? value.expectedRevision
            : null,
          actualRevision: typeof value.actualRevision === "number"
            ? value.actualRevision
            : null,
          expectedHash: typeof value.expectedHash === "string" ? value.expectedHash : null,
          actualHash: typeof value.actualHash === "string" ? value.actualHash : null,
        };
      }));
    }
  }
  return error;
}

function toAdapterContentHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function createAssetStateKey(collection: SyncRemoteCollection, assetId: string): string {
  return `${collection.adapterId}:${assetId}`;
}
