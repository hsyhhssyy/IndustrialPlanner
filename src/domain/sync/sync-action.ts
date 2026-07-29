import type {
  SyncConflictResolution,
  SyncSettings,
} from "./types/sync-types";

export interface SyncAction {
  updateSettings(patch: Partial<SyncSettings>): void;
  syncNow(): Promise<void>;
  resolveConflict(resolution: SyncConflictResolution): void;
}
