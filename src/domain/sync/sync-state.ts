import type {
  SyncPendingConflict,
  SyncSettings,
  SyncStatus,
} from "./types/sync-types";

export interface SyncState {
  readonly settings: SyncSettings;
  readonly status: SyncStatus;
  readonly pendingConflict: SyncPendingConflict | null;
  // AI-REMOVED 2026-07-29:
  // Reason: 设备列表不再属于同步公开状态。
  // Trigger: 用户确认不列出设备，仅在冲突中展示远端上传时间。
  // Evidence: 设备枚举耗时高且不能可靠归因 revision 作者。
  // Replacement: pendingConflict.items[].remoteUpdatedAt。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // readonly remoteDevices: readonly SyncRemoteDeviceInfo[];
}
