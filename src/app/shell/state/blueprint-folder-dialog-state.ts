import { makeAutoObservable } from "mobx";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type { BlueprintLibraryFolder } from "@/shared/blueprints/blueprint-library";

type BlueprintFolderDialogMode = "create" | "edit";

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

export class WorkbenchBlueprintFolderDialogController {
  dialogState: DialogStateReadWrite = createDefaultDialogState();
  mode: BlueprintFolderDialogMode = "create";
  folder: BlueprintLibraryFolder | null = null;
  parentFolderId: string | null = null;
  completedCreateCount = 0;
  completedMutationCount = 0;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public open(parentFolderId: string | null) {
    this.mode = "create";
    this.folder = null;
    this.parentFolderId = parentFolderId;
    this.dialogState.visible = true;
  }

  public openEdit(folder: BlueprintLibraryFolder) {
    this.mode = "edit";
    this.folder = folder;
    this.parentFolderId = folder.parentFolderId;
    this.dialogState.visible = true;
  }

  public close() {
    this.dialogState.visible = false;
    this.mode = "create";
    this.folder = null;
    this.parentFolderId = null;
  }

  public markCreated() {
    this.completedCreateCount += 1;
    this.completedMutationCount += 1;
  }

  public markMutated() {
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