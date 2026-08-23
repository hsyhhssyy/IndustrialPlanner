import type { AppHost } from "@/app/host/app-host";
import {
  FullscreenToggleButton,
  resolveFullscreenSupport,
} from "@/app/shell/layout/fullscreen-toggle-button";
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
  readonly standaloneHint: string;
}> = {
  "zh-CN": {
    ariaLabel: "手机竖屏使用提示",
    title: "请旋转手机横屏使用",
    description: "横屏能给画布、工具栏和两侧面板留出更完整的操作空间。",
    fullscreenHint: "建议进入全屏，减少浏览器地址栏和系统控件遮挡。",
    standaloneHint: "当前已在独立应用模式中，请旋转手机横屏使用。",
  },
  "en-US": {
    ariaLabel: "Phone portrait usage notice",
    title: "Rotate your phone to landscape",
    description: "Landscape gives the canvas, tools, and side panels enough room to work.",
    fullscreenHint: "Fullscreen is recommended to reduce browser and system chrome.",
    standaloneHint: "The app is already running in standalone mode. Rotate your phone to landscape.",
  },
};

export function MobilePortraitGate({
  appHost,
  isStandalone = false,
  onFullscreenActionFailure,
}: {
  appHost: AppHost;
  isStandalone?: boolean;
  onFullscreenActionFailure?: (reason: "rejected" | "unsupported") => void;
}) {
  const copy = MOBILE_PORTRAIT_GATE_COPY[appHost.state.settings.locale];
  const hideFullscreenButton = isStandalone && !resolveFullscreenSupport();
  // AI-REMOVED 2026-08-23:
  // Reason: Gate 不再直接调用全屏 API，统一组件必须区分不支持、拒绝和 standalone。
  // Trigger: 用户要求 iPhone 点击全屏时展示 PWA 引导，并在不支持全屏的独立模式中隐藏按钮。
  // Evidence: 直接调用 requestDocumentFullscreen 无法把失败原因传递给 PwaGateway。
  // Replacement: 下方 FullscreenToggleButton。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const fullscreenLabel = appHost.actions.translate("action.enterFullscreen");
  // const handleFullscreenClick = () => {
  //   requestDocumentFullscreen();
  // };

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
              <p>{hideFullscreenButton ? copy.standaloneHint : copy.fullscreenHint}</p>
            </div>
            {/*
              AI-REMOVED 2026-08-23:
              Reason: 竖屏 Gate 改为复用统一全屏能力检测和失败引导，避免 iPhone 继续调用不存在的 API。
              Trigger: 用户反馈 iPhone 点击全屏无响应，并确认仅在点击时展示 PWA 引导。
              Evidence: FullscreenToggleButton 已统一处理 standard/webkit API、standalone 和失败回调。
              Replacement: 下方 FullscreenToggleButton。
              Risk: Low；按钮视觉与文案仍由原 Gate 样式和翻译提供。
              Human Review: Required

              Original code:
              <button
              className={cm(styles, "mobile-portrait-gate-fullscreen")}
              onClick={handleFullscreenClick}
              type="button"
            >
              <WorkbenchIcon kind="expand" />
              <span>{fullscreenLabel}</span>
              </button>
            */}
            <FullscreenToggleButton
              appHost={appHost}
              className={cm(styles, "mobile-portrait-gate-fullscreen")}
              isStandalone={isStandalone}
              onFullscreenActionFailure={onFullscreenActionFailure}
              showLabel
            />
          </div>
        </section>
      )}
    </OverlayStackLayer>
  );
}
