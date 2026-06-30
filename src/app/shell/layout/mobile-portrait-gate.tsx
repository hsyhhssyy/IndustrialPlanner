import type { AppHost } from "@/app/host/app-host";
import { requestDocumentFullscreen } from "@/app/shell/layout/fullscreen-toggle-button";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppLocale } from "@/domain/app";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const MOBILE_PORTRAIT_GATE_COPY: Record<AppLocale, {
  readonly ariaLabel: string;
  readonly title: string;
  readonly description: string;
  readonly fullscreenHint: string;
}> = {
  "zh-CN": {
    ariaLabel: "手机竖屏使用提示",
    title: "请旋转手机横屏使用",
    description: "横屏能给画布、工具栏和两侧面板留出更完整的操作空间。",
    fullscreenHint: "建议进入全屏，减少浏览器地址栏和系统控件遮挡。",
  },
  "en-US": {
    ariaLabel: "Phone portrait usage notice",
    title: "Rotate your phone to landscape",
    description: "Landscape gives the canvas, tools, and side panels enough room to work.",
    fullscreenHint: "Fullscreen is recommended to reduce browser and system chrome.",
  },
};

export function MobilePortraitGate({ appHost }: { appHost: AppHost }) {
  const copy = MOBILE_PORTRAIT_GATE_COPY[appHost.state.settings.locale];
  const fullscreenLabel = appHost.actions.translate("action.enterFullscreen");
  const handleFullscreenClick = () => {
    requestDocumentFullscreen();
  };

  return (
    <OverlayStackLayer kind="system" layerId="mobile-portrait-gate" visible>
      {({ zIndex }) => (
        <section
          aria-label={copy.ariaLabel}
          aria-modal="true"
          className={cm(styles, "mobile-portrait-gate")}
          role="dialog"
          style={{ zIndex }}
        >
          <div className={cm(styles, "mobile-portrait-gate-panel")}>
            <div className={cm(styles, "mobile-portrait-gate-motion")} aria-hidden="true">
              <span className={cm(styles, "mobile-portrait-gate-phone")}>
                <WorkbenchIcon kind="device-mobile" />
              </span>
              <span className={cm(styles, "mobile-portrait-gate-landscape")}>
                <WorkbenchIcon kind="screen-landscape" />
              </span>
            </div>
            <div className={cm(styles, "mobile-portrait-gate-copy")}>
              <h2>{copy.title}</h2>
              <p>{copy.description}</p>
              <p>{copy.fullscreenHint}</p>
            </div>
            <button
              className={cm(styles, "mobile-portrait-gate-fullscreen")}
              onClick={handleFullscreenClick}
              type="button"
            >
              <WorkbenchIcon kind="expand" />
              <span>{fullscreenLabel}</span>
            </button>
          </div>
        </section>
      )}
    </OverlayStackLayer>
  );
}
