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
  prefetchIndexes(collections: readonly SyncRemoteCollection[]): Promise<void>;
  readIndex(collection: SyncRemoteCollection): Promise<RemoteCollectionIndex>;
  readAsset(params: RemoteAssetRef): Promise<RemoteAssetContent | null>;
  checkCollections(collections: readonly SyncRemoteCollection[]): Promise<RemoteCheckResult>;
  refreshIndexes?(collections: readonly SyncRemoteCollection[]): Promise<void>;
  beginWriteBatch(): SyncRemoteWriteBatch;
  markApplied(result: RemoteApplyResult): Promise<void>;
  prepareCollections?(collections: readonly SyncRemoteCollection[]): Promise<void>;
  complete?(): Promise<void>;
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
  readonly deletedAt: string | null;
  readonly committedAt: string | null;
}

export interface RemoteAssetRef {
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
}

export interface RemoteAssetContent {
  readonly revision: number;
  readonly content: string;
  readonly contentHash: string;
  readonly committedAt: string | null;
  readonly etag?: string | null;
}

export interface RemoteAssetPutParams {
  readonly collection: SyncRemoteCollection;
  readonly assetId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly baseRevision: number | null;
  readonly baseContentHash: string | null;
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

export interface SyncMaintenanceTaskRequest {
  readonly kind: SyncTaskKind;
  readonly collections: readonly SyncRemoteCollection[];
}
