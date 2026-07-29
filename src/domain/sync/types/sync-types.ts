export type SyncPhase = "idle" | "uploading" | "downloading" | "error";

export type SyncSaveState = "idle" | "pending" | "saving" | "error";

export type SyncConflictResolution = "use-local" | "use-remote" | "pause";

export interface SyncSettings {
  readonly enabled: boolean;
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly saveState: SyncSaveState;
  readonly pendingLocalChangeCount: number;
  readonly saveError: string | null;
  readonly lastUploadAt: string | null;
  readonly lastDownloadAt: string | null;
  readonly lastError: string | null;
}

export interface SyncRemoteDeviceInfo {
  readonly deviceId: string;
  readonly label: string;
  readonly firstSeen: string;
  readonly lastActive: string;
}

export interface SyncPendingConflict {
  readonly adapterId: string;
  readonly assetId: string;
  readonly remoteDeviceLabel: string;
}

export interface SyncAssetEntry<TValue = unknown> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export type SyncAssetSourceMode =
  | "full-with-revision"
  | "patch-with-revision";

/**
 * 顶层业务模块向同步模块提供的资源端口。
 *
 * `remotePath` 在 full 模式下是单个资源文件路径，在 patch 模式下是资源目录路径。
 * 端口只描述业务资源，不暴露 WebDAV、队列或网络实现。
 */
export interface SyncAssetSource<TValue = unknown> {
  readonly id: string;
  readonly mode: SyncAssetSourceMode;
  readonly indexPath: string;
  readonly remotePath: (assetId: string) => string;
  readonly listLocal: () => Promise<readonly SyncAssetEntry<TValue>[]>;
  readonly writeLocal: (entry: SyncAssetEntry<TValue>) => Promise<void>;
  readonly normalizeRemote?: (value: unknown) => TValue | null;
  readonly subscribe: (listener: () => void) => () => void;
}
