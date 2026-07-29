import { makeAutoObservable } from "mobx";

import type {
  SyncConflictResolution,
  SyncPendingConflict,
  SyncRemoteDeviceInfo,
  SyncSettings,
  SyncState,
} from "@/domain/sync";
import type {
  WebDavSyncConflict,
} from "./engine/webdav-sync-adapters";
import type { WebDavSyncServiceStatus } from "./engine/webdav-sync-service";

const EMPTY_SETTINGS: SyncSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
};

export class SyncStateImpl implements SyncState {
  public settings: SyncSettings = EMPTY_SETTINGS;
  public status: WebDavSyncServiceStatus = {
    phase: "idle",
    saveState: "idle",
    pendingLocalChangeCount: 0,
    saveError: null,
    lastUploadAt: null,
    lastDownloadAt: null,
    lastError: null,
    lastResults: [],
  };

  public remoteDevices: SyncRemoteDeviceInfo[] = [];
  public pendingConflict: SyncPendingConflict | null = null;

  private conflictResolver: ((resolution: SyncConflictResolution) => void) | null = null;

  public constructor() {
    makeAutoObservable<SyncStateImpl, "conflictResolver">(this, {
      conflictResolver: false,
    }, { autoBind: true });
  }

  public setStatus(status: WebDavSyncServiceStatus): void {
    this.status = status;
  }

  public setSettings(settings: SyncSettings): void {
    this.settings = settings;
  }

  public setRemoteDevices(devices: readonly SyncRemoteDeviceInfo[]): void {
    this.remoteDevices = [...devices].sort((left, right) => right.lastActive.localeCompare(left.lastActive));
  }

  public requestConflict<TValue>(
    conflict: WebDavSyncConflict<TValue>,
    remoteDeviceLabel: string,
  ): Promise<SyncConflictResolution> {
    this.pendingConflict = {
      adapterId: conflict.adapterId,
      assetId: conflict.assetId,
      remoteDeviceLabel,
    };

    return new Promise((resolve) => {
      this.conflictResolver = resolve;
    });
  }

  public resolveConflict(resolution: SyncConflictResolution): void {
    this.conflictResolver?.(resolution);
    this.conflictResolver = null;
    this.pendingConflict = null;
  }

  public clearConflict(): void {
    this.resolveConflict("pause");
  }
}
