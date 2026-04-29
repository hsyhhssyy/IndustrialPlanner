import { FullscreenToggleButton } from "@/app/shell/components/fullscreen-toggle-button";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { observer } from "mobx-react-lite";
import {
  isTouchLandscapeScreenProfile,
} from "@/shared/browser/screen-profile";

export const TopBar = observer(function TopBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const {
    screenProfile,
    workbench: { leftDockOpen, rightDockOpen, topBarCollapsed },
  } = appHost.state;

  const toggleLeftDock = () => {
    appHost.internalActions.toggleLeftDock();
  };
  const toggleRightDock = () => {
    appHost.internalActions.toggleRightDock();
  };
  const toggleTopBarCollapsed = () => {
    appHost.internalActions.toggleTopBarCollapsed();
  };
  const leftPanelLabel = `${t(leftDockOpen ? "action.close" : "action.open")} ${t("topBar.leftPanel")}`;
  const rightPanelLabel = `${t(rightDockOpen ? "action.close" : "action.open")} ${t("topBar.rightPanel")}`;
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const collapseActionKey = isTouchLandscape && topBarCollapsed ? "action.expand" : "action.collapse";
  const collapseButtonLabel = `${t(collapseActionKey)} ${t("topBar.controls")}`;
  const leftPanelIconKind = leftDockOpen ? "panel-left-close" : "panel-left-open";
  const rightPanelIconKind = rightDockOpen ? "panel-right-close" : "panel-right-open";

  if (isTouchLandscape && topBarCollapsed) {
    return null;
  }

  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          aria-label={leftPanelLabel}
          aria-pressed={leftDockOpen}
          className={leftDockOpen ? "is-active" : undefined}
          onClick={toggleLeftDock}
          title={leftPanelLabel}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind={leftPanelIconKind} />
          </span>
          <span className="sr-only">{leftPanelLabel}</span>
        </button>
        <button
          aria-label={rightPanelLabel}
          aria-pressed={rightDockOpen}
          className={rightDockOpen ? "is-active" : undefined}
          onClick={toggleRightDock}
          title={rightPanelLabel}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind={rightPanelIconKind} />
          </span>
          <span className="sr-only">{rightPanelLabel}</span>
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{t("app.title")}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <FullscreenToggleButton
          appHost={appHost}
          className="top-bar-icon-button top-bar-fullscreen-button"
        />
        {isTouchLandscape ? (
          <button
            aria-label={collapseButtonLabel}
            className="top-bar-collapse-button top-bar-icon-button"
            onClick={toggleTopBarCollapsed}
            title={collapseButtonLabel}
            type="button"
          >
            <span className="top-bar-toggle-icon">
              <WorkbenchIcon kind="panel-top-close" />
            </span>
            <span className="sr-only">{t("action.collapse")}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
});
