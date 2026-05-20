import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "@/app/shell/app-shell.module.scss";

import { formatPwaBytes, type PwaController } from "./pwa-controller";

interface PwaSettingsSectionProps {
  readonly appHost: AppHost;
  readonly pwaController: PwaController;
}

export const PwaSettingsSection = observer(function PwaSettingsSection({
  appHost,
  pwaController,
}: PwaSettingsSectionProps) {
  const copy = PWA_SETTINGS_COPY[appHost.state.settings.locale];
  const progress = pwaController.progress;

  return (
    <section className={cm(styles, "settings-dialog-group-section pwa-settings-section")}>
      <div className={cm(styles, "settings-dialog-group-header")}>
        <h3>{copy.title}</h3>
        <p>{copy.description}</p>
      </div>
      <div className={cm(styles, "pwa-settings-card")}>
        <div className={cm(styles, "pwa-settings-copy")}>
          <h4>{copy.offlineMode}</h4>
          <p>{resolveOfflineStatusText(copy, pwaController)}</p>
          {progress !== null ? (
            <p>
              {copy.progress(
                progress.completedFiles,
                progress.totalFiles,
                progress.completedBytes,
                progress.totalBytes,
              )}
            </p>
          ) : null}
        </div>
        <div className={cm(styles, "pwa-settings-actions")}>
          {!pwaController.isOfflineModeAccepted ? (
            <button
              className={cm(styles, "pwa-settings-primary-button")}
              disabled={pwaController.offlineStatus === "unsupported"}
              onClick={() => {
                void pwaController.enableOfflineMode();
              }}
              type="button"
            >
              {copy.enableOffline}
            </button>
          ) : (
            <>
              <button
                className={cm(styles, "pwa-settings-secondary-button")}
                onClick={() => {
                  void pwaController.checkForUpdate();
                }}
                type="button"
              >
                {copy.checkUpdate}
              </button>
              {pwaController.offlineStatus === "update-available" ? (
                <button
                  className={cm(styles, "pwa-settings-primary-button")}
                  onClick={pwaController.applyWaitingUpdate}
                  type="button"
                >
                  {copy.applyUpdate}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className={cm(styles, "pwa-settings-card")}>
        <div className={cm(styles, "pwa-settings-copy")}>
          <h4>{copy.desktopInstall}</h4>
          <p>{resolveDesktopInstallText(copy, pwaController)}</p>
        </div>
        <div className={cm(styles, "pwa-settings-actions")}>
          {pwaController.canPromptDesktopInstall ? (
            <button
              className={cm(styles, "pwa-settings-primary-button")}
              onClick={() => {
                void pwaController.promptDesktopInstall();
              }}
              type="button"
            >
              {copy.install}
            </button>
          ) : (
            <button
              className={cm(styles, "pwa-settings-secondary-button")}
              disabled={pwaController.standalone}
              onClick={
                pwaController.desktopInstallPromptDismissed
                  ? pwaController.resetDesktopInstallPromptDismissal
                  : pwaController.dismissDesktopInstallPrompt
              }
              type="button"
            >
              {resolveDesktopInstallActionText(copy, pwaController)}
            </button>
          )}
        </div>
      </div>
    </section>
  );
});

interface PwaSettingsCopy {
  readonly allowInstallPrompt: string;
  readonly applyUpdate: string;
  readonly checkUpdate: string;
  readonly description: string;
  readonly desktopAlreadyAddedAction: string;
  readonly desktopInstall: string;
  readonly desktopRemindAgain: string;
  readonly desktopRemindLater: string;
  readonly enableOffline: string;
  readonly install: string;
  readonly offlineMode: string;
  readonly progress: (
    completedFiles: number,
    totalFiles: number,
    completedBytes: number,
    totalBytes: number,
  ) => string;
  readonly statusEnabled: string;
  readonly statusError: (message: string | null) => string;
  readonly statusInstalling: string;
  readonly statusNotEnabled: string;
  readonly statusRegistering: string;
  readonly statusUnsupported: string;
  readonly statusUpdateAvailable: string;
  readonly statusUpdating: string;
  readonly title: string;
  readonly desktopAlreadyInstalled: string;
  readonly desktopPromptAvailable: string;
  readonly desktopPromptDismissed: string;
  readonly desktopPromptUnavailable: string;
}

const PWA_SETTINGS_COPY: Record<AppHost["state"]["settings"]["locale"], PwaSettingsCopy> = {
  "zh-CN": {
    allowInstallPrompt: "重新提醒",
    applyUpdate: "应用更新",
    checkUpdate: "检查更新",
    description: "管理离线资源和桌面入口。",
    desktopAlreadyAddedAction: "已添加",
    desktopInstall: "添加到桌面",
    desktopRemindAgain: "重新提醒",
    desktopRemindLater: "稍后提醒",
    enableOffline: "启用离线模式",
    install: "添加",
    offlineMode: "离线模式",
    progress: (completedFiles, totalFiles, completedBytes, totalBytes) => {
      if (totalBytes > 0) {
        return `进度 ${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} / ${formatPwaBytes(totalBytes)}`;
      }

      return `进度 ${completedFiles}/${totalFiles} · 已下载 ${formatPwaBytes(completedBytes)}`;
    },
    statusEnabled: "离线资源已就绪。",
    statusError: (message) => `处理失败：${message ?? "未知错误"}`,
    statusInstalling: "正在下载离线资源。",
    statusNotEnabled: "当前未启用。启用后会下载完整离线资源。",
    statusRegistering: "正在准备离线模式。",
    statusUnsupported: "当前浏览器不支持 Service Worker。",
    statusUpdateAvailable: "新版本离线资源已准备好。",
    statusUpdating: "正在更新离线资源。",
    title: "离线与安装",
    desktopAlreadyInstalled: "已经添加到桌面。",
    desktopPromptAvailable: "现在可以添加到桌面。",
    desktopPromptDismissed: "已选择稍后提醒。请先使用网页一段时间，稍后再试。",
    desktopPromptUnavailable: "暂时不可添加。请先使用网页一段时间，稍后再试。",
  },
  "en-US": {
    allowInstallPrompt: "Remind Again",
    applyUpdate: "Apply Update",
    checkUpdate: "Check Update",
    description: "Manage offline resources and desktop access.",
    desktopAlreadyAddedAction: "Added",
    desktopInstall: "Add to Desktop",
    desktopRemindAgain: "Remind Again",
    desktopRemindLater: "Remind Later",
    enableOffline: "Enable Offline Mode",
    install: "Add",
    offlineMode: "Offline Mode",
    progress: (completedFiles, totalFiles, completedBytes, totalBytes) => {
      if (totalBytes > 0) {
        return `Progress ${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} / ${formatPwaBytes(totalBytes)}`;
      }

      return `Progress ${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} downloaded`;
    },
    statusEnabled: "Offline resources are ready.",
    statusError: (message) => `Failed: ${message ?? "Unknown error"}`,
    statusInstalling: "Downloading offline resources.",
    statusNotEnabled: "Offline mode is not enabled. Enabling it downloads all offline resources.",
    statusRegistering: "Preparing offline mode.",
    statusUnsupported: "This browser does not support Service Worker.",
    statusUpdateAvailable: "New offline resources are ready.",
    statusUpdating: "Updating offline resources.",
    title: "Offline & Install",
    desktopAlreadyInstalled: "Already added to desktop.",
    desktopPromptAvailable: "You can add it to desktop now.",
    desktopPromptDismissed: "You chose to be reminded later. Use this page for a while and try again.",
    desktopPromptUnavailable: "Not available yet. Use this page for a while and try again later.",
  },
};

function resolveOfflineStatusText(copy: PwaSettingsCopy, pwaController: PwaController): string {
  if (pwaController.offlineStatus === "unsupported") {
    return copy.statusUnsupported;
  }

  if (pwaController.offlineStatus === "registering") {
    return copy.statusRegistering;
  }

  if (pwaController.offlineStatus === "installing") {
    return copy.statusInstalling;
  }

  if (pwaController.offlineStatus === "enabled") {
    return copy.statusEnabled;
  }

  if (pwaController.offlineStatus === "update-available") {
    return copy.statusUpdateAvailable;
  }

  if (pwaController.offlineStatus === "updating") {
    return copy.statusUpdating;
  }

  if (pwaController.offlineStatus === "error") {
    return copy.statusError(pwaController.errorMessage);
  }

  return copy.statusNotEnabled;
}

function resolveDesktopInstallText(copy: PwaSettingsCopy, pwaController: PwaController): string {
  if (pwaController.standalone) {
    return copy.desktopAlreadyInstalled;
  }

  if (pwaController.canPromptDesktopInstall) {
    return copy.desktopPromptAvailable;
  }

  if (pwaController.desktopInstallPromptDismissed) {
    return copy.desktopPromptDismissed;
  }

  return copy.desktopPromptUnavailable;
}

function resolveDesktopInstallActionText(copy: PwaSettingsCopy, pwaController: PwaController): string {
  if (pwaController.standalone) {
    return copy.desktopAlreadyAddedAction;
  }

  if (pwaController.desktopInstallPromptDismissed) {
    return copy.desktopRemindAgain;
  }

  return copy.desktopRemindLater;
}
