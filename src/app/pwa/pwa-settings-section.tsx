import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "@/app/shell/app-shell.module.scss";

import { formatPwaBytes, type PwaController } from "./pwa-controller";

interface PwaSettingsSectionProps {
  readonly appHost: AppHost;
  readonly pwaController: PwaController;
  readonly hideHeader?: boolean;
}

export const PwaSettingsSection = observer(function PwaSettingsSection({
  appHost,
  pwaController,
  hideHeader = false,
}: PwaSettingsSectionProps) {
  const copy = PWA_SETTINGS_COPY[appHost.state.settings.locale];
  const offlineAction = resolveOfflineAction(copy, pwaController);
  const progress = pwaController.progress;

  return (
    <section className={cm(styles, "settings-dialog-group-section pwa-settings-section")}>
      {hideHeader ? null : (
        <div className={cm(styles, "settings-dialog-group-header")}>
          <h3>{copy.title}</h3>
          <p>{copy.description}</p>
        </div>
      )}
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
          <button
            className={cm(
              styles,
              offlineAction.primary ? "pwa-settings-primary-button" : "pwa-settings-secondary-button",
            )}
            disabled={offlineAction.disabled}
            onClick={offlineAction.onClick}
            type="button"
          >
            {offlineAction.label}
          </button>
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
  readonly offlineSavingAction: string;
  readonly offlinePreparingAction: string;
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
  readonly offlineRetry: string;
  readonly offlineUnableAction: string;
  readonly offlineUpdatingAction: string;
  readonly title: string;
  readonly desktopAlreadyInstalled: string;
  readonly desktopPromptAvailable: string;
  readonly desktopPromptDismissed: string;
  readonly desktopPromptUnavailable: string;
}

const PWA_SETTINGS_COPY: Record<AppHost["state"]["settings"]["locale"], PwaSettingsCopy> = {
  "zh-CN": {
    allowInstallPrompt: "重新提醒",
    applyUpdate: "立即更新",
    checkUpdate: "检查更新",
    description: "管理断网使用和桌面入口。",
    desktopAlreadyAddedAction: "已添加",
    desktopInstall: "添加到桌面",
    desktopRemindAgain: "重新提醒",
    desktopRemindLater: "稍后提醒",
    enableOffline: "开启断网使用",
    install: "添加",
    offlineMode: "断网使用",
    offlineSavingAction: "正在保存",
    offlinePreparingAction: "正在准备",
    progress: (completedFiles, totalFiles, completedBytes, totalBytes) => {
      if (totalBytes > 0) {
        return `进度 ${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} / ${formatPwaBytes(totalBytes)}`;
      }

      return `进度 ${completedFiles}/${totalFiles} · 已下载 ${formatPwaBytes(completedBytes)}`;
    },
    statusEnabled: "已准备好。断网时也可以打开这个应用。",
    statusError: () => "没有保存成功，请重试。",
    statusInstalling: "正在保存应用内容，完成后断网也能打开。",
    statusNotEnabled: "开启后会先保存应用内容，完成后断网也能打开。",
    statusRegistering: "正在准备断网使用。",
    statusUnsupported: "当前浏览器不支持断网使用。",
    statusUpdateAvailable: "新版本已准备好，更新后断网打开的也是最新版。",
    statusUpdating: "正在更新保存的内容。",
    offlineRetry: "重试",
    offlineUnableAction: "无法开启",
    offlineUpdatingAction: "正在更新",
    title: "离线与安装",
    desktopAlreadyInstalled: "已经添加到桌面。",
    desktopPromptAvailable: "现在可以添加到桌面。",
    desktopPromptDismissed: "已选择稍后提醒。请先使用网页一段时间，稍后再试。",
    desktopPromptUnavailable: "暂时不可添加。请先使用网页一段时间，稍后再试。",
  },
  "en-US": {
    allowInstallPrompt: "Remind Again",
    applyUpdate: "Update Now",
    checkUpdate: "Check Update",
    description: "Manage offline use and desktop access.",
    desktopAlreadyAddedAction: "Added",
    desktopInstall: "Add to Desktop",
    desktopRemindAgain: "Remind Again",
    desktopRemindLater: "Remind Later",
    enableOffline: "Enable Offline Use",
    install: "Add",
    offlineMode: "Offline Use",
    offlineSavingAction: "Saving",
    offlinePreparingAction: "Preparing",
    progress: (completedFiles, totalFiles, completedBytes, totalBytes) => {
      if (totalBytes > 0) {
        return `Progress ${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} / ${formatPwaBytes(totalBytes)}`;
      }

      return `Progress ${completedFiles}/${totalFiles} · ${formatPwaBytes(completedBytes)} downloaded`;
    },
    statusEnabled: "Ready. You can open this app without internet.",
    statusError: () => "Saving failed. Please try again.",
    statusInstalling: "Saving app content so it can open without internet.",
    statusNotEnabled: "Enable this to save app content, then it can open without internet.",
    statusRegistering: "Preparing offline use.",
    statusUnsupported: "This browser does not support offline use.",
    statusUpdateAvailable: "A new version is ready. Update so offline use opens the latest version.",
    statusUpdating: "Updating saved content.",
    offlineRetry: "Retry",
    offlineUnableAction: "Unavailable",
    offlineUpdatingAction: "Updating",
    title: "Offline & Install",
    desktopAlreadyInstalled: "Already added to desktop.",
    desktopPromptAvailable: "You can add it to desktop now.",
    desktopPromptDismissed: "You chose to be reminded later. Use this page for a while and try again.",
    desktopPromptUnavailable: "Not available yet. Use this page for a while and try again later.",
  },
};

interface PwaSettingsAction {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick?: () => void;
  readonly primary: boolean;
}

function resolveOfflineAction(copy: PwaSettingsCopy, pwaController: PwaController): PwaSettingsAction {
  if (pwaController.offlineStatus === "unsupported") {
    return createDisabledAction(copy.offlineUnableAction);
  }

  if (pwaController.offlineStatus === "registering") {
    return createDisabledAction(copy.offlinePreparingAction);
  }

  if (pwaController.offlineStatus === "installing") {
    return createDisabledAction(copy.offlineSavingAction);
  }

  if (pwaController.offlineStatus === "updating") {
    return createDisabledAction(copy.offlineUpdatingAction);
  }

  if (pwaController.offlineStatus === "update-available") {
    return {
      disabled: false,
      label: copy.applyUpdate,
      onClick: pwaController.applyWaitingUpdate,
      primary: true,
    };
  }

  if (pwaController.offlineStatus === "error") {
    return {
      disabled: false,
      label: copy.offlineRetry,
      onClick: () => {
        void pwaController.enableOfflineMode();
      },
      primary: true,
    };
  }

  if (!pwaController.isOfflineModeAccepted) {
    return {
      disabled: false,
      label: copy.enableOffline,
      onClick: () => {
        void pwaController.enableOfflineMode();
      },
      primary: true,
    };
  }

  return {
    disabled: false,
    label: copy.checkUpdate,
    onClick: () => {
      void pwaController.checkForUpdate();
    },
    primary: false,
  };
}

function createDisabledAction(label: string): PwaSettingsAction {
  return {
    disabled: true,
    label,
    primary: false,
  };
}

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
