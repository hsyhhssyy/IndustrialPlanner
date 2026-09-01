// Cloudflare cf-sync-v2 远端实现。
// 协议版本：cf-sync-v2，直接 HTTP fetch，不使用 Web Worker。
// AI-CORRECTION 2026-08-12: 本文件已退出生产入口，仅作为旧主线程实现保留；
// 当前实现位于 cloudflare-v2-remote.ts 与 cloudflare-v2-worker-runtime.ts。
//
// 协议流程：
//   plan:      GET  /v1/sync/spaces/:spaceId/plan
//   check:     GET  /v1/sync/spaces/:spaceId/check?knownRevision=N
//   写入:      POST /v1/sync/spaces/:spaceId/mutations { action: "prepare" }
//              → 上传 blob 到 upload instructions 中的 URL
//              → POST /v1/sync/spaces/:spaceId/mutations { action: "commit" }
//   下载:      从 plan 的 downloadUrl + ticket 直接 GET
//   创建空间:  POST /v1/sync/spaces

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
import { createLogger } from "@/shared/logging/logger";
import {
  createSha256CanonicalHash,
  createSha256Hash,
  createStableJsonHash,
} from "@/shared/storage/hash-utils";
import type {
  CfV2PlanResponse,
  CfV2CheckResponse,
  CfV2PrepareResponse,
  CfV2CommitResult,
  CfV2PrepareObject,
  CfV2PrepareDeletion,
} from "./cloudflare-v2-types";
import { CF_SYNC_V2_PROTOCOL, CfV2HttpError } from "./cloudflare-v2-types";
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
  SyncRemoteCompleteOptions,
  SyncRemoteSession,
  SyncRemoteSessionContext,
  SyncRemoteWriteBatch,
  SyncContentHashRequest,
} from "../remote-types";
import { RemoteWriteConflictError } from "../remote-types";

const logger = createLogger("cloudflare-v2");

// ============================================================================
// IndexedDB 配置
// ============================================================================

const CF_DATABASE_NAME = "v3-industrial-planner";
const CF_STATE_STORE = "cf-sync-state";
const CF_STATE_KEY_PREFIX = "state";
const CF_ASSETS_STORE = "cf-sync-assets";

const CF_ASSETS_LOCATION: IndexedDbStoreLocation = {
  databaseName: CF_DATABASE_NAME,
  storeName: CF_ASSETS_STORE,
};

// ============================================================================
// 本地状态
// ============================================================================

interface CfLocalState {
  schemaVersion: 3;
  spaceId: string;
  revision: string; // 当前已同步的远端 revision（字符串，仅比较相等性）
}

// AI-CORRECTION 2026-08-10: spaceEpoch 与 generation 已移除。
// Reason: epoch 是服务端内部概念，客户端不应持久化；generation 的唯一作用是
// 在 epoch 变更时作废本地缓存，但 epoch 每次 commit 都变，导致 foreground sync
// 的 checkCollections(204) 短路永远无法生效。
// Replacement: createAssetStorageKey 直接使用 assetKey，getRemoteEtag 使用
// CF_STATE_STORE 独立存储 collection 级 revision。
// Risk: Low；空间重置时 revision 不连续，adapters 的 hash 比对仍能检测差异。

interface CfAssetState {
  assetKey: string;
  remoteRevision: number | null;
  lastSyncedContentHash: string | null;
  remoteProtocolContentHash: string | null;
  remoteAdapterContentHash: string | null;
}

// AI-CORRECTION 2026-08-10: collection 级 etag（用来给 checkCollections 传 knownRevision）。
// 存储在 CF_STATE_STORE 下，不受 generation/epoch 影响。
const CF_COLLECTION_ETAG_PREFIX = "col-etag";

function defaultState(spaceId: string): CfLocalState {
  return {
    schemaVersion: 3,
    spaceId,
    revision: "0",
  };
}

// ============================================================================
// CloudflareSyncLocalState
// ============================================================================

class CloudflareSyncLocalState implements SyncLocalState {
  private readonly stateLocation: IndexedDbStorageLocation;
  private cachedState: CfLocalState | null = null;
  // AI-CORRECTION 2026-08-10: pendingAdapterHashStorageKeys 已移除。
  // Reason: 其唯一清空时机是 epoch 变更，epoch 已从客户端移除。
  // Replacement: noteRemoteHashMapping 中 pendingAdapterHashStorageKeys 逻辑替换为直接比较。
  // Risk: Low。
  // AI-CORRECTION 2026-08-11: 远端协议 hash 与适配器 hash 算法不同，下载后仍需等待
  // setLastSyncedHash 提供归一化后的适配器 hash，才能建立可比较映射。
  private readonly pendingAdapterHashStorageKeys = new Set<string>();

  public constructor(
    private readonly apiBase: string,
    private readonly spaceId: string,
  ) {
    this.stateLocation = {
      databaseName: CF_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: `${CF_STATE_KEY_PREFIX}\u0000${apiBase}\u0000${spaceId}`,
    };
  }

  // ---- SyncLocalState 接口 ---- //

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
        // AI-CORRECTION 2026-08-10: pendingAdapterHashStorageKeys 已移除。
        // 原逻辑：pendingAdapterHashStorageKeys 中有 storageKey 时用 hash填充 remoteAdapterContentHash。
        // 新逻辑：lastSyncedContentHash 正常更新，remoteAdapterContentHash 不在此处设置（由 noteRemoteHashMapping 负责）。
        // AI-CORRECTION 2026-08-11: noteRemoteHashMapping 无法独立计算适配器归一化 hash；
        // 下载后的首次 setLastSyncedHash 必须完成协议 hash → 适配器 hash 映射。
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
    const record = await readFromIndexedDb<{ etag: string | null }>({
      databaseName: CF_DATABASE_NAME,
      storeName: CF_STATE_STORE,
      key: `${CF_COLLECTION_ETAG_PREFIX}\u0000${key}`,
    });
    return record?.etag ?? null;
  }

  public async setRemoteEtag(key: string, etag: string | null): Promise<void> {
    const storageKey = `${CF_COLLECTION_ETAG_PREFIX}\u0000${key}`;
    await applyIndexedDbStoreMutations(
      {
        databaseName: CF_DATABASE_NAME,
        storeName: CF_STATE_STORE,
      },
      etag === null
        ? [{ type: "delete", key: storageKey }]
        : [{ type: "put", key: storageKey, value: { etag } }],
    );
  }

  // ---- 内部方法 ---- //

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

  public async advanceToRevision(revision: string): Promise<void> {
    const state = await this.readState();
    if (state.revision === revision) return;
    await this.writeState({ ...state, revision });
  }

  public async reset(): Promise<void> {
    this.cachedState = null;
    this.pendingAdapterHashStorageKeys.clear();
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
    // AI-CORRECTION 2026-08-10: generation 前缀已移除。
    // Reason: generation 在 epoch 变更时重新生成，导致所有旧缓存 key 变孤儿。
    // Replacement: assetKey 直接作为存储 key，不再需要 generation 作用域。
    return assetKey;
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
  // AI-CORRECTION 2026-08-10: spaceEpoch 和 generation 校验已移除，revision 改为 string 校验。
  if (
    candidate.schemaVersion !== 3
    || candidate.spaceId !== spaceId
    || typeof candidate.revision !== "string"
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
// HTTP 工具函数
// ============================================================================

async function cfV2Fetch(apiBase: string, path: string, init?: RequestInit): Promise<Response> {
  const url = `${apiBase}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok && response.status !== 204) {
    let body: Record<string, unknown> = {};
    try { body = await response.json() as Record<string, unknown>; } catch { /* ignore */ }
    throw new CfV2HttpError(
      response.status,
      typeof body.error === "string" ? body.error : "unknown",
      typeof body.message === "string" ? body.message : `HTTP ${response.status}`,
      body,
    );
  }
  return response;
}

async function cfV2GetJson<T>(apiBase: string, path: string): Promise<T> {
  const response = await cfV2Fetch(apiBase, path);
  if (response.status === 204) return undefined as unknown as T;
  return response.json() as Promise<T>;
}

async function cfV2PostJson<T>(apiBase: string, path: string, body: unknown): Promise<T> {
  const response = await cfV2Fetch(apiBase, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}

async function cancelPreparedBatch(
  apiBase: string,
  spaceId: string,
  prepare: CfV2PrepareResponse,
): Promise<void> {
  try {
    await cfV2PostJson(
      apiBase,
      `/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
      {
        protocol: CF_SYNC_V2_PROTOCOL,
        action: "cancel",
        uploadId: prepare.uploadId,
        commitToken: prepare.commitToken,
      },
    );
  } catch (cancelError) {
    // commit 可能已经开始或完成；此时后端只允许向前恢复，不能取消。
    logger.warn(`Failed to cancel Cloudflare transaction ${prepare.uploadId}.`, cancelError);
  }
}

async function commitPreparedBatch(
  apiBase: string,
  spaceId: string,
  prepare: CfV2PrepareResponse,
): Promise<CfV2CommitResult> {
  return await cfV2PostJson<CfV2CommitResult>(
    apiBase,
    `/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
    {
      protocol: CF_SYNC_V2_PROTOCOL,
      action: "commit",
      uploadId: prepare.uploadId,
      commitToken: prepare.commitToken,
    },
  );
}

// ============================================================================
// CloudflareSyncRemoteSession
// ============================================================================

class CloudflareSyncRemoteSession implements SyncRemoteSession {
  private planCache: CfV2PlanResponse | null = null;
  private readonly apiBase: string;
  private latestCommittedRevision: number | null = null;

  public constructor(
    public readonly localState: CloudflareSyncLocalState,
    private readonly context: SyncRemoteSessionContext,
    apiBase: string,
  ) {
    this.apiBase = apiBase;
  }

  public async computeContentHashes(
    requests: readonly SyncContentHashRequest[],
  ): Promise<readonly string[]> {
    return await Promise.all(requests.map(async (request) =>
      request.algorithm === "sha256-canonical-json-v1"
        ? await createSha256CanonicalHash(request.value)
        : createStableJsonHash(request.value)
    ));
  }

  // -- 确保空间存在 -- //

  private async ensureSpace(): Promise<CfLocalState> {
    const state = await this.localState.readState();
    try {
      await cfV2Fetch(this.apiBase, `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/plan`);
      return state;
    } catch (error) {
      if (error instanceof CfV2HttpError && error.status === 404) {
        logger.info(`Creating Cloudflare space: ${state.spaceId}`);
        await cfV2PostJson(this.apiBase, "/v1/sync/spaces", {
          spaceId: state.spaceId,
        });
        return state;
      }
      throw error;
    }
  }

  // -- prefetchIndexes：获取 plan -- //

  public async prefetchIndexes(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    if (this.planCache !== null) return;
    await this.ensureSpace();
    const state = await this.localState.readState();
    const plan = await cfV2GetJson<CfV2PlanResponse>(
      this.apiBase,
      `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/plan`,
    );
    this.planCache = plan;
    // AI-CORRECTION 2026-08-10: epoch 比较已移除，revision 改为字符串相等性比较。
    // AI-REMOVED 2026-08-11:
    // Reason: plan 只表示已观察到远端版本，不表示所有资产已经成功应用到本地。
    // Trigger: 提前推进 revision 会让后续 /check 返回 204，从而跳过尚未下载的远端更新。
    // Evidence: isRemoteIndexUnchangedForCleanLocalEntries 在 prefetchIndexes 后调用 checkCollections。
    // Replacement: complete() 在整次同步成功后推进 plan revision；成功 commit 则立即推进 commit revision。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const planRevision = String(plan.revision);
    // if (planRevision !== state.revision) {
    //   await this.localState.advanceToRevision(planRevision);
    // }
  }

  public async refreshIndexes(collections: readonly SyncRemoteCollection[]): Promise<void> {
    this.planCache = null;
    await this.prefetchIndexes(collections);
  }

  // -- readIndex：从 plan cache 计算 -- //

  public async readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex> {
    const plan = this.planCache;
    if (plan === null) return { revision: 0, entries: {}, committedAt: null };

    // AI-REMOVED 2026-08-22:
    // Reason: legacy Cloudflare session 同样只按 assetType 枚举，会跨 adapter 暴露共享 planner-state 资源。
    // Trigger: regional-settings 与 production-planning 的远端键碰撞审计。
    // Evidence: SyncRemoteAssetIdCodec 现已声明 acceptsRemoteAssetId 作为 collection 归属边界。
    // Replacement: 下方同时按 assetType 与 codec 归属过滤。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // const assets = plan.assets.filter((a) => a.assetType === collection.assetType);
    const assets = plan.assets.filter((asset) =>
      asset.assetType === collection.assetType
      && (collection.assetIdCodec.acceptsRemoteAssetId?.(asset.assetId) ?? true)
    );
    if (assets.length === 0) {
      return { revision: toLegacyNumericRevision(plan.revision), entries: {}, committedAt: null };
    }

    const codec = collection.assetIdCodec;
    const entries: Record<string, RemoteCollectionIndex["entries"][string]> = {};

    await Promise.all(assets.map(async (asset) => {
      const adapterAssetId = codec.toAdapterAssetId(asset.assetId);
      const protocolContentHash = toAdapterContentHash(asset.contentHash);
      const comparableContentHash = await this.localState.getComparableRemoteHash(
        createAssetStateKey(collection, adapterAssetId),
        protocolContentHash,
      ) ?? protocolContentHash;
      entries[adapterAssetId] = {
        revision: toLegacyNumericRevision(asset.lastModifiedRevision),
        contentHash: comparableContentHash,
        protocolContentHash,
        deletedAt: null,
        committedAt: null,
      };
    }));

    return { revision: toLegacyNumericRevision(plan.revision), entries, committedAt: plan.serverTime };
  }

  // -- readAsset：下载远端资产内容 -- //

  public async readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null> {
    const plan = this.planCache;
    if (plan === null) return null;

    const remoteAssetId = params.collection.assetIdCodec.toRemoteAssetId(params.assetId);
    const asset = plan.assets.find(
      (a) => a.assetType === params.collection.assetType && a.assetId === remoteAssetId,
    );
    if (asset === undefined) return null;

    const contentHash = toAdapterContentHash(asset.contentHash);

    // 直接使用 downloadUrl 下载内容
    const response = await fetch(asset.downloadUrl);
    if (!response.ok) {
      throw new CfV2HttpError(
        response.status,
        "download_failed",
        `Failed to download ${asset.assetType}/${asset.assetId}: HTTP ${response.status}`,
      );
    }
    const contentBytes = new Uint8Array(await response.arrayBuffer());
    const receivedHash = (await createSha256Hash(contentBytes)).slice(7);
    const expectedHash = asset.contentHash.startsWith("sha256:")
      ? asset.contentHash.slice(7)
      : asset.contentHash;
    if (receivedHash !== expectedHash) {
      throw new Error(
        `Downloaded content hash mismatch for ${asset.assetType}/${asset.assetId}: `
        + `expected ${expectedHash}, received ${receivedHash}.`,
      );
    }
    const content = new TextDecoder().decode(contentBytes);
    const value = JSON.parse(content) as unknown;

    await this.localState.noteRemoteHashMapping(
      createAssetStateKey(params.collection, params.assetId),
      contentHash,
    );

    return {
      revision: toLegacyNumericRevision(plan.revision),
      value,
      contentHash,
      committedAt: plan.serverTime,
    };
  }

  // -- checkCollections：检查远端是否有变更 -- //

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    await this.ensureSpace();
    const state = await this.localState.readState();

    const response = await cfV2Fetch(
      this.apiBase,
      `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/check?knownRevision=${state.revision}`,
    );

    // 204 = 未变化
    if (response.status === 204) {
      return { changedCollections: [] };
    }

    const check = await response.json() as CfV2CheckResponse;

    if (!check.changed) {
      return { changedCollections: [], globalCursor: toLegacyNumericRevision(check.revision) };
    }

    // 有变更 → 标记所有请求的集合为已变更
    const assetTypes = new Set(collections.map((c) => c.assetType));
    const changedCollections = collections
      .filter((c) => assetTypes.has(c.assetType))
      .map((c) => c.adapterId);

    return {
      changedCollections,
      globalCursor: toLegacyNumericRevision(check.revision),
    };
  }

  // -- 写入相关 -- //

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
    // AI-CORRECTION 2026-08-10: 补充 setRemoteEtag 调用，确保 collection 级 etag
    // 在每次同步完成后写入 CF_STATE_STORE，供下次 foreground sync 的
    // isRemoteIndexUnchangedForCleanLocalEntries 使用。
    if (result.collectionEtag !== undefined) {
      await this.localState.setRemoteEtag(
        result.collection.stateKey,
        result.collectionEtag,
      );
    } else if (result.collectionRevision !== null) {
      await this.localState.setRemoteEtag(
        result.collection.stateKey,
        String(result.collectionRevision),
      );
    }
  }

  public async prepareCollections(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    // Cloudflare v2 无目录概念
  }

  public async complete(options?: SyncRemoteCompleteOptions): Promise<void> {
    // AI-CORRECTION 2026-09-01: 未来业务 schema 未被理解时保留旧 applied revision，等待客户端升级后重读。
    if (options?.advanceAppliedRevision === false) return;
    if (this.context.reason === "local-change" || this.planCache === null) return;
    const state = await this.localState.readState();
    // AI-CORRECTION 2026-08-10: Math.max → 直接使用 planCache.revision，
    // epoch 参数已移除。revision 仅比较相等性，不存在大小关系。
    // AI-CORRECTION 2026-08-11: 本会话发生提交时，planCache 仍是提交前快照；
    // complete 必须保留 commit 返回的新 revision，不能回退到旧 plan revision。
    const targetRevision = String(
      this.latestCommittedRevision ?? this.planCache.revision,
    );
    if (targetRevision !== state.revision) {
      await this.localState.advanceToRevision(targetRevision);
    }
  }

  public dispose(): void {
    this.planCache = null;
  }

  // -- 供 CloudflareSyncWriteBatch 使用 -- //

  public registerCommittedRevision(revision: number): void {
    // AI-CORRECTION 2026-08-10: Math.max → 直接赋值。
    // Reason: revision 仅比较相等性，不存在大小关系。
    this.latestCommittedRevision = revision;
  }

  public getApiBase(): string {
    return this.apiBase;
  }

  public getObservedRemoteRevision(): number | null {
    return this.planCache === null
      ? null
      : toLegacyNumericRevision(this.planCache.revision);
  }
}

// ============================================================================
// CloudflareSyncWriteBatch（两阶段提交）
// ============================================================================

interface BatchMutation {
  clientMutationId: string;
  operation: "put" | "delete";
  collection: SyncRemoteCollection;
  adapterAssetId: string;
  assetType: string;
  assetId: string;
  value: unknown;
  contentHash: string | null;
  deletedAt: string | null;
}

class CloudflareSyncWriteBatch implements SyncRemoteWriteBatch {
  private mutations: BatchMutation[] = [];
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
      value: params.value,
      contentHash: params.contentHash,
      deletedAt: null,
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
      value: null,
      contentHash: null,
      deletedAt: params.deletedAt,
    });
  }

  public async commit(): Promise<RemoteWriteBatchResult> {
    if (this.committed) return { writes: [] };
    this.committed = true;
    if (this.mutations.length === 0) return { writes: [] };

    const apiBase = this.session.getApiBase();
    const state = await this.session.localState.readState();
    const clientBatchId = createUuid();

    // 分片提交：后端限制每批最多 32 条
    const writes: RemoteWriteResult[] = [];
    // AI-CORRECTION 2026-08-12: 写入必须以本会话已观测并用于冲突判定的 plan revision 为基线。
    // localState.revision 只表示上一次完整应用的远端版本，初次 use-local 冲突时它仍可能是 0。
    // AI-REMOVED 2026-08-12:
    // Reason: 仅使用 localState.revision 会让初次 use-local 以过期 revision 提交。
    // Trigger: 独立 use-local Cloudflare E2E 稳定返回“space revision 已变化”。
    // Evidence: 冲突判定使用 plan revision=1，localState.revision 仍为 0。
    // Replacement: 下方 getObservedRemoteRevision() 优先，未 prefetch 时才回退本地 revision。
    // Risk: 若 plan 后远端再发生并发写入，后端仍会正常以 409 拒绝过期 plan。
    // Human Review: Required
    //
    // Original code:
    // const baseRev = Number(state.revision);
    const baseRev = this.session.getObservedRemoteRevision()
      ?? Number(state.revision);
    let latestRevision = baseRev;

    for (let offset = 0; offset < this.mutations.length; offset += 32) {
      const chunk = this.mutations.slice(offset, offset + 32);
      latestRevision = await this.commitChunk(
        apiBase, state.spaceId, clientBatchId, offset,
        chunk, writes, latestRevision,
      );
    }

    // AI-CORRECTION 2026-08-10: > 0 → !== baseRev。
    // Reason: revision 现在是字符串，且不需要比较大小，只需判断是否发生了提交。
    if (latestRevision !== baseRev) {
      this.session.registerCommittedRevision(latestRevision);
    }

    return { writes, globalCursor: latestRevision };
  }

  private async commitChunk(
    apiBase: string,
    spaceId: string,
    clientBatchId: string,
    offset: number,
    chunk: BatchMutation[],
    writes: RemoteWriteResult[],
    baseRevision: number,
  ): Promise<number> {
    // Phase 1: Prepare
    const objects: CfV2PrepareObject[] = [];
    const deletions: CfV2PrepareDeletion[] = [];

    for (const m of chunk) {
      if (m.operation === "put") {
        const content = JSON.stringify(m.value);
        const contentBytes = new TextEncoder().encode(content);
        // blobHash 必须是原始内容字节的 SHA-256 hex（不含 "sha256:" 前缀）
        // AI-CORRECTION 2026-08-11: contentHash 是适配器的规范化比较 hash，可能来自
        // canonical JSON；上传协议 hash 必须始终对实际传输字节重新计算。
        const blobHash = (await createSha256Hash(contentBytes)).slice(7);
        objects.push({
          clientMutationId: m.clientMutationId,
          assetType: m.assetType,
          assetId: m.assetId,
          metadata: "{}",
          blobHash,
          blobByteSize: contentBytes.byteLength,
          storageMode: "full",
          schemaVersion: 1,
          encoding: "identity",
          writerAppVersion: "0.0.0",
          writerBuildId: "browser",
        });
      } else {
        deletions.push({
          clientMutationId: m.clientMutationId,
          assetType: m.assetType,
          assetId: m.assetId,
        });
      }
    }

    const suffix = offset > 0 ? `-${offset}` : "";

    let prepare: CfV2PrepareResponse;
    try {
      prepare = await cfV2PostJson<CfV2PrepareResponse>(
        apiBase,
        `/v1/sync/spaces/${encodeURIComponent(spaceId)}/mutations`,
        {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "prepare",
          baseRevision,
          clientBatchId: `${clientBatchId}${suffix}`,
          objects,
          deletions,
        },
      );
    } catch (error) {
      throw translateWriteError(error);
    }

    try {
      // Phase 2: Upload blobs
      for (const instruction of prepare.uploads) {
        if (!instruction.required || !instruction.url) continue;
        const mutation = chunk.find(
          (m) => m.assetType === instruction.assetType && m.assetId === instruction.assetId,
        );
        if (!mutation || mutation.operation !== "put") continue;

        const uploadResponse = await fetch(instruction.url, {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            ...instruction.headers,
          },
          body: JSON.stringify(mutation.value),
        });
        if (!uploadResponse.ok) {
          let errorBody = "";
          try { errorBody = await uploadResponse.text(); } catch { /* ignore */ }
          throw new CfV2HttpError(
            uploadResponse.status,
            "upload_failed",
            `Failed to upload ${instruction.assetType}/${instruction.assetId}: ${errorBody}`,
          );
        }
      }

      // Phase 3: Commit
      const result = await commitPreparedBatch(apiBase, spaceId, prepare);

      // 更新本地状态
      // AI-CORRECTION 2026-08-10: epoch 比较已移除，revision 仅比较相等性。
      const currentState = await this.session.localState.readState();
      const resultRevision = String(result.revision);
      if (resultRevision !== currentState.revision) {
        await this.session.localState.advanceToRevision(resultRevision);
      }

      // 映射结果
      for (const mutation of chunk) {
        const applied = result.assets.find(
          (a) => a.assetType === mutation.assetType && a.assetId === mutation.assetId,
        );
        if (applied) {
          writes.push({
            collection: mutation.collection,
            assetId: mutation.adapterAssetId,
            revision: toLegacyNumericRevision(result.revision),
            contentHash: toAdapterContentHash(applied.contentHash),
            deletedAt: null,
            committedAt: result.serverTime,
          });
        } else {
          const deleted = result.deletedAssets.find(
            (a) => a.assetType === mutation.assetType && a.assetId === mutation.assetId,
          );
          if (deleted) {
            writes.push({
              collection: mutation.collection,
              assetId: mutation.adapterAssetId,
              revision: toLegacyNumericRevision(result.revision),
              contentHash: null,
              deletedAt: mutation.deletedAt,
              committedAt: result.serverTime,
            });
          }
        }
      }

      return toLegacyNumericRevision(result.revision);
    } catch (error) {
      await cancelPreparedBatch(apiBase, spaceId, prepare);
      throw translateWriteError(error);
    }
  }

  public async discard(): Promise<void> {
    this.mutations = [];
    this.committed = true;
  }
}

// ============================================================================
// CloudflareSyncRemote
// ============================================================================

export interface CloudflareSyncRemoteOptions {
  readonly apiBase?: string;
  readonly spaceId?: string;
  // 以下选项保留以兼容 sync-host.ts 的调用方式，
  // cf-sync-v2 使用直接 HTTP fetch，不使用 Web Worker。
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly onRequestActivityChange?: (activity: {
    readonly activeRequestCount: number;
    readonly queuedRequestCount: number;
  }) => void;
  readonly workerClientFactory?: unknown;
}

export class CloudflareSyncRemote implements SyncRemote {
  public readonly localState: CloudflareSyncLocalState;
  private readonly apiBase: string;
  private readonly spaceId: string;

  public constructor(options: CloudflareSyncRemoteOptions = {}) {
    this.apiBase = (options.apiBase ?? resolveBackendApiBaseUrl()).replace(/\/$/, "");
    this.spaceId = options.spaceId?.trim() || "default";
    this.localState = new CloudflareSyncLocalState(this.apiBase, this.spaceId);
  }

  public async beginSession(
    context: SyncRemoteSessionContext,
  ): Promise<SyncRemoteSession> {
    return new CloudflareSyncRemoteSession(
      this.localState,
      context,
      this.apiBase,
    );
  }

  public async resetRemote(): Promise<void> {
    const state = await this.localState.readState();
    // 远端 reset：尝试创建新空间（若已存在则忽略），然后本地重置状态
    // AI-CORRECTION 2026-08-11: cf-sync-v2 没有 reset 路由；清除远端必须把 plan
    // 中的全部资产按 deletion 事务分批提交，确保 D1/R2 都走服务端删除状态机。
    let plan: CfV2PlanResponse;
    try {
      plan = await cfV2GetJson<CfV2PlanResponse>(
        this.apiBase,
        `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/plan`,
      );
    } catch (error) {
      if (!(error instanceof CfV2HttpError && error.status === 404)) {
        throw error;
      }
      await cfV2PostJson(this.apiBase, "/v1/sync/spaces", {
        spaceId: state.spaceId,
      });
      plan = {
        spaceId: state.spaceId,
        revision: "0",
        epoch: 0,
        assets: [],
        serverTime: new Date().toISOString(),
      };
    }

    let baseRevision = plan.revision;
    for (let offset = 0; offset < plan.assets.length; offset += 32) {
      const chunk = plan.assets.slice(offset, offset + 32);
      const prepare = await cfV2PostJson<CfV2PrepareResponse>(
        this.apiBase,
        `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/mutations`,
        {
          protocol: CF_SYNC_V2_PROTOCOL,
          action: "prepare",
          baseRevision,
          clientBatchId: createUuid(),
          objects: [],
          deletions: chunk.map((asset) => ({
            clientMutationId: createUuid(),
            assetType: asset.assetType,
            assetId: asset.assetId,
          })),
        },
      );
      try {
        const result = await commitPreparedBatch(
          this.apiBase,
          state.spaceId,
          prepare,
        );
        baseRevision = result.revision;
      } catch (error) {
        await cancelPreparedBatch(this.apiBase, state.spaceId, prepare);
        throw error;
      }
    }
    await this.localState.reset();
  }

  public async abortTransaction(): Promise<void> {
    const state = await this.localState.readState();
    await cfV2PostJson(
      this.apiBase,
      `/v1/sync/spaces/${encodeURIComponent(state.spaceId)}/transaction/abort`,
      {},
    );
  }

  public dispose(): void { /* no-op */ }
}

export function createCloudflareSyncRemote(
  options: CloudflareSyncRemoteOptions = {},
): SyncRemote {
  return new CloudflareSyncRemote(options);
}

// ============================================================================
// 工具函数
// ============================================================================

function toAdapterContentHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

// 旧主线程实现已经停用；该转换仅保持历史文件可类型检查，不参与生产 Worker 链路。
function toLegacyNumericRevision(revision: string): number {
  const numeric = Number(revision);
  return Number.isSafeInteger(numeric) ? numeric : 0;
}

function createAssetStateKey(collection: SyncRemoteCollection, assetId: string): string {
  return `${collection.adapterId}:${assetId}`;
}

function translateWriteError(error: unknown): unknown {
  if (error instanceof CfV2HttpError && error.status === 409) {
    const details = error.details;
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

// ============================================================================
// AI-REMOVED 2026-08-09:
// Reason: 旧 cf-sync-v1 协议使用 Web Worker 进行 epoch/appliedHead 游标同步，
//         后端已完全重构为 cf-sync-v2 协议（revision + 两阶段提交）。
// Trigger: 后端 cf-sync-v2 上线后，v1 协议已不可用。
// Evidence: 后端 packages/sync/src/ 中 space_http.ts 使用 SPACE_PROTOCOL_VERSION="cf-sync-v2"，
//          space_service.ts 中使用 prepareSpaceUpload/commitSpaceUpload/planSpace/checkSpaceRevision。
// Replacement: 本文件 — 直接 HTTP fetch，使用 revision 游标 + prepare/upload/commit 两阶段提交。
// Risk: Medium；旧 epoch/appliedHead 状态与 v2 的 revision/epoch 不兼容，
//       首次同步会把远端视为全新版本。
// Human Review: Required
//
// 旧 cloudflare-remote.ts 基于 Web Worker 的 cf-sync-v1 实现已被完全替换。
// 归档原始代码可在 git history 中查看（commit 之前版本的 cloudflare-remote.ts）。
// ============================================================================
