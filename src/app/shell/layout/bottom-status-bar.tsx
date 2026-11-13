import type { AppHost } from "@/app/host/app-host";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { UiKey } from "@/shared/i18n";
import { resolveHostingSite } from "@/shared/browser/hosting-site";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  type DeviceClass,
  type ScreenShape,
} from "@/domain/app/types/screen-profile";
import { observer } from "mobx-react-lite";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function StatusBarNotice({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 8, maxHeight: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(440, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)),
        bottom: window.innerHeight - anchor.top + 6,
        maxHeight: Math.max(0, anchor.top - 14),
      });
    };
    updatePosition();
    panelRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && !buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [open]);

  return <>
    <button
      type="button"
      className={cm(styles, "status-bar-notice-button")}
      ref={buttonRef}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={() => setOpen((current) => !current)}
    >
      {label}
    </button>
    {open ? createPortal(
      // 含可点击链接，使用非模态 dialog 语义；Portal 避免底栏 overflow 裁剪。
      <div
        id={id}
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={cm(styles, "status-bar-notice-popover")}
        style={position}
      >
        {children}
      </div>,
      document.body,
    ) : null}
  </>;
}

export const BottomStatusBar = observer(function BottomStatusBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const { screenProfile } = appHost.state;
  const centerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const activeTool = appHost.mainCanvas.state.activeTool;
  const deviceLabel = t(getDeviceLabelKey(screenProfile.deviceClass));
  const screenShapeLabel = t(getScreenShapeLabelKey(screenProfile.screenShape));
  const hostingSite = resolveHostingSite(typeof window === "undefined" ? "" : window.location.hostname);
  const hostingLabel = t(`statusBar.hosting.${hostingSite}`);
  const zoomPercent = Math.round(
    (appHost.mainCanvas.view.state.gridSize ?? 1) * 100,
  );

  useLayoutEffect(() => {
    const center = centerRef.current;
    const content = contentRef.current;
    if (!center || !content) return;
    // 保留完整内容的固有宽度用于测量，折叠后也能恢复；不依赖设备分类或固定断点。
    const measure = () => setCompact(content.getBoundingClientRect().width > center.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(center);
    observer.observe(content);
    return () => observer.disconnect();
  }, [t, screenProfile, activeTool, zoomPercent]);

  // 原有内容同时用于完整底栏与展开浮层，避免两份版权文案或链接发生漂移。
  const legalContent = <>
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
  </>;

  return (
    <footer className={cm(styles, "status-bar")}>
      <div className={cm(styles, "status-bar-group status-bar-group-left")}>
        <span className={cm(styles, "status-chip status-chip-primary")}>{`${t("statusBar.tool")}: ${t(getActiveToolLabelKey(activeTool))}`}</span>
        {}
        <span className={cm(styles, "status-chip")}>{`${t("topBar.zoom")}: ${zoomPercent}%`}</span>
      </div>
      <div ref={centerRef} className={cm(styles, "status-bar-group status-bar-group-center")}>
        <div
          ref={contentRef}
          className={cm(styles, "status-bar-legal-full", compact && "is-measuring")}
          aria-hidden={compact || undefined}
          inert={compact}
        >
          {legalContent}
        </div>
        {compact ? <>
          <a className={cm(styles, "status-chip")} href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
            {t("statusBar.icpFiling")}
          </a>
          <StatusBarNotice label={t("statusBar.unofficialNotice")}>
            {legalContent}
          </StatusBarNotice>
        </> : null}
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
        <span
          aria-label={hostingLabel}
          className={cm(styles, "status-bar-icon-chip")}
          title={hostingLabel}
        >
          <WorkbenchIcon
            className={cm(styles, "status-bar-icon")}
            kind={`hosting-${hostingSite}`}
          />
        </span>
      </div>
    </footer>
  );
});
