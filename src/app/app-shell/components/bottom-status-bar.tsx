import type { AppHost } from "@/app/app-host";
import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
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

export function BottomStatusBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const [screenProfile, setScreenProfile] = useState(resolveScreenProfileFromWindow);
  const {
    workbench: { leftDockOpen, rightDockOpen },
    settings,
  } = appHost.state;
  const visibleViews = [
    leftDockOpen ? t("view.library") : null,
    rightDockOpen ? t("view.inspector") : null,
  ].filter((value): value is string => value !== null);
  const visibleViewLabel = visibleViews.length > 0
    ? visibleViews.join(" / ")
    : t("statusBar.none");
  const deviceLabel = t(getDeviceLabelKey(screenProfile.deviceClass));
  const screenShapeLabel = t(getScreenShapeLabelKey(screenProfile.screenShape));

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

  return (
    <footer className="status-bar">
      <div className="status-bar-group status-bar-group-left">
        <span className="status-chip status-chip-primary">{t("status.ready")}</span>
        <span className="status-bar-copyright">{t("statusBar.copyright")}</span>
        <span className="status-chip">
          {`${t("statusBar.locale")}: ${t(getLocaleLabelKey(settings.locale))}`}
        </span>
        <span className="status-chip">{`${t("statusBar.view")}: ${visibleViewLabel}`}</span>
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
}
