import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell, type DialogShellTab } from "@/app/shell/shared/dialog-shell";
import { EncyclopediaPanel } from "@/app/shell/encyclopedia/encyclopedia-panel";
import { ModuleBalancingPanel } from "@/app/shell/module-balancing/module-balancing-panel";
import { ProductionPlanningPanel } from "@/app/shell/production-planning";
import {
  COLLAPSED_TOOLBOX_BOTTOM_DOCK_HEIGHT,
  TOOLBOX_DIALOG_TAB_IDS,
  type ToolboxDialogTabId,
} from "@/app/state/state-impl";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function renderInitialSyncLockedContent(options: {
  readonly appHost: AppHost;
  readonly feature: "modules" | "toolbox";
  readonly content: ReactNode;
}): ReactNode {
  const syncState = options.appHost.workspace.sync?.state;
  if (syncState === undefined || !syncState.settings.enabled) {
    return options.content;
  }

  const stage = syncState.status.initialSyncStage;
  const locked = options.feature === "toolbox"
    ? stage !== "ready"
    : stage === "canvas" || stage === "blueprints" || stage === "modules";
  if (!locked) {
    return options.content;
  }

  return (
    <section
      aria-label={options.appHost.actions.translate("syncInitialSync.syncing")}
      aria-live="polite"
      className={cm(styles, "sync-initial-sync-feature-gate")}
      data-sync-initial-sync-feature={options.feature}
      role="status"
    >
      <WorkbenchIcon
        className={cm(styles, "sync-initial-sync-gate-spinner")}
        kind="save-progress"
      />
      <p>{options.appHost.actions.translate("syncInitialSync.syncing")}</p>
    </section>
  );
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export function canUseToolboxBottomDock(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "desktop" || screenProfile.deviceClass === "tablet";
}

export function shouldRenderToolboxBottomDock(appHost: AppHost): boolean {
  return (
    appHost.internalState.workbench.dialogState.toolbox.visible
    && appHost.internalState.workbench.toolbox.dockPreference === "bottom"
    && canUseToolboxBottomDock(appHost.state.screenProfile)
  );
}

const TOOLBOX_DIALOG_TABS: Array<{
  id: ToolboxDialogTabId;
  labelKey: string;
}> = [
  {
    id: TOOLBOX_DIALOG_TAB_IDS[0],
    labelKey: "toolboxDialog.tab.itemEncyclopedia",
  },
  {
    id: TOOLBOX_DIALOG_TAB_IDS[1],
    labelKey: "toolboxDialog.tab.productionPlanning",
  },
  {
    id: TOOLBOX_DIALOG_TAB_IDS[2],
    labelKey: "toolboxDialog.tab.moduleBalancing",
  },
];

function createToolboxTabs(options: {
  appHost: AppHost;
  isTouch: boolean;
}): DialogShellTab[] {
  const { appHost, isTouch } = options;
  const t = appHost.actions.translate;
  const tabContents: Record<string, ReactNode> = {
    [TOOLBOX_DIALOG_TAB_IDS[0]]: renderInitialSyncLockedContent({
      appHost,
      feature: "toolbox",
      content: <EncyclopediaPanel appHost={appHost} isTouch={isTouch} />,
    }),
    [TOOLBOX_DIALOG_TAB_IDS[1]]: renderInitialSyncLockedContent({
      appHost,
      feature: "toolbox",
      content: <ProductionPlanningPanel appHost={appHost} isTouch={isTouch} />,
    }),
    [TOOLBOX_DIALOG_TAB_IDS[2]]: renderInitialSyncLockedContent({
      appHost,
      feature: "modules",
      content: <ModuleBalancingPanel appHost={appHost} isTouch={isTouch} />,
    }),
  };

  const tabs: DialogShellTab[] = TOOLBOX_DIALOG_TABS.map((tab) => {
    const customContent = tabContents[tab.id];
    return {
      id: tab.id,
      label: t(tab.labelKey),
      content: customContent ?? (
        <div className={cm(styles, "toolbox-dialog-content")}>
          <div className={cm(styles, "toolbox-dialog-placeholder")}>
            <h3>{t(tab.labelKey)}</h3>
            <p>{t("toolboxDialog.empty")}</p>
          </div>
        </div>
      ),
    };
  });

  return tabs;
}

export const ToolboxDialog = observer(function ToolboxDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.toolbox;

  if (shouldRenderToolboxBottomDock(appHost)) {
    return null;
  }

  const isTouch = shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile);
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const dockToBottomTitle = t("toolboxDialog.dockToBottom");
  const canDockToBottom = canUseToolboxBottomDock(appHost.state.screenProfile);
  const tabs = createToolboxTabs({ appHost, isTouch });

  return (
    <DialogShell
      className="toolbox-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="toolbox"
      dialogState={dialogState}
      headerActions={canDockToBottom ? (
        <button
          aria-label={dockToBottomTitle}
          className={cm(styles, "dialog-shell-header-button toolbox-dialog-header-button")}
          onClick={() => {
            appHost.internalActions.setToolboxDockPreference("bottom");
          }}
          title={dockToBottomTitle}
          type="button"
        >
          <span className={cm(styles, "top-bar-toggle-icon")}>
            <WorkbenchIcon kind="panel-bottom-close" />
          </span>
          <span className={cm(styles, "sr-only")}>{dockToBottomTitle}</span>
        </button>
      ) : null}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("toolboxDialog.maximize")}
      onClose={() => {
        appHost.internalActions.closeDialog("toolbox");
      }}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("toolbox", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("toolbox", width, height);
      }}
      onTabChange={(tabId) => {
        appHost.internalActions.setDialogTab("toolbox", tabId);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("toolbox");
      }}
      restoreTitle={t("toolboxDialog.restore")}
      tabs={tabs}
      title={t("toolboxDialog.title")}
      titleId="toolbox-dialog-title"
    />
  );
});

export const ToolboxBottomDock = observer(function ToolboxBottomDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.toolbox;
  const toolboxState = appHost.internalState.workbench.toolbox;
  const isTouch = shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const tabs = createToolboxTabs({ appHost, isTouch });
  const activeTab = tabs.find((tab) => tab.id === dialogState.activeTab) ?? tabs[0] ?? null;
  const collapsed = toolboxState.bottomDockCollapsed;
  const collapseTitle = collapsed
    ? t("toolboxDialog.expandBottomDock")
    : t("toolboxDialog.collapseBottomDock");

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  if (!shouldRenderToolboxBottomDock(appHost)) {
    return null;
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const startY = event.clientY;
    const originHeight = toolboxState.bottomDockHeight;

    resizeCleanupRef.current?.();
    document.body.classList.add("is-resizing-toolbox-bottom-dock");

    const cleanup = () => {
      document.body.classList.remove("is-resizing-toolbox-bottom-dock");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);

      if (resizeCleanupRef.current === cleanup) {
        resizeCleanupRef.current = null;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }

      appHost.internalActions.setToolboxBottomDockHeight(
        originHeight + startY - moveEvent.clientY,
      );
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
    resizeCleanupRef.current = cleanup;
  };

  return (
    <section
      aria-labelledby="toolbox-bottom-dock-title"
      className={cm(styles, collapsed
        ? "toolbox-bottom-dock panel-surface is-collapsed"
        : "toolbox-bottom-dock panel-surface")}
    >
      {collapsed ? null : (
        <div
          aria-label={t("toolboxDialog.resizeBottomDock")}
          className={cm(styles, "toolbox-bottom-dock-resize-handle")}
          onPointerDown={handleResizePointerDown}
          role="separator"
          title={t("toolboxDialog.resizeBottomDock")}
        />
      )}
      <header className={cm(styles, "toolbox-bottom-dock-header")}>
        <div className={cm(styles, "toolbox-bottom-dock-title")}>
          <h2 id="toolbox-bottom-dock-title">{t("toolboxDialog.title")}</h2>
        </div>
        <div
          aria-label={t("toolboxDialog.title")}
          className={cm(styles, "toolbox-bottom-dock-tab-list")}
          role="tablist"
        >
          {tabs.map((tab) => {
            const isActive = activeTab?.id === tab.id;

            return (
              <button
                aria-controls={`toolbox-bottom-dock-panel-${tab.id}`}
                aria-selected={isActive}
                className={cm(styles, isActive
                  ? "toolbox-bottom-dock-tab is-active"
                  : "toolbox-bottom-dock-tab")}
                id={`toolbox-bottom-dock-tab-${tab.id}`}
                key={tab.id}
                onClick={() => {
                  appHost.internalActions.setDialogTab("toolbox", tab.id);
                  appHost.internalActions.setToolboxBottomDockCollapsed(false);
                }}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className={cm(styles, "toolbox-bottom-dock-actions")}>
          <button
            aria-label={collapseTitle}
            className={cm(styles, "dialog-shell-header-button toolbox-bottom-dock-action-button")}
            onClick={() => {
              appHost.internalActions.setToolboxBottomDockCollapsed(!collapsed);
            }}
            title={collapseTitle}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind={collapsed ? "panel-bottom-open" : "panel-bottom-close"} />
            </span>
            <span className={cm(styles, "sr-only")}>{collapseTitle}</span>
          </button>
          <button
            aria-label={t("toolboxDialog.undock")}
            className={cm(styles, "dialog-shell-header-button toolbox-bottom-dock-action-button")}
            onClick={() => {
              appHost.internalActions.setToolboxDockPreference("floating");
            }}
            title={t("toolboxDialog.undock")}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind="panel-bottom-open" />
            </span>
            <span className={cm(styles, "sr-only")}>{t("toolboxDialog.undock")}</span>
          </button>
        </div>
      </header>
      {collapsed || activeTab === null ? null : (
        <div className={cm(styles, "toolbox-bottom-dock-body")}>
          <section
            aria-labelledby={`toolbox-bottom-dock-tab-${activeTab.id}`}
            className={cm(styles, "toolbox-bottom-dock-tab-panel")}
            id={`toolbox-bottom-dock-panel-${activeTab.id}`}
            role="tabpanel"
          >
            {activeTab.content}
          </section>
        </div>
      )}
    </section>
  );
});

export function resolveToolboxBottomDockGridHeight(appHost: AppHost): number {
  if (!shouldRenderToolboxBottomDock(appHost)) {
    return 0;
  }

  return appHost.internalState.workbench.toolbox.bottomDockCollapsed
    ? COLLAPSED_TOOLBOX_BOTTOM_DOCK_HEIGHT
    : appHost.internalState.workbench.toolbox.bottomDockHeight;
}
