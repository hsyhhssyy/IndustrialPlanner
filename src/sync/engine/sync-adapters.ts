import { createStableJsonHash } from "@/shared/storage/hash-utils";
import { createLogger } from "@/shared/logging/logger";
import type { SyncConflictItemKind } from "@/domain/sync";
import type {
  RemoteAssetMeta,
  RemoteAssetPutParams,
  RemoteAssetTombstoneParams,
  SyncRemoteAdapterMode,
  SyncRemoteCollection,
  SyncRemoteSession,
  SyncRemoteWriteBatch,
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
  clearLastSeenRemoteEtag,
  readLastSeenRemoteRevision,
  writeLastSeenRemoteRevision,
} from "../storage";

const logger = createLogger("sync-adapter");

export type SyncAdapterMode = SyncRemoteAdapterMode;
export type SyncAdapterConflictResolution = "use-local" | "use-remote" | "pause";
export type SyncAdapterStatus = "idle" | "uploaded" | "downloaded" | "conflict" | "skipped";

export interface SyncAdapterResult {
  readonly adapterId: string;
  readonly mode: SyncAdapterMode;
  readonly status: SyncAdapterStatus;
  readonly changedAssetIds: readonly string[];
  /** 本轮观察到的 collection revision；引擎在 commit 成功后用于 markApplied。 */
  readonly collectionRevision?: number | null;
  /** 本轮观察到的 collection ETag；本 adapter 有上传时传 null 使检查重新探测。 */
  readonly collectionEtag?: string | null;
}

export interface SyncAdapterConflict<TValue> {
  readonly adapterId: string;
  readonly assetId: string;
  /** 弹框条目类型：upload（默认用我的）/ download（默认用远端）/ conflict（双向）。 */
  readonly kind?: SyncConflictItemKind;
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

// ============================================================================
// 同步引擎事务 — 先下载、后上传、单次 commit 的执行上下文
// ============================================================================

export type SyncPlanItemKind = "upload" | "download" | "conflict";
export type SyncLocalChangeState = "dirty" | "clean" | "unknown";

/**
 * 引擎级计划条目：一个资产的分类结果与决议执行句柄。
 * 弹框按条目逐项选择；引擎按决议调用 applyDownload / applyUpload / applyLocalRestore。
 */
export interface SyncPlanItem {
  readonly adapterId: string;
  readonly assetId: string;
  readonly kind: SyncPlanItemKind;
  readonly localValue: unknown;
  readonly remoteValue: unknown | null;
  readonly localHash: string | null;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  /** 决议为“用远端”时执行；墓碑走二段删除，非墓碑立即下载落地。 */
  readonly applyDownload: () => Promise<void>;
  /** 决议为“用我的”时执行：登记上传 mutation + 暂存 touch。 */
  readonly applyUpload: () => Promise<void>;
  /** 下载条目改判“用我的”时恢复本地原值（之后引擎再登记上传）。 */
  readonly applyLocalRestore: () => Promise<void>;
  /**
   * 上传条目改判“用远端”时执行：放弃本地新增。
   * 本地资产按远端墓碑语义二段删除（commit 成功后才落地），touch 清空，
   * 使该资产若日后重新编辑，可再次按“远端从未存在”上传新增。
   */
  readonly applyDiscardLocal: () => Promise<void>;
}

export interface SyncPlanUpload {
  readonly adapterId: string;
  readonly assetId: string;
  readonly params: RemoteAssetPutParams | RemoteAssetTombstoneParams;
}

/**
 * 引擎在单轮同步内注入的事务对象。
 * adapter 只负责分类、下载落地与登记；上传 commit、touch 落盘、
 * 二段删除落地全部由引擎在 commit 成功后统一执行。
 */
export interface SyncEngineTransaction {
  /** 共享上传批次；commit 由引擎在全部下载完成后执行。 */
  readonly writeBatch: SyncRemoteWriteBatch;
  /** 暂存 touch（lastSyncedHash），commit 成功后由引擎统一落盘。 */
  stageTouch(assetKey: string, contentHash: string | null): void;
  /** 暂存二段删除：commit 成功后执行；commit 失败或本轮被丢弃时不会执行。 */
  stageDeletion(adapterId: string, assetId: string, apply: () => Promise<void>): void;
  /** 登记弹框条目（upload / download / conflict）。 */
  recordItem(item: SyncPlanItem): void;
  /** 登记上传 mutation；由引擎在弹框决议后写入共享批次。 */
  recordUpload(upload: SyncPlanUpload): void;
  /** 下载落地前检查二代脏标；置位则抛 SyncDownloadDirtyAbortError 终止本轮。 */
  assertDownloadAllowed(adapterId: string, assetId: string): Promise<void>;
  /** 本轮开始时的本地变更状态；clean 可直接复用持久化 touch hash。 */
  getLocalChangeState?(adapterId: string, assetId: string): SyncLocalChangeState;
  /** 真正开始应用远端内容时通知引擎切换下载阶段。 */
  beginDownload?(): void;
}

/** 下载不容忍：落地前发现第二代脏标。引擎捕获后锁定画布并从头重跑。 */
export class SyncDownloadDirtyAbortError extends Error {
  public constructor(
    public readonly adapterId: string,
    public readonly assetId: string,
  ) {
    super(`Download aborted — asset ${adapterId}/${assetId} was edited during sync.`);
    this.name = "SyncDownloadDirtyAbortError";
  }
}

export interface SyncAdapterSyncOptions {
  readonly scope?: SyncAdapterScope;
  readonly transaction: SyncEngineTransaction;
}

export interface SyncAdapter {
  readonly id: string;
  readonly mode: SyncAdapterMode;
  readonly collection: SyncRemoteCollection;
  readonly checkPath: string | null;
  sync(
    session: SyncRemoteSession,
    options: SyncAdapterSyncOptions,
  ): Promise<SyncAdapterResult>;
  // AI-REMOVED 2026-08-13:
  // Reason: 旧“同步后探测冲突 + 分阶段执行决议”工作流已被引擎级弹框取代。
  // Trigger: sync-model.md 要求上传/下载/冲突资产全部进入对话框逐项选择，
  //   决议执行由引擎统一编排（先下载、后上传、单次 commit）。
  // Evidence: 旧 runConflictWorkflow 依赖这些方法按 adapter 分组二次执行；
  //   新引擎直接从 SyncPlanItem 的决议句柄执行，不再需要探测与执行分离。
  // Replacement: SyncPlanItem.applyDownload / applyUpload / applyLocalRestore。
  // Risk: Low；外部模块无这两个方法的其他调用点。
  // Human Review: Required
  //
  // Original code:
  // inspectConflicts?(
  //   session: SyncRemoteSession,
  //   scope?: SyncAdapterScope,
  // ): Promise<readonly SyncAdapterConflict<unknown>[]>;
  // /**
  //  * 执行冲突决策：Phase 1 并行下载 use-remote，Phase 2 单事务并行上传 use-local。
  //  * 不走 sync() 的全量比较逻辑,只处理 decisions 中明确决定的条目。
  //  *
  //  * 若提供 sharedWriteBatch，use-local 条目将写入该共享批次，且不在此方法内 commit；
  //  * 调用方负责在所有 adapter 完成后调用 sharedWriteBatch.commit()，并仅在提交成功后
  //  * 持久化 use-local 条目的 lastSyncedHash。
  //  */
  // executeConflictDecisions?(
  //   session: SyncRemoteSession,
  //   decisions: readonly SyncAdapterConflictDecision[],
  //   sharedWriteBatch?: SyncRemoteWriteBatch,
  // ): Promise<SyncAdapterResult>;
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
  readonly protocolContentHash?: string | null;
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
  /** 适配器归一化后的本地比较 hash。 */
  readonly contentHash: string;
  /** 远端结构化原值是否被适配器归一化；用于将 schema 迁移结果回写远端。 */
  readonly normalizationChanged: boolean;
  /** 远端协议返回的权威 hash，只能用于下一次乐观并发基线。 */
  readonly remoteContentHash: string;
  readonly revision: number;
  readonly committedAt: string | null;
  readonly etag: string | null;
}

// AI-REMOVED 2026-08-13:
// Reason: writeRemoteValue 已随单值 adapter 的自建批次提交一并移除，接口不再有消费方。
// Trigger: sync-model.md“先下载、后上传、单次 commit”语义。
// Replacement: transaction.recordUpload。
// Risk: Low。
// Human Review: Required
//
// Original code:
// interface WriteRemoteValueOptions<TValue> {
//   readonly session: SyncRemoteSession;
//   readonly collection: SyncRemoteCollection;
//   readonly assetId: string;
//   readonly value: TValue;
//   readonly contentHash: string;
//   readonly baseRevision: number | null;
//   readonly baseContentHash: string | null;
// }

async function createSyncContentHash(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  value: unknown,
): Promise<string> {
  const [hash] = await session.computeContentHashes([{
    algorithm: collection.hashAlgorithm,
    value,
  }]);
  if (hash === undefined) {
    throw new Error(`Content hash worker returned no result for "${collection.adapterId}".`);
  }
  return hash;
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

  // AI-REMOVED 2026-08-11:
  // Reason: JSON 解析或 schema 归一化失败不等于远端资产不存在。
  // Trigger: 返回 null 会进入“仅本地存在”分支，并可能用本地内容覆盖损坏或暂时不兼容的远端资产。
  // Evidence: syncFullNoRevision 将 remoteValue=null 解释为新本地资产并调用 writeRemote。
  // Replacement: 下方显式解析与归一化错误，远端无效时中止同步。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // try {
  //   const parsed: unknown = JSON.parse(asset.content);
  //   const value = normalizeRemote === undefined
  //     ? parsed as TValue
  //     : normalizeRemote(parsed);
  //   if (value === null) {
  //     return null;
  //   }
  //
  //   return {
  //     value,
  //     contentHash: await createSyncContentHash(collection, value),
  //     remoteContentHash: asset.contentHash,
  //     revision: asset.revision,
  //     committedAt: asset.committedAt,
  //     etag: asset.etag ?? null,
  //   };
  // } catch {
  //   return null;
  // }
  // AI-CORRECTION 2026-08-12: JSON 解析已下沉到 provider 边界；适配器只消费结构化值。
  const parsed = asset.value;
  const value = normalizeRemote === undefined
    ? parsed as TValue
    : normalizeRemote(parsed);
  if (value === null) {
    throw new Error(
      `Remote asset ${collection.adapterId}/${assetId} failed schema normalization.`,
    );
  }

  return {
    value,
    contentHash: await createSyncContentHash(session, collection, value),
    normalizationChanged:
      normalizeRemote !== undefined
      && createStableJsonHash(parsed) !== createStableJsonHash(value),
    remoteContentHash: asset.contentHash,
    revision: asset.revision,
    committedAt: asset.committedAt,
    etag: asset.etag ?? null,
  };
}

// AI-REMOVED 2026-08-13:
// Reason: 新编排直接消费 RemoteCollectionIndex，不再需要转换层。
// Trigger: 先下载后上传重构，分类逻辑统一使用 RemoteAssetMeta 口径标记。
// Replacement: syncFullWithRevision / syncPatchCollectionWithRevision 直接使用 remoteIndexState。
// Risk: Low。
// Human Review: Required
//
// Original code:
// function toRemoteIndexFile(index: RemoteCollectionIndex): RemoteIndexFile {
//   return {
//     revision: index.revision,
//     entries: Object.fromEntries(
//       Object.entries(index.entries).flatMap(([assetId, entry]) =>
//         entry.contentHash === null
//           ? []
//           : [[assetId, {
//               contentHash: entry.contentHash,
//               ...(entry.protocolContentHash === undefined
//                 ? {}
//                 : { protocolContentHash: entry.protocolContentHash }),
//               deletedAt: entry.deletedAt,
//               committedAt: entry.committedAt,
//               revision: entry.revision,
//             } satisfies RemoteIndexEntry]]
//       ),
//     ),
//   };
// }

// AI-REMOVED 2026-08-13:
// Reason: 单值 adapter 的上传不再自行建批次提交，统一由引擎的共享批次在下载完成后 commit。
// Trigger: sync-model.md“先下载、后上传、单次 commit”语义。
// Replacement: transaction.recordUpload + createPlanItem 的 applyUpload。
// Risk: Low。
// Human Review: Required
//
// Original code:
// async function writeRemoteValue<TValue>(options: WriteRemoteValueOptions<TValue>): Promise<void> {
//   const batch = options.session.beginWriteBatch();
//   batch.putAsset({
//     collection: options.collection,
//     assetId: options.assetId,
//     value: options.value,
//     contentHash: options.contentHash,
//     baseRevision: options.baseRevision,
//     baseContentHash: options.baseContentHash,
//   });
//   await batch.commit();
// }

function resolveRemoteBaseContentHash(
  entry: RemoteIndexEntry | RemoteAssetMeta | null | undefined,
): string | null {
  const protocolHash = (entry as RemoteIndexEntry | null | undefined)?.protocolContentHash ?? null;
  return protocolHash ?? entry?.contentHash ?? null;
}

/** 索引 hash 是否处于可与本地口径 hash 直接比较的口径（fallback 口径不得比较）。 */
function isIndexHashComparable(
  entry: RemoteAssetMeta | null | undefined,
): boolean {
  return (entry?.contentHashCaliber ?? "adapter") !== "protocol-fallback";
}

// ============================================================================
// 三值分类（lastSyncedHash 为基线）
// ============================================================================

type SingleValueClassification =
  | { readonly kind: "idle" }
  | { readonly kind: "upload" }
  | { readonly kind: "download" }
  | { readonly kind: "conflict" };

interface ClassifySingleValueOptions {
  readonly localValue: unknown | null;
  readonly remoteValue: unknown | null;
  readonly localHash: string | null;
  readonly remoteHash: string | null;
  readonly lastSyncedHash: string | null;
  /** 远端资产消失时是否允许解释为“远端墓碑下载”（否则解释为本地新增上传）。 */
  readonly supportsRemoteTombstone: boolean;
  /** 定位埋点标签（adapterId/assetId），仅当判定为 conflict 时输出三方 hash 调试日志。 */
  readonly debugLabel?: string;
}

function classifySingleValue(options: ClassifySingleValueOptions): SingleValueClassification {
  // 定位埋点：conflict 判定时输出三方 hash，用于追溯 409 重启后假 conflict 的错位源。
  const conflict = (): SingleValueClassification => {
    if (options.debugLabel !== undefined) {
      logger.debug(
        `${options.debugLabel}: classified conflict — `
        + `localHash=${options.localHash ?? "null"} `
        + `remoteHash=${options.remoteHash ?? "null"} `
        + `lastSyncedHash=${options.lastSyncedHash ?? "null"}`,
      );
    }
    return { kind: "conflict" };
  };

  if (options.localValue === null && options.remoteValue === null) {
    return { kind: "idle" };
  }

  if (options.localValue !== null && options.remoteValue === null) {
    // 本地有、远端无。
    if (options.supportsRemoteTombstone && options.lastSyncedHash !== null) {
      if (options.localHash === options.lastSyncedHash) {
        // 曾同步过且本地未改 → 远端墓碑下载（二段删除）。
        return { kind: "download" };
      }
      // 曾同步过且本地已改 → 冲突。
      return conflict();
    }
    // 远端从未存在（或不支持墓碑的 adapter）→ 上传新增。
    return { kind: "upload" };
  }

  if (options.localValue === null && options.remoteValue !== null) {
    return { kind: "download" };
  }

  if (options.localHash === null || options.remoteHash === null) {
    return { kind: "idle" };
  }

  if (options.localHash === options.remoteHash) {
    return { kind: "idle" };
  }

  if (options.lastSyncedHash === options.remoteHash) {
    // 本地改了、远端没变 → 静默上传。
    return { kind: "upload" };
  }

  if (options.lastSyncedHash === options.localHash) {
    // 远端改了、本地没变 → 静默采用远端。
    return { kind: "download" };
  }

  return conflict();
}

// ============================================================================
// 计划条目构造
// ============================================================================

interface CreatePlanItemOptions<TValue> {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly transaction: SyncEngineTransaction;
  readonly adapterId: string;
  readonly assetId: string;
  readonly kind: SyncPlanItemKind;
  readonly localValue: TValue | null;
  readonly localDeletedAt: string | null;
  readonly localHash: string | null;
  readonly remoteValue: TValue | null;
  readonly remoteHash: string | null;
  readonly remoteDeletedAt: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly writeLocal: (value: TValue, deletedAt: string | null) => Promise<void>;
  /** 远端墓碑落地（二段删除）；不提供则该 asset 不支持墓碑下载。 */
  readonly applyRemoteTombstone: ((remoteDeletedAt: string) => Promise<void>) | null;
  /** 读取远端资产（决策翻转为“用远端”时执行下载）。 */
  readonly readRemoteValue: () => Promise<NormalizedRemoteAsset<TValue> | null>;
  /** 构造正文上传参数。 */
  readonly createPutParams: (
    value: TValue,
    contentHash: string,
  ) => Promise<RemoteAssetPutParams>;
  /** 构造墓碑上传参数；不提供则该 asset 不支持墓碑上传。 */
  readonly createTombstoneParams: ((
    value: TValue,
    deletedAt: string,
    contentHash: string,
  ) => Promise<RemoteAssetTombstoneParams>) | null;
}

/**
 * 构造计划条目。下载落地（含脏标代际检查）统一走 applyDownload；
 * 上传登记（mutation + touch 暂存）统一走 applyUpload。
 */
function createPlanItem<TValue>(options: CreatePlanItemOptions<TValue>): SyncPlanItem {
  const {
    session,
    collection,
    transaction,
    adapterId,
    assetId,
    kind,
    localValue,
    localDeletedAt,
    localHash,
    remoteDeletedAt,
  } = options;
  const assetKey = createSyncAssetKey(collection, assetId);

  const applyDownload = async (): Promise<void> => {
    await transaction.assertDownloadAllowed(adapterId, assetId);
    transaction.beginDownload?.();
    if (remoteDeletedAt !== null) {
      if (options.applyRemoteTombstone === null) {
        logger.warn(`${adapterId}/${assetId}: remote tombstone not supported → skipping`);
        return;
      }
      transaction.stageDeletion(adapterId, assetId, () =>
        options.applyRemoteTombstone!(remoteDeletedAt));
      transaction.stageTouch(assetKey, options.remoteHash);
      return;
    }

    const remoteAsset = await options.readRemoteValue();
    if (remoteAsset === null) {
      logger.warn(`${adapterId}/${assetId}: use-remote but remote asset not found → skipping`);
      return;
    }
    await options.writeLocal(remoteAsset.value, null);
    transaction.stageTouch(assetKey, remoteAsset.contentHash);
  };

  const applyUpload = async (): Promise<void> => {
    if (localDeletedAt !== null) {
      if (options.createTombstoneParams === null || localValue === null) {
        logger.warn(`${adapterId}/${assetId}: local tombstone upload not supported → skipping`);
        return;
      }
      const targetContentHash = await createSyncContentHash(session, collection, null);
      const params = await options.createTombstoneParams(
        localValue,
        localDeletedAt,
        targetContentHash,
      );
      transaction.recordUpload({ adapterId, assetId, params });
      transaction.stageTouch(assetKey, localHash);
      return;
    }

    if (localValue === null || localHash === null) {
      logger.warn(`${adapterId}/${assetId}: use-local but local value not found → skipping`);
      return;
    }
    const params = await options.createPutParams(localValue, localHash);
    transaction.recordUpload({ adapterId, assetId, params });
    transaction.stageTouch(assetKey, localHash);
  };

  const applyLocalRestore = async (): Promise<void> => {
    if (localValue === null) {
      return;
    }
    await options.writeLocal(localValue, localDeletedAt);
  };

  // AI-CORRECTION 2026-08-14: 上传条目被用户决议为“用远端”时，语义为放弃本地新增——
  // 本地资产删除（远端墓碑落地，二段式：commit 成功后才执行删除），touch 清空。
  // 原实现走 applyDownload 的“远端资产不存在 → skipping”分支，本地原样保留、不上传，
  // 但本轮同步照常推进 acknowledged 与脏标清理，制造“已同步”假象，
  // 使真实上传被推迟到不可预期的下一轮同步（全量重新分类时），进而污染以
  // 空间 revision 为等待信号的调用方。
  const applyDiscardLocal = async (): Promise<void> => {
    await transaction.assertDownloadAllowed(adapterId, assetId);
    transaction.beginDownload?.();
    if (options.applyRemoteTombstone === null) {
      logger.warn(
        `${adapterId}/${assetId}: local discard not supported → skipping`,
      );
      return;
    }
    transaction.stageDeletion(adapterId, assetId, () =>
      options.applyRemoteTombstone!(new Date().toISOString()));
    transaction.stageTouch(assetKey, null);
  };

  return {
    adapterId,
    assetId,
    kind,
    localValue: localValue as unknown,
    remoteValue: options.remoteValue as unknown | null,
    localHash,
    remoteHash: options.remoteHash,
    remoteDeletedAt,
    remoteUpdatedAt: options.remoteUpdatedAt,
    applyDownload,
    applyUpload,
    applyLocalRestore,
    applyDiscardLocal,
  };
}

// AI-REMOVED 2026-08-13:
// Reason: 旧“分阶段冲突决策执行”已被引擎级弹框 + SyncPlanItem 决议句柄取代。
// Trigger: sync-model.md 要求上传/下载/冲突资产全部进入对话框逐项选择，
//   引擎统一执行决议并负责单次 commit；adapter 不再持有两阶段执行逻辑。
// Evidence: 新引擎从 SyncPlanItem.applyDownload / applyUpload / applyLocalRestore 执行决议。
// Replacement: createPlanItem（上方）与 sync-service 的决议编排。
// Risk: Low。
// Human Review: Required
//
// Original code:
//
// // ============================================================================
// // executeConflictDecisions — 两阶段冲突执行
// // ============================================================================
//
// interface ConflictExecutionContext<TValue> {
//   readonly collection: SyncRemoteCollection;
//   readonly adapterId: string;
//   /** 归一化远端 JSON → 本地 value；返回 null 视为解析失败。 */
//   readonly normalizeRemote: ((value: unknown) => TValue | null) | undefined;
//   /** 读取远端 asset 并返回 parsed + normalized 结果。 */
//   readonly readRemoteAsset: (session: SyncRemoteSession, assetId: string) => Promise<NormalizedRemoteAsset<TValue> | null>;
//   /** 读取本地 value（用于上传 use-local 条目）。 */
//   readonly readLocalValue: (assetId: string) => Promise<TValue | null>;
//   /** 获取本地墓碑的 deletedAt；非墓碑返回 null。 */
//   readonly getLocalDeletedAt: (assetId: string) => Promise<string | null>;
//   /** 将远端 value 写入本地（use-remote 下载）。remoteDeletedAt 用于墓碑场景。 */
//   readonly writeLocalForDownload: (
//     session: SyncRemoteSession,
//     assetId: string,
//     remoteValue: TValue,
//     remoteDeletedAt: string | null,
//   ) => Promise<void>;
//   /** 获取远端上传所需的乐观并发基线修订号。 */
//   readonly getRemoteRevision: (session: SyncRemoteSession, assetId: string) => Promise<number | null>;
//   /** 获取远端上传所需的 baseContentHash。 */
//   readonly getRemoteBaseContentHash: (session: SyncRemoteSession, assetId: string) => Promise<string | null>;
// }
//
// async function executeCollectionConflictDecisions<TValue>(
//   session: SyncRemoteSession,
//   decisions: readonly SyncAdapterConflictDecision[],
//   ctx: ConflictExecutionContext<TValue>,
//   sharedWriteBatch?: SyncRemoteWriteBatch,
// ): Promise<SyncAdapterResult> {
//   const useRemote = decisions.filter((d) => d.resolution === "use-remote");
//   const useLocal = decisions.filter((d) => d.resolution === "use-local");
//   const pause = decisions.filter((d) => d.resolution === "pause");
//   const changedAssetIds: string[] = [...useRemote.map((d) => d.assetId), ...useLocal.map((d) => d.assetId)];
//   let status: SyncAdapterStatus = "idle";
//
//   // Phase 1: 并行下载所有 use-remote
//   if (useRemote.length > 0) {
//     await Promise.all(useRemote.map(async (decision) => {
//       if (decision.remoteDeletedAt !== null) {
//         // 墓碑下载：仅写本地 deletedAt，不拉取远端正文
//         await ctx.writeLocalForDownload(
//           session, decision.assetId,
//           null as unknown as TValue,
//           decision.remoteDeletedAt,
//         );
//         const assetKey = createSyncAssetKey(ctx.collection, decision.assetId);
//         // 墓碑的 lastSyncedHash 使用远端 hash
//         await session.localState.setLastSyncedHash(assetKey, decision.remoteHash);
//         logger.info(`${ctx.adapterId}/${decision.assetId}: use-remote (tombstone) → deletedAt=${decision.remoteDeletedAt}`);
//         status = mergeStatus(status, "downloaded");
//         return;
//       }
//
//       const remoteAsset = await ctx.readRemoteAsset(session, decision.assetId);
//       if (remoteAsset === null) {
//         logger.warn(`${ctx.adapterId}/${decision.assetId}: use-remote but remote asset not found → skipping`);
//         return;
//       }
//       await ctx.writeLocalForDownload(session, decision.assetId, remoteAsset.value, null);
//       const assetKey = createSyncAssetKey(ctx.collection, decision.assetId);
//       await session.localState.setLastSyncedHash(assetKey, remoteAsset.contentHash);
//       logger.info(`${ctx.adapterId}/${decision.assetId}: use-remote → downloaded`);
//       status = mergeStatus(status, "downloaded");
//     }));
//   }
//
//   // Phase 2: 上传所有 use-local — 写入共享批次或自建批次
//   if (useLocal.length > 0) {
//     const ownedBatch = sharedWriteBatch === undefined;
//     const batch = sharedWriteBatch ?? session.beginWriteBatch();
//     for (const decision of useLocal) {
//       const localDeletedAt = await ctx.getLocalDeletedAt(decision.assetId);
//       if (localDeletedAt !== null) {
//         // 本地墓碑：putTombstone
//         const contentHash = await createSyncContentHash(session, ctx.collection, null);
//         const baseRevision = await ctx.getRemoteRevision(session, decision.assetId);
//         const baseContentHash = await ctx.getRemoteBaseContentHash(session, decision.assetId);
//         batch.putTombstone({
//           collection: ctx.collection,
//           assetId: decision.assetId,
//           deletedAt: localDeletedAt,
//           targetContentHash: contentHash,
//           baseRevision,
//           baseContentHash,
//         });
//         logger.info(`${ctx.adapterId}/${decision.assetId}: use-local (tombstone) → uploaded`);
//         status = mergeStatus(status, "uploaded");
//         continue;
//       }
//
//       const localValue = await ctx.readLocalValue(decision.assetId);
//       if (localValue === null) {
//         logger.warn(`${ctx.adapterId}/${decision.assetId}: use-local but local value not found → skipping`);
//         continue;
//       }
//       const contentHash = await createSyncContentHash(session, ctx.collection, localValue);
//       const baseRevision = await ctx.getRemoteRevision(session, decision.assetId);
//       const baseContentHash = await ctx.getRemoteBaseContentHash(session, decision.assetId);
//       batch.putAsset({
//         collection: ctx.collection,
//         assetId: decision.assetId,
//         value: localValue,
//         contentHash,
//         baseRevision,
//         baseContentHash,
//       });
//       logger.info(`${ctx.adapterId}/${decision.assetId}: use-local → uploaded`);
//       status = mergeStatus(status, "uploaded");
//     }
//     if (ownedBatch) {
//       await batch.commit();
//       for (const decision of useLocal) {
//         await session.localState.setLastSyncedHash(
//           createSyncAssetKey(ctx.collection, decision.assetId),
//           decision.localHash,
//         );
//       }
//     }
//   }
//
//   if (pause.length > 0) {
//     status = mergeStatus(status, "conflict");
//   }
//
//   return {
//     adapterId: ctx.adapterId,
//     mode: ctx.collection.mode,
//     status,
//     changedAssetIds: Array.from(new Set(changedAssetIds)),
//   };
// }

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
    sync: async (session, syncOptions) => await syncFullNoRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
    // AI-REMOVED 2026-08-13:
    // Reason: 旧冲突探测与两阶段决策执行工作流已移除。
    // Trigger: sync-model.md 引擎级弹框取代 adapter 级决议执行。
    // Replacement: syncFullNoRevision 通过 SyncPlanItem 登记条目，引擎执行决议。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // inspectConflicts: async (session, scope) =>
    //   await inspectFullNoRevisionConflicts(session, collection, options, scope),
    // executeConflictDecisions: async (session, decisions, sharedWriteBatch) =>
    //   await executeCollectionConflictDecisions(session, decisions, {
    //     collection,
    //     adapterId: options.id,
    //     normalizeRemote: options.normalizeRemote,
    //     readRemoteAsset: (s, assetId) => readRemoteAssetValue(s, collection, assetId, options.normalizeRemote),
    //     readLocalValue: async () => await options.readLocal(),
    //     getLocalDeletedAt: async () => null,
    //     writeLocalForDownload: async (_s, _assetId, remoteValue, remoteDeletedAt) => {
    //       if (remoteDeletedAt !== null) {
    //         // full-no-revision 不支持墓碑；仅记录日志
    //         logger.warn(`${options.id}: use-remote tombstone not supported for full-no-revision adapter`);
    //         return;
    //       }
    //       await options.writeLocal(remoteValue);
    //     },
    //     getRemoteRevision: async (s) => {
    //       const remoteAsset = await readRemoteAssetValue(s, collection, "single", options.normalizeRemote);
    //       return remoteAsset?.revision ?? null;
    //     },
    //     getRemoteBaseContentHash: async (s) => {
    //       const remoteAsset = await readRemoteAssetValue(s, collection, "single", options.normalizeRemote);
    //       return remoteAsset?.remoteContentHash ?? null;
    //     },
    //   }, sharedWriteBatch),
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
    sync: async (session, syncOptions) => await syncFullWithRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
    // AI-REMOVED 2026-08-13:
    // Reason: 旧冲突探测与两阶段决策执行工作流已移除。
    // Trigger: sync-model.md 引擎级弹框取代 adapter 级决议执行。
    // Replacement: syncFullWithRevision 通过 SyncPlanItem 登记条目，引擎执行决议。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // inspectConflicts: async (session, scope) =>
    //   await inspectFullWithRevisionConflicts(session, collection, options, scope),
    // executeConflictDecisions: async (session, decisions, sharedWriteBatch) => {
    //   // 预读远端索引以获取 revision / baseContentHash
    //   const remoteIndexState = await session.readIndex(collection);
    //   return await executeCollectionConflictDecisions(session, decisions, {
    //     collection,
    //     adapterId: options.id,
    //     normalizeRemote: options.normalizeRemote,
    //     readRemoteAsset: (s, assetId) => readRemoteAssetValue(s, collection, assetId, options.normalizeRemote),
    //     readLocalValue: async (assetId) => {
    //       const localEntries = await options.listLocal();
    //       const entry = localEntries.find((e) => e.id === assetId);
    //       return entry?.value ?? null;
    //     },
    //     getLocalDeletedAt: async (assetId) => {
    //       const localEntries = await options.listLocal();
    //       const entry = localEntries.find((e) => e.id === assetId);
    //       return entry?.deletedAt ?? null;
    //     },
    //     writeLocalForDownload: async (_s, assetId, remoteValue, remoteDeletedAt) => {
    //       await options.writeLocal({ id: assetId, value: remoteValue, deletedAt: remoteDeletedAt });
    //     },
    //     getRemoteRevision: async (_s, assetId) => {
    //       const entry = remoteIndexState.entries[assetId];
    //       return entry?.revision ?? remoteIndexState.revision;
    //     },
    //     getRemoteBaseContentHash: async (_s, assetId) => {
    //       const entry = remoteIndexState.entries[assetId];
    //       return resolveRemoteBaseContentHash(entry);
    //     },
    //   }, sharedWriteBatch);
    // },
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
    sync: async (session, syncOptions) => await syncPatchWithRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
    // AI-REMOVED 2026-08-13:
    // Reason: 旧冲突探测与两阶段决策执行工作流已移除。
    // Trigger: sync-model.md 引擎级弹框取代 adapter 级决议执行。
    // Replacement: syncPatchWithRevision 通过 SyncPlanItem 登记条目，引擎执行决议。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // inspectConflicts: async (session, scope) =>
    //   await inspectPatchWithRevisionConflicts(session, collection, options, scope),
    // executeConflictDecisions: async (session, decisions, sharedWriteBatch) =>
    //   await executeCollectionConflictDecisions(session, decisions, {
    //     collection,
    //     adapterId: options.id,
    //     normalizeRemote: options.normalizeRemote,
    //     readRemoteAsset: (s, assetId) => readRemoteAssetValue(s, collection, assetId, options.normalizeRemote),
    //     readLocalValue: async () => await options.readLocal(),
    //     getLocalDeletedAt: async () => null,
    //     writeLocalForDownload: async (_s, _assetId, remoteValue, remoteDeletedAt) => {
    //       if (remoteDeletedAt !== null) {
    //         logger.warn(`${options.id}: use-remote tombstone not supported for patch-with-revision adapter`);
    //         return;
    //       }
    //       await options.writeLocal(remoteValue);
    //     },
    //     getRemoteRevision: async (s) => {
    //       const remoteAsset = await readRemoteAssetValue(s, collection, "snapshot", options.normalizeRemote);
    //       return remoteAsset?.revision ?? null;
    //     },
    //     getRemoteBaseContentHash: async (s) => {
    //       const remoteAsset = await readRemoteAssetValue(s, collection, "snapshot", options.normalizeRemote);
    //       return remoteAsset?.remoteContentHash ?? null;
    //     },
    //   }, sharedWriteBatch),
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
    sync: async (session, syncOptions) => await syncPatchCollectionWithRevision(
      session,
      collection,
      options,
      syncOptions,
    ),
    // AI-REMOVED 2026-08-13:
    // Reason: 旧冲突探测与两阶段决策执行工作流已移除。
    // Trigger: sync-model.md 引擎级弹框取代 adapter 级决议执行。
    // Replacement: syncPatchCollectionWithRevision 通过 SyncPlanItem 登记条目，引擎执行决议。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // inspectConflicts: async (session, scope) =>
    //   await inspectPatchCollectionWithRevisionConflicts(session, collection, options, scope),
    // executeConflictDecisions: async (session, decisions, sharedWriteBatch) => {
    //   const remoteIndexState = await session.readIndex(collection);
    //   return await executeCollectionConflictDecisions(session, decisions, {
    //     collection,
    //     adapterId: options.id,
    //     normalizeRemote: options.normalizeRemote,
    //     readRemoteAsset: (s, assetId) => readRemoteAssetValue(s, collection, assetId, options.normalizeRemote),
    //     readLocalValue: async (assetId) => {
    //       const localEntries = await options.listLocal();
    //       const entry = localEntries.find((e) => e.id === assetId);
    //       return entry?.value ?? null;
    //     },
    //     getLocalDeletedAt: async (assetId) => {
    //       const localEntries = await options.listLocal();
    //       const entry = localEntries.find((e) => e.id === assetId);
    //       return entry?.deletedAt ?? null;
    //     },
    //     writeLocalForDownload: async (_s, assetId, remoteValue, remoteDeletedAt) => {
    //       await options.writeLocal({ id: assetId, value: remoteValue, deletedAt: remoteDeletedAt });
    //     },
    //     getRemoteRevision: async (_s, assetId) => {
    //       const entry = remoteIndexState.entries[assetId];
    //       return entry?.revision ?? remoteIndexState.revision;
    //     },
    //     getRemoteBaseContentHash: async (_s, assetId) => {
    //       const entry = remoteIndexState.entries[assetId];
    //       return resolveRemoteBaseContentHash(entry);
    //     },
    //   }, sharedWriteBatch);
    // },
  };
}

// AI-REMOVED 2026-08-13:
// Reason: 旧“同步完成后探测冲突 + 分阶段执行决议”工作流已移除。
// Trigger: sync-model.md 要求引擎级弹框：上传/下载/冲突资产全部进入对话框逐项选择，
//   分类与决议执行已统一到 sync 函数内的 SyncPlanItem 登记。
// Evidence: sync-service 的 runConflictWorkflow 已删除；无其他调用点。
// Replacement: syncFullNoRevision / syncFullWithRevision / syncPatchWithRevision /
//   syncPatchCollectionWithRevision 通过 transaction.recordItem 登记条目。
// Risk: Low。
// Human Review: Required
//
// Original code:
//
// async function inspectFullNoRevisionConflicts<TValue>(
//   session: SyncRemoteSession,
//   collection: SyncRemoteCollection,
//   options: FullNoRevisionAdapterOptions<TValue>,
//   scope?: SyncAdapterScope,
// ): Promise<readonly SyncAdapterConflict<TValue>[]> {
//   if (!isAssetIncludedInScope("single", scope)) {
//     return [];
//   }
//
//   const localValuePromise = options.readLocal();
//   const remoteAssetPromise = readRemoteAssetValue(
//     session,
//     collection,
//     "single",
//     options.normalizeRemote,
//   );
//   const localValue = await localValuePromise;
//   const remoteAsset = await remoteAssetPromise;
//   const conflict = await createValueConflict<TValue>({
//     session,
//     collection,
//     adapterId: options.id,
//     assetId: "single",
//     localValue,
//     remoteValue: remoteAsset?.value ?? null,
//     lastSyncedHash: await session.localState.getLastSyncedHash(
//       createSyncAssetKey(collection, "single"),
//     ),
//     remoteDeletedAt: null,
//     remoteUpdatedAt: remoteAsset?.committedAt ?? null,
//   });
//
//   return conflict === null ? [] : [conflict];
// }
//
// async function inspectFullWithRevisionConflicts<TValue>(
//   session: SyncRemoteSession,
//   collection: SyncRemoteCollection,
//   options: FullWithRevisionAdapterOptions<TValue>,
//   scope?: SyncAdapterScope,
// ): Promise<readonly SyncAdapterConflict<TValue>[]> {
//   const [localEntries, remoteIndexState] = await Promise.all([
//     options.listLocal(scope),
//     session.readIndex(collection),
//   ]);
//   const includedLocalEntries = localEntries.filter((entry) =>
//     isAssetIncludedInScope(entry.id, scope),
//   );
//   const remoteValues = new Map(await Promise.all(
//     includedLocalEntries.flatMap((entry) => {
//       const remoteEntry = remoteIndexState.entries[entry.id];
//       return remoteEntry === undefined || remoteEntry.deletedAt !== null
//         ? []
//         : [readRemoteAssetValue(
//           session,
//           collection,
//           entry.id,
//           options.normalizeRemote,
//         ).then((value) => [entry.id, value] as const)];
//     }),
//   ));
//
//   return await inspectCollectionConflicts({
//     session,
//     collection,
//     adapterId: options.id,
//     localEntries: includedLocalEntries,
//     remoteIndexState,
//     readRemoteValue: (entryId) => remoteValues.get(entryId)?.value ?? null,
//     readRemoteUpdatedAt: (entryId) =>
//       remoteIndexState.entries[entryId]?.committedAt
//       ?? remoteIndexState.committedAt,
//   });
// }
//
// async function inspectPatchWithRevisionConflicts<TValue>(
//   session: SyncRemoteSession,
//   collection: SyncRemoteCollection,
//   options: PatchWithRevisionAdapterOptions<TValue>,
//   scope?: SyncAdapterScope,
// ): Promise<readonly SyncAdapterConflict<TValue>[]> {
//   if (!isAssetIncludedInScope("snapshot", scope)) {
//     return [];
//   }
//
//   const localValuePromise = options.readLocal();
//   const remoteAssetPromise = readRemoteAssetValue(
//     session,
//     collection,
//     "snapshot",
//     options.normalizeRemote,
//   );
//   const localValue = await localValuePromise;
//   const remoteAsset = await remoteAssetPromise;
//   const conflict = await createValueConflict<TValue>({
//     session,
//     collection,
//     adapterId: options.id,
//     assetId: "snapshot",
//     localValue,
//     remoteValue: remoteAsset?.value ?? null,
//     lastSyncedHash: await session.localState.getLastSyncedHash(
//       createSyncAssetKey(collection, "snapshot"),
//     ),
//     remoteDeletedAt: null,
//     remoteUpdatedAt: remoteAsset?.committedAt ?? null,
//   });
//
//   return conflict === null ? [] : [conflict];
// }
//
// async function inspectPatchCollectionWithRevisionConflicts<TValue>(
//   session: SyncRemoteSession,
//   collection: SyncRemoteCollection,
//   options: PatchCollectionWithRevisionAdapterOptions<TValue>,
//   scope?: SyncAdapterScope,
// ): Promise<readonly SyncAdapterConflict<TValue>[]> {
//   const [localEntries, remoteIndexState] = await Promise.all([
//     options.listLocal(scope),
//     session.readIndex(collection),
//   ]);
//   const includedLocalEntries = localEntries.filter((entry) =>
//     isAssetIncludedInScope(entry.id, scope),
//   );
//   const remoteStates = new Map(await Promise.all(
//     includedLocalEntries.flatMap((entry) => {
//       const remoteEntry = remoteIndexState.entries[entry.id];
//       return remoteEntry === undefined || remoteEntry.deletedAt !== null
//         ? []
//         : [readRemoteAssetValue(
//           session,
//           collection,
//           entry.id,
//           options.normalizeRemote,
//         ).then((state) => [entry.id, state] as const)];
//     }),
//   ));
//
//   return await inspectCollectionConflicts({
//     session,
//     collection,
//     adapterId: options.id,
//     localEntries: includedLocalEntries,
//     remoteIndexState,
//     readRemoteValue: (entryId) =>
//       remoteStates.get(entryId)?.value ?? null,
//     readRemoteUpdatedAt: (entryId) =>
//       remoteStates.get(entryId)?.committedAt
//       ?? remoteIndexState.entries[entryId]?.committedAt
//       ?? remoteIndexState.committedAt,
//   });
// }
//
// async function inspectCollectionConflicts<TValue>(options: {
//   readonly session: SyncRemoteSession;
//   readonly collection: SyncRemoteCollection;
//   readonly adapterId: string;
//   readonly localEntries: readonly {
//     readonly id: string;
//     readonly value: TValue;
//     readonly deletedAt: string | null;
//   }[];
//   readonly remoteIndexState: RemoteCollectionIndex;
//   readonly readRemoteValue: (entryId: string) => TValue | null;
//   readonly readRemoteUpdatedAt: (entryId: string) => string | null;
// }): Promise<readonly SyncAdapterConflict<TValue>[]> {
//   const conflicts: SyncAdapterConflict<TValue>[] = [];
//   for (const localEntry of options.localEntries) {
//     const remoteEntry =
//       options.remoteIndexState.entries[localEntry.id] ?? null;
//     if (remoteEntry === null) {
//       continue;
//     }
//
//     const localHash = await createSyncContentHash(options.session, options.collection, localEntry.value);
//     const lastSyncedHash = await options.session.localState.getLastSyncedHash(
//       createSyncAssetKey(options.collection, localEntry.id),
//     );
//     if (remoteEntry.deletedAt !== null) {
//       if (
//         localEntry.deletedAt !== null
//         || lastSyncedHash === localHash
//         || localHash === remoteEntry.contentHash
//       ) {
//         continue;
//       }
//
//       conflicts.push({
//         adapterId: options.adapterId,
//         assetId: localEntry.id,
//         localValue: localEntry.value,
//         remoteValue: null,
//         localHash,
//         remoteHash: remoteEntry.contentHash,
//         remoteDeletedAt: remoteEntry.deletedAt,
//         remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
//       });
//       continue;
//     }
//
//     const remoteValue = options.readRemoteValue(localEntry.id);
//     if (localEntry.deletedAt !== null) {
//       if (remoteValue === null) {
//         continue;
//       }
//       const remoteHash = await createSyncContentHash(options.session, options.collection, remoteValue);
//       if (
//         localHash === remoteHash
//         || lastSyncedHash === remoteHash
//       ) {
//         continue;
//       }
//
//       conflicts.push({
//         adapterId: options.adapterId,
//         assetId: localEntry.id,
//         localValue: localEntry.value,
//         remoteValue,
//         localHash,
//         remoteHash,
//         remoteDeletedAt: null,
//         remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
//       });
//       continue;
//     }
//
//     const conflict = await createValueConflict({
//       session: options.session,
//       collection: options.collection,
//       adapterId: options.adapterId,
//       assetId: localEntry.id,
//       localValue: localEntry.value,
//       remoteValue,
//       lastSyncedHash,
//       remoteDeletedAt: null,
//       remoteUpdatedAt: options.readRemoteUpdatedAt(localEntry.id),
//     });
//
//     if (conflict !== null) {
//       conflicts.push(conflict);
//     }
//   }
//
//   return conflicts;
// }
//
// async function createValueConflict<TValue>(options: {
//   readonly session: SyncRemoteSession;
//   readonly collection: SyncRemoteCollection;
//   readonly adapterId: string;
//   readonly assetId: string;
//   readonly localValue: TValue | null;
//   readonly remoteValue: TValue | null;
//   readonly lastSyncedHash: string | null;
//   readonly remoteDeletedAt: string | null;
//   readonly remoteUpdatedAt: string | null;
// }): Promise<SyncAdapterConflict<TValue> | null> {
//   if (options.localValue === null || options.remoteValue === null) {
//     return null;
//   }
//
//   const localHash = await createSyncContentHash(options.session, options.collection, options.localValue);
//   const remoteHash = await createSyncContentHash(options.session, options.collection, options.remoteValue);
//   if (
//     localHash === remoteHash
//     || options.lastSyncedHash === localHash
//     || options.lastSyncedHash === remoteHash
//   ) {
//     return null;
//   }
//
//   return {
//     adapterId: options.adapterId,
//     assetId: options.assetId,
//     localValue: options.localValue,
//     remoteValue: options.remoteValue,
//     localHash,
//     remoteHash,
//     remoteDeletedAt: options.remoteDeletedAt,
//     remoteUpdatedAt: options.remoteUpdatedAt,
//   };
// }
//
// function createScopedConflictResolver<TValue>(
//   scope: SyncAdapterScope | undefined,
//   fallback:
//     | ((
//       conflict: SyncAdapterConflict<TValue>,
//     ) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution)
//     | undefined,
// ): (
//   conflict: SyncAdapterConflict<TValue>,
// ) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution {
//   return (conflict) => {
//     if (scope?.conflictDecisions !== undefined) {
//       const decision = scope.conflictDecisions.find((candidate) =>
//         candidate.adapterId === conflict.adapterId
//         && candidate.assetId === conflict.assetId
//         && candidate.localHash === conflict.localHash
//         && candidate.remoteHash === conflict.remoteHash
//         && candidate.remoteDeletedAt === conflict.remoteDeletedAt,
//       );
//
//       return decision?.resolution ?? "pause";
//     }
//
//     return fallback?.(conflict) ?? "pause";
//   };
// }

async function syncFullNoRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullNoRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
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
  const lastSyncedHash = await session.localState.getLastSyncedHash(assetKey);
  const localHash = localValue === null
    ? null
    : await createSyncContentHash(session, collection, localValue);
  const remoteHash = remoteValue === null
    ? null
    : await createSyncContentHash(session, collection, remoteValue);
  const classification = classifySingleValue({
    localValue,
    remoteValue,
    localHash,
    remoteHash,
    lastSyncedHash,
    // full-no-revision 没有墓碑存储，远端消失一律解释为本地新增上传。
    supportsRemoteTombstone: false,
    debugLabel: `${options.id}/${assetId}`,
  });

  let status: SyncAdapterStatus = "idle";
  if (classification.kind === "idle") {
    if (localHash !== null && localHash === remoteHash) {
      transaction.stageTouch(assetKey, localHash);
    }
  } else if (classification.kind === "download") {
    const item = createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind: "download",
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        // AI-CORRECTION 2026-08-08: 乐观并发必须回传服务端权威 SHA，不能使用本地 FNV 归一化 hash。
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    });
    transaction.recordItem(item);
    await item.applyDownload();
    status = "downloaded";
  } else if (classification.kind === "upload") {
    transaction.recordItem(createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind: "upload",
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        // AI-CORRECTION 2026-08-08: 乐观并发必须回传服务端权威 SHA，不能使用本地 FNV 归一化 hash。
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    }));
    status = "uploaded";
  } else {
    transaction.recordItem(createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind: "conflict",
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        // AI-CORRECTION 2026-08-08: 乐观并发必须回传服务端权威 SHA，不能使用本地 FNV 归一化 hash。
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    }));
    status = "conflict";
  }

  return {
    adapterId: options.id,
    mode: "full-no-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["single"],
    collectionRevision: remoteAsset?.revision ?? null,
    collectionEtag: status === "uploaded" ? null : remoteAsset?.etag ?? null,
  };
}

async function syncFullWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: FullWithRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const scope = syncOptions.scope;
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  // AI-REMOVED 2026-08-25:
  // Reason: adapter 在已拉取全量 plan 后再次用 collection check 提前返回，会绕开 plan 的全资产分类，
  //   且每个 adapter 重复请求相同的全局 CF revision。
  // Trigger: 本地 A 上传与远端 B 变化并存时，原设计要求当前 plan 内完成全部资源三值判断。
  // Evidence: session.prefetchIndexes 已在 adapter 执行前完成；CF readIndex 直接消费该 plan。
  // Replacement: 下方读取 plan index 并分类；clean 本地资产通过 persisted touch hash 免重算。
  // Risk: Medium；WebDAV 不再享受 collection ETag 的 adapter 内短路，本轮明确不要求兼容。
  // Human Review: Required
  //
  // Original code:
  // if (await isRemoteIndexUnchangedForCleanLocalEntries({
  //   session,
  //   collection,
  //   localEntries,
  // })) {
  //   return {
  //     adapterId: options.id,
  //     mode: "full-with-revision",
  //     status: "idle",
  //     changedAssetIds: [],
  //   };
  // }
  const remoteIndexState = await session.readIndex(collection);
  const changedAssetIds: string[] = [];
  let status: SyncAdapterStatus = "idle";
  const localHashStatesById = await resolveLocalHashStates({
    session,
    collection,
    transaction,
    adapterId: options.id,
    localEntries,
  });
  const localContentHashesById = new Map(Array.from(
    localHashStatesById,
    ([assetId, state]) => [assetId, state.contentHash] as const,
  ));
  const remoteValuesByLocalId = new Map(await Promise.all(localEntries.flatMap((entry) => {
    const remoteEntry = remoteIndexState.entries[entry.id];
    if (
      remoteEntry !== undefined
      && (
        remoteEntry.deletedAt !== null
        || (
          entry.deletedAt === null
          && isIndexHashComparable(remoteEntry)
          && localContentHashesById.get(entry.id) === remoteEntry.contentHash
        )
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

  const createEntryItem = (
    localEntry: FullWithRevisionEntry<TValue>,
    kind: SyncPlanItemKind,
    itemRemote: {
      readonly remoteValue: TValue | null;
      readonly remoteHash: string | null;
      readonly remoteDeletedAt: string | null;
      readonly remoteUpdatedAt: string | null;
    },
  ): SyncPlanItem => {
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    return createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: localEntry.id,
      kind,
      localValue: localEntry.value,
      localDeletedAt: localEntry.deletedAt,
      localHash: localContentHashesById.get(localEntry.id) ?? null,
      remoteValue: itemRemote.remoteValue,
      remoteHash: itemRemote.remoteHash,
      remoteDeletedAt: itemRemote.remoteDeletedAt,
      remoteUpdatedAt: itemRemote.remoteUpdatedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: localEntry.id, value, deletedAt });
      },
      applyRemoteTombstone: async (remoteDeletedAt) => {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteDeletedAt,
        });
      },
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, localEntry.id, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: localEntry.id,
        value,
        contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
      createTombstoneParams: async (_value, deletedAt, contentHash) => ({
        collection,
        assetId: localEntry.id,
        deletedAt,
        targetContentHash: contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
    });
  };

  for (const localEntry of localEntries) {
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    const assetKey = createSyncAssetKey(collection, localEntry.id);
    const localContentHash = localContentHashesById.get(localEntry.id)
      ?? await createSyncContentHash(session, collection, localEntry.value);
    const localHashState = localHashStatesById.get(localEntry.id);
    const lastSyncedHash = localHashState === undefined
      ? await session.localState.getLastSyncedHash(assetKey)
      : localHashState.lastSyncedHash;
    const remoteValue = remoteValuesByLocalId.get(localEntry.id) ?? null;

    // 远端墓碑（WebDAV 索引携带 deletedAt）。
    if (remoteEntry !== null && remoteEntry.deletedAt !== null) {
      if (localEntry.deletedAt !== null) {
        if (localEntry.deletedAt !== remoteEntry.deletedAt) {
          const item = createEntryItem(localEntry, "download", {
            remoteValue: null,
            remoteHash: remoteEntry.contentHash,
            remoteDeletedAt: remoteEntry.deletedAt,
            remoteUpdatedAt:
              remoteEntry.committedAt ?? remoteIndexState.committedAt,
          });
          transaction.recordItem(item);
          await item.applyDownload();
          status = mergeStatus(status, "downloaded");
          changedAssetIds.push(localEntry.id);
        } else {
          transaction.stageTouch(assetKey, remoteEntry.contentHash);
        }
        continue;
      }

      if (
        lastSyncedHash === localContentHash
        || (
          isIndexHashComparable(remoteEntry)
          && localContentHash === remoteEntry.contentHash
        )
      ) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: remoteEntry.contentHash,
          remoteDeletedAt: remoteEntry.deletedAt,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地墓碑、远端活或远端无。
    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null) {
        // 远端从未有过该资产（例如从 WebDAV 迁移到 Cloudflare），
        // 墓碑无意义，直接标记为已同步。
        logger.debug(`${options.id}/${localEntry.id}: local tombstone has no remote entry → skip`);
        transaction.stageTouch(assetKey, localContentHash);
        continue;
      }
      if (remoteValue === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = remoteValue.contentHash;
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: remoteValue.value,
          remoteHash: remoteContentHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: remoteValue.value,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端索引无条目：
    // 从未同步过 → 上传新增；曾同步过 → 远端墓碑（CF plan 不含已删除资产）→ 下载或冲突。
    if (remoteEntry === null) {
      if (lastSyncedHash === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt: null,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      if (localContentHash === lastSyncedHash) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt:
            remoteIndexState.committedAt ?? new Date().toISOString(),
          remoteUpdatedAt: remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: null,
        remoteDeletedAt:
          remoteIndexState.committedAt ?? new Date().toISOString(),
        remoteUpdatedAt: remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端活。
    if (
      isIndexHashComparable(remoteEntry)
      && localContentHash === remoteEntry.contentHash
    ) {
      logger.debug(`${options.id}/${localEntry.id}: collection index hash matches → idle`);
      transaction.stageTouch(assetKey, remoteEntry.contentHash);
      continue;
    }

    if (remoteValue === null) {
      // 索引有条目但正文读取为空：罕见异常，跳过本资产避免误判。
      logger.warn(`${options.id}/${localEntry.id}: remote entry exists but asset unreadable → skipping`);
      continue;
    }

    const classification = classifySingleValue({
      localValue: localEntry.value,
      remoteValue: remoteValue.value,
      localHash: localContentHash,
      remoteHash: remoteValue.contentHash,
      lastSyncedHash,
      supportsRemoteTombstone: false,
      debugLabel: `${options.id}/${localEntry.id}`,
    });

    if (classification.kind === "idle") {
      transaction.stageTouch(assetKey, localContentHash);
      continue;
    }
    if (classification.kind === "upload") {
      transaction.recordItem(createEntryItem(localEntry, "upload", {
        remoteValue: remoteValue.value,
        remoteHash: remoteValue.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      }));
      status = mergeStatus(status, "uploaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    if (classification.kind === "download") {
      const item = createEntryItem(localEntry, "download", {
        remoteValue: remoteValue.value,
        remoteHash: remoteValue.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      await item.applyDownload();
      status = mergeStatus(status, "downloaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    transaction.recordItem(createEntryItem(localEntry, "conflict", {
      remoteValue: remoteValue.value,
      remoteHash: remoteValue.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteEntry.committedAt ?? remoteIndexState.committedAt,
    }));
    status = mergeStatus(status, "conflict");
    changedAssetIds.push(localEntry.id);
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
    Object.entries(remoteIndexState.entries).flatMap(([entryId, remoteEntry]) =>
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

    const item = createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: entryId,
      kind: "download",
      localValue: null,
      localDeletedAt: null,
      localHash: null,
      remoteValue: remoteAsset.value,
      remoteHash: remoteAsset.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteAsset.committedAt ?? remoteIndexState.committedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: entryId, value, deletedAt });
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, entryId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: entryId,
        value,
        contentHash,
        baseRevision: null,
        baseContentHash: null,
      }),
      createTombstoneParams: null,
    });
    transaction.recordItem(item);
    await item.applyDownload();
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }

  return {
    adapterId: options.id,
    mode: "full-with-revision",
    status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
    collectionRevision: remoteIndexState.revision,
    collectionEtag: remoteIndexState.etag ?? null,
  };
}

async function syncPatchWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchWithRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const assetId = "snapshot";
  const assetKey = createSyncAssetKey(collection, assetId);
  const localValue = await options.readLocal();
  const remoteAsset = await readRemoteAssetValue(
    session,
    collection,
    assetId,
    options.normalizeRemote,
  );
  const remoteValue = remoteAsset?.value ?? null;
  const lastSyncedHash = await session.localState.getLastSyncedHash(assetKey);
  const localHash = localValue === null
    ? null
    : await createSyncContentHash(session, collection, localValue);
  const remoteHash = remoteValue === null
    ? null
    : await createSyncContentHash(session, collection, remoteValue);
  const classification = classifySingleValue({
    localValue,
    remoteValue,
    localHash,
    remoteHash,
    lastSyncedHash,
    // patch-with-revision 单值资产没有墓碑存储，远端消失一律解释为本地新增上传。
    supportsRemoteTombstone: false,
    debugLabel: `${options.id}/${assetId}`,
  });

  let status: SyncAdapterStatus = "idle";
  const createItem = (kind: SyncPlanItemKind): SyncPlanItem =>
    createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId,
      kind,
      localValue,
      localDeletedAt: null,
      localHash,
      remoteValue,
      remoteHash,
      remoteDeletedAt: null,
      remoteUpdatedAt: remoteAsset?.committedAt ?? null,
      writeLocal: async (value) => {
        await options.writeLocal(value);
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, assetId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId,
        value,
        contentHash,
        baseRevision: remoteAsset?.revision ?? null,
        // AI-CORRECTION 2026-08-08: 乐观并发必须回传服务端权威 SHA，不能使用本地 FNV 归一化 hash。
        baseContentHash: remoteAsset?.remoteContentHash ?? null,
      }),
      createTombstoneParams: null,
    });

  if (classification.kind === "idle") {
    if (localHash !== null && localHash === remoteHash) {
      transaction.stageTouch(assetKey, localHash);
    }
  } else if (classification.kind === "download") {
    const item = createItem("download");
    transaction.recordItem(item);
    await item.applyDownload();
    status = "downloaded";
  } else if (classification.kind === "upload") {
    transaction.recordItem(createItem("upload"));
    status = "uploaded";
  } else {
    transaction.recordItem(createItem("conflict"));
    status = "conflict";
  }

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: status === "idle" ? [] : ["snapshot"],
    collectionRevision: remoteAsset?.revision ?? null,
    collectionEtag: status === "uploaded" ? null : remoteAsset?.etag ?? null,
  };
}

async function syncPatchCollectionWithRevision<TValue>(
  session: SyncRemoteSession,
  collection: SyncRemoteCollection,
  options: PatchCollectionWithRevisionAdapterOptions<TValue>,
  syncOptions: SyncAdapterSyncOptions,
): Promise<SyncAdapterResult> {
  const { transaction } = syncOptions;
  const scope = syncOptions.scope;
  reportSyncProgress(scope, 0);
  const localEntries = (await options.listLocal(scope)).filter((entry) =>
    isAssetIncludedInScope(entry.id, scope),
  );
  reportSyncProgress(scope, 10);
  const localEntryById = new Map(localEntries.map((entry) => [entry.id, entry]));
  // AI-REMOVED 2026-08-25:
  // Reason: adapter 在已拉取全量 plan 后再次做 collection check 并提前返回，会跳过 plan 分类，
  //   也会让 CF 为每个 adapter 重复检查同一个全局 revision。
  // Trigger: 本地上传与其他资产远端变化并存时，必须在同一 plan 内完成全部资源判断。
  // Evidence: runAdapterRequests 已统一 prefetchIndexes；CF readIndex 不产生额外 plan 请求。
  // Replacement: 下方完整 index 分类；clean 资产复用 touch hash，只有 dirty/unknown 重算。
  // Risk: Medium；WebDAV 的 adapter 内 ETag 短路不再保留，本轮明确不要求兼容。
  // Human Review: Required
  //
  // Original code:
  // if (await isRemoteIndexUnchangedForCleanLocalEntries({
  //   session,
  //   collection,
  //   localEntries,
  // })) {
  //   reportSyncProgress(scope, 100);
  //   return {
  //     adapterId: options.id,
  //     mode: "patch-with-revision",
  //     status: "idle",
  //     changedAssetIds: [],
  //   };
  // }
  const remoteIndexState = await session.readIndex(collection);
  reportSyncProgress(scope, 35);
  const changedAssetIds: string[] = [];
  let status: SyncAdapterStatus = "idle";
  const localHashStatesById = await resolveLocalHashStates({
    session,
    collection,
    transaction,
    adapterId: options.id,
    localEntries,
  });
  const localContentHashesById = new Map(Array.from(
    localHashStatesById,
    ([assetId, state]) => [assetId, state.contentHash] as const,
  ));
  const remoteStatesByLocalId = new Map(await Promise.all(localEntries.flatMap((entry) => {
    const remoteEntry = remoteIndexState.entries[entry.id];
    if (
      remoteEntry !== undefined
      && (
        remoteEntry.deletedAt !== null
        || (
          entry.deletedAt === null
          && isIndexHashComparable(remoteEntry)
          && localContentHashesById.get(entry.id) === remoteEntry.contentHash
        )
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

  const createEntryItem = (
    localEntry: PatchWithRevisionEntry<TValue>,
    kind: SyncPlanItemKind,
    itemRemote: {
      readonly remoteValue: TValue | null;
      readonly remoteHash: string | null;
      readonly remoteDeletedAt: string | null;
      readonly remoteUpdatedAt: string | null;
    },
  ): SyncPlanItem => {
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    return createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: localEntry.id,
      kind,
      localValue: localEntry.value,
      localDeletedAt: localEntry.deletedAt,
      localHash: localContentHashesById.get(localEntry.id) ?? null,
      remoteValue: itemRemote.remoteValue,
      remoteHash: itemRemote.remoteHash,
      remoteDeletedAt: itemRemote.remoteDeletedAt,
      remoteUpdatedAt: itemRemote.remoteUpdatedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: localEntry.id, value, deletedAt });
      },
      applyRemoteTombstone: async (remoteDeletedAt) => {
        await options.writeLocal({
          id: localEntry.id,
          value: localEntry.value,
          deletedAt: remoteDeletedAt,
        });
      },
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, localEntry.id, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: localEntry.id,
        value,
        contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
      createTombstoneParams: async (_value, deletedAt, contentHash) => ({
        collection,
        assetId: localEntry.id,
        deletedAt,
        targetContentHash: contentHash,
        baseRevision: remoteEntry?.revision ?? null,
        baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
      }),
    });
  };

  for (const [localEntryIndex, localEntry] of localEntries.entries()) {
    reportSyncProgress(
      scope,
      interpolateProgress(55, 75, localEntryIndex, localEntries.length),
    );
    const remoteEntry = remoteIndexState.entries[localEntry.id] ?? null;
    const assetKey = createSyncAssetKey(collection, localEntry.id);
    const localContentHash = localContentHashesById.get(localEntry.id)
      ?? await createSyncContentHash(session, collection, localEntry.value);
    const localHashState = localHashStatesById.get(localEntry.id);
    const lastSyncedHash = localHashState === undefined
      ? await session.localState.getLastSyncedHash(assetKey)
      : localHashState.lastSyncedHash;
    const remoteState = remoteStatesByLocalId.get(localEntry.id) ?? null;

    // 远端墓碑（WebDAV 索引携带 deletedAt）。
    if (remoteEntry !== null && remoteEntry.deletedAt !== null) {
      if (localEntry.deletedAt !== null) {
        if (localEntry.deletedAt !== remoteEntry.deletedAt) {
          const item = createEntryItem(localEntry, "download", {
            remoteValue: null,
            remoteHash: remoteEntry.contentHash,
            remoteDeletedAt: remoteEntry.deletedAt,
            remoteUpdatedAt:
              remoteEntry.committedAt ?? remoteIndexState.committedAt,
          });
          transaction.recordItem(item);
          await item.applyDownload();
          status = mergeStatus(status, "downloaded");
          changedAssetIds.push(localEntry.id);
        } else {
          transaction.stageTouch(assetKey, remoteEntry.contentHash);
        }
        continue;
      }

      if (
        lastSyncedHash === localContentHash
        || (
          isIndexHashComparable(remoteEntry)
          && localContentHash === remoteEntry.contentHash
        )
      ) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: remoteEntry.contentHash,
          remoteDeletedAt: remoteEntry.deletedAt,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: remoteEntry.contentHash,
        remoteDeletedAt: remoteEntry.deletedAt,
        remoteUpdatedAt:
          remoteEntry.committedAt ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地墓碑、远端活或远端无。
    if (localEntry.deletedAt !== null) {
      if (remoteEntry === null) {
        // 远端从未有过该资产，墓碑无意义，直接标记为已同步。
        logger.debug(`${options.id}/${localEntry.id}: local tombstone has no remote entry → skip`);
        transaction.stageTouch(assetKey, localContentHash);
        continue;
      }
      if (remoteState === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteEntry.committedAt ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const remoteContentHash = remoteState.contentHash;
      if (
        localContentHash === remoteContentHash
        || lastSyncedHash === remoteContentHash
      ) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: remoteState.value,
          remoteHash: remoteContentHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteState.committedAt
            ?? remoteEntry.committedAt
            ?? remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }

      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: remoteState.value,
        remoteHash: remoteContentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端索引无条目：
    // 从未同步过 → 上传新增；曾同步过 → 远端墓碑（CF plan 不含已删除资产）→ 下载或冲突。
    if (remoteEntry === null) {
      if (lastSyncedHash === null) {
        const item = createEntryItem(localEntry, "upload", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt: null,
          remoteUpdatedAt: null,
        });
        transaction.recordItem(item);
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      if (localContentHash === lastSyncedHash) {
        const item = createEntryItem(localEntry, "download", {
          remoteValue: null,
          remoteHash: null,
          remoteDeletedAt:
            remoteIndexState.committedAt ?? new Date().toISOString(),
          remoteUpdatedAt: remoteIndexState.committedAt,
        });
        transaction.recordItem(item);
        await item.applyDownload();
        status = mergeStatus(status, "downloaded");
        changedAssetIds.push(localEntry.id);
        continue;
      }
      const item = createEntryItem(localEntry, "conflict", {
        remoteValue: null,
        remoteHash: null,
        remoteDeletedAt:
          remoteIndexState.committedAt ?? new Date().toISOString(),
        remoteUpdatedAt: remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      status = mergeStatus(status, "conflict");
      changedAssetIds.push(localEntry.id);
      continue;
    }

    // 本地活、远端活。
    if (
      isIndexHashComparable(remoteEntry)
      && localContentHash === remoteEntry.contentHash
    ) {
      logger.debug(`${options.id}/${localEntry.id}: patch index hash matches → idle`);
      transaction.stageTouch(assetKey, remoteEntry.contentHash);
      continue;
    }

    if (remoteState === null) {
      // 索引有条目但正文读取为空：罕见异常，跳过本资产避免误判。
      logger.warn(`${options.id}/${localEntry.id}: remote entry exists but asset unreadable → skipping`);
      continue;
    }

    const classification = classifySingleValue({
      localValue: localEntry.value,
      remoteValue: remoteState.value,
      localHash: localContentHash,
      remoteHash: remoteState.contentHash,
      lastSyncedHash,
      supportsRemoteTombstone: false,
    });

    if (classification.kind === "idle") {
      transaction.stageTouch(assetKey, localContentHash);
      // AI-CORRECTION 2026-08-13: 索引 hash 为 fallback 口径（未映射/未知）时，
      // 与本地口径归一化 hash 比较不得得出“不等”结论，回传分支必须跳过（消除 echo upload）。
      // AI-CORRECTION 2026-08-19: 若正文归一化确实改变了结构，则变化证据来自原值与归一化值，
      // 不依赖 fallback 索引 hash 的跨口径比较；此时必须回传以持久化 schema 迁移结果。
      if (
        remoteEntry.deletedAt === null
        && (
          remoteState.normalizationChanged
          || (
            isIndexHashComparable(remoteEntry)
            && remoteEntry.contentHash !== remoteState.contentHash
          )
        )
      ) {
        const normalizedRemoteHash = remoteState.contentHash;
        transaction.recordItem(createPlanItem<TValue>({
          session,
          collection,
          transaction,
          adapterId: options.id,
          assetId: localEntry.id,
          kind: "upload",
          localValue: localEntry.value,
          localDeletedAt: null,
          localHash: localContentHash,
          remoteValue: remoteState.value,
          remoteHash: normalizedRemoteHash,
          remoteDeletedAt: null,
          remoteUpdatedAt:
            remoteState.committedAt
            ?? remoteEntry.committedAt
            ?? remoteIndexState.committedAt,
          writeLocal: async (value, deletedAt) => {
            await options.writeLocal({ id: localEntry.id, value, deletedAt });
          },
          applyRemoteTombstone: null,
          readRemoteValue: async () =>
            await readRemoteAssetValue(session, collection, localEntry.id, options.normalizeRemote),
          createPutParams: async (_value, contentHash) => ({
            collection,
            assetId: localEntry.id,
            value: remoteState.value,
            contentHash,
            baseRevision: remoteEntry.revision ?? remoteIndexState.revision,
            baseContentHash: resolveRemoteBaseContentHash(remoteEntry),
          }),
          createTombstoneParams: null,
        }));
        status = mergeStatus(status, "uploaded");
        changedAssetIds.push(localEntry.id);
      }
      continue;
    }
    if (classification.kind === "upload") {
      transaction.recordItem(createEntryItem(localEntry, "upload", {
        remoteValue: remoteState.value,
        remoteHash: remoteState.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
      }));
      status = mergeStatus(status, "uploaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    if (classification.kind === "download") {
      const item = createEntryItem(localEntry, "download", {
        remoteValue: remoteState.value,
        remoteHash: remoteState.contentHash,
        remoteDeletedAt: null,
        remoteUpdatedAt:
          remoteState.committedAt
          ?? remoteEntry.committedAt
          ?? remoteIndexState.committedAt,
      });
      transaction.recordItem(item);
      await item.applyDownload();
      status = mergeStatus(status, "downloaded");
      changedAssetIds.push(localEntry.id);
      continue;
    }
    transaction.recordItem(createEntryItem(localEntry, "conflict", {
      remoteValue: remoteState.value,
      remoteHash: remoteState.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteState.committedAt
        ?? remoteEntry.committedAt
        ?? remoteIndexState.committedAt,
    }));
    status = mergeStatus(status, "conflict");
    changedAssetIds.push(localEntry.id);

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
    Object.entries(remoteIndexState.entries).flatMap(([entryId, remoteEntry]) =>
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

    const item = createPlanItem<TValue>({
      session,
      collection,
      transaction,
      adapterId: options.id,
      assetId: entryId,
      kind: "download",
      localValue: null,
      localDeletedAt: null,
      localHash: null,
      remoteValue: remoteState.value,
      remoteHash: remoteState.contentHash,
      remoteDeletedAt: null,
      remoteUpdatedAt:
        remoteState.committedAt ?? remoteIndexState.committedAt,
      writeLocal: async (value, deletedAt) => {
        await options.writeLocal({ id: entryId, value, deletedAt });
      },
      applyRemoteTombstone: null,
      readRemoteValue: async () =>
        await readRemoteAssetValue(session, collection, entryId, options.normalizeRemote),
      createPutParams: async (value, contentHash) => ({
        collection,
        assetId: entryId,
        value,
        contentHash,
        baseRevision: null,
        baseContentHash: null,
      }),
      createTombstoneParams: null,
    });
    transaction.recordItem(item);
    await item.applyDownload();
    status = mergeStatus(status, "downloaded");
    changedAssetIds.push(entryId);
  }
  reportSyncProgress(scope, 94);
  reportSyncProgress(scope, 100);

  return {
    adapterId: options.id,
    mode: "patch-with-revision",
    status,
    changedAssetIds: Array.from(new Set(changedAssetIds)),
    collectionRevision: remoteIndexState.revision,
    collectionEtag: remoteIndexState.etag ?? null,
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

// AI-REMOVED 2026-08-13:
// Reason: scopeComplete 由引擎基于请求 scope 计算（resolveRequestScopeComplete）。
// Trigger: adapter 不再自行调用 markApplied。
// Replacement: sync-service.ts 的 finalizeTransaction。
// Risk: Low。
// Human Review: Required
//
// Original code:
// function isScopeComplete(scope: SyncAdapterScope | undefined): boolean {
//   return scope?.includeAssetIds === undefined && scope?.excludeAssetIds === undefined;
// }

// AI-REMOVED 2026-08-25:
// Reason: adapter 级 ETag 短路与“已取得 plan 后对全部资源分类”的流程冲突，并为 CF 制造
//   每个 adapter 一次的重复全局 check；它还必须先重算全部本地 hash 才能判断 clean。
// Trigger: 本地 A 上传、远端 B 变化并存时需要一次 plan 内闭合下载、上传与 revision 前推。
// Evidence: 两个 collection adapter 入口均已改为直接消费 prefetched plan index。
// Replacement: resolveLocalHashStates；远端是否有变化由 plan index 直接参与三值分类。
// Risk: Medium；WebDAV ETag 快路径移除，用户已明确可不兼容 WebDAV。
// Human Review: Required
//
// Original code:
// async function isRemoteIndexUnchangedForCleanLocalEntries<TValue>(options: {
//   readonly session: SyncRemoteSession;
//   readonly collection: SyncRemoteCollection;
//   readonly localEntries: readonly {
//     readonly id: string;
//     readonly value: TValue;
//     readonly deletedAt: string | null;
//   }[];
// }): Promise<boolean> {
//   const lastSeenEtag = await options.session.localState.getRemoteEtag(
//     options.collection.stateKey,
//   );
//   if (
//     lastSeenEtag === null
//     || options.localEntries.length === 0
//     || options.localEntries.some((entry) =>
//       entry.deletedAt !== null
//     )
//   ) {
//     return false;
//   }
//
//   for (const entry of options.localEntries) {
//     const lastSyncedHash = await options.session.localState.getLastSyncedHash(
//       createSyncAssetKey(options.collection, entry.id),
//     );
//     if (lastSyncedHash !== await createSyncContentHash(options.session, options.collection, entry.value)) {
//       return false;
//     }
//   }
//
//   const result = await options.session.checkCollections([options.collection]);
//   const unchanged = !result.changedCollections.includes(options.collection.adapterId);
//   if (unchanged) {
//     logger.debug(
//       `${options.collection.adapterId}: canonical index ETag unchanged and local hashes clean → idle`,
//     );
//   }
//
//   return unchanged;
// }

interface LocalHashState {
  readonly contentHash: string;
  readonly lastSyncedHash: string | null;
}

async function resolveLocalHashStates<TValue>(options: {
  readonly session: SyncRemoteSession;
  readonly collection: SyncRemoteCollection;
  readonly transaction: SyncEngineTransaction;
  readonly adapterId: string;
  readonly localEntries: readonly {
    readonly id: string;
    readonly value: TValue;
    readonly deletedAt: string | null;
  }[];
}): Promise<ReadonlyMap<string, LocalHashState>> {
  const states = await Promise.all(options.localEntries.map(async (entry) => {
    const lastSyncedHash = await options.session.localState.getLastSyncedHash(
      createSyncAssetKey(options.collection, entry.id),
    );
    const localChangeState = options.transaction.getLocalChangeState?.(
      options.adapterId,
      entry.id,
    ) ?? "unknown";
    const canReuseTouchHash = localChangeState === "clean"
      && entry.deletedAt === null
      && lastSyncedHash !== null;
    const contentHash = canReuseTouchHash
      ? lastSyncedHash
      : await createSyncContentHash(
        options.session,
        options.collection,
        entry.value,
      );

    return [entry.id, { contentHash, lastSyncedHash }] as const;
  }));

  return new Map(states);
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

// AI-REMOVED 2026-08-13:
// Reason: 冲突不再由 adapter 内联询问 resolver，而是登记 SyncPlanItem 由引擎统一弹框决议。
// Trigger: sync-model.md“上传/下载/冲突资产全部进入对话框逐项选择”。
// Replacement: classifySingleValue + createPlanItem + transaction.recordItem。
// Risk: Low。
// Human Review: Required
//
// Original code:
//
// async function resolveCollectionConflict<TValue>(options: {
//   readonly adapterId: string;
//   readonly assetId: string;
//   readonly localValue: TValue;
//   readonly remoteValue: TValue | null;
//   readonly localHash: string;
//   readonly remoteHash: string | null;
//   readonly remoteDeletedAt: string | null;
//   readonly remoteUpdatedAt: string | null;
//   readonly resolveConflict?: (
//     conflict: SyncAdapterConflict<TValue>,
//   ) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
// }): Promise<SyncAdapterConflictResolution> {
//   const resolution = await (options.resolveConflict?.({
//     adapterId: options.adapterId,
//     assetId: options.assetId,
//     localValue: options.localValue,
//     remoteValue: options.remoteValue,
//     localHash: options.localHash,
//     remoteHash: options.remoteHash,
//     remoteDeletedAt: options.remoteDeletedAt,
//     remoteUpdatedAt: options.remoteUpdatedAt,
//   }) ?? "pause");
//   logger.debug(
//     `${options.adapterId}/${options.assetId}: collection conflict detected, ` +
//     `resolved as "${resolution}"`,
//   );
//
//   return resolution;
// }
//
// async function syncSingleValue<TValue>(options: {
//   readonly session: SyncRemoteSession;
//   readonly collection: SyncRemoteCollection;
//   readonly adapterId: string;
//   readonly assetId: string;
//   readonly localValue: TValue | null;
//   readonly remoteValue: TValue | null;
//   readonly remoteUpdatedAt: string | null;
//   readonly readLastSyncedHash: () => Promise<string | null>;
//   readonly writeLastSyncedHash: (contentHash: string) => Promise<void>;
//   readonly writeLocal: (value: TValue) => Promise<void>;
//   readonly writeRemote: (value: TValue, contentHash: string) => Promise<void>;
//   readonly resolveConflict?: (conflict: SyncAdapterConflict<TValue>) => Promise<SyncAdapterConflictResolution> | SyncAdapterConflictResolution;
// }): Promise<SyncAdapterStatus> {
//   if (options.localValue === null && options.remoteValue === null) {
//     return "idle";
//   }
//
//   const lastSyncedHash = await options.readLastSyncedHash();
//   const localHash = options.localValue === null
//     ? null
//     : await createSyncContentHash(options.session, options.collection, options.localValue);
//   const remoteHash = options.remoteValue === null
//     ? null
//     : await createSyncContentHash(options.session, options.collection, options.remoteValue);
//
//   if (options.localValue !== null && options.remoteValue === null) {
//     logger.info(`${options.adapterId}/${options.assetId}: local exists, remote absent → uploading`);
//     await options.writeRemote(options.localValue, localHash!);
//     await options.writeLastSyncedHash(localHash!);
//     return "uploaded";
//   }
//
//   if (options.localValue === null && options.remoteValue !== null) {
//     logger.info(`${options.adapterId}/${options.assetId}: local absent, remote exists → downloading`);
//     await options.writeLocal(options.remoteValue);
//     await options.writeLastSyncedHash(remoteHash!);
//     return "downloaded";
//   }
//
//   if (options.localValue === null || options.remoteValue === null || localHash === null || remoteHash === null) {
//     return "skipped";
//   }
//
//   if (localHash === remoteHash) {
//     logger.debug(`${options.adapterId}/${options.assetId}: hashes match → idle`);
//     await options.writeLastSyncedHash(localHash);
//     return "idle";
//   }
//
//   if (lastSyncedHash === remoteHash) {
//     logger.info(`${options.adapterId}/${options.assetId}: local changed, remote unchanged → uploading`);
//     await options.writeRemote(options.localValue, localHash);
//     await options.writeLastSyncedHash(localHash);
//     return "uploaded";
//   }
//
//   if (lastSyncedHash === localHash) {
//     logger.info(`${options.adapterId}/${options.assetId}: remote changed, local unchanged → downloading`);
//     await options.writeLocal(options.remoteValue);
//     await options.writeLastSyncedHash(remoteHash);
//     return "downloaded";
//   }
//
//   const resolution = await (options.resolveConflict?.({
//     adapterId: options.adapterId,
//     assetId: options.assetId,
//     localValue: options.localValue,
//     remoteValue: options.remoteValue,
//     localHash,
//     remoteHash,
//     remoteDeletedAt: null,
//     remoteUpdatedAt: options.remoteUpdatedAt,
//   }) ?? "pause");
//
//   logger.debug(`${options.adapterId}/${options.assetId}: conflict detected, resolved as "${resolution}"`);
//
//   if (resolution === "use-local") {
//     await options.writeRemote(options.localValue, localHash);
//     await options.writeLastSyncedHash(localHash);
//     return "uploaded";
//   }
//
//   if (resolution === "use-remote") {
//     await options.writeLocal(options.remoteValue);
//     await options.writeLastSyncedHash(remoteHash);
//     return "downloaded";
//   }
//
//   return "conflict";
// }

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
  const lastSeenRevision = readLastSeenRemoteRevision(indexPath);
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
  writeLastSeenRemoteRevision(indexPath, result.index.revision);

  return result;
}

async function _writeRemoteIndex(
  client: SyncStorageClient,
  indexPath: string,
  index: RemoteIndexFile,
  expectedRevision: number,
  canonicalMissing: boolean,
): Promise<void> {
  clearLastSeenRemoteEtag(indexPath);
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
  writeLastSeenRemoteRevision(indexPath, committedIndex.revision);
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
  const lastSeenRevision = readLastSeenRemoteRevision(metaPath);
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
    writeLastSeenRemoteRevision(metaPath, result.meta.revision);

    return result;
  }

  if (canonicalState !== null) {
    writeLastSeenRemoteRevision(
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
  writeLastSeenRemoteRevision(metaPath, meta.revision);
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
