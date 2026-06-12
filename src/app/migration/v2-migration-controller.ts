import { makeAutoObservable, runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { DialogStateReadWrite } from "@/app/state/state-impl";

import {
  detectV2MigrationData,
  type V2MigrationDetection,
} from "./v2-migration-detector";
import {
  executeV2Migration,
  type V2MigrationExecutorResult,
} from "./v2-migration-executor";
import {
  readV2MigrationState,
  type V2MigrationState,
} from "./v2-migration-state";

export type V2MigrationPhase = "idle" | "migrating" | "completed" | "failed";

export class V2MigrationController {
  readonly dialogState: DialogStateReadWrite = {
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 560,
    height: null,
    activeTab: null,
  };

  detection: V2MigrationDetection = detectV2MigrationData();
  migrationState: V2MigrationState = readV2MigrationState();
  phase: V2MigrationPhase = "idle";
  confirmationRequested = false;
  errorMessage: string | null = null;
  result: V2MigrationExecutorResult | null = null;
  private didAutoOpen = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  initialize(): void {
    this.refresh();

    if (
      this.didAutoOpen
      || !this.detection.hasData
      || this.migrationState.completedAt !== null
    ) {
      return;
    }

    this.didAutoOpen = true;
    this.openDialog();
  }

  refresh(): void {
    this.detection = detectV2MigrationData();
    this.migrationState = readV2MigrationState();
  }

  openDialog(): void {
    this.refresh();
    this.dialogState.visible = true;
    this.confirmationRequested = false;
    this.errorMessage = null;
    if (this.phase !== "migrating") {
      this.phase = this.result === null ? "idle" : "completed";
    }
  }

  closeDialog(): void {
    if (this.phase === "migrating") {
      return;
    }

    this.dialogState.visible = false;
    this.confirmationRequested = false;
  }

  requestConfirmation(): void {
    if (this.phase === "migrating") {
      return;
    }

    this.confirmationRequested = true;
    this.errorMessage = null;
  }

  cancelConfirmation(): void {
    if (this.phase === "migrating") {
      return;
    }

    this.confirmationRequested = false;
  }

  async runMigration(appHost: AppHost): Promise<void> {
    if (this.phase === "migrating") {
      return;
    }

    runInAction(() => {
      this.phase = "migrating";
      this.errorMessage = null;
      this.confirmationRequested = false;
    });

    try {
      const result = await executeV2Migration(appHost);

      runInAction(() => {
        this.result = result;
        this.phase = "completed";
        this.refresh();
      });
    } catch (error) {
      runInAction(() => {
        this.phase = "failed";
        this.errorMessage = error instanceof Error ? error.message : "迁移失败";
      });
    }
  }
}
