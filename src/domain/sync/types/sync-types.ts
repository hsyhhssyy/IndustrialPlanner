export type SyncPhase = "idle" | "uploading" | "downloading" | "error";

export type SyncSaveState = "idle" | "pending" | "saving" | "error";

export type SyncInitialSyncStage =
  | "canvas"
  | "blueprints"
  | "modules"
  | "toolbox"
  | "ready";

export type SyncConflictResolution = "use-local" | "use-remote" | "pause";

export type SyncConflictPhase =
  | "discovering"
  | "awaiting-resolution"
  | "applying";

// AI-REMOVED 2026-08-10:
// Reason: 大检查与小检查功能重叠，小检查已通过 GET /check 实现远端变化探测并触发全量同步。
// Trigger: 用户确认不会存在假阴性情况，大检查没有额外价值。
// Evidence: 大检查 = 无条件全量 syncNow，与小检查检测到变化后的行为完全一致。
// Replacement: 仅保留小检查（interval）。
// Risk: Low。
// Human Review: Required
//
// Original code:
//   | "big-check"
//
// AI-CORRECTION 2026-08-24: 唯一保留的同步检查现统一称为“更新检查”，`interval` 仅表示定时触发原因。
export type SyncRunReason =
  | "startup"
  | "foreground"
  | "interval"
  | "local-change"
  | "settings-change"
  | "manual";

export type SyncTaskKind =
  | "canvas"
  | "blueprints"
  | "modules"
  | "toolbox"
  | "background-documents"
  | "directory-maintenance"
  | "update-check";
// AI-REMOVED 2026-08-10:
// Reason: 大检查任务类型已删除，与小检查功能重叠。
// Trigger: 用户确认大检查无额外价值。
// Evidence: 大检查任务与 interval-check 行为一致。
// Replacement: 仅保留 interval-check。
// Risk: Low。
// Human Review: Required
//
// Original code:
//   | "big-check";
// AI-CORRECTION 2026-08-24: 现行任务类型已由 `interval-check` 统一更名为 `update-check`。
// AI-REMOVED 2026-07-29:
// Reason: 设备枚举与设备心跳不再参与 WebDAV 同步协议。
// Trigger: 用户确认不需要列出设备，冲突只展示远端上传时间。
// Evidence: 真实服务器的 39 个设备文件需要约 17.9 秒读取，且无法证明具体资源由哪个设备提交。
// Replacement: revision/index 元数据中的 committedAt。
// Risk: Low；不再展示历史设备列表。
// Human Review: Required
//
// Original code:
//   | "device-registration"
//   | "remote-devices";

export type SyncTaskPhase =
  | "idle"
  | "queued"
  | "running"
  | "success"
  | "error";

export type SyncTaskDirection = "upload" | "download";

export interface SyncTaskStatus {
  readonly kind: SyncTaskKind;
  readonly phase: SyncTaskPhase;
  readonly direction: SyncTaskDirection | null;
  readonly completedUnitCount: number;
  readonly totalUnitCount: number;
  readonly lastStartedAt: string | null;
  readonly lastFinishedAt: string | null;
  readonly lastError: string | null;
}

export interface SyncSettings {
  readonly enabled: boolean;
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly maxConcurrentRequests: number;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly saveState: SyncSaveState;
  readonly initialSyncStage: SyncInitialSyncStage;
  readonly hasCompletedInitialFeatureSync: boolean;
  readonly currentRunReason: SyncRunReason | null;
  readonly activeRequestCount: number;
  readonly queuedRequestCount: number;
  readonly tasks: readonly SyncTaskStatus[];
  readonly pendingLocalChangeCount: number;
  readonly saveError: string | null;
  readonly lastUploadAt: string | null;
  readonly lastDownloadAt: string | null;
  readonly lastError: string | null;
  readonly lastUpdateCheckAt: string | null;
  /** 下载不容忍中止后锁定画布，阻断继续编辑直到本轮同步结束。 */
  readonly canvasLocked: boolean;
  // AI-REMOVED 2026-08-10:
  // Reason: lastBigCheckAt 随大检查功能一并删除。
  // Trigger: 用户确认大检查无额外价值。
  // Evidence: 与大检查定时器和任务类型配套。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // readonly lastBigCheckAt: string | null;
}

// AI-REMOVED 2026-07-29:
// Reason: 设备列表不能可靠归因远端 revision，且枚举成本随设备数增长。
// Trigger: 用户确认设备列表没有业务意义，仅展示远端上传时间。
// Evidence: 当前冲突设备名只是取 remoteDevices[0]，并非 revision 的真实作者。
// Replacement: SyncConflictItem.remoteUpdatedAt。
// Risk: Low；旧 devices/*.json 保留在服务器，不做破坏性删除。
// Human Review: Required
//
// Original code:
// export interface SyncRemoteDeviceInfo {
//   readonly deviceId: string;
//   readonly label: string;
//   readonly firstSeen: string;
//   readonly lastActive: string;
// }

export type SyncConflictItemKind = "upload" | "download" | "conflict";

export interface SyncConflictItem {
  readonly adapterId: string;
  readonly assetId: string;
  /** 条目类型：上传（默认用我的）、下载（默认用远端）或双向冲突。 */
  readonly kind: SyncConflictItemKind;
  readonly remoteUpdatedAt: string | null;
}

export interface SyncConflictDecision {
  readonly adapterId: string;
  readonly assetId: string;
  readonly resolution: SyncConflictResolution;
}

export interface SyncPendingConflict {
  readonly phase: SyncConflictPhase;
  readonly items: readonly SyncConflictItem[];
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
