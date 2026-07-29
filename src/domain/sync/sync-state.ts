import type {
  SyncPendingConflict,
  SyncRemoteDeviceInfo,
  SyncSettings,
  SyncStatus,
} from "./types/sync-types";

export interface SyncState {
  readonly settings: SyncSettings;
  readonly status: SyncStatus;
  readonly remoteDevices: readonly SyncRemoteDeviceInfo[];
  readonly pendingConflict: SyncPendingConflict | null;
}
