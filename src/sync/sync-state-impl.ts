import { makeAutoObservable } from "mobx";

import type {
  SyncConflictDecision,
  SyncPendingConflict,
  SyncSettings,
  SyncState,
} from "@/domain/sync";
import type {
  SyncAdapterConflict,
} from "./engine/sync-adapters";
import type { SyncServiceStatus } from "./engine/sync-service";

const EMPTY_SETTINGS: SyncSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  maxConcurrentRequests: 4,
};

export class SyncStateImpl implements SyncState {
  public settings: SyncSettings = EMPTY_SETTINGS;
  public status: SyncServiceStatus = {
    phase: "idle",
    saveState: "idle",
    initialSyncStage: "ready",
    hasCompletedInitialFeatureSync: false,
    currentRunReason: null,
    activeRequestCount: 0,
    queuedRequestCount: 0,
    tasks: [],
    pendingLocalChangeCount: 0,
    saveError: null,
    lastUploadAt: null,
    lastDownloadAt: null,
    lastError: null,
    lastSmallCheckAt: null,
    canvasLocked: false,
    lastResults: [],
  };

  public pendingConflict: SyncPendingConflict | null = null;

  private conflictResolver: ((
    decisions: readonly SyncConflictDecision[],
  ) => void) | null = null;

  public constructor() {
    makeAutoObservable<SyncStateImpl, "conflictResolver">(this, {
      conflictResolver: false,
    }, { autoBind: true });
  }

  public setStatus(status: SyncServiceStatus): void {
    this.status = status;
  }

  public setSettings(settings: SyncSettings): void {
    this.settings = settings;
  }

  // AI-REMOVED 2026-07-29:
  // Reason: 不再维护没有可靠 revision 归因能力的设备列表。
  // Trigger: 用户确认设备列表没有业务意义，只显示远端上传时间。
  // Evidence: 原 setRemoteDevices 仅排序逐文件枚举结果，冲突时却错误使用第一项作为提交设备。
  // Replacement: requestConflictResolutions 中的 remoteUpdatedAt。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // public remoteDevices: SyncRemoteDeviceInfo[] = [];
  // public setRemoteDevices(devices: readonly SyncRemoteDeviceInfo[]): void {
  //   this.remoteDevices = [...devices].sort((left, right) => right.lastActive.localeCompare(left.lastActive));
  // }

  public beginConflictDiscovery(): void {
    this.pendingConflict = {
      phase: "discovering",
      items: this.pendingConflict?.items ?? [],
    };
  }

  public requestConflictResolutions(
    conflicts: readonly SyncAdapterConflict<unknown>[],
  ): Promise<readonly SyncConflictDecision[]> {
    if (!this.settings.enabled) {
      return Promise.resolve(conflicts.map((conflict) => ({
        adapterId: conflict.adapterId,
        assetId: conflict.assetId,
        resolution: "pause",
      })));
    }

    this.pendingConflict = {
      phase: "awaiting-resolution",
      items: conflicts.map((conflict) => ({
        adapterId: conflict.adapterId,
        assetId: conflict.assetId,
        kind: conflict.kind ?? "conflict",
        remoteUpdatedAt: conflict.remoteUpdatedAt,
      })),
    };

    return new Promise((resolve) => {
      this.conflictResolver = resolve;
    });
  }

  public resolveConflicts(
    decisions: readonly SyncConflictDecision[],
  ): void {
    if (
      this.pendingConflict === null
      || this.pendingConflict.phase !== "awaiting-resolution"
    ) {
      return;
    }

    this.pendingConflict = {
      ...this.pendingConflict,
      phase: "applying",
    };
    this.conflictResolver?.(decisions);
    this.conflictResolver = null;
  }

  public finishConflictWorkflow(): void {
    this.pendingConflict = null;
    this.conflictResolver = null;
  }

  public cancelConflictWorkflow(): void {
    if (
      this.pendingConflict !== null
      && this.pendingConflict.phase === "awaiting-resolution"
    ) {
      this.resolveConflicts(this.pendingConflict.items.map((item) => ({
        adapterId: item.adapterId,
        assetId: item.assetId,
        resolution: "pause",
      })));
    }
    this.finishConflictWorkflow();
  }
}
