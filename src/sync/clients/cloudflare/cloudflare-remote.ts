import {
  applyIndexedDbStoreMutations,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
  type IndexedDbStoreLocation,
} from "@/shared/storage/browser-storage";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import { createUuid } from "@/domain/shared/uuid";
import { CfWorkerClient } from "./cloudflare-worker-client";
import type {
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

// ============================================================================
// IndexedDB 配置
// ============================================================================

const CF_DATABASE_NAME = "v3-industrial-planner";
const CF_STATE_STORE = "cf-sync-state";
const CF_STATE_KEY = "state";
const CF_ASSETS_STORE = "cf-sync-assets";

const CF_STATE_LOCATION: IndexedDbStorageLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_STATE_STORE,
  key: CF_STATE_KEY,
};

const CF_ASSETS_LOCATION: IndexedDbStoreLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_ASSETS_STORE,
};

// ============================================================================
// 本地状态
// ============================================================================

interface CfLocalState {
  spaceId: string;
  epoch: string | null;
  appliedHead: number | null;
}

interface CfAssetState {
  assetKey: string;
  remoteRevision: number | null;
  lastSyncedContentHash: string | null;
}

function defaultState(): CfLocalState {
  return {
    spaceId: "default",
    epoch: null,
    appliedHead: null,
  };
}

// ============================================================================
// CloudflareSyncLocalState（保留在主线程，操作 IndexedDB）
// ============================================================================

class CloudflareSyncLocalState implements SyncLocalState {
  public async getLastSyncedHash(assetKey: string): Promise<string | null> {
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: assetKey,
    });
    return record?.lastSyncedContentHash ?? null;
  }

  public async setLastSyncedHash(assetKey: string, hash: string | null): Promise<void> {
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key: assetKey,
    });
    if (hash === null) {
      if (existing === null) return;
      await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [
        { type: "delete", key: assetKey },
      ]);
      return;
    }
    await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [{
      type: "put",
      key: assetKey,
      value: {
        assetKey,
        remoteRevision: existing?.remoteRevision ?? null,
        lastSyncedContentHash: hash,
      },
    }]);
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key,
    });
    return record?.remoteRevision ?? null;
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    if (revision === null) return;
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key,
    });
    await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [{
      type: "put",
      key,
      value: {
        assetKey: key,
        remoteRevision: revision,
        lastSyncedContentHash: existing?.lastSyncedContentHash ?? null,
      },
    }]);
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    const revision = await this.getRemoteRevision(key);
    return revision === null ? null : String(revision);
  }

  public async setRemoteEtag(_key: string, _etag: string | null): Promise<void> {
    // Cloudflare 不使用 ETag
  }

  public async readState(): Promise<CfLocalState> {
    const stored = await readFromIndexedDb<CfLocalState>(CF_STATE_LOCATION);
    return stored ?? defaultState();
  }

  public async writeState(state: CfLocalState): Promise<void> {
    await applyIndexedDbStoreMutations(CF_STATE_LOCATION, [
      { type: "put", key: CF_STATE_KEY, value: state },
    ]);
  }
}

// ============================================================================
// CloudflareSyncRemoteSession（Worker 薄代理）
// ============================================================================

class CloudflareSyncRemoteSession implements SyncRemoteSession {
  // planCache 保留在主线程，供 readIndex() 纯计算使用
  private planCache: CfWorkerPlanResponse | null = null;
  private readonly workerClient: CfWorkerClient;

  public constructor(
    public readonly localState: CloudflareSyncLocalState,
    private readonly context: SyncRemoteSessionContext,
  ) {
    this.workerClient = new CfWorkerClient(resolveBackendApiBaseUrl());
  }

  // -- prefetchIndexes: 委托 Worker 获取 plan -- //

  public async prefetchIndexes(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    const state = await this.ensureSpace();
    const result = await this.workerClient.request<CfPrefetchIndexesResult>({
      type: "prefetch-indexes",
      spaceId: state.spaceId,
      appliedHead: state.appliedHead,
      epoch: state.epoch,
    });

    this.planCache = result.plan;
    if (result.epoch && state.epoch !== result.epoch) {
      await this.localState.writeState({ ...state, epoch: result.epoch });
    }
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

    for (const asset of modulePlan.assets) {
      const adapterAssetId = codec.toAdapterAssetId(asset.assetId);
      entries[adapterAssetId] = {
        revision: asset.revision,
        contentHash: asset.contentHash || null,
        deletedAt: asset.deletedAt,
        committedAt: null,
      };
      if (asset.revision > maxRevision) maxRevision = asset.revision;
    }

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

    const contentHash = asset.contentHash || null;
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
    const result = await this.workerClient.request<CfReadAssetResult | null>({
      type: "read-asset",
      spaceId: state.spaceId,
      assetType: params.collection.assetType,
      assetId: remoteAssetId,
      blobHash,
      contentHash,
      revision: asset.revision,
      deletedAt: asset.deletedAt,
    });

    if (result === null) return null;

    return {
      revision: result.revision,
      content: result.content,
      contentHash: result.contentHash,
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
      await this.localState.writeState({ ...state, epoch: result.epoch });
    }

    if (result.changedAssetTypes.length === 0) {
      return { changedCollections: [] };
    }

    const changed = new Set<string>();
    for (const assetType of result.changedAssetTypes) {
      for (const c of collections) {
        if (c.assetType === assetType) changed.add(c.adapterId);
      }
    }
    return { changedCollections: Array.from(changed) };
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

  public dispose(): void {
    this.planCache = null;
    this.workerClient.dispose();
  }

  // -- 供 CloudflareSyncWriteBatch 访问 Worker 客户端 -- //

  public getWorkerClient(): CfWorkerClient {
    return this.workerClient;
  }

  // -- ensureSpace: 委托 Worker 检测 / 创建空间 -- //

  private async ensureSpace(): Promise<CfLocalState> {
    const state = await this.localState.readState();
    const result = await this.workerClient.request<CfEnsureSpaceResult>({
      type: "ensure-space",
      spaceId: state.spaceId,
    });

    if (result.epoch && state.epoch !== result.epoch) {
      const newState = { ...state, epoch: result.epoch };
      await this.localState.writeState(newState);
      return newState;
    }

    return state;
  }
}

// ============================================================================
// CloudflareSyncWriteBatch（commit 委托 Worker）
// ============================================================================

class CloudflareSyncWriteBatch implements SyncRemoteWriteBatch {
  private mutations: Array<{
    assetType: string;
    assetId: string;
    content: string | null;
    contentHash: string | null;
  }> = [];
  private committed = false;

  public constructor(private readonly session: CloudflareSyncRemoteSession) {}

  public putAsset(params: RemoteAssetPutParams): void {
    if (this.committed) return;
    this.mutations.push({
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      content: params.content,
      contentHash: params.contentHash,
    });
  }

  public putTombstone(params: RemoteAssetTombstoneParams): void {
    if (this.committed) return;
    this.mutations.push({
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      content: null,
      contentHash: null,
    });
  }

  public async commit(): Promise<RemoteWriteBatchResult> {
    if (this.committed) return { writes: [] };
    this.committed = true;
    if (this.mutations.length === 0) return { writes: [] };

    const state = await this.session.localState.readState();
    const clientBatchId = createUuid();

    // 全部委托 Worker：hash 计算 + prepare + R2 PUT + commit
    const result = await this.session.getWorkerClient().request<CfCommitBatchResult>({
      type: "commit-batch",
      spaceId: state.spaceId,
      epoch: state.epoch ?? "",
      clientBatchId,
      mutations: this.mutations.map((m) => ({
        clientMutationId: "", // Worker 内重新生成
        assetType: m.assetType,
        assetId: m.assetId,
        content: m.content,
        contentHash: m.contentHash,
      })),
    });

    // 更新 IndexedDB 状态：appliedHead 和 epoch（如果 Worker 返回了更新后的 epoch）
    const nextState: CfLocalState = {
      ...state,
      appliedHead: result.head,
    };
    if (result.epoch !== null) {
      nextState.epoch = result.epoch;
    }
    await this.session.localState.writeState(nextState);

    const results: RemoteWriteResult[] = result.applied.map((a) => ({
      collection: {
        adapterId: "",
        name: "",
        mode: "full-no-revision" as const,
        assetType: a.assetType as never,
        assetIdCodec: {
          toRemoteAssetId: (id: string) => id,
          toAdapterAssetId: (id: string) => id,
        },
        hashAlgorithm: "sha256-canonical-json-v1" as const,
        stateKey: "",
      },
      assetId: a.assetId,
      revision: a.revision,
      contentHash: a.contentHash || null,
      deletedAt: null,
      committedAt: "",
    }));

    return { writes: results, globalCursor: result.head };
  }

  public async discard(): Promise<void> {
    this.mutations = [];
    this.committed = true;
  }
}

// ============================================================================
// CloudflareSyncRemote（入口保持不变）
// ============================================================================

export class CloudflareSyncRemote implements SyncRemote {
  public readonly localState = new CloudflareSyncLocalState();

  public async beginSession(
    context: SyncRemoteSessionContext,
  ): Promise<SyncRemoteSession> {
    return new CloudflareSyncRemoteSession(this.localState, context);
  }

  public async resetRemote(): Promise<void> {
    const state = await this.localState.readState();
    // reset-remote 也委托 Worker
    const apiBase = resolveBackendApiBaseUrl();
    const workerClient = new CfWorkerClient(apiBase);
    try {
      await workerClient.request<void>({
        type: "reset-remote",
        spaceId: state.spaceId,
      });
    } finally {
      workerClient.dispose();
    }
    await this.localState.writeState(defaultState());
  }

  public dispose(): void { /* no-op */ }
}

export function createCloudflareSyncRemote(): SyncRemote {
  return new CloudflareSyncRemote();
}
