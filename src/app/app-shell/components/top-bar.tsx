import { FullscreenToggleButton } from "@/app/app-shell/components/fullscreen-toggle-button";
import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import type { AppHost } from "@/app/app-host";
import {
  type DeviceClass,
  type ScreenShape,
} from "@/domain/state/screen-profile";
import { observer } from "mobx-react-lite";
import {
  isMobileLandscapeScreenProfile,
} from "@/shared/browser/screen-profile";

function getLocaleLabelKey(locale: AppHost["state"]["settings"]["locale"]): string {
  return locale === "en-US" ? "locale.en-US" : "locale.zh-CN";
}

function getDeviceLabelKey(deviceClass: DeviceClass): string {
  if (deviceClass === "mobile") {
    return "device.mobile";
  }

  if (deviceClass === "tablet") {
    return "device.tablet";
  }

  return "device.desktop";
}

function getScreenShapeLabelKey(screenShape: ScreenShape): string {
  if (screenShape === "portrait") {
    return "screen.portrait";
  }

  if (screenShape === "square") {
    return "screen.square";
  }

  return "screen.landscape";
}

export const TopBar = observer(function TopBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const {
    screenProfile,
    workbench: { leftDockOpen, rightDockOpen, topBarCollapsed },
    settings,
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
  const isMobileLandscape = isMobileLandscapeScreenProfile(screenProfile);
  const collapseActionKey = isMobileLandscape && topBarCollapsed ? "action.expand" : "action.collapse";
  const collapseButtonLabel = `${t(collapseActionKey)} ${t("topBar.controls")}`;
  const deviceLabel = t(getDeviceLabelKey(screenProfile.deviceClass));
  const screenShapeLabel = t(getScreenShapeLabelKey(screenProfile.screenShape));
  const leftPanelIconKind = leftDockOpen ? "panel-left-close" : "panel-left-open";
  const rightPanelIconKind = rightDockOpen ? "panel-right-close" : "panel-right-open";

  if (isMobileLandscape && topBarCollapsed) {
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
        <span className="top-bar-metric">
          {`${t("topBar.language")}: ${t(getLocaleLabelKey(settings.locale))}`}
        </span>
        <span className="top-bar-metric">{`${t("topBar.theme")}: ${appHost.state.theme.name}`}</span>
        <span className="top-bar-metric">{`${t("topBar.device")}: ${deviceLabel}`}</span>
        <span className="top-bar-metric">{`${t("topBar.screen")}: ${screenShapeLabel}`}</span>
        <FullscreenToggleButton
          appHost={appHost}
          className="top-bar-icon-button top-bar-fullscreen-button"
        />
        {isMobileLandscape ? (
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
