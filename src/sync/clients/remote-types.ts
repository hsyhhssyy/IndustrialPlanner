import type {
  SyncRunReason,
  SyncTaskKind,
} from "@/domain/sync";

export type SyncRemoteAdapterMode = "patch-with-revision" | "full-with-revision" | "full-no-revision";

export type SyncHashAlgorithm = "fnv1a32" | "sha256-canonical-json-v1";

export type SyncAssetType =
  | "world-document"
  | "blueprint"
  | "blueprint-folder"
  | "custom-module"
  | "custom-module-folder"
  | "module-canvas-folder"
  | "module-canvas"
  | "planner-state";

export interface SyncRemoteAssetIdCodec {
  toRemoteAssetId(adapterAssetId: string): string;
  toAdapterAssetId(remoteAssetId: string): string;
  /** 同一 assetType 被多个 adapter 共享时，只枚举属于当前 adapter 的远端 ID。 */
  acceptsRemoteAssetId?(remoteAssetId: string): boolean;
}

export type SyncRemoteWebDavBinding =
  | {
      readonly kind: "full-no-revision";
      readonly remotePath: string;
    }
  | {
      readonly kind: "full-with-revision";
      readonly indexPath: string;
      readonly entryPath: (assetId: string) => string;
    }
  | {
      readonly kind: "patch-with-revision";
      readonly directoryPath: string;
      readonly deltaThreshold?: number;
    }
  | {
      readonly kind: "patch-collection-with-revision";
      readonly indexPath: string;
      readonly directoryPath: (assetId: string) => string;
      readonly deltaThreshold?: number;
    };

export interface SyncRemoteCollection {
  readonly adapterId: string;
  readonly name: string;
  readonly mode: SyncRemoteAdapterMode;
  readonly assetType: SyncAssetType;
  readonly assetIdCodec: SyncRemoteAssetIdCodec;
  readonly hashAlgorithm: SyncHashAlgorithm;
  readonly stateKey: string;
  readonly webDav?: SyncRemoteWebDavBinding;
}

export interface SyncRemoteSessionContext {
  readonly reason: SyncRunReason;
  readonly collections: readonly SyncRemoteCollection[];
  readonly focusedAssets?: readonly RemoteAssetRef[];
}

export interface SyncRemoteCompleteOptions {
  /** false 表示本轮未完整理解远端内容，不得推进 provider 的全局已应用游标。 */
  readonly advanceAppliedRevision: boolean;
}

export interface SyncLocalState {
  getLastSyncedHash(assetKey: string): Promise<string | null>;
  setLastSyncedHash(assetKey: string, hash: string | null): Promise<void>;
  getRemoteRevision(key: string): Promise<number | null>;
  setRemoteRevision(key: string, revision: number | null): Promise<void>;
  getRemoteEtag(key: string): Promise<string | null>;
  setRemoteEtag(key: string, etag: string | null): Promise<void>;
}

export interface SyncRemote {
  readonly localState: SyncLocalState;
  beginSession(context: SyncRemoteSessionContext): Promise<SyncRemoteSession>;
  resetRemote?(): Promise<void>;
  abortTransaction?(): Promise<void>;
  dispose?(): void;
}

export interface SyncRemoteSession {
  readonly localState: SyncLocalState;
  computeContentHashes(
    requests: readonly SyncContentHashRequest[],
  ): Promise<readonly string[]>;
  prefetchIndexes(collections: readonly SyncRemoteCollection[]): Promise<void>;
  readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex>;
  readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null>;
  checkCollections(collections: readonly SyncRemoteCollection[]): Promise<RemoteCheckResult>;
  refreshIndexes?(collections: readonly SyncRemoteCollection[]): Promise<void>;
  beginWriteBatch(): SyncRemoteWriteBatch;
  markApplied(result: RemoteApplyResult): Promise<void>;
  prepareCollections?(collections: readonly SyncRemoteCollection[]): Promise<void>;
  complete?(options?: SyncRemoteCompleteOptions): Promise<void>;
  dispose?(): void;
}

export interface SyncRemoteWriteBatch {
  putAsset(params: RemoteAssetPutParams): void;
  putTombstone(params: RemoteAssetTombstoneParams): void;
  commit(): Promise<RemoteWriteBatchResult>;
  discard(): Promise<void>;
}

export interface RemoteCollectionIndex {
  readonly revision: number;
  readonly entries: Record<string, RemoteAssetMeta>;
  readonly committedAt: string | null;
  readonly etag?: string | null;
}

export interface RemoteAssetMeta {
  readonly revision: number;
  readonly contentHash: string | null;
  /** 远端协议的权威 hash；与适配器本地比较算法不同时用于乐观并发基线。 */
  readonly protocolContentHash?: string | null;
  /**
   * contentHash 的可比口径。
   * - "adapter"：contentHash 使用 collection.hashAlgorithm 的本地口径，可直接与本地 hash 比较；
   * - "protocol-fallback"：provider 缺少可比 hash 映射，contentHash 为远端协议原始值（如 SHA-256），
   *   与本地口径 hash 比较不得得出“相等”或“不等”结论。
   * 未提供时视为 "adapter"（WebDAV 索引始终由本地口径写入）。
   */
  readonly contentHashCaliber?: "adapter" | "protocol-fallback";
  readonly deletedAt: string | null;
  readonly committedAt: string | null;
}

export interface RemoteAssetRef {
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
}

export interface RemoteAssetContent {
  readonly revision: number;
  readonly value: unknown;
  readonly contentHash: string;
  readonly committedAt: string | null;
  readonly etag?: string | null;
}

export interface RemoteAssetPutParams {
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
  readonly value: unknown;
  readonly contentHash: string;
  readonly baseRevision: number | null;
  readonly baseContentHash: string | null;
}

export interface SyncContentHashRequest {
  readonly algorithm: SyncHashAlgorithm;
  readonly value: unknown;
}

export interface RemoteAssetTombstoneParams {
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
  readonly deletedAt: string;
  readonly targetContentHash: string | null;
  readonly baseRevision: number | null;
  readonly baseContentHash: string | null;
}

export interface RemoteWriteResult {
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
  readonly revision: number;
  readonly contentHash: string | null;
  readonly deletedAt: string | null;
  readonly committedAt: string;
}

export interface RemoteWriteBatchResult {
  readonly writes: readonly RemoteWriteResult[];
  readonly globalCursor?: number;
}

export interface RemoteApplyResult {
  readonly collection: SyncRemoteCollection;
  readonly assetIds: readonly string[];
  readonly scopeComplete: boolean;
  readonly collectionRevision: number | null;
  readonly collectionEtag?: string | null;
  readonly globalCursor?: number;
}

export interface RemoteCheckResult {
  readonly changedCollections: readonly string[];
  readonly globalCursor?: number;
}

export interface RemoteWriteConflict {
  readonly assetType: string;
  readonly assetId: string;
  readonly reason: string;
  readonly expectedRevision: number | null;
  readonly actualRevision: number | null;
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
}

export class RemoteWriteConflictError extends Error {
  public constructor(public readonly conflicts: readonly RemoteWriteConflict[]) {
    super(conflicts.length === 0
      ? 'Remote write conflict.'
      : `Remote write conflict: ${conflicts.map((conflict) =>
        `${conflict.assetType}/${conflict.assetId} reason=${conflict.reason}`
      ).join(', ')}.`);
    this.name = 'RemoteWriteConflictError';
  }
}

/**
 * 下载内容时远端 revision 已推进（CF download_stale 等）。
 * 语义与写 409 相同：丢弃本次完整同步操作，回到流程起点重新拉 plan。
 */
export class RemoteDownloadStaleError extends Error {
  public constructor(
    public readonly collectionName: string,
    public readonly assetId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteDownloadStaleError';
  }
}

/** 判断一个错误是否要求整轮同步丢弃重来（下载票据过期或提交写冲突）。 */
export function isRemoteSyncStaleError(error: unknown): boolean {
  return error instanceof RemoteDownloadStaleError
    || error instanceof RemoteWriteConflictError;
}

export interface SyncMaintenanceTaskRequest {
  readonly kind: SyncTaskKind;
  readonly collections: readonly SyncRemoteCollection[];
}
