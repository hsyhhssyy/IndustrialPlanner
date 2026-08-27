// AI-CORRECTION 2026-08-12:
// cf-sync-v2 的网络、JSON/UTF-8、哈希和两阶段提交已迁入 Dedicated Worker。
// 本文件只保留 SyncRemote 值语义适配、assetId codec 以及业务同步状态编排。

import { createUuid } from "@/domain/shared/uuid";
import { resolveBackendApiBaseUrl } from "@/shared/storage/backend-api-address";

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
  SyncContentHashRequest,
  SyncLocalState,
  SyncRemote,
  SyncRemoteCollection,
  SyncRemoteSession,
  SyncRemoteSessionContext,
  SyncRemoteWriteBatch,
} from "../remote-types";
import {
  RemoteDownloadStaleError,
  RemoteWriteConflictError,
} from "../remote-types";
import type {
  CfV2CommitBatchResult,
  CfV2LoadPlanResult,
  CfV2ReadAssetResult,
  CfV2TransactionRecoveryResult,
  CfV2WorkerConfig,
  CfV2WorkerMutation,
} from "./cloudflare-v2-worker-protocol";
import {
  CloudflareV2WorkerClient,
  type CloudflareV2WorkerActivity,
  type CloudflareV2WorkerBridge,
} from "./cloudflare-v2-worker-client";
import type { CfV2CheckResponse, CfV2Revision } from "./cloudflare-v2-types";
import { CfV2HttpError } from "./cloudflare-v2-types";

export interface CloudflareSyncRemoteOptions {
  readonly apiBase?: string;
  readonly spaceId: string;
  readonly accessToken?: string;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly onRequestActivityChange?: (activity: CloudflareV2WorkerActivity) => void;
  readonly workerClient?: CloudflareV2WorkerBridge;
  readonly workerClientFactory?: () => CloudflareV2WorkerBridge;
}

export class CloudflareSyncRemote implements SyncRemote {
  public readonly localState: SyncLocalState;
  private readonly workerClient: CloudflareV2WorkerBridge;
  private readonly ownsWorkerClient: boolean;
  private readonly config: CfV2WorkerConfig;

  public constructor(private readonly options: CloudflareSyncRemoteOptions) {
    const spaceId = options.spaceId.trim();
    if (spaceId === "") {
      throw new Error("Cloudflare space ID must not be empty.");
    }

    this.config = {
      apiBase: (options.apiBase ?? resolveBackendApiBaseUrl()).replace(/\/$/, ""),
      spaceId,
      ...(options.accessToken === undefined
        ? {}
        : { accessToken: options.accessToken }),
      maxConcurrentRequests: normalizeConcurrency(options.maxConcurrentRequests),
      requestTimeoutMs: normalizeTimeout(options.requestTimeoutMs),
    };
    this.workerClient = options.workerClient
      ?? options.workerClientFactory?.()
      ?? new CloudflareV2WorkerClient();
    this.ownsWorkerClient = options.workerClient === undefined;
    this.localState = new CloudflareV2SyncLocalState(
      this.workerClient,
      this.config,
      options.onRequestActivityChange,
    );
  }

  public async beginSession(context: SyncRemoteSessionContext): Promise<SyncRemoteSession> {
    const recovery = await this.request<CfV2TransactionRecoveryResult>({
      type: "recover-pending-upload",
    });
    return new CloudflareV2SyncRemoteSession(
      this.workerClient,
      this.config,
      this.localState,
      context,
      this.options.onRequestActivityChange,
      recovery,
    );
  }

  public async resetRemote(): Promise<void> {
    await this.request<void>({ type: "reset-remote" });
  }

  public async abortTransaction(): Promise<void> {
    await this.request<void>({ type: "abort-transaction" });
  }

  public dispose(): void {
    if (this.ownsWorkerClient) {
      this.workerClient.dispose();
    }
  }

  private async request<TResult>(
    operation: Parameters<CloudflareV2WorkerBridge["request"]>[1],
  ): Promise<TResult> {
    return await this.workerClient.request<TResult>(
      this.config,
      operation,
      this.options.onRequestActivityChange,
    );
  }
}

class CloudflareV2SyncLocalState implements SyncLocalState {
  public constructor(
    private readonly workerClient: CloudflareV2WorkerBridge,
    private readonly config: CfV2WorkerConfig,
    private readonly onActivity?: (activity: CloudflareV2WorkerActivity) => void,
  ) {}

  public async getLastSyncedHash(assetKey: string): Promise<string | null> {
    return await this.request<string | null>({
      type: "state-get-last-synced-hash",
      assetKey,
    });
  }

  public async setLastSyncedHash(assetKey: string, hash: string | null): Promise<void> {
    await this.request<void>({ type: "state-set-last-synced-hash", assetKey, hash });
  }

  public async getRemoteRevision(key: string): Promise<number | null> {
    return await this.request<number | null>({ type: "state-get-remote-revision", key });
  }

  public async setRemoteRevision(key: string, revision: number | null): Promise<void> {
    await this.request<void>({ type: "state-set-remote-revision", key, revision });
  }

  public async getRemoteEtag(key: string): Promise<string | null> {
    return await this.request<string | null>({ type: "state-get-remote-etag", key });
  }

  public async setRemoteEtag(key: string, etag: string | null): Promise<void> {
    await this.request<void>({ type: "state-set-remote-etag", key, etag });
  }

  private async request<TResult>(
    operation: Parameters<CloudflareV2WorkerBridge["request"]>[1],
  ): Promise<TResult> {
    return await this.workerClient.request<TResult>(this.config, operation, this.onActivity);
  }
}

class CloudflareV2SyncRemoteSession implements SyncRemoteSession {
  private planCache: CfV2LoadPlanResult | null = null;
  private latestCommittedRevision: CfV2Revision | null;
  // AI-REMOVED 2026-08-25:
  // Reason: 引擎常规同步已恢复为全部 adapter 的完整 plan 分类，不再存在用 collection 集合
  //   补救局部 scope 的合法路径；继续保留该门禁会使成功 commit 无法推进全局 revision。
  // Trigger: 本地 A 上传、远端 B 变化并存时，上传成功后更新检查仍重复命中旧 revision。
  // Evidence: sync-service.resolveRegularSyncRequests 现始终发出无 scope 的全部 adapter 请求。
  // Replacement: complete() 在完整同步事务成功后直接推进 plan/commit revision。
  // Risk: Low；CloudflareV2SyncRemoteSession 仅由执行完整分类的同步引擎创建。
  // Human Review: Required
  //
  // Original code:
  // /** 仅完整处理过的 collection 才能参与全局 applied revision 推进。 */
  // private readonly appliedCompleteCollectionIds = new Set<string>();
  // AI-REMOVED 2026-08-13:
  // Reason: 同步编排已改为“先下载、后上传、单次 commit”，不再有同会话多批次顺序上传。
  // Trigger: sync-model.md 要求上传基线固定为下载阶段开始前 plan 的最新 revision。
  // Evidence: 新引擎每个 run 只 commit 一次；本字段让后续批次以本会话提交的 revision 为基线，与新语义冲突。
  // Replacement: getObservedRemoteRevision 直接返回 plan revision。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // private sessionCommittedRevision: CfV2Revision | null = null;
  private pendingJournalAck: boolean;

  public constructor(
    private readonly workerClient: CloudflareV2WorkerBridge,
    private readonly config: CfV2WorkerConfig,
    public readonly localState: SyncLocalState,
    // AI-REMOVED 2026-08-25:
    // Reason: session 不再用 run reason/collection 到齐状态决定全局 revision。
    // Trigger: CF 同步恢复完整 plan 分类，complete() 成为唯一推进边界。
    // Evidence: context 的唯一活动读取来自已移除的 allCollectionsApplied 与 local-change 特判。
    // Replacement: 保留普通参数 `_context` 以维持构造签名，provider 不再持久持有它。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // private readonly context: SyncRemoteSessionContext,
    _context: SyncRemoteSessionContext,
    private readonly onActivity: ((activity: CloudflareV2WorkerActivity) => void) | undefined,
    recovery: CfV2TransactionRecoveryResult,
  ) {
    this.latestCommittedRevision = recovery.commit?.revision ?? null;
    this.pendingJournalAck = recovery.commit !== null;
  }

  public async computeContentHashes(
    requests: readonly SyncContentHashRequest[],
  ): Promise<readonly string[]> {
    return await this.request<readonly string[]>({
      type: "compute-content-hashes",
      requests,
    });
  }

  public async prefetchIndexes(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    if (this.planCache === null) {
      this.planCache = await this.request<CfV2LoadPlanResult>({ type: "load-plan" });
    }
  }

  public async refreshIndexes(collections: readonly SyncRemoteCollection[]): Promise<void> {
    this.planCache = null;
    // AI-REMOVED 2026-08-13:
    // Reason: 与 sessionCommittedRevision 字段一并移除（见上）。
    // Trigger: 新编排不再有同会话多批次上传基线。
    // Replacement: None。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.sessionCommittedRevision = null;
    await this.prefetchIndexes(collections);
  }

  public async readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex> {
    const plan = this.planCache;
    if (plan === null) {
      return { revision: 0, entries: {}, committedAt: null };
    }
    // AI-REMOVED 2026-08-22:
    // Reason: 只按 assetType 过滤会把共享 planner-state 命名空间中的生产计划和区域设置混入彼此索引。
    // Trigger: regional-settings/default 错读 planner-state/default 的生产计划 JSON。
    // Evidence: SyncRemoteAssetIdCodec 现已声明 acceptsRemoteAssetId 作为 collection 归属边界。
    // Replacement: 下方同时按 assetType 与 codec 归属过滤。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // const assets = plan.assets.filter((asset) => asset.assetType === collection.assetType);
    const assets = plan.assets.filter((asset) =>
      asset.assetType === collection.assetType
      && (collection.assetIdCodec.acceptsRemoteAssetId?.(asset.assetId) ?? true)
    );
    if (assets.length === 0) {
      return { revision: toAdapterRevision(plan.revision), entries: {}, committedAt: null };
    }
    const mappedAssets = assets.map((asset) => {
      const adapterAssetId = collection.assetIdCodec.toAdapterAssetId(asset.assetId);
      const protocolContentHash = toProtocolContentHash(asset.contentHash);
      return {
        asset,
        adapterAssetId,
        protocolContentHash,
        assetKey: createAssetStateKey(collection, adapterAssetId),
      };
    });
    const comparableHashes = await this.request<readonly (string | null)[]>({
      type: "state-read-comparable-hashes",
      assets: mappedAssets.map((asset) => ({
        assetKey: asset.assetKey,
        protocolContentHash: asset.protocolContentHash,
      })),
    });
    const entries: RemoteCollectionIndex["entries"] = {};
    mappedAssets.forEach((mapped, index) => {
      // AI-CORRECTION 2026-08-13: fallback 口径（未映射/未知）时不得与本地口径 hash 比较。
      const comparableHash = comparableHashes[index];
      entries[mapped.adapterAssetId] = {
        revision: toAdapterRevision(mapped.asset.lastModifiedRevision),
        contentHash: comparableHash ?? mapped.protocolContentHash,
        protocolContentHash: mapped.protocolContentHash,
        contentHashCaliber: comparableHash === null ? "protocol-fallback" : "adapter",
        deletedAt: null,
        committedAt: null,
      };
    });
    return {
      revision: toAdapterRevision(plan.revision),
      entries,
      committedAt: plan.serverTime,
    };
  }

  public async readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null> {
    const plan = this.planCache;
    if (plan === null) {
      return null;
    }
    const remoteAssetId = params.collection.assetIdCodec.toRemoteAssetId(params.assetId);
    const asset = plan.assets.find((candidate) =>
      candidate.assetType === params.collection.assetType
      && candidate.assetId === remoteAssetId
    );
    if (asset === undefined) {
      return null;
    }
    const result = await this.request<CfV2ReadAssetResult>({
      type: "read-asset",
      asset,
      planRevision: plan.revision,
      planServerTime: plan.serverTime,
    }).catch((error: unknown) => {
      // AI-CORRECTION 2026-08-13: 下载 409 与写 409 同语义，转换为引擎可识别的整轮重启信号。
      if (error instanceof CfV2HttpError && error.status === 409) {
        // 定位埋点：把后端 error code 带进重启日志，区分 409 的具体语义。
        throw new RemoteDownloadStaleError(
          params.collection.name,
          params.assetId,
          `${error.message} (backendCode=${error.code})`,
        );
      }
      throw error;
    });
    await this.request<void>({
      type: "state-note-remote-hash",
      assetKey: createAssetStateKey(params.collection, params.assetId),
      protocolContentHash: result.contentHash,
    });
    return result;
  }

  public async checkCollections(
    collections: readonly SyncRemoteCollection[],
  ): Promise<RemoteCheckResult> {
    const knownRevision = await this.request<string>({
      type: "state-read-applied-revision",
    });
    const check = await this.request<CfV2CheckResponse | null>({
      type: "check",
      knownRevision,
    });
    if (check === null || !check.changed) {
      return {
        changedCollections: [],
        ...(check === null ? {} : { globalCursor: toAdapterRevision(check.revision) }),
      };
    }
    return {
      changedCollections: collections.map((collection) => collection.adapterId),
      globalCursor: toAdapterRevision(check.revision),
    };
  }

  public beginWriteBatch(): SyncRemoteWriteBatch {
    return new CloudflareV2SyncWriteBatch(this);
  }

  public async markApplied(result: RemoteApplyResult): Promise<void> {
    if (!result.scopeComplete) {
      return;
    }

    // AI-REMOVED 2026-08-25:
    // Reason: complete() 不再按 collection 到齐情况决定全局 revision，集合登记失去语义。
    // Trigger: 常规同步恢复完整 plan 分类，局部 scope 不再是 CF 成功事务的合法形态。
    // Evidence: sync-service.resolveRegularSyncRequests 对所有 adapter 使用无 scope 请求。
    // Replacement: complete() 的事务成功边界。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.appliedCompleteCollectionIds.add(result.collection.adapterId);
    if (result.collectionRevision !== null) {
      await this.localState.setRemoteRevision(
        result.collection.stateKey,
        result.collectionRevision,
      );
    }
    if (result.collectionEtag !== undefined) {
      await this.localState.setRemoteEtag(result.collection.stateKey, result.collectionEtag);
    } else if (result.collectionRevision !== null) {
      await this.localState.setRemoteEtag(
        result.collection.stateKey,
        String(result.collectionRevision),
      );
    }
  }

  public async prepareCollections(_collections: readonly SyncRemoteCollection[]): Promise<void> {
    // Cloudflare v2 没有目录维护步骤。
  }

  public async complete(): Promise<void> {
    // AI-REMOVED 2026-08-25:
    // Reason: collection 到齐门禁是对局部 local-change scope 的补救；它只能阻止漏变更，
    //   却同时造成成功 commit 后全局 revision 不前推、下一轮重复 plan 和伪下载阶段。
    // Trigger: 同步引擎已恢复“每轮完整 plan、全部资源分类”的原设计不变量。
    // Evidence: sync-service.resolveRegularSyncRequests 始终覆盖全部 adapter，初始同步 scope
    //   也由互补请求覆盖完整 collection；只有完整事务成功后才调用 complete()。
    // Replacement: 下方直接选择 latestCommittedRevision 或本轮 plan revision。
    // Risk: Low；若未来重新引入局部 CF 同步，必须在引擎层建立独立游标，不能复用全局 revision。
    // Human Review: Required
    //
    // Original code:
    // const allCollectionsApplied = this.context.collections.every((collection) =>
    //   this.appliedCompleteCollectionIds.has(collection.adapterId)
    // );
    // AI-REMOVED 2026-08-22:
    // Reason: 仅依据 run reason 或本轮 commit 推进全局 revision，会把未进入局部 scope 的
    //   其他 collection/资产一并标记为已读取。
    // Trigger: 非当前基地远端变化在另一个局部上传完成后被小检查永久跳过。
    // Evidence: markApplied 已提供 scopeComplete，但旧 complete 未验证所有 collection 是否完整处理。
    // Replacement: 下方仅在 allCollectionsApplied 时选择 targetRevision；上传日志确认继续独立执行。
    // Risk: Medium；局部上传后会保守地保留旧 applied revision，下一轮小检查将再次拉取确认。
    // Human Review: Required
    // AI-CORRECTION 2026-08-24: 上述“小检查”现统一称为“更新检查”。
    //
    // Original code:
    // const targetRevision = this.latestCommittedRevision
    //   ?? (this.context.reason === "local-change" ? null : this.planCache?.revision ?? null);
    // AI-CORRECTION 2026-08-25: 上述 2026-08-22 的局部 scope 门禁已由完整 plan 不变量取代；
    // 成功 commit 必须推进到 commit revision，无上传的完整分类推进到 plan revision。
    // AI-REMOVED 2026-08-25:
    // Reason: allCollectionsApplied 门禁已删除，条件表达式不再成立。
    // Trigger: 常规同步不再允许局部 CF scope。
    // Evidence: sync-service.resolveRegularSyncRequests 的无 scope 全 adapter 请求。
    // Replacement: 下方 targetRevision。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // const targetRevision = allCollectionsApplied
    //   ? this.latestCommittedRevision ?? this.planCache?.revision ?? null
    //   : null;
    const targetRevision = this.latestCommittedRevision
      ?? this.planCache?.revision
      ?? null;
    if (targetRevision !== null) {
      await this.request<void>({
        type: "state-write-applied-revision",
        revision: targetRevision,
      });
    }
    if (this.pendingJournalAck) {
      await this.request<void>({ type: "ack-pending-upload" });
      this.pendingJournalAck = false;
    }
  }

  public dispose(): void {
    this.planCache = null;
  }

  public getObservedRemoteRevision(): CfV2Revision | null {
    // AI-REMOVED 2026-08-13:
    // Reason: 同一会话内多批次顺序上传的基线机制已被“单次 commit”取代。
    // Trigger: sync-model.md 上传基线 = 下载阶段开始前 plan 的最新 revision。
    // Replacement: 直接返回 plan revision。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // if (this.sessionCommittedRevision !== null) {
    //   return this.sessionCommittedRevision;
    // }
    return this.planCache?.revision ?? null;
  }

  public async readAppliedRevision(): Promise<CfV2Revision> {
    return await this.request<string>({ type: "state-read-applied-revision" });
  }

  public registerCommittedRevision(revision: CfV2Revision): void {
    this.latestCommittedRevision = revision;
    // AI-REMOVED 2026-08-13:
    // Reason: 与 sessionCommittedRevision 字段一并移除（见上）。
    // Trigger: 新编排单次 commit。
    // Replacement: latestCommittedRevision 继续用于 complete() 的 applied revision。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // this.sessionCommittedRevision = revision;
    this.pendingJournalAck = true;
  }

  public async commitWorkerBatch(options: {
    readonly baseRevision: CfV2Revision;
    readonly clientBatchId: string;
    readonly mutations: readonly CfV2WorkerMutation[];
  }): Promise<CfV2CommitBatchResult> {
    return await this.request<CfV2CommitBatchResult>({
      type: "commit-batch",
      ...options,
    });
  }

  private async request<TResult>(
    operation: Parameters<CloudflareV2WorkerBridge["request"]>[1],
  ): Promise<TResult> {
    return await this.workerClient.request<TResult>(this.config, operation, this.onActivity);
  }
}

interface PendingMutation {
  readonly collection: SyncRemoteCollection;
  readonly mutation: CfV2WorkerMutation;
}

class CloudflareV2SyncWriteBatch implements SyncRemoteWriteBatch {
  private mutations: PendingMutation[] = [];
  private committed = false;

  public constructor(private readonly session: CloudflareV2SyncRemoteSession) {}

  public putAsset(params: RemoteAssetPutParams): void {
    if (this.committed) {
      return;
    }
    this.mutations.push({
      collection: params.collection,
      mutation: {
        clientMutationId: createUuid(),
        operation: "put",
        adapterId: params.collection.adapterId,
        adapterAssetId: params.assetId,
        assetType: params.collection.assetType,
        assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
        value: params.value,
        adapterContentHash: params.contentHash,
        deletedAt: null,
      },
    });
  }

  public putTombstone(params: RemoteAssetTombstoneParams): void {
    if (this.committed) {
      return;
    }
    this.mutations.push({
      collection: params.collection,
      mutation: {
        clientMutationId: createUuid(),
        operation: "delete",
        adapterId: params.collection.adapterId,
        adapterAssetId: params.assetId,
        assetType: params.collection.assetType,
        assetId: params.collection.assetIdCodec.toRemoteAssetId(params.assetId),
        value: null,
        adapterContentHash: params.targetContentHash,
        deletedAt: params.deletedAt,
      },
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
    const baseRevision = this.session.getObservedRemoteRevision()
      ?? await this.session.readAppliedRevision();
    let latestRevision = baseRevision;
    const writes: RemoteWriteResult[] = [];
    const clientBatchId = createUuid();

    for (let offset = 0; offset < this.mutations.length; offset += 32) {
      const chunk = this.mutations.slice(offset, offset + 32);
      let result: CfV2CommitBatchResult;
      try {
        result = await this.session.commitWorkerBatch({
          baseRevision: latestRevision,
          clientBatchId: offset === 0 ? clientBatchId : `${clientBatchId}-${offset}`,
          mutations: chunk.map((entry) => entry.mutation),
        });
      } catch (error) {
        throw translateWriteError(error);
      }
      latestRevision = result.revision;
      for (const applied of result.applied) {
        const pending = chunk.find((entry) =>
          entry.mutation.clientMutationId === applied.clientMutationId
        );
        if (pending === undefined) {
          continue;
        }
        writes.push({
          collection: pending.collection,
          assetId: applied.adapterAssetId,
          revision: applied.revision,
          contentHash: applied.contentHash,
          deletedAt: applied.deletedAt,
          committedAt: applied.committedAt,
        });
      }
      // 后续 chunk 需要先释放前一笔已提交日志；Worker 会在下一次 commit 前执行该步骤。
      this.session.registerCommittedRevision(latestRevision);
    }
    return { writes, globalCursor: toAdapterRevision(latestRevision) };
  }

  public async discard(): Promise<void> {
    this.mutations = [];
    this.committed = true;
  }
}

export function createCloudflareSyncRemote(
  options: CloudflareSyncRemoteOptions,
): SyncRemote {
  return new CloudflareSyncRemote(options);
}

function translateWriteError(error: unknown): unknown {
  if (error instanceof CfV2HttpError && error.status === 409) {
    const details = error.details;
    if (
      typeof details === "object"
      && details !== null
      && "conflicts" in details
      && Array.isArray(details.conflicts)
    ) {
      return new RemoteWriteConflictError(details.conflicts.map((conflict) => {
        const value = conflict as Record<string, unknown>;
        return {
          assetType: typeof value.assetType === "string" ? value.assetType : "",
          assetId: typeof value.assetId === "string" ? value.assetId : "",
          reason: typeof value.reason === "string" ? value.reason : error.code,
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
    // AI-CORRECTION 2026-08-13: 后端所有 commit 409（revision_mismatch / space_locked /
    // batch_cancelled / uploads_incomplete 等）语义均为“丢弃本次完整操作从头开始”，
    // 统一转换为引擎的整轮重启信号，不再依赖 details.conflicts 结构。
    return new RemoteWriteConflictError([{
      assetType: "",
      assetId: "",
      reason: error.code,
      expectedRevision: typeof details === "object" && details !== null
        && typeof details.expectedRevision === "number"
        ? details.expectedRevision
        : null,
      actualRevision: typeof details === "object" && details !== null
        && typeof details.actualRevision === "number"
        ? details.actualRevision
        : null,
      expectedHash: null,
      actualHash: null,
    }]);
  }
  return error;
}

function createAssetStateKey(collection: SyncRemoteCollection, assetId: string): string {
  return `${collection.adapterId}:${assetId}`;
}

function toProtocolContentHash(hash: string): string {
  return hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
}

function toAdapterRevision(revision: CfV2Revision): number {
  if (/^\d+$/.test(revision)) {
    const numeric = Number(revision);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  const timestampMatch = /-(\d+)$/.exec(revision);
  if (timestampMatch?.[1] !== undefined) {
    const timestamp = Number(timestampMatch[1]);
    if (Number.isSafeInteger(timestamp)) {
      return timestamp;
    }
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < revision.length; index += 1) {
    hash ^= revision.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeConcurrency(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? 4
    : Math.max(1, Math.min(16, Math.round(value)));
}

function normalizeTimeout(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? 30_000
    : Math.max(1_000, Math.round(value));
}
