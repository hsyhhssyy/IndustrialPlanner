import {
  applyIndexedDbStoreMutations,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
  type IndexedDbStoreLocation,
} from "@/shared/storage/browser-storage";
import { createSha256CanonicalHash } from "@/shared/storage/sync-shadow-storage";
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
// 后端协议类型（与实际 Worker 返回一致）
// ============================================================================

interface CfCheckResponse {
  head: number;
  epoch: string;
  changed: boolean;
  planRequired: boolean;
  changes: CfPlanAsset[];
  moduleHeads: CfModuleHead[];
  serverTime: string;
}

interface CfPlanResponse {
  head: number;
  epoch: string;
  snapshotHead: number;
  modules: CfPlanModule[];
  capabilities: Record<string, unknown>;
  nextPageToken: string | null;
  minRetainedHead: number;
  serverTime: string;
}

interface CfPlanModule {
  moduleType: string;
  assets: CfPlanAsset[];
}

interface CfPlanAsset {
  assetType: string;
  assetId: string;
  revision: number;
  contentHash: string;
  blobHash: string;
  byteSize: number;
  deletedAt: string | null;
}

interface CfModuleHead {
  moduleType: string;
  head: number;
}

interface CfPrepareResponse {
  status: "ready";
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

interface CfDownloadSignResponse {
  urls: Array<{ blobHash: string; url: string }>;
}

interface CfCommitResponse {
  status: "committed" | "already-committed";
  head: number;
  applied: CfAppliedMutation[];
  serverTime: string;
}

interface CfAppliedMutation {
  clientMutationId: string;
  assetType: string;
  assetId: string;
  revision: number;
  contentHash: string;
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
// CloudflareSyncRemoteSession
// ============================================================================

class CloudflareSyncRemoteSession implements SyncRemoteSession {
  private planCache: CfPlanResponse | null = null;
  private downloadUrlCache = new Map<string, string | null>();
  private readonly apiBase: string;

  public constructor(
    public readonly localState: CloudflareSyncLocalState,
    private readonly context: SyncRemoteSessionContext,
  ) {
    this.apiBase = resolveBackendApiBaseUrl();
  }

  public async prefetchIndexes(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    const state = await this.ensureSpace();
    const params = new URLSearchParams();
    params.set("mode", state.appliedHead === null ? "full" : "incremental");
    if (state.epoch !== null) params.set("epoch", state.epoch);
    if (state.appliedHead !== null) params.set("cursor", String(state.appliedHead));

    const url = `${this.apiBase}/v1/sync/spaces/${state.spaceId}/plan?${params.toString()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) { this.planCache = null; return; }

    this.planCache = await response.json() as CfPlanResponse;
    if (this.planCache.epoch) {
      if (state.epoch !== this.planCache.epoch) {
        await this.localState.writeState({ ...state, epoch: this.planCache.epoch });
      }
    }
  }

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

    // 获取或从缓存读取下载 URL
    let downloadUrl = this.downloadUrlCache.get(blobHash);
    if (downloadUrl === undefined) {
      const state = await this.localState.readState();
      const signUrl = `${this.apiBase}/v1/sync/spaces/${state.spaceId}/downloads:sign`;
      const signResp = await fetch(signUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobHashes: [blobHash] }),
        cache: "no-store",
      });
      if (!signResp.ok) {
        this.downloadUrlCache.set(blobHash, null);
        return null;
      }
      const signResult = await signResp.json() as CfDownloadSignResponse;
      downloadUrl = signResult.urls[0]?.url ?? null;
      this.downloadUrlCache.set(blobHash, downloadUrl);
    }

    if (downloadUrl === null) return null;

    // 下载 blob
    try {
      const dlResp = await fetch(downloadUrl, { cache: "no-store" });
      if (!dlResp.ok) return null;

      const content = await dlResp.text();

      // SHA-256 校验
      const computedHash = await createSha256CanonicalHash(JSON.parse(content));
      const expectedHash = computedHash.startsWith("sha256:")
        ? computedHash.slice(7)
        : computedHash;
      if (expectedHash !== blobHash) return null;

      return {
        revision: asset.revision,
        content,
        contentHash: contentHash ?? "",
        committedAt: null,
      };
    } catch {
      return null;
    }
  }

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    const state = await this.ensureSpace();
    const params = new URLSearchParams();
    if (state.epoch !== null) params.set("epoch", state.epoch);
    if (state.appliedHead !== null) params.set("cursor", String(state.appliedHead));

    const url = `${this.apiBase}/v1/sync/spaces/${state.spaceId}/check?${params.toString()}`;
    const response = await fetch(url, { cache: "no-store" });

    if (response.status === 204) return { changedCollections: [] };
    if (!response.ok) return { changedCollections: [] };

    const result = await response.json() as CfCheckResponse;
    if (result.epoch) {
      const currentState = await this.localState.readState();
      if (currentState.epoch !== result.epoch) {
        await this.localState.writeState({ ...currentState, epoch: result.epoch });
      }
    }

    if (!result.changed || result.changes.length === 0) {
      return { changedCollections: [] };
    }

    const changed = new Set<string>();
    for (const change of result.changes) {
      for (const c of collections) {
        if (c.assetType === change.assetType) changed.add(c.adapterId);
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
    this.downloadUrlCache.clear();
  }

  public getApiBase(): string { return this.apiBase; }

  // -- ensureSpace: 检测空间是否存在，不存在则自动创建 -- //

  private async ensureSpace(): Promise<CfLocalState> {
    const state = await this.localState.readState();
    const checkUrl = `${this.apiBase}/v1/sync/spaces/${state.spaceId}/check`;
    const checkResp = await fetch(checkUrl, { cache: "no-store" });

    if (checkResp.status === 404) {
      // 空间不存在，自动创建
      const createUrl = `${this.apiBase}/v1/sync/spaces`;
      const createResp = await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: state.spaceId }),
        cache: "no-store",
      });
      if (createResp.ok) {
        const created = await createResp.json() as { activeEpoch: string };
        const newState = { ...state, epoch: created.activeEpoch ?? state.epoch };
        await this.localState.writeState(newState);
        return newState;
      }
    }

    return state;
  }
}

// ============================================================================
// CloudflareSyncWriteBatch
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

    const apiBase = this.session.getApiBase();
    const state = await this.session.localState.readState();
    const clientBatchId = createUuid();

    const mutationRecords = await Promise.all(this.mutations.map(async (m) => {
      const mutationId = createUuid();
      let blobHash = "";
      let blobByteSize = 0;
      if (m.content !== null) {
        const contentBytes = new TextEncoder().encode(m.content);
        blobByteSize = contentBytes.length;
        blobHash = await createSha256CanonicalHash(JSON.parse(m.content));
        blobHash = blobHash.startsWith("sha256:") ? blobHash.slice(7) : blobHash;
      }
      return {
        clientMutationId: mutationId,
        assetType: m.assetType,
        assetId: m.assetId,
        blobHash,
        blobByteSize,
        content: m.content,
        contentHash: m.contentHash,
      };
    }));

    // Step 1: POST /prepare
    const prepareBody = {
      protocol: "cf-sync-v1",
      action: "prepare",
      spaceEpoch: state.epoch ?? "",
      clientBatchId,
      mutations: mutationRecords.map((r) => ({
        clientMutationId: r.clientMutationId,
        assetType: r.assetType,
        assetId: r.assetId,
        baseRevision: null,
        baseContentHash: null,
        metadata: "{}",
        blobHash: r.blobHash,
        blobByteSize: r.blobByteSize,
        storageMode: "full",
        schemaVersion: 1,
        encoding: "identity",
        writerAppVersion: "0.1.0",
        writerBuildId: "dev",
      })),
    };

    const mutationsUrl = `${apiBase}/v1/sync/spaces/${state.spaceId}/mutations`;
    const prepareResp = await fetch(mutationsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prepareBody),
      cache: "no-store",
    });
    if (!prepareResp.ok) return { writes: [] };

    const prepareResult = await prepareResp.json() as CfPrepareResponse;

    // Step 2: R2 PUT
    for (const upload of prepareResult.uploads) {
      if (!upload.required || !upload.url) continue;
      const rec = mutationRecords.find(
        (r) => r.assetType === upload.assetType && r.assetId === upload.assetId,
      );
      if (!rec || rec.content === null) continue;

      const headers: Record<string, string> = upload.headers ?? {};
      await fetch(upload.url, {
        method: "PUT",
        headers,
        body: rec.content,
        cache: "no-store",
      });
    }

    // Step 3: POST /commit
    const commitBody = {
      protocol: "cf-sync-v1",
      action: "commit",
      spaceEpoch: state.epoch ?? "",
      clientBatchId,
      commitToken: prepareResult.commitToken,
      mutations: mutationRecords.map((r) => ({
        clientMutationId: r.clientMutationId,
        assetType: r.assetType,
        assetId: r.assetId,
      })),
    };

    const commitResp = await fetch(mutationsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitBody),
      cache: "no-store",
    });
    if (!commitResp.ok) return { writes: [] };

    const commitResult = await commitResp.json() as CfCommitResponse;

    await this.session.localState.writeState({
      ...state,
      appliedHead: commitResult.head,
    });

    const results: RemoteWriteResult[] = commitResult.applied.map((a) => ({
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

    return { writes: results, globalCursor: commitResult.head };
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
    const state = await this.localState.readState();
    await fetch(
      `${resolveBackendApiBaseUrl()}/v1/sync/spaces/${state.spaceId}/reset`,
      { method: "POST", cache: "no-store" },
    );
    await this.localState.writeState(defaultState());
  }

  public dispose(): void { /* no-op */ }
}

export function createCloudflareSyncRemote(): SyncRemote {
  return new CloudflareSyncRemote();
}
