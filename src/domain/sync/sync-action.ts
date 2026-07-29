import type {
  SyncConflictDecision,
  SyncSettings,
} from "./types/sync-types";

export interface SyncAction {
  updateSettings(patch: Partial<SyncSettings>): void;
  syncNow(): Promise<void>;
  resolveConflicts(decisions: readonly SyncConflictDecision[]): void;
  // AI-REMOVED 2026-07-29:
  // Reason: 单个全局决议无法表达一次窗口中每项冲突的独立选择。
  // Trigger: 用户要求确定全部冲突范围后只弹一次窗口，并为每一项提供三个选项。
  // Evidence: 原 action 只有一个 SyncConflictResolution，调用后立即清空 pendingConflict。
  // Replacement: resolveConflicts(decisions)。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // resolveConflict(resolution: SyncConflictResolution): void;
}
