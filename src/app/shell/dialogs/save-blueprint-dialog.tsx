import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { observer } from "mobx-react-lite";

import { canSaveSelectionAsBlueprint, saveSelectionBlueprint } from "@/app/blueprint/save-blueprint";
import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

function createDefaultBlueprintName(locale: AppHost["state"]["settings"]["locale"]): string {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return locale === "zh-CN"
    ? `蓝图 ${hours}:${minutes}`
    : `Blueprint ${hours}:${minutes}`;
}

export const SaveBlueprintDialog = observer(function SaveBlueprintDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const locale = appHost.state.settings.locale;
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState["save-blueprint"];
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  const canSaveSelection = canSaveSelectionAsBlueprint(appHost.workspace);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!dialogState.visible) {
      setIsSaving(false);
      setErrorMessage(null);
      return;
    }

    setName(createDefaultBlueprintName(locale));
    setDescription("");
    setErrorMessage(null);
    setIsSaving(false);
  }, [dialogState.visible, locale]);

  const copy = useMemo(() => (
    locale === "zh-CN"
      ? {
        title: "保存蓝图",
        nameLabel: "蓝图名称",
        namePlaceholder: "输入蓝图名称",
        descriptionLabel: "描述",
        descriptionPlaceholder: "可选，补充说明用途或布局特点",
        cancel: "取消",
        save: "保存蓝图",
        emptySelection: "当前至少需要选中两个实体才能保存蓝图。",
        requiredName: "请输入蓝图名称。",
        saveFailed: "蓝图保存失败，请检查浏览器存储是否可用。",
      }
      : {
        title: "Save Blueprint",
        nameLabel: "Blueprint Name",
        namePlaceholder: "Enter a blueprint name",
        descriptionLabel: "Description",
        descriptionPlaceholder: "Optional notes about purpose or layout",
        cancel: "Cancel",
        save: "Save Blueprint",
        emptySelection: "Select at least two entities to save a blueprint.",
        requiredName: "Please enter a blueprint name.",
        saveFailed: "Failed to save blueprint. Check browser storage availability.",
      }
  ), [locale]);

  const handleClose = useCallback(() => {
    if (isSaving) {
      return;
    }

    appHost.internalActions.closeDialog("save-blueprint");
  }, [appHost, isSaving]);

  if (!dialogState.visible) {
    return null;
  }

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "100%" : isTabletLayout ? "560px" : "520px",
      height: isPhoneLayout ? "min(520px, 100%)" : isTabletLayout ? "520px" : "440px",
      minHeight: isPhoneLayout ? "320px" : isTabletLayout ? "480px" : "400px",
    }
    : undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedName = name.trim();

    if (!canSaveSelection) {
      setErrorMessage(copy.emptySelection);
      return;
    }

    if (normalizedName.length === 0) {
      setErrorMessage(copy.requiredName);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const saved = await saveSelectionBlueprint({
        workspace: appHost.workspace,
        name: normalizedName,
        description,
      });

      if (saved === null) {
        setErrorMessage(copy.saveFailed);
        return;
      }

      appHost.internalActions.closeDialog("save-blueprint");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogShell
      bodyClassName="save-blueprint-dialog-body"
      className="save-blueprint-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="save-blueprint"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("save-blueprint", offsetX, offsetY);
      }}
      onResize={isPhoneLayout ? undefined : (width, height) => {
        appHost.internalActions.setDialogSize("save-blueprint", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("save-blueprint");
      }}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={copy.title}
      titleId="save-blueprint-dialog-title"
    >
      <div className="save-blueprint-dialog-content">
        <form className="save-blueprint-form" onSubmit={(event) => {
          void handleSubmit(event);
        }}>
          <div className="save-blueprint-form-content">
            <label className="save-blueprint-field">
              <span className="save-blueprint-label">{copy.nameLabel}</span>
              <input
                autoFocus
                className="save-blueprint-input"
                disabled={isSaving}
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                  if (errorMessage !== null) {
                    setErrorMessage(null);
                  }
                }}
                placeholder={copy.namePlaceholder}
                type="text"
                value={name}
              />
            </label>
            <label className="save-blueprint-field save-blueprint-field-description">
              <span className="save-blueprint-label">{copy.descriptionLabel}</span>
              <textarea
                className="save-blueprint-textarea"
                disabled={isSaving}
                maxLength={500}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
                placeholder={copy.descriptionPlaceholder}
                rows={5}
                value={description}
              />
            </label>
            {errorMessage === null ? null : (
              <p className="save-blueprint-error" role="alert">{errorMessage}</p>
            )}
          </div>
          <div className="save-blueprint-actions">
            <button
              className="save-blueprint-secondary-button"
              disabled={isSaving}
              onClick={handleClose}
              type="button"
            >
              {copy.cancel}
            </button>
            <button
              className="save-blueprint-primary-button"
              disabled={isSaving || !canSaveSelection}
              type="submit"
            >
              {isSaving ? `${copy.save}...` : copy.save}
            </button>
          </div>
        </form>
      </div>
    </DialogShell>
  );
});