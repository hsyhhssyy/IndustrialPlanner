import { useEffect, useRef, type RefObject } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { cm } from "@/app/shell/shared/css-module-class";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import styles from "@/app/shell/app-shell.module.scss";

import {
  formatPwaBytes,
  type PwaController,
  type PwaFullscreenNotice,
  type PwaProgress,
} from "./pwa-controller";

const PRECACHE_CACHE_NAME_PREFIX = "industrial-planner-precache-";

interface PwaGatewayProps {
  readonly appHost: AppHost;
  readonly pwaController: PwaController;
}

export const PwaGateway = observer(function PwaGateway({
  appHost,
  pwaController,
}: PwaGatewayProps) {
  const copy = PWA_GATEWAY_COPY[appHost.state.settings.locale];
  const fullscreenNoticeCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenNoticeTriggerRef = useRef<HTMLElement | null>(null);
  const previousFullscreenNoticeRef = useRef<PwaFullscreenNotice | null>(null);

  useEffect(() => {
    pwaController.initialize();

    return () => {
      pwaController.dispose();
    };
  }, [pwaController]);

  useEffect(() => {
    const previousNotice = previousFullscreenNoticeRef.current;
    const currentNotice = pwaController.fullscreenNotice;

    if (previousNotice === null && currentNotice !== null) {
      fullscreenNoticeTriggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      fullscreenNoticeCloseButtonRef.current?.focus();
    }

    if (previousNotice !== null && currentNotice === null) {
      fullscreenNoticeTriggerRef.current?.focus();
      fullscreenNoticeTriggerRef.current = null;
    }

    previousFullscreenNoticeRef.current = currentNotice;
  }, [pwaController.fullscreenNotice]);

  // AI-REMOVED 2026-08-23:
  // Reason: 离线能力不受支持时仍需承载由用户点击触发的全屏失败/PWA 引导。
  // Trigger: iPhone Safari 不提供页面 Fullscreen API，开发环境也会把 offlineStatus 标记为 unsupported。
  // Evidence: 原提前返回会让 fullscreenNotice 已更新但没有任何 UI 渲染。
  // Replacement: 下方各离线 UI 继续按自身状态条件渲染，fullscreenNotice 独立渲染。
  // Risk: Low；unsupported 状态下原有离线提示条件均为 false。
  // Human Review: Required
  //
  // Original code:
  // if (pwaController.offlineStatus === "unsupported") {
  //   return null;
  // }

  const pwaProgress = pwaController.progress;
  const pwaStatus = pwaController.offlineStatus;
  const shouldShowProgress = pwaProgress !== null && (
    pwaStatus === "installing"
    || pwaStatus === "updating"
    || pwaStatus === "registering"
  );

  return (
    <>
      {pwaController.shouldShowOfflinePrompt ? (
        <OverlayStackLayer kind="system" layerId="pwa:offline-prompt" visible>
          {({ zIndex }) => (
            <div className={cm(styles, "pwa-gateway-backdrop")} role="presentation" style={{ zIndex }}>
              <section
                aria-labelledby="pwa-gateway-title"
                className={cm(styles, "pwa-gateway-card")}
                role="dialog"
              >
                <h2 id="pwa-gateway-title">{copy.offlineTitle}</h2>
                <p>{copy.offlineBody}</p>
                <div className={cm(styles, "pwa-gateway-actions")}>
                  <button
                    className={cm(styles, "pwa-gateway-primary-button")}
                    onClick={() => {
                      void pwaController.enableOfflineMode();
                    }}
                    type="button"
                  >
                    {copy.enableOffline}
                  </button>
                  <button
                    className={cm(styles, "pwa-gateway-secondary-button")}
                    onClick={pwaController.declineOfflineMode}
                    type="button"
                  >
                    {copy.notNow}
                  </button>
                </div>
              </section>
            </div>
          )}
        </OverlayStackLayer>
      ) : null}
      {shouldShowProgress ? (
        <OverlayStackLayer kind="system" layerId={`pwa:${pwaStatus}-progress`} visible>
          {({ zIndex }) => (
            <ProgressToast
              copy={copy}
              progress={pwaProgress}
              title={pwaStatus === "updating" ? copy.updateProgress : copy.installProgress}
              zIndex={zIndex}
            />
          )}
        </OverlayStackLayer>
      ) : null}
      {pwaController.offlineStatus === "update-available" ? (
        <OverlayStackLayer kind="system" layerId="pwa:update-available" visible>
          {({ zIndex }) => (
            <section className={cm(styles, "pwa-gateway-toast")} role="status" style={{ zIndex }}>
              <div className={cm(styles, "pwa-gateway-toast-copy")}>
                <strong>{copy.updateReadyTitle}</strong>
                <span>{copy.updateReadyBody}</span>
              </div>
              <button
                className={cm(styles, "pwa-gateway-primary-button")}
                onClick={pwaController.applyWaitingUpdate}
                type="button"
              >
                {copy.applyUpdate}
              </button>
            </section>
          )}
        </OverlayStackLayer>
      ) : null}
      {pwaController.canPromptDesktopInstall ? (
        <OverlayStackLayer kind="system" layerId="pwa:desktop-install" visible>
          {({ zIndex }) => (
            <section
              aria-labelledby="pwa-install-title"
              className={cm(styles, "pwa-gateway-card pwa-install-card")}
              role="dialog"
              style={{ zIndex }}
            >
              <h2 id="pwa-install-title">{copy.desktopInstallTitle}</h2>
              <p>{copy.desktopInstallBody}</p>
              <div className={cm(styles, "pwa-gateway-actions")}>
                <button
                  className={cm(styles, "pwa-gateway-primary-button")}
                  onClick={() => {
                    void pwaController.promptDesktopInstall();
                  }}
                  type="button"
                >
                  {copy.installDesktop}
                </button>
                <button
                  className={cm(styles, "pwa-gateway-secondary-button")}
                  onClick={pwaController.dismissDesktopInstallPrompt}
                  type="button"
                >
                  {copy.later}
                </button>
              </div>
            </section>
          )}
        </OverlayStackLayer>
      ) : null}
      {pwaController.offlineStatus === "error" && pwaController.errorMessage !== null ? (
        <OverlayStackLayer kind="system" layerId="pwa:error" visible>
          {({ zIndex }) => (
            <section className={cm(styles, "pwa-gateway-toast pwa-gateway-toast-error")} role="alert" style={{ zIndex }}>
              <div className={cm(styles, "pwa-gateway-toast-copy")}>
                <strong>{copy.errorTitle}</strong>
                <span>{pwaController.errorMessage}</span>
              </div>
              <button
                className={cm(styles, "pwa-gateway-primary-button")}
                onClick={() => {
                  void pwaController.enableOfflineMode();
                }}
                type="button"
              >
                {copy.retry}
              </button>
            </section>
          )}
        </OverlayStackLayer>
      ) : null}
      {pwaController.fullscreenNotice !== null ? (
        <FullscreenNotice
          closeButtonRef={fullscreenNoticeCloseButtonRef}
          copy={copy}
          notice={pwaController.fullscreenNotice}
          onClose={pwaController.closeFullscreenNotice}
        />
      ) : null}
    </>
  );
});

function FullscreenNotice({
  closeButtonRef,
  copy,
  notice,
  onClose,
}: {
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>;
  readonly copy: PwaGatewayCopy;
  readonly notice: PwaFullscreenNotice;
  readonly onClose: () => void;
}) {
  const content = resolveFullscreenNoticeContent(copy, notice);

  return (
    <OverlayStackLayer kind="system" layerId="pwa:fullscreen-notice" visible>
      {({ zIndex }) => (
        <div className={cm(styles, "pwa-gateway-backdrop")} role="presentation" style={{ zIndex }}>
          <section
            aria-labelledby="pwa-fullscreen-notice-title"
            aria-modal="true"
            className={cm(styles, "pwa-gateway-card pwa-fullscreen-notice-card")}
            role="dialog"
          >
            <h2 id="pwa-fullscreen-notice-title">{content.title}</h2>
            <p>{content.body}</p>
            {content.steps === null ? null : (
              <ol className={cm(styles, "pwa-fullscreen-notice-steps")}>
                {content.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            )}
            <div className={cm(styles, "pwa-gateway-actions")}>
              <button
                className={cm(styles, "pwa-gateway-primary-button")}
                onClick={onClose}
                ref={closeButtonRef}
                type="button"
              >
                {copy.fullscreenNoticeAcknowledge}
              </button>
            </div>
          </section>
        </div>
      )}
    </OverlayStackLayer>
  );
}

function resolveFullscreenNoticeContent(
  copy: PwaGatewayCopy,
  notice: PwaFullscreenNotice,
): {
  readonly body: string;
  readonly steps: readonly string[] | null;
  readonly title: string;
} {
  if (notice === "apple-mobile-install") {
    return {
      body: copy.fullscreenAppleInstallBody,
      steps: copy.fullscreenAppleInstallSteps,
      title: copy.fullscreenAppleInstallTitle,
    };
  }

  if (notice === "request-rejected") {
    return {
      body: copy.fullscreenRejectedBody,
      steps: null,
      title: copy.fullscreenRejectedTitle,
    };
  }

  return {
    body: copy.fullscreenUnsupportedBody,
    steps: null,
    title: copy.fullscreenUnsupportedTitle,
  };
}

function ProgressToast({
  copy,
  progress,
  title,
  zIndex,
}: {
  readonly copy: PwaGatewayCopy;
  readonly progress: PwaProgress;
  readonly title: string;
  readonly zIndex: number;
}) {
  const percent = resolveProgressPercent(progress);
  const updaterVersion = resolveUpdaterVersion(progress.cacheName);

  return (
    <section className={cm(styles, "pwa-gateway-toast")} role="status" style={{ zIndex }}>
      <div className={cm(styles, "pwa-gateway-toast-copy")}>
        <strong>{title}</strong>
        <span>
          {copy.progressSummary(
            progress.completedFiles,
            progress.totalFiles,
            progress.completedBytes,
            progress.totalBytes,
          )}
        </span>
      </div>
      <div className={cm(styles, "pwa-progress-row")}>
        <span className={cm(styles, "pwa-progress-version")}>{copy.updaterVersion(updaterVersion)}</span>
        <div
          aria-label={copy.progressAria(percent)}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          className={cm(styles, "pwa-progress")}
          role="progressbar"
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </section>
  );
}

function resolveProgressPercent(progress: PwaProgress): number {
  if (progress.totalBytes > 0) {
    return Math.round((progress.completedBytes / progress.totalBytes) * 100);
  }

  if (progress.totalFiles > 0) {
    return Math.round((progress.completedFiles / progress.totalFiles) * 100);
  }

  return 0;
}

function resolveUpdaterVersion(cacheName: string): string {
  if (cacheName.startsWith(PRECACHE_CACHE_NAME_PREFIX)) {
    return cacheName.slice(PRECACHE_CACHE_NAME_PREFIX.length);
  }

  return cacheName;
}

interface PwaGatewayCopy {
  readonly applyUpdate: string;
  readonly desktopInstallBody: string;
  readonly desktopInstallTitle: string;
  readonly enableOffline: string;
  readonly errorTitle: string;
  readonly fullscreenAppleInstallBody: string;
  readonly fullscreenAppleInstallSteps: readonly string[];
  readonly fullscreenAppleInstallTitle: string;
  readonly fullscreenNoticeAcknowledge: string;
  readonly fullscreenRejectedBody: string;
  readonly fullscreenRejectedTitle: string;
  readonly fullscreenUnsupportedBody: string;
  readonly fullscreenUnsupportedTitle: string;
  readonly installDesktop: string;
  readonly installProgress: string;
  readonly later: string;
  readonly notNow: string;
  readonly offlineBody: string;
  readonly offlineTitle: string;
  readonly progressAria: (percent: number) => string;
  readonly progressSummary: (
    completedFiles: number,
    totalFiles: number,
    completedBytes: number,
    totalBytes: number,
  ) => string;
  readonly retry: string;
  readonly updateProgress: string;
  readonly updateReadyBody: string;
  readonly updateReadyTitle: string;
  readonly updaterVersion: (version: string) => string;
}

const PWA_GATEWAY_COPY: Record<AppHost["state"]["settings"]["locale"], PwaGatewayCopy> = {
  "zh-CN": {
    applyUpdate: "更新",
    desktopInstallBody: "可以把应用安装为独立窗口，之后从桌面或启动器直接打开。",
    desktopInstallTitle: "安装到桌面",
    enableOffline: "启用离线模式",
    errorTitle: "离线模式处理失败",
    fullscreenAppleInstallBody: "iPhone 浏览器不支持网页直接全屏。本站支持 Web App 模式，可隐藏浏览器地址栏。如果已经添加到主屏幕，请从主屏幕图标打开；如果尚未添加，请按以下步骤操作。",
    fullscreenAppleInstallSteps: [
      "打开浏览器的分享菜单。",
      "选择“添加到主屏幕”。",
      "开启“作为 Web App 打开”，然后点击“添加”。",
    ],
    fullscreenAppleInstallTitle: "无法直接进入全屏",
    fullscreenNoticeAcknowledge: "我知道了",
    fullscreenRejectedBody: "浏览器未完成全屏操作。请尝试在系统浏览器中直接打开本站后重试。",
    fullscreenRejectedTitle: "未能切换全屏",
    fullscreenUnsupportedBody: "当前浏览器不支持网页全屏。请尝试使用支持全屏的浏览器。",
    fullscreenUnsupportedTitle: "无法进入全屏",
    installDesktop: "安装",
    installProgress: "正在下载离线资源",
    later: "以后再说",
    notNow: "暂不",
    offlineBody: "离线模式会一次性下载应用资源，完成后无网络也能打开和使用。",
    offlineTitle: "启用离线模式",
    progressAria: (percent) => `当前进度 ${percent}%`,
    progressSummary: (completedFiles, totalFiles, completedBytes, totalBytes) => {
      if (totalBytes > 0) {
        return `${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} / ${formatPwaBytes(totalBytes)}`;
      }

      return `${completedFiles}/${totalFiles} · 已下载 ${formatPwaBytes(completedBytes)}`;
    },
    retry: "重试",
    updateProgress: "正在更新离线资源",
    updateReadyBody: "离线资源已更新完成，刷新后切换到新版本。",
    updateReadyTitle: "新版本可用",
    updaterVersion: (version) => `更新器版本: ${version}`,
  },
  "en-US": {
    applyUpdate: "Update",
    desktopInstallBody: "Install the app as a standalone window and open it from your launcher.",
    desktopInstallTitle: "Install App",
    enableOffline: "Enable Offline Mode",
    errorTitle: "Offline setup failed",
    fullscreenAppleInstallBody: "iPhone browsers cannot make a web page fullscreen directly. This site supports Web App mode, which removes the browser address bar. If it is already on your Home Screen, open it from that icon. Otherwise, follow these steps.",
    fullscreenAppleInstallSteps: [
      "Open the browser Share menu.",
      "Choose Add to Home Screen.",
      "Enable Open as Web App, then tap Add.",
    ],
    fullscreenAppleInstallTitle: "Fullscreen is unavailable",
    fullscreenNoticeAcknowledge: "Got it",
    fullscreenRejectedBody: "The browser did not complete the fullscreen action. Open this site directly in the system browser and try again.",
    fullscreenRejectedTitle: "Could not switch fullscreen",
    fullscreenUnsupportedBody: "This browser does not support web page fullscreen. Try a browser that supports fullscreen.",
    fullscreenUnsupportedTitle: "Fullscreen is unavailable",
    installDesktop: "Install",
    installProgress: "Downloading offline resources",
    later: "Later",
    notNow: "Not Now",
    offlineBody: "Offline mode downloads app resources once so the app can open without network access.",
    offlineTitle: "Enable Offline Mode",
    progressAria: (percent) => `Current progress ${percent}%`,
    progressSummary: (completedFiles, totalFiles, completedBytes, totalBytes) => {
      if (totalBytes > 0) {
        return `${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} / ${formatPwaBytes(totalBytes)}`;
      }

      return `${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} downloaded`;
    },
    retry: "Retry",
    updateProgress: "Updating offline resources",
    updateReadyBody: "Offline resources are ready. Reload to switch to the new version.",
    updateReadyTitle: "New Version Available",
    updaterVersion: (version) => `Updater version: ${version}`,
  },
};
