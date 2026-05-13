import { useCallback, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { EditSelectionInspector } from "@/app/shell/inspector/edit-selection-inspector";
import { InspectorNeighborhoodPreview } from "@/app/shell/inspector/inspector-neighborhood-preview";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const InspectorDialog = observer(function InspectorDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.inspector;
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const selectionCount = appHost.workspace.editor?.state.collections.selection.length ?? 0;
  const shouldShowNeighborhoodPreview = selectionCount === 1;
  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "90%" : "72%",
      height: isPhoneLayout ? "90%" : "80%",
    }
    : undefined;

  const handleClose = useCallback(() => {
    appHost.workspace.editor?.actions.clearCollection(EntityCollectionType.selection);
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.closeDialog("inspector");
  }, [appHost]);

  if (!dialogState.visible) {
    return null;
  }

  return (
    <DialogShell
      className="inspector-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="inspector"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("inspector", offsetX, offsetY);
      }}
      onResize={isPhoneLayout ? undefined : (width, height) => {
        appHost.internalActions.setDialogSize("inspector", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("inspector");
      }}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={t("rightDock.selection")}
      titleId="inspector-dialog-title"
    >
      <div className={shouldShowNeighborhoodPreview
        ? "section-body inspector-dialog-body has-neighborhood-preview"
        : "section-body inspector-dialog-body"}
      >
        {shouldShowNeighborhoodPreview ? (
          <InspectorNeighborhoodPreview appHost={appHost} />
        ) : null}
        <div className="inspector-dialog-inspector-pane">
          <EditSelectionInspector
            appHost={appHost}
            context={null}
            mode="dialog"
            state={{ locale: appHost.state.settings.locale }}
            translate={t}
          />
        </div>
      </div>
    </DialogShell>
  );
});