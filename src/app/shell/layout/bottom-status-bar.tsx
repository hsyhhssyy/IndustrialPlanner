import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  type DeviceClass,
  type ScreenShape,
} from "@/domain/app/types/screen-profile";
import { observer } from "mobx-react-lite";

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
    <footer className="status-bar">
      <div className="status-bar-group status-bar-group-left">
        <span className="status-chip status-chip-primary">{`工具:${activeTool}`}</span>
        {}
        <span className="status-chip">{`${t("topBar.zoom")}: ${zoomPercent}%`}</span>
      </div>
      <div className="status-bar-group status-bar-group-right">
        <span
          aria-label={deviceLabel}
          className="status-bar-icon-chip"
          title={deviceLabel}
        >
          <WorkbenchIcon
            className="status-bar-icon"
            kind={getDeviceIconKind(screenProfile.deviceClass)}
          />
        </span>
        <span
          aria-label={screenShapeLabel}
          className="status-bar-icon-chip"
          title={screenShapeLabel}
        >
          <WorkbenchIcon
            className="status-bar-icon"
            kind={getScreenShapeIconKind(screenProfile.screenShape)}
          />
        </span>
      </div>
    </footer>
  );
});
