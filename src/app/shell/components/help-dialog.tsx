import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import { HELP_DIALOG_TAB_IDS, type HelpDialogTabId } from "@/app/state/state-impl";

function shouldUseImmersiveMaximizedHelpDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

const HELP_DIALOG_TABS: Array<{
  id: HelpDialogTabId;
  labelKey: string;
}> = [
  {
    id: HELP_DIALOG_TAB_IDS[0],
    labelKey: "helpDialog.tab.overview",
  },
  {
    id: HELP_DIALOG_TAB_IDS[1],
    labelKey: "helpDialog.tab.shortcuts",
  },
  {
    id: HELP_DIALOG_TAB_IDS[2],
    labelKey: "helpDialog.tab.faq",
  },
  {
    id: HELP_DIALOG_TAB_IDS[3],
    labelKey: "helpDialog.tab.versionUpdates",
  },
];

interface HelpDialogOffset {
  x: number;
  y: number;
}

export const HelpDialog = observer(function HelpDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const helpDialog = appHost.internalState.runtime.helpDialog;
  const helpDialogMaximized = appHost.state.workbench.helpDialogMaximized;
  const immersiveMaximized = helpDialogMaximized
    && shouldUseImmersiveMaximizedHelpDialog(appHost.state.screenProfile);
  const [dialogOffset, setDialogOffset] = useState<HelpDialogOffset>({ x: 0, y: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!helpDialog.visible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      appHost.internalActions.closeHelpDialog();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [appHost, helpDialog.visible]);

  useEffect(() => {
    if (!helpDialog.visible || helpDialogMaximized) {
      dragCleanupRef.current?.();
    }
  }, [helpDialog.visible, helpDialogMaximized]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  if (!helpDialog.visible) {
    return null;
  }

  const currentTab = HELP_DIALOG_TABS.find((tab) => tab.id === helpDialog.activeTab) ?? HELP_DIALOG_TABS[0];
  const maximizeTitle = helpDialogMaximized
    ? t("helpDialog.restore")
    : t("helpDialog.maximize");
  const helpDialogStyle: CSSProperties | undefined = helpDialogMaximized
    ? undefined
    : {
      transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)`,
    };

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (helpDialogMaximized) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest("button") !== null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = dialogOffset.x;
    const originY = dialogOffset.y;

    dragCleanupRef.current?.();
    document.body.classList.add("is-dragging-help-dialog");

    const cleanup = () => {
      document.body.classList.remove("is-dragging-help-dialog");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);

      if (dragCleanupRef.current === cleanup) {
        dragCleanupRef.current = null;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      setDialogOffset({
        x: originX + moveEvent.clientX - startX,
        y: originY + moveEvent.clientY - startY,
      });
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) {
        return;
      }

      cleanup();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    dragCleanupRef.current = cleanup;
  };

  return (
    <div
      className={immersiveMaximized
        ? "help-dialog-backdrop is-immersive-maximized"
        : "help-dialog-backdrop"}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        appHost.internalActions.closeHelpDialog();
      }}
    >
      <section
        aria-labelledby="help-dialog-title"
        aria-modal="true"
        className={helpDialogMaximized ? "help-dialog is-maximized" : "help-dialog"}
        role="dialog"
        style={helpDialogStyle}
      >
        <header
          className={helpDialogMaximized ? "help-dialog-header" : "help-dialog-header is-draggable"}
          onPointerDown={handleHeaderPointerDown}
        >
          <div className="help-dialog-header-copy">
            <h2 id="help-dialog-title">{t("helpDialog.title")}</h2>
          </div>
          <div aria-label={t("helpDialog.title")} className="help-dialog-tab-list" role="tablist">
            {HELP_DIALOG_TABS.map((tab) => {
              const isActive = tab.id === helpDialog.activeTab;

              return (
                <button
                  aria-controls={`help-dialog-panel-${tab.id}`}
                  aria-selected={isActive}
                  className={isActive ? "help-dialog-tab is-active" : "help-dialog-tab"}
                  id={`help-dialog-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => {
                    appHost.internalActions.setHelpDialogTab(tab.id);
                  }}
                  role="tab"
                  type="button"
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>
          <div className="help-dialog-header-actions">
            <button
              aria-label={maximizeTitle}
              className="help-dialog-header-button"
              onClick={appHost.internalActions.toggleHelpDialogMaximized}
              title={maximizeTitle}
              type="button"
            >
              <span className="top-bar-toggle-icon">
                <WorkbenchIcon kind={helpDialogMaximized ? "shrink" : "expand"} />
              </span>
              <span className="sr-only">{maximizeTitle}</span>
            </button>
            <button
              aria-label={t("action.close")}
              className="help-dialog-header-button"
              onClick={appHost.internalActions.closeHelpDialog}
              title={t("action.close")}
              type="button"
            >
              <span className="top-bar-toggle-icon">
                <WorkbenchIcon kind="cancel" />
              </span>
              <span className="sr-only">{t("action.close")}</span>
            </button>
          </div>
        </header>
        <div className="help-dialog-layout">
          <section
            aria-labelledby={`help-dialog-tab-${currentTab.id}`}
            className="help-dialog-content"
            id={`help-dialog-panel-${currentTab.id}`}
            role="tabpanel"
          >
            <div className="help-dialog-placeholder">
              <h3>{t(currentTab.labelKey)}</h3>
              <p>{t("helpDialog.empty")}</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
});