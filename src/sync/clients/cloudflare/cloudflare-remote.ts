import {
  applyIndexedDbStoreMutations,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
  type IndexedDbStoreLocation,
} from "@/shared/storage/browser-storage";
import {
  createSha256CanonicalHash,
} from "@/shared/storage/sync-shadow-storage";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";
import { createUuid } from "@/domain/shared/uuid";
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
  SyncAssetType,
} from "../remote-types";

// ============================================================================
// IndexedDB 配置
// ============================================================================

const CF_DATABASE_NAME = "v3-industrial-planner";
const CF_STATE_STORE = "cf-sync-state";
const CF_STATE_KEY = "state";

const CF_STATE_LOCATION: IndexedDbStorageLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_STATE_STORE,
  key: CF_STATE_KEY,
};

const CF_ASSETS_STORE = "cf-sync-assets";

const CF_ASSETS_LOCATION: IndexedDbStoreLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_ASSETS_STORE,
};

// ============================================================================
// 协议类型
// ============================================================================

type SyncModule = "world-documents" | "blueprints" | "modules" | "toolbox";

interface CfLocalState {
  protocol: "cf-sync-v1";
  apiBaseUrl: string;
  spaceId: string;
  epoch: string | null;
  appliedHead: number | null;
  moduleHeads: Partial<Record<SyncModule, number>>;
}

interface CfAssetState {
  assetKey: string;
  remoteRevision: number | null;
  lastSyncedContentHash: string | null;
  lastSyncedDeletedAt: string | null;
}

interface CfSmallCheckResult {
  head: number;
  epoch: string;
  changed: boolean;
  planRequired: boolean;
  changes: CfPlannedAsset[];
  moduleHeads: Partial<Record<SyncModule, number>>;
  serverTime: string;
}

interface CfPlanResult {
  head: number;
  epoch: string;
  snapshotHead: number;
  modules: CfModulePlan[];
  capabilities: Record<string, unknown>;
  nextPageToken: string | null;
  minRetainedHead: number;
  serverTime: string;
}

interface CfModulePlan {
  module: SyncModule;
  remoteHead: number;
  mode: "unchanged" | "changes" | "full-manifest";
  assets: CfPlannedAsset[];
}

interface CfPlannedAsset {
  assetType: SyncAssetType;
  assetId: string;
  revision: number;
  contentHash: string | null;
  deletedAt: string | null;
  committedAt: string;
  downloads: CfDownloadRef[];
}

interface CfDownloadRef {
  blobHash: string;
  url: string;
  expiresAt: string;
}

interface CfPrepareResponse {
  status: "ready";
  epoch: string;
  observedHead: number;
  commitToken: string;
  uploads: CfUploadSlot[];
}

interface CfUploadSlot {
  assetType: string;
  assetId: string;
  required: boolean;
  url?: string | null;
  headers?: Record<string, string>;
}

interface CfCommitResponse {
  status: "committed" | "already-committed";
  epoch: string;
  head: number;
  moduleHeads: Partial<Record<SyncModule, number>>;
  applied: CfAppliedMutation[];
}

interface CfAppliedMutation {
  assetType: SyncAssetType;
  assetId: string;
  revision: number;
  contentHash: string | null;
  deletedAt: string | null;
  committedAt: string;
}

interface CfWriteMutation {
  assetType: SyncAssetType;
  assetId: string;
  operation: "put" | "delete";
  contentHash: string | null;
  content: string | null;
}

// ============================================================================
// CloudflareSyncLocalState
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

    await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [
      {
        type: "put",
        key: assetKey,
        value: {
          assetKey,
          remoteRevision: existing?.remoteRevision ?? null,
          lastSyncedContentHash: hash,
          lastSyncedDeletedAt: existing?.lastSyncedDeletedAt ?? null,
        },
      },
    ]);
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    const record = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key,
    });
    return record?.remoteRevision ?? null;
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    const existing = await readFromIndexedDb<CfAssetState>({
      ...CF_ASSETS_LOCATION,
      key,
    });
    if (revision === null) {
      if (existing === null) return;
      await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [
        {
          type: "put",
          key,
          value: {
            ...existing,
            remoteRevision: null,
          },
        },
      ]);
      return;
    }

    await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [
      {
        type: "put",
        key,
        value: {
          assetKey: key,
          remoteRevision: revision,
          lastSyncedContentHash: existing?.lastSyncedContentHash ?? null,
          lastSyncedDeletedAt: existing?.lastSyncedDeletedAt ?? null,
        },
      },
    ]);
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    // Cloudflare 不使用 ETag；返回 revision 的字符串形式作为等效游标
    const revision = await this.getRemoteRevision(key);
    return revision === null ? null : String(revision);
  }

  public async setRemoteEtag(_key: string, _etag: string | null): Promise<void> {
    // Cloudflare 不使用 ETag；不操作
  }

  // -- Cloudflare 专属方法 --

  public async readState(): Promise<CfLocalState> {
    const stored = await readFromIndexedDb<CfLocalState>(CF_STATE_LOCATION);
    return stored ?? createDefaultState();
  }

  public async writeState(state: CfLocalState): Promise<void> {
    await applyIndexedDbStoreMutations(CF_STATE_LOCATION, [
      { type: "put", key: CF_STATE_KEY, value: state },
    ]);
  }

  public async saveAssetState(
    assetKey: string,
    revision: number | null,
    contentHash: string | null,
    deletedAt: string | null,
  ): Promise<void> {
    await applyIndexedDbStoreMutations(CF_ASSETS_LOCATION, [
      {
        type: "put",
        key: assetKey,
        value: {
          assetKey,
          remoteRevision: revision,
          lastSyncedContentHash: contentHash,
          lastSyncedDeletedAt: deletedAt,
        },
      },
    ]);
  }
}

function createDefaultState(): CfLocalState {
  return {
    protocol: "cf-sync-v1",
    apiBaseUrl: resolveBackendApiBaseUrl(),
    spaceId: "default",
    epoch: null,
    appliedHead: null,
    moduleHeads: {},
  };
}

// ============================================================================
// CloudflareSyncRemoteSession
// ============================================================================

class CloudflareSyncRemoteSession implements SyncRemoteSession {
  private planCache: CfPlanResult | null = null;
  private checkCache: CfSmallCheckResult | null = null;
  private assetContentCache = new Map<string, string | null>();
  private readonly apiBase: string;
  private readonly spaceId: string;

  public constructor(
    public readonly localState: CloudflareSyncLocalState,
    private readonly context: SyncRemoteSessionContext,
  ) {
    const state = createDefaultState();
    this.apiBase = state.apiBaseUrl;
    this.spaceId = state.spaceId;
  }

  public async prefetchIndexes(collections: readonly SyncRemoteCollection[]): Promise<void> {
    // 通过 plan 批量预取所有 collection 的远端索引
    const state = await this.localState.readState();
    const params = new URLSearchParams();
    params.set("mode", state.appliedHead === null ? "full" : "incremental");
    if (state.epoch !== null) {
      params.set("epoch", state.epoch);
    }
    if (state.appliedHead !== null) {
      params.set("cursor", String(state.appliedHead));
    }
    for (const collection of collections) {
      const moduleHead = state.moduleHeads[toSyncModule(collection.name)];
      if (moduleHead !== undefined) {
        params.set(`${toSyncModule(collection.name)}Head`, String(moduleHead));
      }
    }
    const focusedAssets = this.context.focusedAssets;
    if (focusedAssets !== undefined && focusedAssets.length > 0 && focusedAssets[0] !== undefined) {
      params.set("focusType", focusedAssets[0].collection.assetType);
      params.set("focusId", focusedAssets[0].assetId);
    }

    const url = `${this.apiBase}/v1/sync/spaces/${this.spaceId}/plan?${params.toString()}`;
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      this.planCache = null;
      return;
    }

    this.planCache = await response.json() as CfPlanResult;
    // 首次同步后更新本地 epoch
    if (this.planCache.epoch) {
      const state = await this.localState.readState();
      if (state.epoch !== this.planCache.epoch) {
        await this.localState.writeState({ ...state, epoch: this.planCache.epoch });
      }
    }
  }

  public async readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex> {
    const plan = this.planCache;
    if (plan === null) {
      return createEmptyIndex();
    }

    const moduleName = toSyncModule(collection.name);
    const modulePlan = plan.modules.find((m) => m.module === moduleName);
    if (modulePlan === undefined || modulePlan.mode === "unchanged") {
      return createEmptyIndex();
    }

    const codec = collection.assetIdCodec;
    const entries: Record<string, RemoteCollectionIndex["entries"][string]> = {};
    let maxRevision = 0;

    for (const asset of modulePlan.assets) {
      const adapterAssetId = codec.toAdapterAssetId(asset.assetId);
      entries[adapterAssetId] = {
        revision: asset.revision,
        contentHash: asset.contentHash,
        deletedAt: asset.deletedAt,
        committedAt: asset.committedAt,
      };
      if (asset.revision > maxRevision) {
        maxRevision = asset.revision;
      }
    }

    const firstAsset = modulePlan.assets[0];
    return {
      revision: maxRevision,
      entries,
      committedAt: firstAsset !== undefined ? firstAsset.committedAt : null,
    };
  }

  public async readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null> {
    const plan = this.planCache;
    if (plan === null) {
      return null;
    }

    const moduleName = toSyncModule(params.collection.name);
    const modulePlan = plan.modules.find((m) => m.module === moduleName);
    if (modulePlan === undefined) {
      return null;
    }

    const remoteAssetId = params.collection.assetIdCodec.toRemoteAssetId(params.assetId);
    const asset = modulePlan.assets.find((a) => a.assetId === remoteAssetId);
    if (asset === undefined) {
      return null;
    }

    // 无内容哈希或已删除的资产跳过
    if (asset.contentHash === null || asset.deletedAt !== null) {
      return {
        revision: asset.revision,
        content: "",
        contentHash: "",
        committedAt: asset.committedAt,
      };
    }

    // 尝试从缓存读取
    const cacheKey = `${params.collection.adapterId}:${params.assetId}`;
    const cachedContent = this.assetContentCache.get(cacheKey);
    if (cachedContent !== undefined) {
      if (cachedContent === null) return null;
      return {
        revision: asset.revision,
        content: cachedContent,
        contentHash: asset.contentHash,
        committedAt: asset.committedAt,
      };
    }

    // 通过 R2 预签名 URL 下载
    const download = asset.downloads[0];
    if (download === undefined) {
      return null;
    }

    try {
      const response = await fetch(download.url, { cache: "no-store" });
      if (!response.ok) {
        this.assetContentCache.set(cacheKey, null);
        return null;
      }

      const content = await response.text();
      // 校验 contentHash
      const computedHash = await createSha256CanonicalHash(JSON.parse(content));
      if (computedHash !== asset.contentHash) {
        this.assetContentCache.set(cacheKey, null);
        return null;
      }

      this.assetContentCache.set(cacheKey, content);
      return {
        revision: asset.revision,
        content,
        contentHash: asset.contentHash,
        committedAt: asset.committedAt,
      };
    } catch {
      this.assetContentCache.set(cacheKey, null);
      return null;
    }
  }

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    const state = await this.localState.readState();
    const params = new URLSearchParams();
    if (state.epoch !== null) {
      params.set("epoch", state.epoch);
    }
    if (state.appliedHead !== null) {
      params.set("cursor", String(state.appliedHead));
    }

    const url = `${this.apiBase}/v1/sync/spaces/${this.spaceId}/check?${params.toString()}`;
    const response = await fetch(url, { cache: "no-store" });

    // 204 = 无变化
    if (response.status === 204) {
      this.checkCache = null;
      return { changedCollections: [] };
    }

    if (!response.ok) {
      this.checkCache = null;
      return { changedCollections: [] };
    }

    const result = await response.json() as CfSmallCheckResult;
    this.checkCache = result;

    // 更新本地 epoch
    if (result.epoch) {
      const state = await this.localState.readState();
      if (state.epoch !== result.epoch) {
        await this.localState.writeState({ ...state, epoch: result.epoch });
      }
    }

    if (result.changes.length === 0) {
      // 无变化
      return { changedCollections: [] };
    }

    // 从 check 内联的 changes 中找到受影响的 collection
    const changedCollections = new Set<string>();
    for (const change of result.changes) {
      for (const collection of collections) {
        if (collection.assetType === change.assetType) {
          changedCollections.add(collection.adapterId);
        }
      }
    }

    return { changedCollections: Array.from(changedCollections) };
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
    // Cloudflare 不使用 ETag；不操作
  }

  public async prepareCollections(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    // Cloudflare 后端无目录概念；no-op
  }

  public dispose(): void {
    this.planCache = null;
    this.checkCache = null;
    this.assetContentCache.clear();
  }

  /** 获取缓存的 plan 结果，供 write batch 使用 */
  public getPlanCache(): CfPlanResult | null {
    return this.planCache;
  }

  /** 获取缓存的 check 结果 */
  public getCheckCache(): CfSmallCheckResult | null {
    return this.checkCache;
  }

  /** 获取 API base URL */
  public getApiBase(): string {
    return this.apiBase;
  }

  /** 获取 space ID */
  public getSpaceId(): string {
    return this.spaceId;
  }
}

// ============================================================================
// CloudflareSyncWriteBatch
// ============================================================================

class CloudflareSyncWriteBatch implements SyncRemoteWriteBatch {
  private mutations: CfWriteMutation[] = [];
  private committed = false;

  public constructor(private readonly session: CloudflareSyncRemoteSession) {}

  public putAsset(params: RemoteAssetPutParams): void {
    if (this.committed) return;

    this.mutations.push({
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      operation: "put",
      contentHash: params.contentHash,
      content: params.content,
    });
  }

  public putTombstone(params: RemoteAssetTombstoneParams): void {
    if (this.committed) return;

    this.mutations.push({
      assetType: params.collection.assetType,
      assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
      operation: "delete",
      contentHash: null,
      content: null,
    });
  }

  public async commit(): Promise<RemoteWriteBatchResult> {
    if (this.committed) {
      return { writes: [] };
    }
    this.committed = true;

    if (this.mutations.length === 0) {
      return { writes: [] };
    }

    const apiBase = this.session.getApiBase();
    const spaceId = this.session.getSpaceId();
    const state = await this.session.localState.readState();
    const clientBatchId = createUuid();

    // Step 1: POST /prepare
    const prepareBody = {
      protocol: "cf-sync-v1" as const,
      action: "prepare" as const,
      epoch: state.epoch ?? "",
      clientBatchId,
      mutations: this.mutations.map((m) => ({
        clientMutationId: createUuid(),
        assetType: m.assetType,
        assetId: m.assetId,
        operation: m.operation,
        baseRevision: null,
        baseContentHash: null,
        targetContentHash: m.contentHash,
        schemaVersion: 1,
        minReadableSchemaVersion: 1,
        writerAppVersion: "0.1.0",
        writerBuildId: "dev",
        payload: m.content !== null
          ? {
              kind: "full" as const,
              blobHash: "pending",
              byteSize: new TextEncoder().encode(m.content).length,
              encoding: "identity" as const,
            }
          : null,
      })),
    };

    const prepareUrl = `${apiBase}/v1/sync/spaces/${spaceId}/mutations`;
    const prepareResponse = await fetch(prepareUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prepareBody),
      cache: "no-store",
    });

    if (!prepareResponse.ok) {
      return { writes: [] };
    }

    const prepareResult = await prepareResponse.json() as CfPrepareResponse;

    // 更新本地 epoch
    if (prepareResult.epoch) {
      const currentState = await this.session.localState.readState();
      if (currentState.epoch !== prepareResult.epoch) {
        await this.session.localState.writeState({ ...currentState, epoch: prepareResult.epoch });
      }
    }

    // Step 2: Upload blobs to R2
    const mutationIds = new Map<number, string>();
    const blobHashes = new Map<number, string>();
    for (let i = 0; i < this.mutations.length; i++) {
      const mutation = this.mutations[i];
      if (mutation === undefined) continue;
      const mutationId = createUuid();
      mutationIds.set(i, mutationId);
      if (mutation.content !== null) {
        const blobHash = await createSha256CanonicalHash(JSON.parse(mutation.content));
        blobHashes.set(i, blobHash);
      }
    }

    for (const upload of prepareResult.uploads) {
      if (!upload.required || upload.url === undefined || upload.url === null) continue;

      // 通过 assetType + assetId 匹配 mutation
      let blobIdx = -1;
      for (let i = 0; i < this.mutations.length; i++) {
        const m = this.mutations[i];
        if (m !== undefined && m.assetType === upload.assetType && m.assetId === upload.assetId) {
          blobIdx = i;
          break;
        }
      }
      if (blobIdx === -1) continue;

      const mutation = this.mutations[blobIdx];
      if (mutation === undefined || mutation.content === null) continue;

      const headers: Record<string, string> = upload.headers ?? {};
      await fetch(upload.url, {
        method: "PUT",
        headers,
        body: mutation.content,
        cache: "no-store",
      });
    }

    // Step 3: POST /commit（后端要求 commit 也带 mutations 数组）
    const commitMutations = Array.from(mutationIds.entries()).map(([idx, mutationId]) => {
      const m = this.mutations[idx];
      return {
        clientMutationId: mutationId,
        assetType: m?.assetType ?? "",
        assetId: m?.assetId ?? "",
      };
    });

    const commitBody = {
      protocol: "cf-sync-v1" as const,
      action: "commit" as const,
      epoch: prepareResult.epoch,
      clientBatchId,
      commitToken: prepareResult.commitToken,
      mutations: commitMutations,
    };

    const commitResponse = await fetch(prepareUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitBody),
      cache: "no-store",
    });

    if (!commitResponse.ok) {
      return { writes: [] };
    }

    const commitResult = await commitResponse.json() as CfCommitResponse;

    // 更新本地状态
    const newState: CfLocalState = {
      ...state,
      epoch: commitResult.epoch,
      appliedHead: commitResult.head,
      moduleHeads: {
        ...state.moduleHeads,
        ...commitResult.moduleHeads,
      },
    };
    await this.session.localState.writeState(newState);

    const results: RemoteWriteResult[] = commitResult.applied.map((applied) => ({
      collection: {
        adapterId: "",
        name: "",
        mode: "full-no-revision",
        assetType: applied.assetType,
        assetIdCodec: {
          toRemoteAssetId: (id) => id,
          toAdapterAssetId: (id) => id,
        },
        hashAlgorithm: "sha256-canonical-json-v1",
        stateKey: "",
      },
      assetId: applied.assetId,
      revision: applied.revision,
      contentHash: applied.contentHash,
      deletedAt: applied.deletedAt,
      committedAt: applied.committedAt,
    }));

    return {
      writes: results,
      globalCursor: commitResult.head,
    };
  }

  public async discard(): Promise<void> {
    this.mutations = [];
    this.committed = true;
  }
}

// ============================================================================
// CloudflareSyncRemote
// ============================================================================

export class CloudflareSyncRemote implements SyncRemote {
  public readonly localState = new CloudflareSyncLocalState();

  public async beginSession(
    context: SyncRemoteSessionContext,
  ): Promise<SyncRemoteSession> {
    return new CloudflareSyncRemoteSession(this.localState, context);
  }

  public async resetRemote(): Promise<void> {
    const apiBase = resolveBackendApiBaseUrl();
    const spaceId = "default";

    await fetch(`${apiBase}/v1/sync/spaces/${spaceId}/reset`, {
      method: "POST",
      cache: "no-store",
    });

    // 重置本地状态
    await this.localState.writeState(createDefaultState());
  }

  public dispose(): void {
    // no-op
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

export function createCloudflareSyncRemote(): SyncRemote {
  return new CloudflareSyncRemote();
}

// ============================================================================
// 工具函数
// ============================================================================

function toSyncModule(collectionName: string): SyncModule {
  switch (collectionName) {
    case "world-documents":
      return "world-documents";
    case "blueprints":
      return "blueprints";
    case "modules":
      return "modules";
    case "toolbox":
      return "toolbox";
    default:
      return "world-documents";
  }
}

function createEmptyIndex(): RemoteCollectionIndex {
  return {
    revision: 0,
    entries: {},
    committedAt: null,
  };
}
