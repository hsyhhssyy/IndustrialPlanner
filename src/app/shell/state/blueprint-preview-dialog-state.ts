import { makeAutoObservable } from "mobx";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

function createDefaultDialogState(): DialogStateReadWrite {
  return {
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  };
}

export class WorkbenchBlueprintPreviewController {
  dialogState: DialogStateReadWrite = createDefaultDialogState();
  record: BlueprintLibraryRecord | null = null;
  canDelete = false;
  completedDeleteCount = 0;
  completedMutationCount = 0;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public open(record: BlueprintLibraryRecord, options: {
    canDelete?: boolean;
  } = {}) {
    this.record = record;
    this.canDelete = options.canDelete ?? false;
    this.dialogState.visible = true;
  }

  public close() {
    this.dialogState.visible = false;
    this.record = null;
    this.canDelete = false;
  }

  public markDeleted() {
    this.completedDeleteCount += 1;
    this.completedMutationCount += 1;
  }

  public markMoved() {
    this.completedMutationCount += 1;
  }

  public setOffset(offsetX: number, offsetY: number) {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      return;
    }

    this.dialogState.offsetX = Math.round(offsetX);
    this.dialogState.offsetY = Math.round(offsetY);
  }

  public setSize(width: number | null, height: number | null) {
    if (width !== null && (!Number.isFinite(width) || width <= 0)) {
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      return;
    }

    this.dialogState.width = width === null ? null : Math.round(width);
    this.dialogState.height = height === null ? null : Math.round(height);
  }

  public toggleMaximized() {
    this.dialogState.maximized = !this.dialogState.maximized;
  }
}