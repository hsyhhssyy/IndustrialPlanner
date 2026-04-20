import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import type { AppHost } from "@/app/app-host";
import {
  type DeviceClass,
  resolveScreenProfileFromWindow,
  type ScreenShape,
} from "@/shared/browser/screen-profile";
import { useEffect, useState } from "react";

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

function resolveFullscreenState(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.fullscreenElement !== null;
}

export function TopBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const [isFullscreen, setIsFullscreen] = useState(resolveFullscreenState);
  const [screenProfile, setScreenProfile] = useState(resolveScreenProfileFromWindow);
  const {
    workbench: { leftDockOpen, rightDockOpen },
    settings,
  } = appHost.state;

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(resolveFullscreenState());
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setScreenProfile(resolveScreenProfileFromWindow());
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const toggleLeftDock = () => {
    appHost.internalActions.toggleLeftDock();
  };
  const toggleRightDock = () => {
    appHost.internalActions.toggleRightDock();
  };
  const toggleFullscreen = () => {
    if (typeof document === "undefined") {
      return;
    }

    if (document.fullscreenElement !== null) {
      void document.exitFullscreen?.();
      return;
    }

    void document.documentElement.requestFullscreen?.();
  };
  const leftPanelLabel = `${t(leftDockOpen ? "action.close" : "action.open")} ${t("topBar.leftPanel")}`;
  const rightPanelLabel = `${t(rightDockOpen ? "action.close" : "action.open")} ${t("topBar.rightPanel")}`;
  const fullscreenLabel = t(isFullscreen ? "action.exitFullscreen" : "action.enterFullscreen");
  const deviceLabel = t(getDeviceLabelKey(screenProfile.deviceClass));
  const screenShapeLabel = t(getScreenShapeLabelKey(screenProfile.screenShape));

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
            <WorkbenchIcon kind="panel-left" />
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
            <WorkbenchIcon kind="panel-right" />
          </span>
          <span className="sr-only">{rightPanelLabel}</span>
        </button>
        <button
          aria-label={fullscreenLabel}
          aria-pressed={isFullscreen}
          className={isFullscreen ? "is-active" : undefined}
          onClick={toggleFullscreen}
          title={fullscreenLabel}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="fullscreen" />
          </span>
          <span className="sr-only">{fullscreenLabel}</span>
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{t("app.title")}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <span className="top-bar-metric">
          {`${t("topBar.language")}: ${t(getLocaleLabelKey(settings.locale))}`}
        </span>
        <span className="top-bar-metric">{`${t("topBar.device")}: ${deviceLabel}`}</span>
        <span className="top-bar-metric">{`${t("topBar.screen")}: ${screenShapeLabel}`}</span>
      </div>
    </header>
  );
}
