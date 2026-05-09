import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { BlueprintFolderForm } from "@/app/shell/panels/blueprint-folder-form";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import type { WorkbenchBlueprintFolderDialogController } from "@/app/shell/state/blueprint-folder-dialog-state";
import {
  createBlueprintFolder,
  deleteBlueprintFolder,
  renameBlueprintFolder,
} from "@/shared/storage/blueprint-storage";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const BlueprintFolderDialog = observer(function BlueprintFolderDialog({
  appHost,
  controller,
}: {
  appHost: AppHost;
  controller: WorkbenchBlueprintFolderDialogController;
}) {
  const t = appHost.actions.translate;
  const dialogState = controller.dialogState;
  const isEditMode = controller.mode === "edit";
  const editingFolder = controller.folder;
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  const [folderName, setFolderName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);

  useEffect(() => {
    if (!dialogState.visible) {
      setFolderName("");
      setErrorMessage(null);
      setIsSubmitting(false);
      setIsDeleteConfirming(false);
      return;
    }

    setFolderName(isEditMode ? editingFolder?.name ?? "" : "");
    setErrorMessage(null);
    setIsSubmitting(false);
    setIsDeleteConfirming(false);
  }, [dialogState.visible, editingFolder?.folderId, editingFolder?.name, isEditMode]);

  const handleClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }

    controller.close();
  }, [controller, isSubmitting]);

  if (!dialogState.visible || (isEditMode && editingFolder === null)) {
    return null;
  }

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "100%" : isTabletLayout ? "520px" : "420px",
      height: isPhoneLayout
        ? `min(${isEditMode ? 380 : 320}px, 100%)`
        : isTabletLayout
          ? `${isEditMode ? 360 : 300}px`
          : `${isEditMode ? 320 : 260}px`,
      minHeight: isPhoneLayout ? "240px" : "220px",
    }
    : undefined;

  const handleCreateSubmit = async () => {
    const normalizedName = folderName.trim();

    if (normalizedName.length === 0) {
      setErrorMessage(t("workbench.blueprint.folderNameRequired"));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const createdFolder = await createBlueprintFolder({
        name: normalizedName,
        parentFolderId: controller.parentFolderId,
      });

      if (createdFolder === null) {
        setErrorMessage(t("workbench.blueprint.folderCreateFailed"));
        return;
      }

      controller.markCreated();
      controller.close();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameSubmit = async () => {
    const normalizedName = folderName.trim();

    if (editingFolder === null) {
      return;
    }

    if (normalizedName.length === 0) {
      setErrorMessage(t("workbench.blueprint.folderNameRequired"));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const renamedFolder = await renameBlueprintFolder({
        folderId: editingFolder.folderId,
        name: normalizedName,
      });

      if (renamedFolder === null) {
        setErrorMessage(t("workbench.blueprint.folderRenameFailed"));
        return;
      }

      controller.markMutated();
      controller.close();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (editingFolder === null) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const deletedFolder = await deleteBlueprintFolder(editingFolder.folderId);

      if (deletedFolder === null) {
        setErrorMessage(t("workbench.blueprint.folderDeleteFailed"));
        return;
      }

      controller.markMutated();
      controller.close();
    } finally {
      setIsSubmitting(false);
    }
  };

  const folderDialogTitle = isEditMode
    ? t("workbench.blueprint.editFolder")
    : t("workbench.blueprint.createFolder");

  return (
    <DialogShell
      bodyClassName="save-blueprint-dialog-body"
      className="blueprint-folder-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey={isEditMode ? "blueprint-folder-edit" : "blueprint-folder-create"}
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        controller.setOffset(offsetX, offsetY);
      }}
      onResize={isPhoneLayout ? undefined : (width, height) => {
        controller.setSize(width, height);
      }}
      onToggleMaximized={() => {
        controller.toggleMaximized();
      }}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={folderDialogTitle}
      titleId="blueprint-folder-dialog-title"
    >
      <div className="save-blueprint-dialog-content">
        {isEditMode ? (
          <form
            className="save-blueprint-form"
            onSubmit={(event) => {
              event.preventDefault();

              if (isDeleteConfirming) {
                void handleDeleteSubmit();
                return;
              }

              void handleRenameSubmit();
            }}
          >
            <div className="save-blueprint-form-content">
              <label className="save-blueprint-field">
                <span className="save-blueprint-label">{t("workbench.blueprint.folderNameLabel")}</span>
                <input
                  autoFocus
                  className="save-blueprint-input"
                  data-blueprint-folder-input
                  disabled={isSubmitting || isDeleteConfirming}
                  onChange={(event) => {
                    setFolderName(event.currentTarget.value);
                    if (errorMessage !== null) {
                      setErrorMessage(null);
                    }
                  }}
                  placeholder={t("workbench.blueprint.createFolderPlaceholder")}
                  type="text"
                  value={folderName}
                />
              </label>
              {isDeleteConfirming ? (
                <p className="blueprint-folder-dialog-note">{t("workbench.blueprint.folderDeleteDescription")}</p>
              ) : null}
              {errorMessage === null ? null : (
                <p className="save-blueprint-error" role="alert">{errorMessage}</p>
              )}
            </div>
            <div className={isDeleteConfirming
              ? "save-blueprint-actions"
              : "save-blueprint-actions is-triple-action"}
            >
              {isDeleteConfirming ? (
                <>
                  <button
                    className="save-blueprint-secondary-button"
                    data-ui-button-id="blueprint-folder-delete-cancel-confirm"
                    disabled={isSubmitting}
                    onClick={() => {
                      setIsDeleteConfirming(false);
                      setErrorMessage(null);
                    }}
                    type="button"
                  >
                    {t("workbench.blueprint.deleteFolderCancel")}
                  </button>
                  <button
                    className="save-blueprint-primary-button blueprint-folder-danger-button is-confirm"
                    data-ui-button-id="blueprint-folder-delete-confirm"
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {t("workbench.blueprint.deleteFolderConfirm")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="save-blueprint-secondary-button"
                    data-ui-button-id="blueprint-folder-edit-cancel"
                    disabled={isSubmitting}
                    onClick={handleClose}
                    type="button"
                  >
                    {t("workbench.blueprint.cancel")}
                  </button>
                  <button
                    className="save-blueprint-secondary-button blueprint-folder-danger-button"
                    data-ui-button-id="blueprint-folder-delete-trigger"
                    disabled={isSubmitting}
                    onClick={() => {
                      setIsDeleteConfirming(true);
                      setErrorMessage(null);
                    }}
                    type="button"
                  >
                    {t("workbench.blueprint.deleteFolder")}
                  </button>
                  <button
                    className="save-blueprint-primary-button"
                    data-ui-button-id="blueprint-folder-edit-submit"
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {t("workbench.blueprint.renameFolderSubmit")}
                  </button>
                </>
              )}
            </div>
          </form>
        ) : (
          <BlueprintFolderForm
            errorMessage={errorMessage}
            isCreatingFolder={isSubmitting}
            onCancel={handleClose}
            onSubmit={handleCreateSubmit}
            onValueChange={(value) => {
              setFolderName(value);
              if (errorMessage !== null) {
                setErrorMessage(null);
              }
            }}
            translate={t}
            value={folderName}
          />
        )}
      </div>
    </DialogShell>
  );
});