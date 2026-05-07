import { useEffect, useRef, useSyncExternalStore } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import {
  getDebugLogSnapshot,
  subscribeDebugLogSnapshot,
} from "@/shared/logging/debug-log-store";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const DebugLogDialog = observer(function DebugLogDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState["debug-log"];
  const snapshot = useSyncExternalStore(
    subscribeDebugLogSnapshot,
    getDebugLogSnapshot,
    getDebugLogSnapshot,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea === null) {
      return;
    }

    textarea.scrollTop = textarea.scrollHeight;
  }, [snapshot.version]);

  if (dialogState === undefined) {
    return null;
  }

  return (
    <DialogShell
      bodyClassName="debug-log-dialog-body"
      className="debug-log-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={appHost.state.screenProfile.deviceClass === "mobile"}
      dialogKey="debug-log"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("debugLogDialog.maximize")}
      onClose={() => {
        appHost.internalActions.closeDialog("debug-log");
      }}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("debug-log", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("debug-log", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("debug-log");
      }}
      restoreTitle={t("debugLogDialog.restore")}
      title={t("debugLogDialog.title")}
      titleId="debug-log-dialog-title"
    >
      <textarea
        aria-label={t("debugLogDialog.title")}
        className="json-debug-textarea debug-log-dialog-textarea"
        placeholder={t("debugLogDialog.empty")}
        readOnly
        ref={textareaRef}
        spellCheck={false}
        value={snapshot.text}
      />
    </DialogShell>
  );
});