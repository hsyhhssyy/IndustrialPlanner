import { useEffect } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { cm } from "@/app/shell/shared/css-module-class";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import styles from "@/app/shell/app-shell.module.scss";

import { formatPwaBytes, type PwaController, type PwaProgress } from "./pwa-controller";

interface PwaGatewayProps {
  readonly appHost: AppHost;
  readonly pwaController: PwaController;
}

export const PwaGateway = observer(function PwaGateway({
  appHost,
  pwaController,
}: PwaGatewayProps) {
  const copy = PWA_GATEWAY_COPY[appHost.state.settings.locale];

  useEffect(() => {
    pwaController.initialize();

    return () => {
      pwaController.dispose();
    };
  }, [pwaController]);

  if (pwaController.offlineStatus === "unsupported") {
    return null;
  }

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
    </>
  );
});

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

interface PwaGatewayCopy {
  readonly applyUpdate: string;
  readonly desktopInstallBody: string;
  readonly desktopInstallTitle: string;
  readonly enableOffline: string;
  readonly errorTitle: string;
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
}

const PWA_GATEWAY_COPY: Record<AppHost["state"]["settings"]["locale"], PwaGatewayCopy> = {
  "zh-CN": {
    applyUpdate: "更新",
    desktopInstallBody: "可以把应用安装为独立窗口，之后从桌面或启动器直接打开。",
    desktopInstallTitle: "安装到桌面",
    enableOffline: "启用离线模式",
    errorTitle: "离线模式处理失败",
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
  },
  "en-US": {
    applyUpdate: "Update",
    desktopInstallBody: "Install the app as a standalone window and open it from your launcher.",
    desktopInstallTitle: "Install App",
    enableOffline: "Enable Offline Mode",
    errorTitle: "Offline setup failed",
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
  },
};
