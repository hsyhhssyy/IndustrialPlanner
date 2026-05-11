import { makeAutoObservable } from "mobx";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

export type SaveBlueprintDialogSource = "selection" | "import" | "edit";

export class WorkbenchSaveBlueprintDialogController {
  dialogState: DialogStateReadWrite;
  source: SaveBlueprintDialogSource = "selection";
  document: BlueprintDocument | null = null;
  parentFolderId: string | null = null;
  completedMutationCount = 0;

  public constructor(dialogState: DialogStateReadWrite) {
    this.dialogState = dialogState;
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public openSelection(parentFolderId: string | null = null) {
    this.source = "selection";
    this.document = null;
    this.parentFolderId = parentFolderId;
    this.dialogState.visible = true;
  }

  public openImported(document: BlueprintDocument, parentFolderId: string | null = null) {
    this.source = "import";
    this.document = document;
    this.parentFolderId = parentFolderId;
    this.dialogState.visible = true;
  }

  public openEdit(record: BlueprintLibraryRecord) {
    this.source = "edit";
    this.document = record;
    this.parentFolderId = record.parentFolderId;
    this.dialogState.visible = true;
  }

  public close() {
    this.dialogState.visible = false;
    this.source = "selection";
    this.document = null;
    this.parentFolderId = null;
  }

  public markSaved() {
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
