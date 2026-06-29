import { makeAutoObservable, runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { isBaseBuiltinEntityId } from "@/domain/registry/types/base-definition";
import { listWorldDocuments } from "@/shared/storage";

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
  // AI-CORRECTION 2026-06-13: confirmationRequested 已替换为 showClearConfirmation 文字确认流程。
  confirmationRequested = false;
  v3IsEmpty: boolean | null = null;
  showClearConfirmation = false;
  clearConfirmationText = "";
  errorMessage: string | null = null;
  result: V2MigrationExecutorResult | null = null;
  private didAutoOpen = false;
  private shouldCloseDialogAfterSuccessfulMigration = false;

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
    this.shouldCloseDialogAfterSuccessfulMigration = true;
  }

  refresh(): void {
    this.detection = detectV2MigrationData();
    this.migrationState = readV2MigrationState();
  }

  openDialog(): void {
    this.refresh();
    this.dialogState.visible = true;
    this.confirmationRequested = false;
    this.showClearConfirmation = false;
    this.clearConfirmationText = "";
    this.shouldCloseDialogAfterSuccessfulMigration = false;
    this.errorMessage = null;
    if (this.phase !== "migrating") {
      this.phase = this.result === null ? "idle" : "completed";
    }
    void this.checkV3Emptiness();
  }

  closeDialog(): void {
    if (this.phase === "migrating") {
      return;
    }

    this.dialogState.visible = false;
    this.confirmationRequested = false;
    this.showClearConfirmation = false;
    this.clearConfirmationText = "";
    this.shouldCloseDialogAfterSuccessfulMigration = false;
  }

  async requestConfirmation(appHost: AppHost): Promise<void> {
    if (this.phase === "migrating") {
      return;
    }

    await this.checkV3Emptiness();

    if (this.v3IsEmpty === true) {
      void this.runMigration(appHost);
      return;
    }

    runInAction(() => {
      this.showClearConfirmation = true;
      this.clearConfirmationText = "";
      this.errorMessage = null;
    });
  }

  cancelConfirmation(): void {
    if (this.phase === "migrating") {
      return;
    }

    this.confirmationRequested = false;
    this.showClearConfirmation = false;
    this.clearConfirmationText = "";
  }

  submitClearConfirmation(appHost: AppHost): void {
    if (this.phase === "migrating") {
      return;
    }

    if (this.clearConfirmationText !== "清除所有基地数据") {
      return;
    }

    this.showClearConfirmation = false;
    void this.runMigration(appHost);
  }

  private async checkV3Emptiness(): Promise<void> {
    try {
      const documents = await listWorldDocuments();
      const isEmpty = documents.length === 0
        || documents.every((document) =>
          Object.keys(document.entities).every((entityId) =>
            isBaseBuiltinEntityId(entityId),
          ),
        );

      runInAction(() => {
        this.v3IsEmpty = isEmpty;
      });
    } catch {
      runInAction(() => {
        this.v3IsEmpty = null;
      });
    }
  }

  async runMigration(appHost: AppHost): Promise<void> {
    if (this.phase === "migrating") {
      return;
    }

    const shouldCloseDialogAfterSuccessfulMigration = this.shouldCloseDialogAfterSuccessfulMigration;

    runInAction(() => {
      this.phase = "migrating";
      this.errorMessage = null;
      this.confirmationRequested = false;
      this.showClearConfirmation = false;
      this.clearConfirmationText = "";
    });

    try {
      const result = await executeV2Migration(appHost);

      runInAction(() => {
        this.result = result;
        this.phase = "completed";
        this.refresh();
        this.shouldCloseDialogAfterSuccessfulMigration = false;
        if (shouldCloseDialogAfterSuccessfulMigration) {
          this.dialogState.visible = false;
        }
      });
    } catch (error) {
      runInAction(() => {
        this.phase = "failed";
        this.errorMessage = error instanceof Error ? error.message : "迁移失败";
      });
    }
  }
}
