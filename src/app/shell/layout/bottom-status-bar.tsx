import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  type DeviceClass,
  type ScreenShape,
} from "@/domain/app/types/screen-profile";
import { observer } from "mobx-react-lite";

/*
AI-REMOVED 2026-05-09:
Reason: 用户要求从 bottom bar 去掉“语言”提示，当前组件不再显示 locale 标签。
Trigger: 底部提示精简需求。
Evidence: 用户在本次会话中明确要求“语言去掉”。
Replacement: None
Risk: Low
Human Review: Required

Original code:
function getLocaleLabelKey(locale: AppHost["state"]["settings"]["locale"]): string {
  return locale === "en-US" ? "locale.en-US" : "locale.zh-CN";
}
*/

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
  /*
  AI-REMOVED 2026-05-09:
  Reason: 用户要求从 bottom bar 去掉“语言”“当前视图”提示，组件不再推导 dock 可见视图和 locale 文案。
  Trigger: 底部提示精简需求。
  Evidence: 用户在本次会话中明确要求“语言去掉 当前视图去掉”。
  Replacement: 同组件中的 zoomPercent 百分比显示。
  Risk: Low
  Human Review: Required

  Original code:
  const {
    screenProfile,
    workbench: { leftDockOpen, rightDockOpen },
    settings,
  } = appHost.state;
  const showRightDock = settings.gameUseInspectorPanel && rightDockOpen;
  const visibleViews = [
    leftDockOpen ? t("view.library") : null,
    showRightDock ? t("view.inspector") : null,
  ].filter((value): value is string => value !== null);
  const visibleViewLabel = visibleViews.length > 0
    ? visibleViews.join(" / ")
    : t("statusBar.none");
  */
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
        {/*
          AI-REMOVED 2026-05-09:
          Reason: 用户要求从 bottom bar 去掉“集成工业仿真”“语言”“当前视图”提示，只保留更直接的状态信息。
          Trigger: 底部提示精简需求。
          Evidence: 用户在本次会话中明确要求“集成工业仿真 去掉 语言去掉 当前视图去掉”。
          Replacement: 同组件中的缩放状态 chip。
          Risk: Low
          Human Review: Required

          Original code:
          <span className="status-bar-copyright">{t("statusBar.copyright")}</span>
          <span className="status-chip">
            {`${t("statusBar.locale")}: ${t(getLocaleLabelKey(settings.locale))}`}
          </span>
          <span className="status-chip">{`${t("statusBar.view")}: ${visibleViewLabel}`}</span>
        */}
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
