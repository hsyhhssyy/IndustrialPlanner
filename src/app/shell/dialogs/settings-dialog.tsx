import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { makeAutoObservable, runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
// AI-REMOVED 2026-07-29:
// Reason: WebDAV 冲突窗口已脱离设置窗口生命周期，不再由设置页消费冲突类型。
// Trigger: 设置窗口关闭时冲突窗口完全未挂载，画布锁在 55% 且无可见解决入口。
// Evidence: SettingsDialog 在 isOpen=false 时直接 return null。
// Replacement: ./webdav-conflict-dialog.tsx。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import type {
//   SyncConflictResolution,
//   SyncPendingConflict,
// } from "@/domain/sync";
// AI-REMOVED 2026-07-29:
// Reason: 设置页不再内嵌读取同步 phase/state，详细数据由独立状态弹窗消费。
// Trigger: 用户要求把设置内直接显示改为按钮，并打开多板块状态窗口。
// Evidence: WebDavSyncStatusDialog 直接订阅公开 SyncState。
// Replacement: ./webdav-sync-status-dialog.tsx。
// Risk: Low。
// Human Review: Required
//
// Original code:
// SyncPhase,
// SyncState,
import type { V2MigrationController } from "@/app/migration";
import type { PwaController } from "@/app/pwa/pwa-controller";
import { PwaSettingsSection } from "@/app/pwa/pwa-settings-section";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { ActivityIconStrip } from "@/app/shell/shared/activity-icon-strip";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { MarkdownTutorialOverlay } from "@/app/shell/dialogs/markdown-tutorial-overlay";
import { KeyboardShortcutSettingsDialog } from "@/app/shell/dialogs/keyboard-shortcut-settings-dialog";
import { WebDavSyncStatusDialog } from "@/app/shell/dialogs/webdav-sync-status-dialog";
import { CloudflareSyncStatusDialog } from "@/app/shell/dialogs/cloudflare-sync-status-dialog";
import {
  type SettingsGroupId,
  type WorkbenchSettingDefinition,
  WORKBENCH_SETTINGS_GROUPS,
  WorkbenchSettingsDialogController,
} from "@/app/shell/state/settings-dialog-state";
import {
  ACTIVITY_DEFINITIONS,
  isActivityOngoing,
  normalizeSelectedActivityIds,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  clearAllStorageAndReload,
  estimateTotalStorageBytes,
  formatStorageBytesToMB,
} from "@/shared/storage";
import {
  activateSyncProvider,
  createWebDavSyncTargetKey,
  readSyncProviderActivation,
  requestSyncProvider,
} from "@/shared/storage/sync-provider-activation";
// AI-REMOVED 2026-08-08:
// Reason: 删除目标 provider 必须由 sync-host 在 reset 成功后原子关闭，UI 不能提前切成 none。
// Trigger: UI 先切 provider 会让 deleteRemoteData 看见 none，从而完全不删除远端。
// Evidence: deleteRemoteData 内部通过 readSyncProvider() 选择 Cloudflare/WebDAV。
// Replacement: sync-host.ts deleteRemoteData action。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { writeSyncProvider } from "@/sync/sync-providers";

const SETTINGS_DIALOG_SECTION_SCROLL_OFFSET = 10;

const CONFIG_GUIDE_SETTING_DOC_FILES: ReadonlySet<string> = new Set([
  "game-use-blueprint-style-device-images.md",
  "game-show-device-names.md",
  "game-show-device-icons.md",
  "other-toolbox-show-all-activity-content.md",
  "game-use-inspector-panel.md",
  "game-arknights-selection-right-dock-sync.md",
  "game-arknights-inspector-open-on-second-click.md",
  "game-show-hotkeys.md",
  "game-always-show-grid-lines.md",
  "game-show-grass-background.md",
  "game-arknights-immediate-move.md",
  "game-arknights-copy-while-moving.md",
  "game-arknights-immediate-marquee.md",
  "game-arknights-allow-empty-logistics-endpoints.md",
  "game-arknights-auto-create-splitters-and-convergers.md",
  "other-debug-mode.md",
  "debug-show-fps.md",
  "debug-show-gesture-diagnostics-window.md",
]);

interface SettingsDialogProps {
  appHost: AppHost;
  controller: WorkbenchSettingsDialogController;
  pwaController: PwaController;
  migrationController?: V2MigrationController;
}

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const SettingsDialog = observer(function SettingsDialog({
  appHost,
  controller,
  migrationController,
  pwaController,
}: SettingsDialogProps) {
  const t = appHost.actions.translate;
  const sync = appHost.workspace.sync;
  const syncActivation = readSyncProviderActivation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<SettingsGroupId, HTMLElement>());
  // AI-REMOVED 2026-08-03:
  // Reason: 快捷键捕获状态已迁入独立快捷键设置对话框。
  // Trigger: ST2-RQ-002 要求通用设置页面只保留入口。
  // Evidence: KeyboardShortcutSettingsDialog 内部持有 capturingSlot。
  // Replacement: keyboard-shortcut-settings-dialog.tsx。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const [capturingKeybindingId, setCapturingKeybindingId] = useState<string | null>(null);
  const dialogState = appHost.internalState.workbench.dialogState.settings;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const effectiveActivityIds = resolveEffectiveActivityIds({ selectedActivityIds });
  const isOpen = dialogState.visible;
  const [settingGuideSettingId, setSettingGuideSettingId] = useState<string | null>(null);
  const hideGroupSidebar = appHost.state.screenProfile.deviceClass !== "desktop";
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isNonDesktop = appHost.state.screenProfile.deviceClass !== "desktop";
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const experimentalEnabled = controller.getValue("other-experimental-features") === true;

  const visibleGroups = useMemo(() => {
    return WORKBENCH_SETTINGS_GROUPS.filter((group) => {
      if (isNonDesktop && group.mobileHidden) return false;
      if (group.id === "experimental" && !experimentalEnabled) return false;

      return true;
    });
  }, [isNonDesktop, experimentalEnabled]);

  // 当实验性功能分组可见时，估算存储占用
  useEffect(() => {
    if (!isOpen || !experimentalEnabled) return;

    estimateTotalStorageBytes().then((bytes) => {
      setStorageBytes(bytes);
    }).catch(() => {
      setStorageBytes(null);
    });
  }, [isOpen, experimentalEnabled]);

  // 实验性功能关闭时，若当前选中该分组则回退到默认分组
  useEffect(() => {
    if (!isOpen || experimentalEnabled) return;
    if (controller.selectedGroupId === "experimental") {
      controller.selectGroup("display-system");
    }
  }, [isOpen, experimentalEnabled, controller]);
  const selectedSettingGuideSetting = settingGuideSettingId === null
    ? null
    : findWorkbenchSettingDefinition(settingGuideSettingId);

  const settingGuideDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  }), []);

  const handleClose = useCallback(() => {
    // AI-REMOVED 2026-08-03:
    // Reason: 快捷键捕获状态已迁入独立快捷键设置对话框。
    // Trigger: ST2-RQ-002 快捷键录入收拢。
    // Evidence: KeyboardShortcutSettingsDialog 在 visible=false 时清理 capturingSlot。
    // Replacement: keyboard-shortcut-settings-dialog.tsx。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // setCapturingKeybindingId(null);
    setSettingGuideSettingId(null);
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
    appHost.internalActions.closeDialog("settings");
  }, [appHost, settingGuideDialogState]);

  const handleOpenSettingGuide = useCallback((settingId: string) => {
    setSettingGuideSettingId(settingId);
    runInAction(() => {
      settingGuideDialogState.visible = true;
      settingGuideDialogState.maximized = false;
      settingGuideDialogState.offsetX = 0;
      settingGuideDialogState.offsetY = 0;
    });
  }, [settingGuideDialogState]);

  const handleCloseSettingGuide = useCallback(() => {
    runInAction(() => {
      settingGuideDialogState.visible = false;
    });
    setSettingGuideSettingId(null);
  }, [settingGuideDialogState]);

  const confirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const resetAllConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const activityDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 520,
    height: null,
    activeTab: null,
  }), []);

  const keyboardShortcutDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 820,
    height: 680,
    activeTab: null,
  }), []);

  // AI-REMOVED 2026-08-03:
  // Reason: 快捷键冲突状态已迁入独立快捷键设置对话框。
  // Trigger: ST2-RQ-002 要求快捷键录入规则与帮助代码统一收拢。
  // Evidence: KeyboardShortcutSettingsDialog 内部持有 ShortcutConflict。
  // Replacement: keyboard-shortcut-settings-dialog.tsx。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const conflictDialogState = useMemo(() => makeAutoObservable({
  //   visible: false,
  //   currentSettingId: null as string | null,
  //   conflictSettingId: null as string | null,
  //   newKeyValue: null as string | null,
  // }), []);

  const experimentalFeaturesDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 460,
    height: null,
    activeTab: null,
  }), []);

  const clearStorageConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const clearStorageInputDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const webDavDeleteConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const webDavDeleteInputDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const webDavStatusDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 760,
    height: 620,
    activeTab: null,
  }), []);

  const cloudflareStatusDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 760,
    height: 620,
    activeTab: null,
  }), []);

  const cfDeleteConfirmDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const cfDeleteInputDialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), []);

  const [clearStorageInputValue, setClearStorageInputValue] = useState("");

  const handleClearStorage = useCallback(() => {
    runInAction(() => {
      clearStorageConfirmDialogState.visible = true;
    });
  }, [clearStorageConfirmDialogState]);

  const handleClearStorageCancel = useCallback(() => {
    runInAction(() => {
      clearStorageConfirmDialogState.visible = false;
    });
  }, [clearStorageConfirmDialogState]);

  const handleClearStorageConfirm = useCallback(() => {
    runInAction(() => {
      clearStorageConfirmDialogState.visible = false;
      clearStorageInputDialogState.visible = true;
    });
    setClearStorageInputValue("");
  }, [clearStorageConfirmDialogState, clearStorageInputDialogState]);

  const handleClearStorageInputCancel = useCallback(() => {
    runInAction(() => {
      clearStorageInputDialogState.visible = false;
    });
    setClearStorageInputValue("");
  }, [clearStorageInputDialogState]);

  const handleClearStorageInputConfirm = useCallback(() => {
    clearAllStorageAndReload();
  }, []);

  const [webDavDeleteInputValue, setWebDavDeleteInputValue] = useState("");
  const [webDavDeleting, setWebDavDeleting] = useState(false);

  const [cfDeleteInputValue, setCfDeleteInputValue] = useState("");
  const [cfDeleting, setCfDeleting] = useState(false);
  const [cfAborting, setCfAborting] = useState(false);

  const handleWebDavDelete = useCallback(() => {
    runInAction(() => {
      webDavDeleteConfirmDialogState.visible = true;
    });
  }, [webDavDeleteConfirmDialogState]);

  const handleWebDavDeleteCancel = useCallback(() => {
    runInAction(() => {
      webDavDeleteConfirmDialogState.visible = false;
    });
  }, [webDavDeleteConfirmDialogState]);

  const handleWebDavDeleteConfirm = useCallback(() => {
    runInAction(() => {
      webDavDeleteConfirmDialogState.visible = false;
      webDavDeleteInputDialogState.visible = true;
    });
    setWebDavDeleteInputValue("");
  }, [webDavDeleteConfirmDialogState, webDavDeleteInputDialogState]);

  const handleWebDavDeleteInputCancel = useCallback(() => {
    runInAction(() => {
      webDavDeleteInputDialogState.visible = false;
    });
    setWebDavDeleteInputValue("");
  }, [webDavDeleteInputDialogState]);

  const handleWebDavDeleteInputConfirm = useCallback(async () => {
    runInAction(() => {
      webDavDeleteInputDialogState.visible = false;
    });
    setWebDavDeleting(true);
    // AI-REMOVED 2026-08-08:
    // Reason: UI 提前关闭 provider 后，sync-host 无法再判断应删除 WebDAV 还是 Cloudflare。
    // Trigger: deleteRemoteData 读取 provider 时已经得到 none，删除请求被直接跳过。
    // Evidence: sync-host.ts 的删除 action 必须先捕获并 reset 原 provider。
    // Replacement: sync-host.ts deleteRemoteData 在 reset 成功后关闭 provider。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // writeSyncProvider("none");
    // sync?.actions.updateSettings({});
    try {
      await sync?.actions.deleteRemoteData();
    } catch {
      runInAction(() => {
        webDavDeleteInputDialogState.visible = true;
      });
      setWebDavDeleting(false);
      return;
    }

    runInAction(() => {
      webDavStatusDialogState.visible = false;
    });
    setWebDavDeleting(false);
  }, [sync, webDavDeleteInputDialogState, webDavStatusDialogState]);

  // -- Cloudflare 同步状态弹窗 handlers -- //

  const handleOpenCloudflareStatus = useCallback(() => {
    runInAction(() => {
      cloudflareStatusDialogState.visible = true;
    });
  }, [cloudflareStatusDialogState]);

  const handleCloseCloudflareStatus = useCallback(() => {
    runInAction(() => {
      cloudflareStatusDialogState.visible = false;
    });
  }, [cloudflareStatusDialogState]);

  const handleToggleCloudflareStatusMaximized = useCallback(() => {
    runInAction(() => {
      cloudflareStatusDialogState.maximized = !cloudflareStatusDialogState.maximized;
    });
  }, [cloudflareStatusDialogState]);

  const handleCloudflareStatusOffsetChange = useCallback((offsetX: number, offsetY: number) => {
    runInAction(() => {
      cloudflareStatusDialogState.offsetX = offsetX;
      cloudflareStatusDialogState.offsetY = offsetY;
    });
  }, [cloudflareStatusDialogState]);

  const handleCloudflareStatusResize = useCallback((width: number, height: number) => {
    runInAction(() => {
      cloudflareStatusDialogState.width = width;
      cloudflareStatusDialogState.height = height;
    });
  }, [cloudflareStatusDialogState]);

  // -- Cloudflare 删除远端数据 handlers -- //

  const handleCfDelete = useCallback(() => {
    runInAction(() => {
      cfDeleteConfirmDialogState.visible = true;
    });
  }, [cfDeleteConfirmDialogState]);

  const handleCfDeleteCancel = useCallback(() => {
    runInAction(() => {
      cfDeleteConfirmDialogState.visible = false;
    });
  }, [cfDeleteConfirmDialogState]);

  const handleCfDeleteConfirm = useCallback(() => {
    runInAction(() => {
      cfDeleteConfirmDialogState.visible = false;
      cfDeleteInputDialogState.visible = true;
    });
    setCfDeleteInputValue("");
  }, [cfDeleteConfirmDialogState, cfDeleteInputDialogState]);

  const handleCfDeleteInputCancel = useCallback(() => {
    runInAction(() => {
      cfDeleteInputDialogState.visible = false;
    });
    setCfDeleteInputValue("");
  }, [cfDeleteInputDialogState]);

  const handleCfDeleteInputConfirm = useCallback(async () => {
    runInAction(() => {
      cfDeleteInputDialogState.visible = false;
    });
    setCfDeleting(true);
    // AI-REMOVED 2026-08-08:
    // Reason: Cloudflare 删除也不能在调用 action 前把 provider 改成 none。
    // Trigger: 该顺序让 deleteRemoteData 无法进入 Cloudflare reset 分支。
    // Evidence: 原 handler 的 provider 写入发生在 await deleteRemoteData 之前。
    // Replacement: sync-host.ts deleteRemoteData。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // writeSyncProvider("none");
    // sync?.actions.updateSettings({});

    try {
      await sync?.actions.deleteRemoteData();
    } catch {
      runInAction(() => {
        cfDeleteInputDialogState.visible = true;
      });
      setCfDeleting(false);
      return;
    }

    runInAction(() => {
      cloudflareStatusDialogState.visible = false;
    });
    setCfDeleting(false);
  }, [sync, cfDeleteInputDialogState, cloudflareStatusDialogState]);

  const handleCfAbortCurrentTransaction = useCallback(async () => {
    setCfAborting(true);
    try {
      await sync?.actions.abortCurrentTransaction();
    } catch {
      // abort 失败静默处理，用户可重试
    } finally {
      setCfAborting(false);
    }
  }, [sync]);

  // AI-REMOVED 2026-07-29:
  // Reason: 冲突 action 由 Workbench 顶层窗口直接发送给独立同步模块。
  // Trigger: 设置页关闭后该 handler 不存在，用户无法解除同步等待。
  // Evidence: SyncContract 已提供公开 resolveConflict action，无需设置页代理。
  // Replacement: ./webdav-conflict-dialog.tsx resolveConflict。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const handleResolveWebDavConflict = useCallback((resolution: SyncConflictResolution) => {
  //   sync?.actions.resolveConflict(resolution);
  //   runInAction(() => {
  //     webDavConflictDialogState.visible = false;
  //   });
  // }, [sync, webDavConflictDialogState]);

  const handleOpenWebDavStatus = useCallback(() => {
    runInAction(() => {
      webDavStatusDialogState.visible = true;
    });
  }, [webDavStatusDialogState]);

  const handleCloseWebDavStatus = useCallback(() => {
    runInAction(() => {
      webDavStatusDialogState.visible = false;
    });
  }, [webDavStatusDialogState]);

  const handleToggleWebDavStatusMaximized = useCallback(() => {
    runInAction(() => {
      webDavStatusDialogState.maximized = !webDavStatusDialogState.maximized;
    });
  }, [webDavStatusDialogState]);

  const handleWebDavStatusOffsetChange = useCallback((offsetX: number, offsetY: number) => {
    runInAction(() => {
      webDavStatusDialogState.offsetX = offsetX;
      webDavStatusDialogState.offsetY = offsetY;
    });
  }, [webDavStatusDialogState]);

  const handleWebDavStatusResize = useCallback((width: number, height: number) => {
    runInAction(() => {
      webDavStatusDialogState.width = width;
      webDavStatusDialogState.height = height;
    });
  }, [webDavStatusDialogState]);

  const handleSelectSettingValue = useCallback((settingId: string, value: string) => {
    controller.updateSelectValue(settingId, value);
    if (settingId !== "sync-provider") {
      return;
    }
    runInAction(() => {
      webDavStatusDialogState.visible = value === "webdav";
      cloudflareStatusDialogState.visible = value === "cloudflare";
    });
  }, [cloudflareStatusDialogState, controller, webDavStatusDialogState]);

  // AI-CORRECTION 2026-08-01: 测试 WebDAV 连接。
  // 通过 fetch 发送 PROPFIND 请求验证 URL/用户名/密码是否可达。
  const handleWebDavTestConnection = useCallback(
    async (draft: { url: string; username: string; password: string }) => {
      const url = draft.url.trim().replace(/\/+$/, "");
      if (!url) {
        return false;
      }
      try {
        const headers: Record<string, string> = {
          Depth: "1",
        };
        if (draft.username || draft.password) {
          headers.Authorization = `Basic ${btoa(`${draft.username}:${draft.password}`)}`;
        }
        const response = await fetch(url, {
          method: "PROPFIND",
          headers,
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    [],
  );

  // AI-REMOVED 2026-07-29:
  // Reason: 同步冲突本身就是公开 MobX state，不需要设置页复制第二份可见性状态。
  // Trigger: 复制状态受 SettingsDialog 生命周期约束，造成冲突存在但窗口不可见。
  // Evidence: WebDavConflictDialog 现在由 observer 直接订阅 sync.state.pendingConflict。
  // Replacement: ./webdav-conflict-dialog.tsx。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => {
  //   runInAction(() => {
  //     webDavConflictDialogState.visible = sync?.state.pendingConflict !== null
  //       && sync?.state.pendingConflict !== undefined;
  //   });
  // }, [sync?.state.pendingConflict, webDavConflictDialogState]);

  const clearStorageExpectedText = useMemo(
    () => appHost.state.settings.locale === "zh-CN"
      ? "确认清除所有存储的数据"
      : "Confirm to clear all stored data",
    [appHost.state.settings.locale],
  );

  const isClearStorageInputValid = clearStorageInputValue === clearStorageExpectedText;

  const webDavDeleteExpectedText = useMemo(
    () => appHost.state.settings.locale === "zh-CN"
      ? "删除服务器端所有保存内容"
      : "Delete all saved content on the server",
    [appHost.state.settings.locale],
  );

  const isWebDavDeleteInputValid = webDavDeleteInputValue === webDavDeleteExpectedText;

  const cfDeleteExpectedText = useMemo(
    () => appHost.state.settings.locale === "zh-CN"
      ? "删除"
      : "DELETE",
    [appHost.state.settings.locale],
  );

  const isCfDeleteInputValid = cfDeleteInputValue === cfDeleteExpectedText;

  const handleRequestToggleExperimentalFeatures = useCallback(() => {
    runInAction(() => {
      experimentalFeaturesDialogState.visible = true;
    });
  }, [experimentalFeaturesDialogState]);

  const handleExperimentalFeaturesCancel = useCallback(() => {
    runInAction(() => {
      experimentalFeaturesDialogState.visible = false;
    });
  }, [experimentalFeaturesDialogState]);

  const handleExperimentalFeaturesConfirm = useCallback(() => {
    controller.updateSwitchValue("other-experimental-features", true);
    runInAction(() => {
      experimentalFeaturesDialogState.visible = false;
    });
  }, [controller, experimentalFeaturesDialogState]);

  // AI-REMOVED 2026-06-24:
  // Reason: conflictPendingRef 被声明但从未被使用，属于死代码
  // Trigger: ESLint @typescript-eslint/no-unused-vars error
  // Evidence: 全仓库搜索仅此一处声明，无任何读取或写入引用
  // Replacement: None
  // Risk: Low — 若后续需要冲突暂存逻辑，可从此处恢复
  // Human Review: Required
  //
  // Original code:
  // const conflictPendingRef = useRef<{ settingId: string; value: string } | null>(null);

  // AI-REMOVED 2026-08-03:
  // Reason: 操作设置与快捷键不再共用重置入口。
  // Trigger: ST2-RQ-002 独立快捷键设置对话框。
  // Evidence: 当前 handler 只打开操作设置重置确认框。
  // Replacement: handleResetOperation in this file。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const handleResetOperationAndShortcuts = useCallback(() => {
  const handleResetOperation = useCallback(() => {
    runInAction(() => {
      confirmDialogState.visible = true;
    });
  }, [confirmDialogState]);

  const handleResetConfirm = useCallback(() => {
    controller.resetArknightsOperation();
    runInAction(() => {
      confirmDialogState.visible = false;
    });
  }, [controller, confirmDialogState]);

  const handleResetCancel = useCallback(() => {
    runInAction(() => {
      confirmDialogState.visible = false;
    });
  }, [confirmDialogState]);

  const handleResetAllSettings = useCallback(() => {
    runInAction(() => {
      resetAllConfirmDialogState.visible = true;
    });
  }, [resetAllConfirmDialogState]);

  const handleResetAllConfirm = useCallback(() => {
    controller.resetAllSettings();
    runInAction(() => {
      resetAllConfirmDialogState.visible = false;
    });
  }, [controller, resetAllConfirmDialogState]);

  const handleResetAllCancel = useCallback(() => {
    runInAction(() => {
      resetAllConfirmDialogState.visible = false;
    });
  }, [resetAllConfirmDialogState]);

  const handleOpenActivityDialog = useCallback(() => {
    runInAction(() => {
      activityDialogState.visible = true;
    });
  }, [activityDialogState]);

  const handleOpenKeyboardShortcutDialog = useCallback(() => {
    runInAction(() => {
      keyboardShortcutDialogState.visible = true;
      keyboardShortcutDialogState.maximized = false;
      keyboardShortcutDialogState.offsetX = 0;
      keyboardShortcutDialogState.offsetY = 0;
    });
  }, [keyboardShortcutDialogState]);

  const handleCloseKeyboardShortcutDialog = useCallback(() => {
    runInAction(() => {
      keyboardShortcutDialogState.visible = false;
    });
  }, [keyboardShortcutDialogState]);

  const handleCloseActivityDialog = useCallback(() => {
    runInAction(() => {
      activityDialogState.visible = false;
    });
  }, [activityDialogState]);

  const handleToggleActivity = useCallback((activityId: string, selected: boolean) => {
    runInAction(() => {
      const selectedIds = new Set(normalizeSelectedActivityIds(appHost.internalState.settings.selectedActivityIds));
      if (selected) {
        selectedIds.add(activityId);
      } else {
        selectedIds.delete(activityId);
      }

      appHost.internalState.settings.selectedActivityIds = normalizeSelectedActivityIds([...selectedIds]);
    });
  }, [appHost]);

  /* AI-REMOVED 2026-08-03:
  Reason: 通用设置对话框不再负责快捷键冲突、捕获和写入。
  Trigger: ST2-RQ-002 新建独立快捷键设置对话框并要求相关规则统一迁移。
  Evidence: keyboard-shortcut-settings-dialog.tsx 已实现逐槽捕获与冲突替换。
  Replacement: KeyboardShortcutSettingsDialog in keyboard-shortcut-settings-dialog.tsx。
  Risk: Low
  Human Review: Required

  Original code:
  const handleConflictCancel = useCallback(() => {
    runInAction(() => {
      conflictDialogState.visible = false;
      conflictDialogState.currentSettingId = null;
      conflictDialogState.conflictSettingId = null;
      conflictDialogState.newKeyValue = null;
    });
  }, [conflictDialogState]);

  const handleConflictConfirm = useCallback(() => {
    const currentId = conflictDialogState.currentSettingId;
    const conflictId = conflictDialogState.conflictSettingId;
    const newValue = conflictDialogState.newKeyValue;

    runInAction(() => {
      conflictDialogState.visible = false;
      conflictDialogState.currentSettingId = null;
      conflictDialogState.conflictSettingId = null;
      conflictDialogState.newKeyValue = null;
    });

    if (currentId === null || conflictId === null || newValue === null) return;

    // 先清空冲突快捷键，再设置当前快捷键
    controller.clearKeybinding(conflictId);
    controller.updateKeybindingValue(currentId, newValue);
  }, [controller, conflictDialogState]);

  const handleWindowKeyDown = useCallback((event: KeyboardEvent) => {
    if (capturingKeybindingId === null) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setCapturingKeybindingId(null);

      return true;
    }

    if (!controller.isSettingEditable(capturingKeybindingId)) {
      setCapturingKeybindingId(null);

      return true;
    }

    const nextValue = formatCapturedKeybinding(event);
    if (nextValue === null) {
      return true;
    }

    // 检查快捷键冲突
    const conflictSettingId = controller.findKeybindingConflict(capturingKeybindingId, nextValue);
    if (conflictSettingId !== null) {
      // 有冲突：弹出确认对话框
      runInAction(() => {
        conflictDialogState.visible = true;
        conflictDialogState.currentSettingId = capturingKeybindingId;
        conflictDialogState.conflictSettingId = conflictSettingId;
        conflictDialogState.newKeyValue = nextValue;
      });
      setCapturingKeybindingId(null);

      return true;
    }

    controller.updateKeybindingValue(capturingKeybindingId, nextValue);
    setCapturingKeybindingId(null);

    return true;
  }, [capturingKeybindingId, controller, conflictDialogState]);
  */

  useEffect(() => {
    if (isOpen) {
      return;
    }

    // AI-REMOVED 2026-08-03:
    // Reason: 捕获状态由独立快捷键设置对话框在自身关闭时清理。
    // Trigger: ST2-RQ-002 快捷键录入收拢。
    // Evidence: KeyboardShortcutSettingsDialog useEffect 监听 visible。
    // Replacement: keyboard-shortcut-settings-dialog.tsx。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // setCapturingKeybindingId(null);
    setSettingGuideSettingId(null);
    runInAction(() => {
      settingGuideDialogState.visible = false;
      keyboardShortcutDialogState.visible = false;
    });
  }, [isOpen, keyboardShortcutDialogState, settingGuideDialogState]);

  useEffect(() => {
    if (!isOpen || hideGroupSidebar) {
      return;
    }

    const contentElement = contentRef.current;
    const selectedSection = sectionRefs.current.get(controller.selectedGroupId);
    if (contentElement === null || selectedSection === undefined) {
      return;
    }

    scrollSettingsDialogContentToSection({
      contentElement,
      selectedSection,
    });
  }, [isOpen, controller.selectedGroupId, hideGroupSidebar]);

  if (!isOpen) {
    return null;
  }

  const selectedGroup = controller.selectedGroup;

  return (
    <>
    {/* AI-REMOVED 2026-08-03:
        Reason: 通用设置窗口不再捕获快捷键。
        Trigger: ST2-RQ-002 快捷键录入收拢。
        Evidence: KeyboardShortcutSettingsDialog 向自己的 DialogShell 提供 onWindowKeyDown。
        Replacement: keyboard-shortcut-settings-dialog.tsx。
        Risk: Low
        Human Review: Required

        Original code:
        onWindowKeyDown={handleWindowKeyDown}
    */}
    <DialogShell
      className="settings-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="settings"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("settings", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("settings", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("settings");
      }}
      restoreTitle={t("dialog.restore")}
      title={t("settingsDialog.title")}
      titleId="settings-dialog-title"
    >
        <div
          className={cm(styles, hideGroupSidebar
            ? "settings-dialog-layout settings-dialog-layout-single-pane"
            : "settings-dialog-layout")}
        >
          {hideGroupSidebar ? null : (
            <aside className={cm(styles, "settings-dialog-sidebar")}>
              <div className={cm(styles, "settings-dialog-sidebar-title")}>{t("settingsDialog.groups")}</div>
              <div aria-label={t("settingsDialog.groups")} className={cm(styles, "settings-dialog-tree")} role="tree">
                {visibleGroups.map((group) => {
                  const isActive = group.id === selectedGroup.id;

                  return (
                    <button
                      aria-selected={isActive}
                      aria-controls={`settings-dialog-group-${group.id}`}
                      className={cm(styles, isActive
                        ? "settings-dialog-tree-button is-active"
                        : "settings-dialog-tree-button")}
                      key={group.id}
                      onClick={() => {
                        controller.selectGroup(group.id);
                      }}
                      role="treeitem"
                      type="button"
                    >
                      <span className={cm(styles, "settings-dialog-tree-label")}>{t(group.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
          <div className={cm(styles, "settings-dialog-content")} ref={contentRef}>
            {visibleGroups.map((group) => (
              <section
                className={cm(styles, "settings-dialog-group-section")}
                id={`settings-dialog-group-${group.id}`}
                key={group.id}
                ref={(element) => {
                  if (element === null) {
                    sectionRefs.current.delete(group.id);

                    return;
                  }

                  sectionRefs.current.set(group.id, element);
                }}
              >
                <div className={cm(styles, "settings-dialog-group-header")}>
                  <h3>{t(group.labelKey)}</h3>
                  <p>{t(group.descriptionKey)}</p>
                </div>
                <div className={cm(styles, "settings-dialog-settings-list")}>
                  {group.items.filter((setting) => !isNonDesktop || !setting.mobileHidden).flatMap((setting, index, _filtered) => {
                    const isEditable = controller.isSettingEditable(setting.id);
                    // AI-REMOVED 2026-08-03:
                    // Reason: 通用设置组已不包含 keybinding 类型。
                    // Trigger: ST2-RQ-002 快捷键设置独立化。
                    // Evidence: WORKBENCH_SETTINGS_GROUPS 已归档 shortcuts 分组。
                    // Replacement: KeyboardShortcutSettingsDialog。
                    // Risk: Low
                    // Human Review: Required
                    //
                    // Original code:
                    // const isKeybinding = setting.kind === "keybinding";
                    const isText = setting.kind === "text" || setting.kind === "password";
                    const isDebugGroup = group.id === "debug";
                    const isGameGroup = group.id === "game";
                    const settingLabel = resolveSettingLabel(setting, t);
                    const hasSettingGuide = CONFIG_GUIDE_SETTING_DOC_FILES.has(`${setting.id}.md`);

                    // 调试分组：调试模式关闭时隐藏除调试模式开关外的所有项
                    if (isDebugGroup && index > 0 && !controller.getValue("other-debug-mode")) {
                      return [];
                    }

                    const elements: React.ReactNode[] = [];

                    // 游戏分组分隔符：index 0-2 为第一组(使用蓝图样式+显示设备名称+显示设备图标)，index 3 为第二组(工具箱显示所有活动)
                    if (isGameGroup && (index === 3 || index === 4 || index === 6)) {
                      elements.push(<hr key={`sep-${group.id}-${index}`} className={cm(styles, "settings-dialog-separator")} />);
                    }

                    // 游戏分组：活动设置按钮（第二组中，工具箱显示所有活动后面）
                    if (isGameGroup && index === 3) {
                      elements.push(
                        <ActivitySettingsCard
                          effectiveActivityIds={effectiveActivityIds}
                          key="activity-card"
                          onOpen={handleOpenActivityDialog}
                        />,
                      );
                    }

                    elements.push(
                      <article
                        aria-disabled={!isEditable}
                        className={cm(styles, [
                          "settings-dialog-setting-card",
                          isEditable ? "" : "is-disabled",
                          // AI-REMOVED 2026-08-03:
                          // Reason: 通用设置卡片不再渲染快捷键专用样式。
                          // Trigger: ST2-RQ-002 快捷键设置独立化。
                          // Evidence: keybinding 行已迁入独立对话框。
                          // Replacement: keyboard-shortcut-settings-dialog.module.scss。
                          // Risk: Low
                          // Human Review: Required
                          //
                          // Original code:
                          // isKeybinding ? "is-keybinding" : "",
                          isText ? "is-text" : "",
                        ].filter(Boolean).join(" "))}
                        key={setting.id}
                      >
                        <div className={cm(styles, "settings-dialog-setting-copy")}>
                          <h4 className={cm(styles, "settings-dialog-setting-title")}>
                            <span>{settingLabel}</span>
                            {hasSettingGuide ? (
                              <SettingGuideButton
                                label={settingLabel}
                                onClick={() => handleOpenSettingGuide(setting.id)}
                                t={t}
                              />
                            ) : null}
                          </h4>
                          <p>{resolveSettingDescription(setting, t)}</p>
                        </div>
                        <div className={cm(styles, "settings-dialog-setting-control")}>
                          {renderSettingControl({
                            controller,
                            setting,
                            t,
                            isEditable,
                            onSelectValue: handleSelectSettingValue,
                            onRequestToggleExperimentalFeatures: handleRequestToggleExperimentalFeatures,
                          })}
                        </div>
                      </article>,
                    );

                    return elements;
                  })}
                </div>
                {group.id === "operation" && (
                  /*
                   * AI-REMOVED 2026-06-15:
                   * Reason: 重置操作需要与普通设置项使用同一张卡片，避免按钮脱离设置列表。
                   * Trigger: 用户反馈重置按钮没有走设置选项样式、视觉突兀。
                   * Evidence: Playwright 截图显示重置按钮位于卡片列表外；代码中使用 settings-dialog-reset-row 单独渲染。
                   * Replacement: SettingsActionCard in this file.
                   * Risk: Low
                   * Human Review: Required
                   *
                   * Original code:
                   * <div className={cm(styles, "settings-dialog-reset-row")}>
                   *   <button
                   *     className={cm(styles, "settings-dialog-reset-button")}
                   *     onClick={handleResetOperationAndShortcuts}
                   *     type="button"
                   *   >
                   *     {t("settingsAction.resetOperationAndShortcuts")}
                   *   </button>
                   * </div>
                   */
                  <>
                    <SettingsActionCard
                      buttonLabel={t("settingsAction.resetOperation")}
                      description={t("settingsAction.resetOperationConfirm")}
                      onClick={handleResetOperation}
                      title={t("settingsAction.resetOperation")}
                    />
                    <SettingsActionCard
                      buttonLabel={t("keyboardShortcutDialog.open")}
                      onClick={handleOpenKeyboardShortcutDialog}
                      title={t("keyboardShortcutDialog.title")}
                    />
                  </>
                )}
                {group.id === "other" && (
                  <>
                    {/*
                      AI-REMOVED 2026-06-15:
                      Reason: 全部重置操作需要与普通设置项使用同一张卡片，避免按钮脱离设置列表。
                      Trigger: 用户反馈重置按钮没有走设置选项样式、视觉突兀。
                      Evidence: Playwright 截图显示重置按钮位于卡片列表外；代码中使用 settings-dialog-reset-row 单独渲染。
                      Replacement: SettingsActionCard in this file.
                      Risk: Low
                      Human Review: Required

                      Original code:
                      <div className={cm(styles, "settings-dialog-reset-row")}>
                        <button
                          className={cm(styles, "settings-dialog-reset-button")}
                          onClick={handleResetAllSettings}
                          type="button"
                        >
                          {t("settingsAction.resetAllSettings")}
                        </button>
                      </div>
                    */}
                    <SettingsActionCard
                      buttonLabel={t("settingsAction.resetAllSettings")}
                      description={t("settingsAction.resetAllSettingsConfirm")}
                      onClick={handleResetAllSettings}
                      title={t("settingsAction.resetAllSettings")}
                    />
                    {migrationController === undefined ? null : (
                      <V2MigrationSettingsCard controller={migrationController} />
                    )}
                    <PwaSettingsSection appHost={appHost} hideHeader pwaController={pwaController} />
                  </>
                )}
                {group.id === "experimental" && (
                  <>
                    {controller.getValue("sync-provider") === "webdav" ? (
                      <WebDavSyncStatusCard
                        enabled={sync?.state.settings.enabled === true
                          && syncActivation.state === "active"
                          && syncActivation.provider === "webdav"}
                        onOpen={handleOpenWebDavStatus}
                        t={t}
                      />
                    ) : null}
                    {controller.getValue("sync-provider") === "cloudflare" ? (
                      <CloudflareSyncStatusCard
                        enabled={sync?.state.settings.enabled === true
                          && syncActivation.state === "active"
                          && syncActivation.provider === "cloudflare"}
                        onOpen={handleOpenCloudflareStatus}
                        t={t}
                      />
                    ) : null}
                    <StorageUsageCard
                      onClearStorage={handleClearStorage}
                      storageBytes={storageBytes}
                      t={t}
                    />
                  </>
                )}
              </section>
            ))}
          </div>
        </div>
    </DialogShell>
    {confirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={confirmDialogState}
        confirmMessageKey="settingsAction.resetOperationConfirm"
        onCancel={handleResetCancel}
        onConfirm={handleResetConfirm}
        t={t}
        titleKey="settingsAction.resetOperation"
      />
    )}
    {resetAllConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={resetAllConfirmDialogState}
        confirmMessageKey="settingsAction.resetAllSettingsConfirm"
        onCancel={handleResetAllCancel}
        onConfirm={handleResetAllConfirm}
        t={t}
        titleKey="settingsAction.resetAllSettings"
      />
    )}
    {clearStorageConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={clearStorageConfirmDialogState}
        confirmMessageKey="settingsAction.experimental-clear-storage-confirm"
        onCancel={handleClearStorageCancel}
        onConfirm={handleClearStorageConfirm}
        t={t}
        titleKey="settingsAction.experimental-clear-storage"
      />
    )}
    {clearStorageInputDialogState.visible && (
      <ClearStorageInputDialog
        confirmDialogState={clearStorageInputDialogState}
        expectedText={clearStorageExpectedText}
        inputValue={clearStorageInputValue}
        isValid={isClearStorageInputValid}
        onCancel={handleClearStorageInputCancel}
        onChange={setClearStorageInputValue}
        onConfirm={handleClearStorageInputConfirm}
        t={t}
      />
    )}
    {webDavDeleteConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={webDavDeleteConfirmDialogState}
        confirmMessageKey="webDavConfig.deleteAllDataConfirm"
        onCancel={handleWebDavDeleteCancel}
        onConfirm={handleWebDavDeleteConfirm}
        t={t}
        titleKey="webDavConfig.deleteAllData"
      />
    )}
    {webDavDeleteInputDialogState.visible && (
      <ClearStorageInputDialog
        confirmButtonKey="syncConfig.deleteAllDataFinalConfirm"
        confirmDialogState={webDavDeleteInputDialogState}
        expectedText={webDavDeleteExpectedText}
        inputValue={webDavDeleteInputValue}
        isValid={isWebDavDeleteInputValid}
        onCancel={handleWebDavDeleteInputCancel}
        onChange={setWebDavDeleteInputValue}
        onConfirm={handleWebDavDeleteInputConfirm}
        promptKey="webDavConfig.deleteAllDataFinalPrompt"
        t={t}
        titleKey="webDavConfig.deleteAllDataFinalTitle"
      />
    )}
    {cfDeleteConfirmDialogState.visible && (
      <ConfirmResetDialog
        confirmDialogState={cfDeleteConfirmDialogState}
        confirmMessageKey="cloudflareStatus.deleteAllDataConfirm"
        onCancel={handleCfDeleteCancel}
        onConfirm={handleCfDeleteConfirm}
        t={t}
        titleKey="cloudflareStatus.deleteAllData"
      />
    )}
    {cfDeleteInputDialogState.visible && (
      <ClearStorageInputDialog
        confirmButtonKey="syncConfig.deleteAllDataFinalConfirm"
        confirmDialogState={cfDeleteInputDialogState}
        expectedText={cfDeleteExpectedText}
        inputValue={cfDeleteInputValue}
        isValid={isCfDeleteInputValid}
        onCancel={handleCfDeleteInputCancel}
        onChange={setCfDeleteInputValue}
        onConfirm={handleCfDeleteInputConfirm}
        promptKey="cloudflareStatus.deleteAllDataFinalPrompt"
        t={t}
        titleKey="cloudflareStatus.deleteAllData"
      />
    )}
    {activityDialogState.visible && (
      <ActivitySelectionDialog
        activityDialogState={activityDialogState}
        effectiveActivityIds={effectiveActivityIds}
        onClose={handleCloseActivityDialog}
        onToggleActivity={handleToggleActivity}
        selectedActivityIds={selectedActivityIds}
        t={t}
      />
    )}
    <KeyboardShortcutSettingsDialog
      appHost={appHost}
      dialogState={keyboardShortcutDialogState}
      onClose={handleCloseKeyboardShortcutDialog}
    />
    {/*
      AI-REMOVED 2026-07-29:
      Reason: WebDAV 冲突是阻断全局同步的系统窗口，不能嵌套在可关闭的设置窗口中。
      Trigger: 设置窗口关闭时画布遮罩停在 55%，但冲突窗口没有挂载。
      Evidence: pendingConflict 非空时 [data-dialog-key="webdav-conflict"] 查询结果为 null。
      Replacement: WorkbenchApp 顶层 WebDavConflictDialog。
      Risk: Low。
      Human Review: Required

      Original code:
      {webDavConflictDialogState.visible
        && sync !== null
        && sync.state.pendingConflict !== null ? (
        <WebDavConflictDialog
          conflict={sync.state.pendingConflict}
          dialogState={webDavConflictDialogState}
          onResolve={handleResolveWebDavConflict}
          t={t}
        />
      ) : null}
    */}
      {webDavStatusDialogState.visible && sync !== null ? (
        /*
          AI-REMOVED 2026-08-24:
          Reason: WebDAV 设置应用必须在连接参数持久化后显式激活目标，不能只写参数。
          Trigger: 用户要求切换同步方式后完成设置确认才生效。
          Evidence: 新 handler 串行执行 pending、updateSettings 与 activateSyncProvider。
          Replacement: 下方异步 onUpdateSettings。
          Risk: Low。
          Human Review: Required

          Original code:
          onUpdateSettings={(patch) => sync.actions.updateSettings(patch)}
        */
        <WebDavSyncStatusDialog
        compactMobileLayout={isNonDesktop}
        deleting={webDavDeleting}
        dialogState={webDavStatusDialogState}
        onClose={handleCloseWebDavStatus}
        onDeleteAllData={handleWebDavDelete}
        onOffsetChange={handleWebDavStatusOffsetChange}
        onResize={handleWebDavStatusResize}
        onTestConnection={handleWebDavTestConnection}
        onToggleMaximized={handleToggleWebDavStatusMaximized}
        onUpdateSettings={async (patch) => {
          if (!requestSyncProvider("webdav")) {
            throw new Error("Failed to enter WebDAV setup mode.");
          }
          await sync.actions.updateSettings(patch);
          const nextSettings = {
            ...sync.state.settings,
            ...patch,
          };
          if (!activateSyncProvider(
            "webdav",
            createWebDavSyncTargetKey(nextSettings),
          )) {
            throw new Error("Failed to activate WebDAV sync.");
          }
        }}
        state={sync.state}
        t={t}
      />
    ) : null}
    {cloudflareStatusDialogState.visible && sync !== null ? (
      <CloudflareSyncStatusDialog
        aborting={cfAborting}
        compactMobileLayout={isNonDesktop}
        deleting={cfDeleting}
        dialogState={cloudflareStatusDialogState}
        onAbortCurrentTransaction={handleCfAbortCurrentTransaction}
        onClose={handleCloseCloudflareStatus}
        onDeleteAllData={handleCfDelete}
        onOffsetChange={handleCloudflareStatusOffsetChange}
        onResize={handleCloudflareStatusResize}
        onToggleMaximized={handleToggleCloudflareStatusMaximized}
        state={sync.state}
        t={t}
      />
    ) : null}
    {experimentalFeaturesDialogState.visible && (
      <DialogShell
        bodyClassName={cm(styles, "experimental-warning-dialog-body")}
        className="experimental-warning-dialog"
        closeTitle={t("action.close")}
        compactMobileLayout={isNonDesktop}
        dialogKey="experimental-features-warning"
        dialogState={experimentalFeaturesDialogState}
        maximizeTitle=""
        onClose={handleExperimentalFeaturesCancel}
        onToggleMaximized={() => {}}
        restoreTitle=""
        showMaximizeButton={false}
        title={t("settingsField.other-experimental-features-warning-title")}
        titleId="experimental-features-warning-title"
      >
        <div className={cm(styles, "experimental-warning-content")}>
          <p>{t("settingsField.other-experimental-features-warning-message")}</p>
          <div className={cm(styles, "experimental-warning-actions")}>
            <button
              className={cm(styles, "experimental-warning-cancel-btn")}
              onClick={handleExperimentalFeaturesCancel}
              type="button"
            >
              {t("action.cancel")}
            </button>
            <button
              className={cm(styles, "experimental-warning-confirm-btn")}
              onClick={handleExperimentalFeaturesConfirm}
              type="button"
            >
              {t("settingsField.other-experimental-features-warning-confirm")}
            </button>
          </div>
        </div>
      </DialogShell>
    )}
    {settingGuideDialogState.visible && selectedSettingGuideSetting !== null ? (
      <SettingGuideDialog
        compactMobileLayout={isMobileCompactLayout}
        dialogState={settingGuideDialogState}
        onClose={handleCloseSettingGuide}
        setting={selectedSettingGuideSetting}
        t={t}
      />
    ) : null}
    </>
  );
});

function SettingGuideButton({
  label,
  onClick,
  t,
}: {
  label: string;
  onClick: () => void;
  t: AppHost["actions"]["translate"];
}) {
  const buttonLabel = `${t("helpDialog.title")}: ${label}`;

  return (
    <button
      aria-label={buttonLabel}
      className={cm(styles, "settings-dialog-setting-help-button")}
      onClick={onClick}
      title={buttonLabel}
      type="button"
    >
      <WorkbenchIcon kind="help" />
      <span className={cm(styles, "sr-only")}>{buttonLabel}</span>
    </button>
  );
}

function SettingGuideDialog({
  compactMobileLayout,
  dialogState,
  onClose,
  setting,
  t,
}: {
  compactMobileLayout: boolean;
  dialogState: DialogStateReadWrite;
  onClose: () => void;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
}) {
  const title = resolveSettingLabel(setting, t);
  const path = createPublicAssetUrl(`help/config-guide/${setting.id}.md`);

  return (
    <MarkdownTutorialOverlay
      compactLayout={compactMobileLayout}
      dialogKey="settings-guide"
      onClose={onClose}
      path={path}
      title={title}
      visible={dialogState.visible}
    />
  );
}

function SettingsActionCard({
  buttonLabel,
  description,
  onClick,
  title,
}: {
  buttonLabel: string;
  description?: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>{title}</h4>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      <div className={cm(styles, "settings-dialog-setting-control")}>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onClick}
          type="button"
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
}

function StorageUsageCard({
  onClearStorage,
  storageBytes,
  t,
}: {
  onClearStorage: () => void;
  storageBytes: number | null;
  t: AppHost["actions"]["translate"];
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>{t("settingsField.experimental-storage-usage")}</h4>
        <p>{t("settingsField.experimental-storage-usageDescription")}</p>
      </div>
      <div className={cm(styles, "settings-dialog-setting-control")}>
        <span className={cm(styles, "settings-dialog-storage-usage-value")}>
          {formatStorageBytesToMB(storageBytes)}
        </span>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onClearStorage}
          type="button"
        >
          {t("settingsAction.experimental-clear-storage")}
        </button>
      </div>
    </article>
  );
}

const WebDavSyncStatusCard = observer(function WebDavSyncStatusCard({
  enabled,
  onOpen,
  t,
}: {
  enabled: boolean;
  onOpen: () => void;
  t: AppHost["actions"]["translate"];
}) {
  return (
    <SettingsActionCard
      buttonLabel={t("webDavStatus.open")}
      description={t(enabled
        ? "settingsField.experimental-webdav-statusDescription"
        : "syncActivation.setupRequiredDescription")}
      onClick={onOpen}
      title={t("webDavConfig.title")}
    />
  );
});

const CloudflareSyncStatusCard = observer(function CloudflareSyncStatusCard({
  enabled,
  onOpen,
  t,
}: {
  enabled: boolean;
  onOpen: () => void;
  t: AppHost["actions"]["translate"];
}) {
  return (
    <SettingsActionCard
      buttonLabel={t("cloudflareStatus.open")}
      description={t(enabled
        ? "settingsField.experimental-webdav-statusDescription"
        : "syncActivation.setupRequiredDescription")}
      onClick={onOpen}
      title={t("cloudflareStatus.title")}
    />
  );
});

// AI-REMOVED 2026-07-29:
// Reason: 设置页不再直接渲染同步 phase、时间和设备列表。
// Trigger: 用户要求设置页只保留按钮，详细信息进入独立弹窗。
// Evidence: WebDavSyncStatusDialog 已集中处理阶段、任务、网络和设备信息。
// Replacement: webdav-sync-status-dialog.tsx。
// Risk: Low。
// Human Review: Required
//
// Original code:
// function resolveWebDavPhaseKey(phase: SyncPhase): Parameters<AppHost["actions"]["translate"]>[0] {
//   if (phase === "uploading") return "settingsField.experimental-webdav-status-uploading";
//   if (phase === "downloading") return "settingsField.experimental-webdav-status-downloading";
//   if (phase === "error") return "settingsField.experimental-webdav-status-error";
//
//   return "settingsField.experimental-webdav-status-idle";
// }
//
// function formatNullableTime(value: string | null, fallback: string): string {
//   if (value === null) {
//     return fallback;
//   }
//
//   return new Date(value).toLocaleString();
// }

const V2MigrationSettingsCard = observer(function V2MigrationSettingsCard({
  controller,
}: {
  controller: V2MigrationController;
}) {
  const summary = controller.result ?? controller.migrationState.summary;
  const statusText = summary !== null && controller.migrationState.completedAt !== null
    ? `已迁移地图 ${summary.migratedMapCount} 个，蓝图 ${summary.migratedBlueprintCount} 个`
    : controller.detection.hasData
      ? `检测到 v2 地图 ${controller.detection.mapCount} 个，蓝图 ${controller.detection.blueprintCount} 个`
      : "未检测到可迁移的 v2 数据";

  return (
    <article className={cm(styles, "settings-dialog-setting-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>v2 数据迁移</h4>
        <p>{statusText}</p>
      </div>
      <div className={cm(styles, "settings-dialog-migration-control")}>
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={controller.openDialog}
          type="button"
        >
          打开迁移
        </button>
      </div>
    </article>
  );
});

function ActivitySettingsCard({
  effectiveActivityIds,
  onOpen,
}: {
  effectiveActivityIds: readonly string[];
  onOpen: () => void;
}) {
  return (
    <article className={cm(styles, "settings-dialog-setting-card settings-dialog-activity-card")}>
      <div className={cm(styles, "settings-dialog-setting-copy")}>
        <h4>活动数据</h4>
        <p>当前生效活动</p>
      </div>
      <div className={cm(styles, "settings-dialog-activity-control")}>
        <ActivityIconStrip activityIds={effectiveActivityIds} />
        {effectiveActivityIds.length === 0 ? (
          <span className={cm(styles, "settings-dialog-activity-empty")}>无</span>
        ) : null}
        <button
          className={cm(styles, "settings-dialog-reset-button")}
          onClick={onOpen}
          type="button"
        >
          加载活动数据
        </button>
      </div>
    </article>
  );
}

function ActivitySelectionDialog({
  activityDialogState,
  effectiveActivityIds,
  onClose,
  onToggleActivity,
  selectedActivityIds,
  t,
}: {
  activityDialogState: DialogStateReadWrite;
  effectiveActivityIds: readonly string[];
  onClose: () => void;
  onToggleActivity: (activityId: string, selected: boolean) => void;
  selectedActivityIds: readonly string[];
  t: AppHost["actions"]["translate"];
}) {
  const selectedActivityIdSet = new Set(selectedActivityIds);
  const effectiveActivityIdSet = new Set(effectiveActivityIds);

  return (
    <DialogShell
      className="activity-selection-dialog"
      bodyClassName={cm(styles, "activity-selection-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="activity-selection"
      dialogState={activityDialogState}
      maximizeTitle=""
      onClose={onClose}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title="加载活动数据"
      titleId="activity-selection-dialog-title"
    >
      <div className={cm(styles, "activity-selection-list")}>
        {ACTIVITY_DEFINITIONS.map((activity) => {
          const isSelected = selectedActivityIdSet.has(activity.id);
          const isEffective = effectiveActivityIdSet.has(activity.id);
          const isOngoing = isActivityOngoing(activity);

          return (
            <label
              className={cm(styles, `activity-selection-row${isSelected ? " is-selected" : ""}`)}
              key={activity.id}
            >
              <img
                alt=""
                draggable={false}
                src={createPublicAssetUrl(activity.banner)}
              />
              <span aria-hidden="true" className={cm(styles, "activity-selection-banner-tint")} />
              <span className={cm(styles, "activity-selection-row-controls")}>
                <input
                  checked={isSelected}
                  onChange={(event) => onToggleActivity(activity.id, event.currentTarget.checked)}
                  type="checkbox"
                />
                <span className={cm(styles, "activity-selection-row-copy")}>
                  <strong className={cm(styles, "sr-only")}>{activity.name}</strong>
                  <span>{formatActivityTimeRange(activity.startTime, activity.endTime)}</span>
                </span>
                <span className={cm(styles, "activity-selection-row-badges")}>
                  {isOngoing ? <span className={cm(styles, "activity-selection-badge")}>进行中</span> : null}
                  {isEffective ? <span className={cm(styles, "activity-selection-badge")}>生效</span> : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </DialogShell>
  );
}

function scrollSettingsDialogContentToSection(options: {
  contentElement: HTMLDivElement;
  selectedSection: HTMLElement;
}): void {
  const { contentElement, selectedSection } = options;
  const contentRect = contentElement.getBoundingClientRect();
  const sectionRect = selectedSection.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    contentElement.scrollTop + sectionRect.top - contentRect.top - SETTINGS_DIALOG_SECTION_SCROLL_OFFSET,
  );

  if (typeof contentElement.scrollTo === "function") {
    contentElement.scrollTo({ top: nextScrollTop });
    return;
  }

  contentElement.scrollTop = nextScrollTop;
}

function findWorkbenchSettingDefinition(settingId: string): WorkbenchSettingDefinition | null {
  for (const group of WORKBENCH_SETTINGS_GROUPS) {
    const setting = group.items.find((item) => item.id === settingId);
    if (setting !== undefined) {
      return setting;
    }
  }

  return null;
}

function resolveSettingLabel(
  setting: WorkbenchSettingDefinition,
  translate: AppHost["actions"]["translate"],
): string {
  if (typeof setting.labelText === "string") {
    return setting.labelText;
  }

  return setting.labelKey ? translate(setting.labelKey) : "";
}

function resolveSettingDescription(
  setting: WorkbenchSettingDefinition,
  translate: AppHost["actions"]["translate"],
): string {
  if (typeof setting.descriptionText === "string") {
    return setting.descriptionText;
  }

  return setting.descriptionKey ? translate(setting.descriptionKey) : "";
}

function renderSettingControl(options: {
  controller: WorkbenchSettingsDialogController;
  setting: WorkbenchSettingDefinition;
  t: AppHost["actions"]["translate"];
  isEditable: boolean;
  onSelectValue?: (settingId: string, value: string) => void;
  onRequestToggleExperimentalFeatures?: () => void;
}) {
  const {
    controller,
    setting,
    t,
    isEditable,
    onSelectValue,
    onRequestToggleExperimentalFeatures,
  } = options;
  const value = controller.getValue(setting.id);

  if (setting.kind === "text" || setting.kind === "password") {
    return (
      <label className={cm(styles, "settings-dialog-text-shell")} htmlFor={`setting-${setting.id}`}>
        <input
          autoComplete="off"
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          name={setting.id}
          onChange={(event) => {
            controller.updateTextValue(setting.id, event.target.value);
          }}
          placeholder={setting.placeholderText}
          type={setting.kind === "password" ? "password" : "text"}
          value={typeof value === "string" ? value : setting.defaultValue}
        />
      </label>
    );
  }

  if (setting.kind === "select") {
    return (
      <label className={cm(styles, "settings-dialog-field-shell")} htmlFor={`setting-${setting.id}`}>
        <select
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          name={setting.id}
          onChange={(event) => {
            // AI-REMOVED 2026-08-24:
            // Reason: provider 下拉框还必须打开对应配置对话框，不能只更新选中值。
            // Trigger: 用户要求切换同步方式后必须进入设置完成确认。
            // Evidence: handleSelectSettingValue 在保持通用 select 行为的同时处理同步配置入口。
            // Replacement: 下方 onSelectValue 分支。
            // Risk: Low。
            // Human Review: Required
            //
            // Original code:
            // controller.updateSelectValue(setting.id, event.target.value);
            if (onSelectValue === undefined) {
              controller.updateSelectValue(setting.id, event.target.value);
              return;
            }
            onSelectValue(setting.id, event.target.value);
          }}
          value={typeof value === "string" ? value : setting.defaultValue}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (setting.kind === "slider") {
    const numericValue = typeof value === "number" ? value : setting.defaultValue;

    return (
      <label className={cm(styles, "settings-dialog-slider-shell")} htmlFor={`setting-${setting.id}`}>
        <input
          disabled={!isEditable}
          id={`setting-${setting.id}`}
          max={setting.max}
          min={setting.min}
          name={setting.id}
          onChange={(event) => {
            controller.updateSliderValue(setting.id, Number(event.target.value));
          }}
          step={setting.step}
          type="range"
          value={numericValue}
        />
        <span className={cm(styles, "settings-dialog-slider-value")}>
          {numericValue}{setting.valueSuffix ?? ""}
        </span>
      </label>
    );
  }

  /* AI-REMOVED 2026-08-03:
  Reason: 通用设置控件渲染器不再承载快捷键录入按钮。
  Trigger: ST2-RQ-002 新建独立快捷键设置对话框。
  Evidence: KeyboardShortcutSettingsDialog 每行渲染两个图片化快捷键选择框。
  Replacement: keyboard-shortcut-settings-dialog.tsx。
  Risk: Low
  Human Review: Required

  Original code:
  if (setting.kind === "keybinding") {
    const isCapturing = capturingKeybindingId === setting.id;
    const buttonLabel = isCapturing
      ? t("settingsKeybinding.awaitingInput")
      : (typeof value === "string" ? value : setting.defaultValue);

    return (
      <button
        aria-pressed={isCapturing}
        className={cm(styles, isCapturing
          ? "settings-dialog-keybinding-button is-capturing"
          : "settings-dialog-keybinding-button")}
        data-setting-id={setting.id}
        disabled={!isEditable}
        id={`setting-${setting.id}`}
        onClick={(event) => {
          event.preventDefault();
        }}
        onMouseDown={(event) => {
          event.preventDefault();

          if (!isEditable) {
            return;
          }

          onStartCapturing(setting.id);
        }}
        title={buttonLabel}
        type="button"
      >
        {buttonLabel}
      </button>
    );
  }
  */

  const checked = typeof value === "boolean" ? value : setting.defaultValue;

  return (
    <label
      className={cm(styles, isEditable
        ? "settings-dialog-switch-shell"
        : "settings-dialog-switch-shell is-disabled")}
      htmlFor={`setting-${setting.id}`}
    >
      <input
        checked={checked}
        disabled={!isEditable}
        id={`setting-${setting.id}`}
        name={setting.id}
        onChange={(event) => {
          if (setting.id === "other-experimental-features" && event.target.checked && onRequestToggleExperimentalFeatures) {
            onRequestToggleExperimentalFeatures();
            return;
          }
          controller.updateSwitchValue(setting.id, event.target.checked);
        }}
        type="checkbox"
      />
      <span className={cm(styles, "settings-dialog-switch-track")} aria-hidden="true">
        <span className={cm(styles, "settings-dialog-switch-thumb")} />
      </span>
      <span className={cm(styles, "settings-dialog-switch-label")}>
        {t(checked ? "settingsOption.enabled" : "settingsOption.disabled")}
      </span>
    </label>
  );
}

/* AI-REMOVED 2026-08-03:
Reason: 快捷键捕获格式化、键名规范化与 modifier-only 判断已迁入独立快捷键设置对话框。
Trigger: ST2-RQ-002 要求相关规则与帮助函数统一收拢。
Evidence: keyboard-shortcut-settings-dialog.tsx 已提供同名职责函数，并增加双槽位与 Escape 禁止规则。
Replacement: keyboard-shortcut-settings-dialog.tsx。
Risk: Low
Human Review: Required

Original code:
function formatCapturedKeybinding(event: KeyboardEvent): string | null {
  if (isModifierOnlyKey(event.key)) {
    return null;
  }

  const keyLabel = normalizeCapturedKeyLabel(event.key);
  if (keyLabel === null) {
    return null;
  }

  const parts: string[] = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.metaKey) {
    parts.push("Meta");
  }

  if (!parts.includes(keyLabel)) {
    parts.push(keyLabel);
  }

  return parts.join("+");
}

function normalizeCapturedKeyLabel(key: string): string | null {
  if (key === "") {
    return null;
  }

  if (key === " ") {
    return "Space";
  }

  if (key === "Escape") {
    return "Esc";
  }

  if (key === "ArrowUp") {
    return "Up";
  }

  if (key === "ArrowDown") {
    return "Down";
  }

  if (key === "ArrowLeft") {
    return "Left";
  }

  if (key === "ArrowRight") {
    return "Right";
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key;
}

function isModifierOnlyKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}
*/

function formatActivityTimeRange(startTime: number | undefined, endTime: number | undefined): string {
  const formatTime = (timestamp: number) => new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(timestamp);

  if (startTime !== undefined && endTime !== undefined) {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  }

  if (startTime !== undefined) {
    return `${formatTime(startTime)} 起`;
  }

  if (endTime !== undefined) {
    return `${formatTime(endTime)} 止`;
  }

  return "长期";
}

// ─── 重置确认对话框 ───

interface ConfirmResetDialogProps {
  confirmDialogState: DialogStateReadWrite;
  onCancel: () => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
  titleKey?: string;
  confirmMessageKey?: string;
}

function ConfirmResetDialog({
  confirmDialogState,
  onCancel,
  onConfirm,
  t,
  titleKey,
  confirmMessageKey,
}: ConfirmResetDialogProps) {
  const title = titleKey ? t(titleKey as Parameters<typeof t>[0]) : t("settingsAction.resetOperationAndShortcuts");
  const message = confirmMessageKey
    ? t(confirmMessageKey as Parameters<typeof t>[0])
    : t("settingsAction.resetOperationAndShortcutsConfirm");

  return (
    <DialogShell
      className="confirm-reset-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="confirm-reset"
      dialogState={confirmDialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={title}
      titleId="confirm-reset-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p>{message}</p>
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("action.cancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            onClick={onConfirm}
            type="button"
          >
            {t("action.confirm")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ─── 清空存储二次确认输入框 ───

interface ClearStorageInputDialogProps {
  confirmDialogState: DialogStateReadWrite;
  expectedText: string;
  inputValue: string;
  isValid: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
  titleKey?: string;
  promptKey?: string;
  confirmButtonKey?: string;
}

function ClearStorageInputDialog({
  confirmDialogState,
  expectedText,
  inputValue,
  isValid,
  onCancel,
  onChange,
  onConfirm,
  t,
  titleKey,
  promptKey,
  confirmButtonKey,
}: ClearStorageInputDialogProps) {
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && isValid) {
      onConfirm();
    }
  }, [isValid, onConfirm]);

  return (
    <DialogShell
      className="clear-storage-input-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="clear-storage-input"
      dialogState={confirmDialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t(titleKey ?? "settingsAction.experimental-clear-storage-final-title")}
      titleId="clear-storage-input-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p className={cm(styles, "clear-storage-input-prompt")}>
          {t(promptKey ?? "settingsAction.experimental-clear-storage-final-prompt")}
        </p>
        <p className={cm(styles, "clear-storage-input-expected")}>
          {expectedText}
        </p>
        <input
          autoFocus
          className={cm(styles, "clear-storage-input-field")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={expectedText}
          type="text"
          value={inputValue}
        />
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("action.cancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            disabled={!isValid}
            onClick={onConfirm}
            type="button"
          >
            {t(confirmButtonKey ?? "settingsAction.experimental-clear-storage-final-confirm")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ─── 快捷键冲突对话框 ───

/* AI-REMOVED 2026-08-03:
Reason: 快捷键冲突对话框已迁入独立快捷键设置模块，并升级为逐槽冲突处理和图片化键位展示。
Trigger: ST2-RQ-002 快捷键录入收拢与图片化展示。
Evidence: KeyboardShortcutConflictDialog 位于 keyboard-shortcut-settings-dialog.tsx。
Replacement: keyboard-shortcut-settings-dialog.tsx。
Risk: Low
Human Review: Required

Original code:
interface ConflictDialogProps {
  conflictDialogState: {
    visible: boolean;
    currentSettingId: string | null;
    conflictSettingId: string | null;
    newKeyValue: string | null;
  };
  controller: WorkbenchSettingsDialogController;
  onCancel: () => void;
  onConfirm: () => void;
  t: AppHost["actions"]["translate"];
}

function ConflictDialog({
  conflictDialogState,
  controller,
  onCancel,
  onConfirm,
  t,
}: ConflictDialogProps) {
  const conflictLabel = useMemo(() => {
    if (conflictDialogState.conflictSettingId === null) return "";
    return resolveSettingLabelById(conflictDialogState.conflictSettingId, controller, t);
  }, [conflictDialogState.conflictSettingId, controller, t]);

  const newKey = conflictDialogState.newKeyValue ?? "";

  const message = t("settingsKeybinding.conflictMessage")
    .replace("{newKey}", newKey)
    .replace("{conflictLabel}", conflictLabel);

  // 为 ConflictDialog 创建一个简单的 DialogStateReadWrite
  const dialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: conflictDialogState.visible,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 420,
    height: null,
    activeTab: null,
  }), [conflictDialogState.visible]);

  return (
    <DialogShell
      className="conflict-dialog"
      bodyClassName={cm(styles, "confirm-reset-dialog-body")}
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="shortcut-conflict"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t("settingsKeybinding.conflictTitle")}
      titleId="shortcut-conflict-dialog-title"
    >
      <div className={cm(styles, "confirm-reset-content")}>
        <p>{message}</p>
        <div className={cm(styles, "confirm-reset-actions")}>
          <button
            className={cm(styles, "confirm-reset-cancel-btn")}
            onClick={onCancel}
            type="button"
          >
            {t("settingsKeybinding.conflictCancel")}
          </button>
          <button
            className={cm(styles, "confirm-reset-confirm-btn")}
            onClick={onConfirm}
            type="button"
          >
            {t("settingsKeybinding.conflictReplace")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
*/

// AI-REMOVED 2026-07-29:
// Reason: 冲突窗口已成为 Workbench 顶层 system overlay，不能由 SettingsDialog 私有实现。
// Trigger: SettingsDialog 未打开时该函数没有调用点，导致冲突等待永久遮住画布。
// Evidence: OverlayStack 已有 system 层；独立组件可直接订阅 SyncContract public state。
// Replacement: ./webdav-conflict-dialog.tsx。
// Risk: Low。
// Human Review: Required
//
// Original code:
// function WebDavConflictDialog({
//   conflict,
//   dialogState,
//   onResolve,
//   t,
// }: {
//   conflict: SyncPendingConflict;
//   dialogState: DialogStateReadWrite;
//   onResolve: (resolution: SyncConflictResolution) => void;
//   t: AppHost["actions"]["translate"];
// }) {
//   return (
//     <DialogShell
//       className="webdav-conflict-dialog"
//       bodyClassName={cm(styles, "confirm-reset-dialog-body")}
//       closeTitle={t("action.close")}
//       compactMobileLayout={false}
//       dialogKey="webdav-conflict"
//       dialogState={dialogState}
//       maximizeTitle=""
//       onClose={() => onResolve("pause")}
//       onToggleMaximized={() => {}}
//       restoreTitle=""
//       showMaximizeButton={false}
//       title={t("settingsField.experimental-webdav-conflict-title")}
//       titleId="webdav-conflict-dialog-title"
//     >
//       <div className={cm(styles, "confirm-reset-content")}>
//         <p>{t("settingsField.experimental-webdav-conflict-message").replace("{remoteDeviceLabel}", conflict.remoteDeviceLabel)}</p>
//         <p>{conflict.adapterId} / {conflict.assetId}</p>
//         <div className={cm(styles, "confirm-reset-actions")}>
//           <button className={cm(styles, "confirm-reset-confirm-btn")} onClick={() => onResolve("use-local")} type="button">
//             {t("settingsField.experimental-webdav-conflict-use-local")}
//           </button>
//           <button className={cm(styles, "confirm-reset-confirm-btn")} onClick={() => onResolve("use-remote")} type="button">
//             {t("settingsField.experimental-webdav-conflict-use-remote").replace("{remoteDeviceLabel}", conflict.remoteDeviceLabel)}
//           </button>
//           <button className={cm(styles, "confirm-reset-cancel-btn")} onClick={() => onResolve("pause")} type="button">
//             {t("settingsField.experimental-webdav-conflict-pause")}
//           </button>
//         </div>
//       </div>
//     </DialogShell>
//   );
// }

/* AI-REMOVED 2026-08-03:
Reason: 通用设置页不再解析快捷键冲突条目的标签。
Trigger: 快捷键冲突对话框迁入独立模块。
Evidence: keyboard-shortcut-settings-dialog.tsx 使用 KEYBOARD_SHORTCUT_SETTING_BY_ID 解析标签。
Replacement: keyboard-shortcut-settings-dialog.tsx。
Risk: Low
Human Review: Required

Original code:
// 根据 setting id 解析显示标签
function resolveSettingLabelById(
  settingId: string,
  controller: WorkbenchSettingsDialogController,
  translate: AppHost["actions"]["translate"],
): string {
  // 通过 WORKBENCH_SETTINGS_GROUPS 查找
  for (const group of WORKBENCH_SETTINGS_GROUPS) {
    for (const setting of group.items) {
      if (setting.id === settingId) {
        return resolveSettingLabel(setting, translate);
      }
    }
  }

  return settingId;
}
*/
