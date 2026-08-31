import { action } from "mobx";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import { BottomStatusBar } from "@/app/shell/layout/bottom-status-bar";
import { CanvasBottomLeftToolbar } from "@/app/shell/canvas/canvas-bottom-left-toolbar";
import { CanvasBottomLeftSecondaryToolbar } from "@/app/shell/canvas/canvas-bottom-left-secondary-toolbar";
import { CanvasPanel } from "@/app/shell/canvas/canvas-panel";
import { CanvasFloatingToolbar } from "@/app/shell/canvas/canvas-floating-toolbar";
import { CanvasTopLeftCornerToolbar } from "@/app/shell/canvas/canvas-top-left-corner-toolbar";
import { CanvasRightDockToolbar } from "@/app/shell/canvas/canvas-right-dock-toolbar";
import { OverlapEntityMenu } from "@/app/shell/canvas/overlap-entity-menu";
import { QuickPlacePopup } from "@/app/shell/quick-place/quick-place-popup";
import { FullscreenToggleButton } from "@/app/shell/layout/fullscreen-toggle-button";
// AI-REMOVED 2026-08-23:
// Reason: 手机旋转不再自动请求全屏，Workbench 只负责把用户点击失败转交给 PWA 引导。
// Trigger: 用户确认全屏/PWA 提示只能由全屏按钮点击触发，不能主动打扰。
// Evidence: Fullscreen API 要求瞬时用户激活；orientationchange 后的 effect 不具备该条件。
// Replacement: FullscreenToggleButton.onFullscreenActionFailure。
// Risk: Low；用户仍可从顶栏、悬浮入口或竖屏 Gate 主动请求全屏。
// Human Review: Required
//
// Original code:
// import {
//   FullscreenToggleButton,
//   requestDocumentFullscreen,
//   resolveFullscreenState,
// } from "@/app/shell/layout/fullscreen-toggle-button";
import { DebugLogDialog } from "@/app/shell/dialogs/debug-log-dialog";
import { FeedbackDialog } from "@/app/shell/dialogs/feedback-dialog";
import { BaseSelectDialog } from "@/app/shell/dialogs/base-select-dialog";
import { BlueprintFolderDialog } from "@/app/shell/dialogs/blueprint-folder-dialog";
import { BlueprintPreviewDialog } from "@/app/shell/dialogs/blueprint-preview-dialog";
import { HelpDialog } from "@/app/shell/dialogs/help-dialog";
import { InspectorDialog } from "@/app/shell/dialogs/inspector-dialog";
import { MobilePortraitGate } from "@/app/shell/layout/mobile-portrait-gate";
import { RecipePickerDialog } from "@/app/shell/dialogs/recipe-picker-dialog";
import { SaveBlueprintDialog } from "@/app/shell/dialogs/save-blueprint-dialog";
import { SettingsDialog } from "@/app/shell/dialogs/settings-dialog";
import { V2MigrationDialog } from "@/app/shell/dialogs/v2-migration-dialog";
import { WarehouseStatsDialog } from "@/app/shell/dialogs/warehouse-stats-dialog";
import { SyncConflictDialog } from "@/app/shell/dialogs/sync-conflict-dialog";
import { EncyclopediaPickerDialog } from "@/app/shell/encyclopedia/encyclopedia-picker-dialog";
import {
  ToolboxBottomDock,
  ToolboxDialog,
  resolveToolboxBottomDockGridHeight,
} from "@/app/shell/dialogs/toolbox-dialog";
import {
  TimelineBottomDock,
  TimelineDialog,
  resolveTimelineBottomDockGridHeight,
} from "@/app/shell/dialogs/timeline-dialog";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { PwaController } from "@/app/pwa/pwa-controller";
import { PwaGateway } from "@/app/pwa/pwa-gateway";
import { createAppTelemetryController } from "@/app/telemetry";
import LeftDock from "@/app/shell/layout/left-dock";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { V2MigrationController } from "@/app/migration";
import { WorkbenchSettingsDialogController } from "@/app/shell/state/settings-dialog-state";
import { regionalSimulationUiState } from "@/app/state/regional-simulation-ui-state";
import { writeRegionalMultiBaseExperimentalEnabled } from "@/shared/storage/regional-simulation-settings";
import { RightDock } from "@/app/shell/layout/right-dock";
import { SimulationControlButton, TimelineButton, TopBar } from "@/app/shell/layout/top-bar";
import {
  readSelectedSyncProvider,
  requestSyncProvider,
} from "@/shared/storage/sync-provider-activation";
// AI-REMOVED 2026-08-24:
// Reason: app 模块不应跨模块调用 sync 内部 provider 存储入口。
// Trigger: provider 选择现由 shared 两阶段激活状态统一持久化。
// Evidence: 项目模块隔离规范只允许 app 引用 shared 与 domain。
// Replacement: readSelectedSyncProvider / requestSyncProvider。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { readSyncProvider, writeSyncProvider } from "@/sync/sync-providers";
import {
  SyncInitialSyncFeatureGate,
  SyncInitialSyncGate,
} from "@/app/shell/layout/sync-initial-sync-gate";
// AI-REMOVED 2026-07-29:
// Reason: 保存提示不再作为折叠顶栏第一排按钮组成员。
// Trigger: 用户要求隐藏顶栏时位于右上角第二排最右侧。
// Evidence: 第一排内提示会被 FPS 布局推动或挤压。
// Replacement: CanvasPanel 内独立定位的 WebDavSaveIndicator。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { WebDavSaveIndicator } from "@/app/shell/layout/webdav-save-indicator";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import {
  preventMiddleMousePointerDownBrowserBehavior,
  preventNativeBrowserEvent,
} from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state/state-impl";
import { resolveLeftDockWidthForScreenProfile } from "@/app/state/state-impl";
import type { AppThemeId } from "@/domain/app/types/theme";
import { publishDebugModeEnabled } from "@/shared/logging/debug-mode-runtime";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  setLogLevel,
} from "@/shared/logging/logger";
import {
  readBackendApiAddressOverride,
  writeBackendApiAddressOverride,
} from "@/shared/storage/backend-api-address";
// AI-REMOVED 2026-07-29:
// Reason: 设置界面不再直接读写 WebDAV localStorage。
// Trigger: 同步模块必须通过公开 state/action 自治。
// Evidence: 直接调用 read/writeWebDavSync* 会绕过 MobX 状态，导致开关需刷新才更新。
// Replacement: WorkspaceContract.sync.state.settings 与 SyncAction.updateSettings。
// Risk: Low；持久化仍由 sync 模块使用相同 key 完成。
// Human Review: Required
//
// Original code:
// import { readWebDavSyncEnabled, readWebDavSyncPassword, readWebDavSyncUrl,
//   readWebDavSyncUsername, writeWebDavSyncEnabled, writeWebDavSyncPassword,
//   writeWebDavSyncUrl, writeWebDavSyncUsername } from "@/shared/storage/webdav-sync-settings";
import {
  isMobileOrTabletScreenProfile,
  isMobilePortraitScreenProfile,
  isTouchLandscapeScreenProfile,
  resetScreenProfileConsoleDiagnosticsForTest,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";
// AI-REMOVED 2026-08-23:
// Reason: Workbench 不再识别“竖屏转横屏”以自动请求全屏。
// Trigger: 用户要求只在点击全屏按钮时执行全屏或展示引导。
// Evidence: screenProfile 仍用于布局；isMobileLandscapeScreenProfile 仅服务于已移除的自动全屏 effect。
// Replacement: None。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import { isMobileLandscapeScreenProfile } from "@/shared/browser/screen-profile";
import {
  resolveEffectiveCanvasTheme,
  resolveInCanvasThemeCssVariables,
} from "@/shared/theme/canvas-theme";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  loadChangelogIndexEntries,
  normalizeChangelogVersionText,
  resolveCurrentVersionChangelogKey,
} from "@/app/shell/dialogs/changelog-data";

const CHANGELOG_READ_STATE_KEY = "industrial-planner-changelog-read-state";
const LEGACY_LAST_READ_VERSION_KEY = "industrial-planner-changelog-last-read-version";

interface ChangelogReadState {
  version: string;
  changelogKey: string;
}

function isAppThemeId(value: unknown): value is AppThemeId {
  return value === "ayu-light" || value === "ayu-dark";
}

function normalizeStoredChangelogVersion(version: string): string {
  return normalizeChangelogVersionText(version) ?? version;
}

function isChangelogReadState(value: unknown): value is ChangelogReadState {
  return typeof value === "object"
    && value !== null
    && typeof (value as ChangelogReadState).version === "string"
    && typeof (value as ChangelogReadState).changelogKey === "string";
}

function readChangelogReadState(): ChangelogReadState | null {
  const rawState = localStorage.getItem(CHANGELOG_READ_STATE_KEY);

  if (rawState !== null) {
    try {
      const parsed: unknown = JSON.parse(rawState);

      if (isChangelogReadState(parsed)) {
        return {
          version: normalizeStoredChangelogVersion(parsed.version),
          changelogKey: parsed.changelogKey,
        };
      }
    } catch {
      // 损坏的结构化状态会回退到旧版已读版本。
    }
  }

  const legacyVersion = localStorage.getItem(LEGACY_LAST_READ_VERSION_KEY);

  if (legacyVersion === null || legacyVersion.length === 0) {
    return null;
  }

  return {
    version: normalizeStoredChangelogVersion(legacyVersion),
    changelogKey: "",
  };
}

function writeChangelogReadState(state: ChangelogReadState): void {
  localStorage.setItem(CHANGELOG_READ_STATE_KEY, JSON.stringify(state));
  localStorage.setItem(LEGACY_LAST_READ_VERSION_KEY, state.version);
}

export const WorkbenchApp = observer(function WorkbenchApp({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const [pwaController] = useState(() => new PwaController());
  const [migrationController] = useState(() => new V2MigrationController());
  const [settingsDialog] = useState(() => new WorkbenchSettingsDialogController({
    externalBindings: {
      "system-language": {
        readValue: () => appHost.state.settings.locale,
        writeValue: (value) => {
          if (value === "zh-CN" || value === "en-US") {
            appHost.internalActions.setLocale(value);
          }
        },
      },
      "system-theme": {
        readValue: () => appHost.state.settings.themeId,
        writeValue: action((value) => {
          if (!isAppThemeId(value)) {
            return;
          }

          if (appHost.internalState.settings.themeId === value) {
            return;
          }

          appHost.internalState.settings.themeId = value;
        }),
      },
      // AI-REMOVED 2026-05-26:
      // Reason: 鹰角网络操作模式开关已从设置面板移除，对应的 readValue/writeValue 绑定不再需要。
      // Trigger: 用户需求 — 取消该设置的图像化入口。
      // Evidence: 设置项 game-arknights-operation-mode 已从 settings-dialog-state.ts 移除。
      // Replacement: None（字段 hypergryphOperationMode 仍保留于 state，但不再通过设置面板读写）。
      // Risk: Low
      // Human Review: Not Required
      //
      // Original code:
      // "game-arknights-operation-mode": {
      //   readValue: () => appHost.state.settings.hypergryphOperationMode,
      //   writeValue: action((value) => {
      //     if (typeof value !== "boolean") {
      //       return;
      //     }
      //     if (appHost.internalState.settings.hypergryphOperationMode === value) {
      //       return;
      //     }
      //     appHost.internalState.settings.hypergryphOperationMode = value;
      //   }),
      // },
      "game-arknights-immediate-move": {
        readValue: () => appHost.state.settings.hypergryphImmediateMove,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphImmediateMove === value) {
            return;
          }

          appHost.internalState.settings.hypergryphImmediateMove = value;
        }),
      },
      "game-quick-place": {
        readValue: () => appHost.internalState.settings.quickPlaceEnabled,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.quickPlaceEnabled === value) {
            return;
          }

          appHost.internalState.settings.quickPlaceEnabled = value;
          if (!value) {
            appHost.internalState.runtime.quickPlace.visible = false;
            appHost.internalState.runtime.quickPlace.anchor = null;
            appHost.internalState.runtime.quickPlace.searchQuery = "";
            appHost.internalState.runtime.quickPlace.openSource = null;
          }
        }),
      },
      "game-arknights-copy-while-moving": {
        readValue: () => appHost.state.settings.hypergryphCopyWhileMoving,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphCopyWhileMoving === value) {
            return;
          }

          appHost.internalState.settings.hypergryphCopyWhileMoving = value;
        }),
      },
      "game-arknights-immediate-marquee": {
        readValue: () => appHost.state.settings.hypergryphImmediateMarquee,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphImmediateMarquee === value) {
            return;
          }

          appHost.internalState.settings.hypergryphImmediateMarquee = value;
        }),
      },
      "game-arknights-allow-empty-logistics-endpoints": {
        readValue: () => appHost.state.settings.hypergryphAllowEmptyLogisticsEndpoints,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints === value) {
            return;
          }

          appHost.internalState.settings.hypergryphAllowEmptyLogisticsEndpoints = value;
        }),
      },
      "game-arknights-auto-create-splitters-and-convergers": {
        readValue: () => appHost.state.settings.hypergryphAutoCreateSplittersAndConvergers,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (
            appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers === value
          ) {
            return;
          }

          appHost.internalState.settings.hypergryphAutoCreateSplittersAndConvergers = value;
        }),
      },
      "game-arknights-selection-right-dock-sync": {
        readValue: () => appHost.state.settings.hypergryphSelectionRightDockSync,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphSelectionRightDockSync === value) {
            return;
          }

          appHost.internalState.settings.hypergryphSelectionRightDockSync = value;
        }),
      },
      "game-arknights-inspector-open-on-second-click": {
        readValue: () => appHost.state.settings.hypergryphInspectorOpenOnSecondClick,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick === value) {
            return;
          }

          appHost.internalState.settings.hypergryphInspectorOpenOnSecondClick = value;
        }),
      },
      "game-show-hotkeys": {
        readValue: () => appHost.state.settings.gameShowHotkeys,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameShowHotkeys === value) {
            return;
          }

          appHost.internalState.settings.gameShowHotkeys = value;
        }),
      },
      "game-collapse-device-modes": {
        readValue: () => appHost.state.settings.collapseDeviceModes,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.collapseDeviceModes === value) {
            return;
          }

          appHost.internalState.settings.collapseDeviceModes = value;
        }),
      },
      "game-show-pipe-exact-fluid-position": {
        readValue: () => appHost.state.settings.gameShowPipeExactFluidPosition,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameShowPipeExactFluidPosition === value) {
            return;
          }

          appHost.internalState.settings.gameShowPipeExactFluidPosition = value;
        }),
      },
      "game-show-device-names": {
        readValue: () => appHost.state.settings.gameShowDeviceNames,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameShowDeviceNames === value) {
            return;
          }

          appHost.internalState.settings.gameShowDeviceNames = value;
        }),
      },
      "game-show-device-icons": {
        readValue: () => appHost.state.settings.gameShowDeviceIcons,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages) {
            if (!appHost.internalState.settings.gameShowDeviceIcons) {
              appHost.internalState.settings.gameShowDeviceIcons = true;
            }

            return;
          }

          if (appHost.internalState.settings.gameShowDeviceIcons === value) {
            return;
          }

          appHost.internalState.settings.gameShowDeviceIcons = value;
        }),
      },
      "game-use-blueprint-style-device-images": {
        readValue: () => appHost.state.settings.gameUseBlueprintStyleDeviceImages,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          const shouldEnforceLinkedSettings = value
            && (
              !appHost.internalState.settings.gameAlwaysShowGridLines
              || appHost.internalState.settings.showGrassBackground
              || !appHost.internalState.settings.gameShowDeviceIcons
            );

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages === value
            && !shouldEnforceLinkedSettings) {
            return;
          }

          appHost.internalState.settings.gameUseBlueprintStyleDeviceImages = value;

          if (value) {
            appHost.internalState.settings.gameAlwaysShowGridLines = true;
            appHost.internalState.settings.showGrassBackground = false;
            appHost.internalState.settings.gameShowDeviceIcons = true;
          }
        }),
      },
      "game-use-inspector-panel": {
        readValue: () => appHost.state.settings.gameUseInspectorPanel,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseInspectorPanel === value) {
            return;
          }

          appHost.internalState.settings.gameUseInspectorPanel = value;
        }),
      },
      "game-always-show-grid-lines": {
        readValue: () => appHost.state.settings.gameAlwaysShowGridLines,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages) {
            if (!appHost.internalState.settings.gameAlwaysShowGridLines) {
              appHost.internalState.settings.gameAlwaysShowGridLines = true;
            }

            return;
          }

          if (appHost.internalState.settings.gameAlwaysShowGridLines === value) {
            return;
          }

          appHost.internalState.settings.gameAlwaysShowGridLines = value;
        }),
      },
      "game-always-show-power-range": {
        readValue: () => appHost.state.settings.gameAlwaysShowPowerRange,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameAlwaysShowPowerRange === value) {
            return;
          }

          appHost.internalState.settings.gameAlwaysShowPowerRange = value;
        }),
      },
      "game-show-grass-background": {
        readValue: () => appHost.state.settings.showGrassBackground,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseBlueprintStyleDeviceImages) {
            if (appHost.internalState.settings.showGrassBackground) {
              appHost.internalState.settings.showGrassBackground = false;
            }

            return;
          }

          if (appHost.internalState.settings.showGrassBackground === value) {
            return;
          }

          appHost.internalState.settings.showGrassBackground = value;
        }),
      },
      "debug-show-fps": {
        readValue: () => appHost.state.settings.debugShowFps,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugShowFps === value) {
            return;
          }

          appHost.internalState.settings.debugShowFps = value;
        }),
      },
      "debug-show-gesture-diagnostics-window": {
        readValue: () => appHost.state.settings.debugShowGestureDiagnosticsWindow,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugShowGestureDiagnosticsWindow === value) {
            return;
          }

          appHost.internalState.settings.debugShowGestureDiagnosticsWindow = value;
        }),
      },
      "debug-simulation-worker-detailed-report": {
        readValue: () => appHost.internalState.settings.debugSimulationWorkerDetailedReport,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugSimulationWorkerDetailedReport === value) {
            return;
          }

          appHost.internalState.settings.debugSimulationWorkerDetailedReport = value;
        }),
      },
      "debug-backend-api-address-override": {
        readValue: () => readBackendApiAddressOverride(),
        writeValue: (value) => {
          if (typeof value === "string") {
            writeBackendApiAddressOverride(value);
          }
        },
      },
      "other-debug-mode": {
        readValue: () => appHost.state.settings.debugMode,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.debugMode === value) {
            return;
          }

          appHost.internalState.settings.debugMode = value;

          // 关闭调试模式时，同步关闭级联子选项
          if (!value) {
            appHost.internalState.settings.debugShowFps = false;
            appHost.internalState.settings.debugShowGestureDiagnosticsWindow = false;
            appHost.internalState.settings.debugSimulationWorkerDetailedReport = false;
            appHost.internalState.settings.virtualMousePointer = false;
          }
        }),
      },
      "experimental-regional-multi-base": {
        readValue: () => regionalSimulationUiState.experimentalEnabled,
        writeValue: action((value) => {
          if (typeof value === "boolean") {
            regionalSimulationUiState.experimentalEnabled = value;
            writeRegionalMultiBaseExperimentalEnabled(value);
            if (!value) {
              // AI-REMOVED 2026-08-19:
              // Reason: App UI state 不再保存多基地模式副本。
              // Trigger: SimulationMode 单一事实源改造。
              // Evidence: 下方 Simulation Action 已负责切回 single-base。
              // Replacement: appHost.workspace.simulation.state.simulationMode。
              // Risk: Low
              // Human Review: Required
              //
              // Original code:
              // regionalSimulationUiState.allBasesEnabled = false;
              // AI-REMOVED 2026-08-19:
              // Reason: 关闭开发期实验开关只能停用当前有效模式，不能清除已经同步的用户选择。
              // Trigger: 用户要求多基地选择具备记忆，且实验性开关保持设备本地。
              // Evidence: main.tsx 根据实验开关与 RegionalSettingsController.multiBaseEnabled 派生 SimulationMode。
              // Replacement: src/main.tsx 的多基地有效模式 reaction。
              // Risk: Low
              // Human Review: Required
              //
              // Original code:
              // appHost.workspace.simulation?.actions.setRegionalMultiBaseEnabled(false);
              // AI-CORRECTION 2026-08-19: 上方旧注释所述“Action 已负责切回”不再有效；有效模式由组合根 reaction 负责。
            }
          }
        }),
      },
      "experimental-virtual-mouse-pointer": {
        readValue: () => appHost.state.settings.virtualMousePointer,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.virtualMousePointer === value) {
            return;
          }

          appHost.internalState.settings.virtualMousePointer = value;
        }),
      },
      "sync-provider": {
        readValue: () => readSelectedSyncProvider(),
        writeValue: action((value) => {
          requestSyncProvider(
            value === "webdav" || value === "cloudflare" ? value : "none",
          );
          // AI-CORRECTION 2026-08-24: provider 订阅会主动更新宿主；此调用仅兼容初始化期间尚未注册订阅的场景。
          appHost.workspace.sync?.actions.updateSettings({});
        }),
      },
      "other-toolbox-show-all-activity-content": {
        readValue: () => appHost.internalState.settings.toolboxShowAllActivityContent,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.toolboxShowAllActivityContent === value) {
            return;
          }

          appHost.internalState.settings.toolboxShowAllActivityContent = value;
        }),
      },
    },
    // AI-REMOVED 2026-08-03:
    // Reason: 通用设置控制器不再代理快捷键读写与重置。
    // Trigger: ST2-RQ-002 新建独立快捷键设置对话框。
    // Evidence: KeyboardShortcutSettingsDialog 直接调用 appHost internalActions。
    // Replacement: keyboard-shortcut-settings-dialog.tsx。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // // 所有 keybinding 类型设置统一走 shortcutReader/shortcutWriter
    // shortcutReader: (key) => appHost.internalActions.getKeyboardShortcutFor(key),
    // shortcutWriter: (key, value) => {
    //   appHost.internalActions.setShortcutFor(key, value);
    // },
    // shortcutResetAll: () => {
    //   appHost.internalActions.resetAllShortcutsToDefaults();
    // },
  }));
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const leftDockSuppressed = appHost.internalState.workbench.leftDockSuppressed;
  const effectiveLeftDockOpen = leftDockOpen && !leftDockSuppressed;
  const rightDockOpen = appHost.state.workbench.rightDockOpen;
  const useInspectorPanel = appHost.state.settings.gameUseInspectorPanel;
  const leftDockWidth = appHost.state.workbench.leftDockWidth;
  const topBarCollapsed = appHost.state.workbench.topBarCollapsed;
  const screenProfile = appHost.state.screenProfile;
  const activeTool = appHost.state.activeTool;
  const canvasFloatingToolbar = appHost.internalState.runtime.canvasFloatingToolbar;
  const canvasRightDockToolbar = appHost.internalState.runtime.canvasRightDockToolbar;
  const canvasTopLeftCornerToolbar = appHost.internalState.runtime.canvasTopLeftCornerToolbar;
  const canvasTopLeftCornerToolbarKey = `${canvasTopLeftCornerToolbar.buttonIds.join("|")}::${canvasTopLeftCornerToolbar.initialOffButtonIds.join("|")}`;
  const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
  const timelineBottomDockGridHeight = resolveTimelineBottomDockGridHeight(appHost);
  const showTimelineBottomDock = timelineBottomDockGridHeight > 0;
  const toolboxBottomDockGridHeight = showTimelineBottomDock
    ? 0
    : resolveToolboxBottomDockGridHeight(appHost);
  const showToolboxBottomDock = toolboxBottomDockGridHeight > 0;
  const bottomDockGridHeight = showTimelineBottomDock
    ? timelineBottomDockGridHeight
    : toolboxBottomDockGridHeight;
  const selectionCount = appHost.workspace.editor?.state.collections.selection.length ?? 0;
  const openInspectorOnSecondClick = appHost.state.settings.hypergryphInspectorOpenOnSecondClick;
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);
  const isCompactLeftToolbar = isTouchLayout;
  const effectiveLeftDockWidth = resolveLeftDockWidthForScreenProfile(leftDockWidth, screenProfile);
  const showFloatingTopBarControls = isTouchLandscape && topBarCollapsed;
  const showBottomStatusBar = !showFloatingTopBarControls;
  const showCanvasBottomLeftToolbar = !effectiveLeftDockOpen;
  const showMobilePortraitGate = isMobilePortraitScreenProfile(screenProfile);
  const showRightDock = useInspectorPanel && rightDockOpen;
  const canKeepInspectorDialogOpen = !useInspectorPanel
    && (activeTool === "select" || activeTool === "dark-pipe-link")
    && selectionCount === 1
    && appHost.state.toolInfo.darkPipeLink === null;
  const shouldAutoOpenInspectorDialog = canKeepInspectorDialogOpen && !openInspectorOnSecondClick;
  const floatingOpenRightDockLabel = `${t("action.open")} ${t("topBar.rightPanel")}`;
  // AI-REMOVED 2026-08-23:
  // Reason: 不再比较前后屏幕方向以自动进入全屏。
  // Trigger: 用户要求全屏动作和 PWA 引导都只由全屏按钮点击触发。
  // Evidence: previousScreenProfileRef 仅被自动全屏 effect 使用。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const previousScreenProfileRef = useRef(screenProfile);
  const prevUseInspectorPanelRef = useRef(useInspectorPanel);
  const hasVisibleDialogShell =
    isAnyDialogShellVisible(appHost, { showTimelineBottomDock, showToolboxBottomDock })
    || migrationController.dialogState.visible;
  const effectiveCanvasTheme = resolveEffectiveCanvasTheme(
    appHost.state.theme,
    appHost.state.settings.gameUseBlueprintStyleDeviceImages,
  );

  useEffect(() => {
    migrationController.initialize();
  }, [migrationController]);

  useEffect(() => {
    const telemetryController = createAppTelemetryController({
      readScreenProfile: () => appHost.state.screenProfile,
    });

    return () => {
      telemetryController.dispose();
    };
  }, [appHost]);

  // 版本检测：新版本自动弹出帮助对话框并切换到"版本更新"tab
  // AI-CORRECTION 2026-07-06: 现在必须同时满足版本变更与当前版本存在新的 changelog 条目，才自动弹出。
  useEffect(() => {
    const currentVersionText = (window as { __APP_VERSION__?: string }).__APP_VERSION__;

    if (currentVersionText === undefined || currentVersionText === "0.0.0-dev") {
      return;
    }

    const currentVersion = normalizeChangelogVersionText(currentVersionText);

    if (currentVersion === null) {
      return;
    }

    const currentVersionKey = currentVersion;
    let lastReadState: ChangelogReadState | null;

    try {
      lastReadState = readChangelogReadState();
    } catch {
      return;
    }

    let cancelled = false;

    async function checkChangelogAnnouncement() {
      try {
        const entries = await loadChangelogIndexEntries();

        if (cancelled) {
          return;
        }

        const currentChangelogKey = resolveCurrentVersionChangelogKey(entries, currentVersionText);

        if (currentChangelogKey === null) {
          return;
        }

        const versionChanged = lastReadState?.version !== currentVersionKey;
        const changelogChanged = lastReadState?.changelogKey !== currentChangelogKey;

        if (!versionChanged || !changelogChanged) {
          return;
        }

        // 记录已读版本
        try {
          writeChangelogReadState({
            version: currentVersionKey,
            changelogKey: currentChangelogKey,
          });
        } catch {
          // 静默忽略
        }

        if (screenProfile.deviceClass !== "mobile") {
          // 计算 80% 屏幕宽高
          const width = Math.floor(window.innerWidth * 0.8);
          const height = Math.floor(window.innerHeight * 0.8);

          appHost.internalActions.setDialogSize("help", width, height);
        }

        appHost.internalActions.setDialogTab("help", "version");
        appHost.internalActions.openDialog("help");
      } catch {
        // 更新日志索引不可用时不自动弹出，避免误判为已读。
      }
    }

    void checkChangelogAnnouncement();

    return () => {
      cancelled = true;
    };
  }, [appHost, screenProfile.deviceClass]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleViewportChange = () => {
      appHost.internalActions.setScreenProfile(resolveScreenProfileFromWindow());
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    handleViewportChange();

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
    };
  }, [appHost]);

  // AI-REMOVED 2026-08-08:
  // Reason: Workbench 不再安装或清空主线程内存日志捕获器，日志运行时在 main.tsx 按应用生命周期初始化。
  // Trigger: ST2-RQ-009 要求刷新后保留日志，并删除 captureEnabled 冗余状态。
  // Evidence: debug-log-store.ts 已完整归档；DebugLogDialog 改为查询 SharedWorker。
  // Replacement: initializeDebugLogging() 与 publishDebugModeEnabled()。
  // Risk: Low；Workbench 单独挂载时不创建 Collector，只同步设置镜像和 logger 级别。
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => {
  //   const disposeDebugLogCapture = installDebugLogCapture();
  //   clearDebugLogEntries();
  //   return () => {
  //     setDebugLogCaptureEnabled(false);
  //     setLogLevel(DEFAULT_WORKBENCH_LOG_LEVEL);
  //     disposeDebugLogCapture();
  //   };
  // }, []);

  useEffect(() => {
    publishDebugModeEnabled(appHost.state.settings.debugMode);
    if (!appHost.state.settings.debugMode) {
      setLogLevel(DEFAULT_WORKBENCH_LOG_LEVEL);
      if (appHost.internalState.workbench.dialogState["debug-log"]?.visible) {
        appHost.internalActions.closeDialog("debug-log");
      }
      return;
    }

    setLogLevel("debug", { announce: true });

    // 调试模式刚启用时重放一次初始 profile，确保它进入持久化日志。
    resetScreenProfileConsoleDiagnosticsForTest();
    resolveScreenProfileFromWindow();
  }, [appHost, appHost.state.settings.debugMode]);

  // AI-REMOVED 2026-08-23:
  // Reason: 旋转手机后的 effect 没有瞬时用户激活，自动请求全屏会被浏览器拒绝且违背按需提示原则。
  // Trigger: 用户要求仅在点击全屏按钮时提示，不主动打扰用户。
  // Evidence: Fullscreen API 要求请求由用户交互直接触发；现有 orientationchange 链路由 screenProfile effect 间接调用。
  // Replacement: 顶栏、悬浮入口和 MobilePortraitGate 中的 FullscreenToggleButton。
  // Risk: Low；手机转横屏后需要用户主动点击一次全屏按钮。
  // Human Review: Required
  //
  // Original code:
  // useEffect(() => {
  //   const previousScreenProfile = previousScreenProfileRef.current;
  //   previousScreenProfileRef.current = screenProfile;
  //
  //   if (!isMobilePortraitScreenProfile(previousScreenProfile)) {
  //     return;
  //   }
  //
  //   if (!isMobileLandscapeScreenProfile(screenProfile)) {
  //     return;
  //   }
  //
  //   if (resolveFullscreenState()) {
  //     return;
  //   }
  //
  //   requestDocumentFullscreen();
  // }, [screenProfile]);

  useEffect(() => {
    if (!hasVisibleDialogShell) {
      return;
    }

    appHost.gestureAdapter.handleBlur();
  }, [appHost, hasVisibleDialogShell]);

  useEffect(() => {

    const handleWindowKeyDown = (event: KeyboardEvent) => {

      const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
      const isInspectorDialogVisible = inspectorDialogState?.visible === true;
      if (hasVisibleDialogShell && !isInspectorDialogVisible) {
        return;
      }

      // AI-REMOVED 2026-08-30:
      // Reason: Inspector 不再在 DOM 入口按字符串特判 M/F；由 Route 的 inspector-dialog 作用域决定穿透。
      // Trigger: ST2-RQ-020 输入层与冲突系统统一。
      // Evidence: move.enter-selection、delete-selection.selection、move.delete-operation 显式声明该输入层。
      // Replacement: GestureActionRouter Shortcut Route scope
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const isMoveKey = appHost.internalActions.isShortcutFor("shortcut-move-selection", event.code, event.key);
      // const isDeleteKey = appHost.internalActions.isShortcutFor("shortcut-delete-device", event.code, event.key);
      // if (hasVisibleDialogShell && !(isInspectorDialogVisible && (isMoveKey || isDeleteKey))) return;

      if (isEditableKeyboardTarget(event)) {
        return;
      }

      if (appHost.gestureAdapter.handleKeyDown(event) && event.cancelable) {
        event.preventDefault();
        return;
      }

      // 即使 gesture module 未消费，只要匹配任意已配置快捷键就拦截浏览器默认行为
      // （例如 Ctrl+S 在非多选状态下仍应阻止浏览器保存网页对话框）
      // 订正（2026-08-30）：匹配范围收敛为当前输入层和 activeTool 中声明按键所有权的 Route。
      if (event.cancelable && appHost.gestureActionRouter.claimsBrowserDefaultForKeyboardEvent({
        type: "key down",
        code: event.code,
        key: event.key,
        keyCode: event.keyCode,
        modifiers: {
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
        },
        sourceEvent: event,
      })) {
        event.preventDefault();
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
      if (hasVisibleDialogShell && inspectorDialogState?.visible !== true) {
        return;
      }

      if (isEditableKeyboardTarget(event)) {
        return;
      }

      if (appHost.gestureAdapter.handleKeyUp(event) && event.cancelable) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
    };
  }, [appHost, hasVisibleDialogShell]);

  useEffect(() => {
    const prev = prevUseInspectorPanelRef.current;
    prevUseInspectorPanelRef.current = useInspectorPanel;

    if (useInspectorPanel) {
      if (inspectorDialogState.visible) {
        appHost.internalActions.closeDialog("inspector");
      }

      return;
    }

    if (rightDockOpen) {
      // 初始渲染时 rightDockOpen 默认 true，此时应保留选中以允许 auto-open inspector。
      // 用户主动关掉"使用面板"时，清除选中，避免"有选中但无 inspector"的中间态。
      appHost.internalActions.setRightDockOpen(false, { preserveSingleSelection: !prev });
    }
  }, [appHost, inspectorDialogState.visible, rightDockOpen, useInspectorPanel]);

  useEffect(() => {
    if (useInspectorPanel) {
      return;
    }

    if (shouldAutoOpenInspectorDialog) {
      if (!inspectorDialogState.visible) {
        appHost.internalActions.openDialog("inspector");
      }

      return;
    }

    if (!canKeepInspectorDialogOpen && inspectorDialogState.visible) {
      appHost.internalActions.closeDialog("inspector");
    }
  }, [
    appHost,
    canKeepInspectorDialogOpen,
    inspectorDialogState.visible,
    shouldAutoOpenInspectorDialog,
    useInspectorPanel,
  ]);


  const workbenchStyle = {
    ...resolveInCanvasThemeCssVariables(effectiveCanvasTheme),
    "--left-toolbar-width": isCompactLeftToolbar ? "51px" : "68px",
    "--left-toolbar-button-scale": isCompactLeftToolbar ? "0.75" : "1",
    "--left-dock-width": effectiveLeftDockOpen ? `${effectiveLeftDockWidth}px` : "0px",
    "--right-dock-width": showRightDock ? `${DEFAULT_RIGHT_DOCK_WIDTH}px` : "0px",
    "--top-bar-height": showFloatingTopBarControls ? "0px" : "48px",
    "--bottom-bar-height": showBottomStatusBar ? "28px" : "0px",
    "--toolbox-bottom-dock-height": `${bottomDockGridHeight}px`,
    "--canvas-bottom-obstruction-height": "calc(var(--bottom-bar-height, 28px) + var(--toolbox-bottom-dock-height, 0px))",
  } as CSSProperties;

  return (
    <div
      className={cm(styles, "workbench")}
      onAuxClick={preventNativeBrowserEvent}
      onContextMenu={preventNativeBrowserEvent}
      onDragStart={preventNativeBrowserEvent}
      onPointerDownCapture={preventMiddleMousePointerDownBrowserBehavior}
      style={workbenchStyle}
    >
      <OverlayStackProvider>
        <TopBar
          appHost={appHost}
          isStandalone={pwaController.standalone}
          onFullscreenActionFailure={pwaController.openFullscreenNotice}
        />
        <LeftToolbar appHost={appHost} />
        <LeftDock appHost={appHost} hidden={!effectiveLeftDockOpen} />
        {effectiveLeftDockOpen
          && (appHost.internalState.runtime.activePanel ?? "placement") === "blueprint"
          && appHost.workspace.sync !== null ? (
            <SyncInitialSyncFeatureGate
              className="sync-initial-sync-feature-gate-left-dock"
              feature="blueprints"
              state={appHost.workspace.sync.state}
              translate={appHost.actions.translate}
            />
          ) : null}
        <CanvasPanel appHost={appHost} />
        {/* AI-CORRECTION 2026-08-05: 折叠顶栏控件改为 CanvasPanel 的 sibling overlay，保持画布定位但隔离画布手势。 */}
        {showFloatingTopBarControls ? (
          <div className={cm(styles, "workbench-floating-top-bar-controls")}>
            <SimulationControlButton
              appHost={appHost}
              className={cm(styles, "workbench-floating-top-bar-button")}
            />
            <TimelineButton
              appHost={appHost}
              className={cm(styles, "workbench-floating-top-bar-button")}
            />
            <FullscreenToggleButton
              appHost={appHost}
              className={cm(
                styles,
                "workbench-floating-top-bar-button workbench-floating-fullscreen-button",
              )}
              isStandalone={pwaController.standalone}
              onFullscreenActionFailure={pwaController.openFullscreenNotice}
            />
            {useInspectorPanel && !rightDockOpen ? (
              <button
                aria-label={floatingOpenRightDockLabel}
                className={cm(
                  styles,
                  "workbench-floating-top-bar-button workbench-floating-right-dock-button",
                )}
                onClick={appHost.internalActions.toggleRightDock}
                title={floatingOpenRightDockLabel}
                type="button"
              >
                <span className={cm(styles, "top-bar-toggle-icon")}>
                  <WorkbenchIcon kind="panel-right-open" />
                </span>
                <span className={cm(styles, "sr-only")}>
                  {floatingOpenRightDockLabel}
                </span>
              </button>
            ) : null}
            <button
              aria-label={`${t("action.expand")} ${t("topBar.controls")}`}
              className={cm(
                styles,
                "workbench-floating-top-bar-button workbench-floating-top-bar-toggle",
              )}
              onClick={appHost.internalActions.toggleTopBarCollapsed}
              title={`${t("action.expand")} ${t("topBar.controls")}`}
              type="button"
            >
              <span className={cm(styles, "top-bar-toggle-icon")}>
                <WorkbenchIcon kind="panel-top-open" />
              </span>
              <span className={cm(styles, "sr-only")}>
                {`${t("action.expand")} ${t("topBar.controls")}`}
              </span>
            </button>
            {/* AI-REMOVED 2026-07-29:
                Reason: 保存提示迁移到折叠顶栏第二排的独立画布 overlay。
                Trigger: 用户要求第二排最右侧且不受 FPS 布局影响。
                Evidence: 原实现将提示放在第一排 floating controls 内。
                Replacement: CanvasPanel 内的 canvas-webdav-save-indicator-collapsed。
                Risk: Low。
                Human Review: Required

                Original code:
                {appHost.workspace.sync !== null ? (
                  <WebDavSaveIndicator
                    syncState={appHost.workspace.sync.state}
                    translate={appHost.actions.translate}
                  />
                ) : null} */}
          </div>
        ) : null}
        <OverlapEntityMenu appHost={appHost} />
        <QuickPlacePopup appHost={appHost} />
        <CanvasBottomLeftSecondaryToolbar
          appHost={appHost}
          offsetForFloatingTools={showCanvasBottomLeftToolbar}
        />
        {showCanvasBottomLeftToolbar ? <CanvasBottomLeftToolbar appHost={appHost} /> : null}
        {canvasTopLeftCornerToolbar.visible && canvasTopLeftCornerToolbar.buttonIds.length > 0 ? (
          <CanvasTopLeftCornerToolbar
            appHost={appHost}
            buttonIds={canvasTopLeftCornerToolbar.buttonIds}
            initialOffButtonIds={canvasTopLeftCornerToolbar.initialOffButtonIds}
            key={canvasTopLeftCornerToolbarKey}
          />
        ) : null}
        {canvasFloatingToolbar.visible && canvasFloatingToolbar.anchor !== null && canvasFloatingToolbar.buttonIds.length > 0 ? (
          <CanvasFloatingToolbar
            anchor={canvasFloatingToolbar.anchor}
            appHost={appHost}
            buttonIds={canvasFloatingToolbar.buttonIds}
          />
        ) : null}
        {canvasRightDockToolbar.visible && canvasRightDockToolbar.items.length > 0 ? (
          <CanvasRightDockToolbar
            appHost={appHost}
            items={canvasRightDockToolbar.items}
          />
        ) : null}
        {/* AI-REMOVED 2026-08-22:
            Reason: Workbench 改为传递逐项功能展示请求，不再传按钮数组和全局 mode。
            Trigger: 用户要求右侧工具列按项混排 button、shortcut 与 both。
            Evidence: CanvasRightDockToolbarProps 只接收 items。
            Replacement: 上方基于 canvasRightDockToolbar.items 的渲染分支。
            Risk: Low
            Human Review: Required

            Original code:
            {canvasRightDockToolbar.visible && canvasRightDockToolbar.buttonIds.length > 0 ? (
              <CanvasRightDockToolbar
                appHost={appHost}
                buttonIds={canvasRightDockToolbar.buttonIds}
                mode={canvasRightDockToolbar.mode}
              />
            ) : null}
        */}
        {showRightDock ? <RightDock appHost={appHost} /> : null}
        {showToolboxBottomDock ? <ToolboxBottomDock appHost={appHost} /> : null}
        {showTimelineBottomDock ? <TimelineBottomDock appHost={appHost} /> : null}
        {showBottomStatusBar ? <BottomStatusBar appHost={appHost} /> : null}
        {appHost.state.settings.debugMode ? <DebugLogDialog appHost={appHost} /> : null}
        <BaseSelectDialog appHost={appHost} />
        <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
        <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
        <InspectorDialog appHost={appHost} />
        <SaveBlueprintDialog appHost={appHost} />
        <ToolboxDialog appHost={appHost} />
        <TimelineDialog appHost={appHost} />
        <WarehouseStatsDialog appHost={appHost} />
        <EncyclopediaPickerDialog appHost={appHost} />
        <RecipePickerDialog appHost={appHost} />
        <HelpDialog appHost={appHost} />
        <FeedbackDialog appHost={appHost} />
        <SettingsDialog
          appHost={appHost}
          controller={settingsDialog}
          migrationController={migrationController}
          pwaController={pwaController}
        />
        <V2MigrationDialog appHost={appHost} controller={migrationController} />
        <PwaGateway appHost={appHost} pwaController={pwaController} />
        {appHost.workspace.sync === null ? null : (
          <SyncInitialSyncGate
            sync={appHost.workspace.sync}
            translate={appHost.actions.translate}
          />
        )}
        {appHost.workspace.sync === null ? null : (
          <SyncConflictDialog
            appHost={appHost}
            compactMobileLayout={appHost.state.screenProfile.deviceClass !== "desktop"}
            onStopSync={() => {
              requestSyncProvider("none");
              appHost.workspace.sync?.actions.updateSettings({});
            }}
            sync={appHost.workspace.sync}
            t={appHost.actions.translate}
          />
        )}
        {showMobilePortraitGate ? (
          <MobilePortraitGate
            appHost={appHost}
            isStandalone={pwaController.standalone}
            onFullscreenActionFailure={pwaController.openFullscreenNotice}
          />
        ) : null}
      </OverlayStackProvider>
    </div>
  );
});

function isAnyDialogShellVisible(
  appHost: AppHost,
  options: { showTimelineBottomDock: boolean; showToolboxBottomDock: boolean },
): boolean {
  return Object.entries(appHost.internalState.workbench.dialogState).some(
    ([dialogKey, dialogState]) => {
      if (dialogKey === "debug-log" && !appHost.state.settings.debugMode) {
        return false;
      }

      if (dialogKey === "toolbox" && options.showToolboxBottomDock) {
        return false;
      }

      if (dialogKey === "timeline" && options.showTimelineBottomDock) {
        return false;
      }

      return dialogState?.visible === true;
    },
  )
    || appHost.encyclopediaPicker.dialogState.visible
    || appHost.recipePicker.dialogState.visible
    || appHost.blueprintFolderDialog.dialogState.visible
    || appHost.blueprintPreview.dialogState.visible;
}

function isEditableKeyboardTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toLowerCase() ?? '';

  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }

  if ((target as HTMLElement).isContentEditable === true) {
    return true;
  }

  if (typeof (target as HTMLElement).closest === 'function') {
    return (target as HTMLElement).closest(
      "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']",
    ) !== null;
  }

  return false;
}
