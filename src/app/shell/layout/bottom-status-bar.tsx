import type { AppHost } from "@/app/host/app-host";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { UiKey } from "@/shared/i18n";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  type DeviceClass,
  type ScreenShape,
} from "@/domain/app/types/screen-profile";
import { observer } from "mobx-react-lite";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function getDeviceLabelKey(deviceClass: DeviceClass): string {
  if (deviceClass === "mobile") {
    return "device.mobile";
  }

  if (deviceClass === "tablet") {
    return "device.tablet";
  }

  return "device.desktop";
}

function getDeviceIconKind(deviceClass: DeviceClass) {
  if (deviceClass === "mobile") {
    return "device-mobile";
  }

  if (deviceClass === "tablet") {
    return "device-tablet";
  }

  return "device-desktop";
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

function getScreenShapeIconKind(screenShape: ScreenShape) {
  if (screenShape === "portrait") {
    return "screen-portrait";
  }

  if (screenShape === "square") {
    return "screen-square";
  }

  return "screen-landscape";
}

function getActiveToolLabelKey(activeTool: ActiveTool): UiKey {
  return `activeTool.${activeTool}` as UiKey;
}

export const BottomStatusBar = observer(function BottomStatusBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
    const { screenProfile } = appHost.state;
  const activeTool = appHost.state.activeTool;
  const deviceLabel = t(getDeviceLabelKey(screenProfile.deviceClass));
  const screenShapeLabel = t(getScreenShapeLabelKey(screenProfile.screenShape));
  const zoomPercent = Math.round(
    (appHost.workspace.editor?.state.viewport.gridSize ?? 1) * 100,
  );

  return (
    <footer className={cm(styles, "status-bar")}>
      <div className={cm(styles, "status-bar-group status-bar-group-left")}>
        <span className={cm(styles, "status-chip status-chip-primary")}>{`${t("statusBar.tool")}: ${t(getActiveToolLabelKey(activeTool))}`}</span>
        {}
        <span className={cm(styles, "status-chip")}>{`${t("topBar.zoom")}: ${zoomPercent}%`}</span>
      </div>
      <div className={cm(styles, "status-bar-group status-bar-group-center")}>
        <span className={cm(styles, "status-bar-copyright")}>
          {'© '}{new Date().getFullYear()}{' '}{t("statusBar.copyright")}
        </span>
        <a
          className={cm(styles, "status-chip")}
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("statusBar.icpFiling")}
        </a>
        <a
          className={cm(styles, "status-chip")}
          href="https://github.com/hsyhhssyy/IndustrialPlanner"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("statusBar.githubRepo")}
        </a>
        <span className={cm(styles, "status-bar-copyright")}>
          {t("statusBar.trademarkNotice")}
        </span>
      </div>
      <div className={cm(styles, "status-bar-group status-bar-group-right")}>
        <span
          aria-label={deviceLabel}
          className={cm(styles, "status-bar-icon-chip")}
          title={deviceLabel}
        >
          <WorkbenchIcon
            className={cm(styles, "status-bar-icon")}
            kind={getDeviceIconKind(screenProfile.deviceClass)}
          />
        </span>
        <span
          aria-label={screenShapeLabel}
          className={cm(styles, "status-bar-icon-chip")}
          title={screenShapeLabel}
        >
          <WorkbenchIcon
            className={cm(styles, "status-bar-icon")}
            kind={getScreenShapeIconKind(screenProfile.screenShape)}
          />
        </span>
      </div>
    </footer>
  );
});
