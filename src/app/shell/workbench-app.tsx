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
import {
  FullscreenToggleButton,
  requestDocumentFullscreen,
  resolveFullscreenState,
} from "@/app/shell/layout/fullscreen-toggle-button";
import { DebugLogDialog } from "@/app/shell/dialogs/debug-log-dialog";
import { BaseSelectDialog } from "@/app/shell/dialogs/base-select-dialog";
import { BlueprintFolderDialog } from "@/app/shell/dialogs/blueprint-folder-dialog";
import { BlueprintPreviewDialog } from "@/app/shell/dialogs/blueprint-preview-dialog";
import { HelpDialog } from "@/app/shell/dialogs/help-dialog";
import { InspectorDialog } from "@/app/shell/dialogs/inspector-dialog";
import { MobilePortraitGate } from "@/app/shell/layout/mobile-portrait-gate";
import { RecipePickerDialog } from "@/app/shell/dialogs/recipe-picker-dialog";
import { SaveBlueprintDialog } from "@/app/shell/dialogs/save-blueprint-dialog";
import { SettingsDialog } from "@/app/shell/dialogs/settings-dialog";
import { EncyclopediaPickerDialog } from "@/app/shell/encyclopedia/encyclopedia-picker-dialog";
import {
  ToolboxBottomDock,
  ToolboxDialog,
  resolveToolboxBottomDockGridHeight,
} from "@/app/shell/dialogs/toolbox-dialog";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { PwaController } from "@/app/pwa/pwa-controller";
import { PwaGateway } from "@/app/pwa/pwa-gateway";
import LeftDock from "@/app/shell/layout/left-dock";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { WorkbenchSettingsDialogController } from "@/app/shell/state/settings-dialog-state";
import { RightDock } from "@/app/shell/layout/right-dock";
import { SimulationControlButton, TopBar } from "@/app/shell/layout/top-bar";
import {
  preventMiddleMousePointerDownBrowserBehavior,
  preventNativeBrowserEvent,
} from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state/state-impl";
import { resolveLeftDockWidthForScreenProfile } from "@/app/state/state-impl";
import type { AppThemeId } from "@/domain/app/types/theme";
import {
  clearDebugLogEntries,
  installDebugLogCapture,
  setDebugLogCaptureEnabled,
} from "@/shared/logging/debug-log-store";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  setLogLevel,
} from "@/shared/logging/logger";
import {
  isMobileOrTabletScreenProfile,
  isMobileLandscapeScreenProfile,
  isMobilePortraitScreenProfile,
  isTouchLandscapeScreenProfile,
  resetScreenProfileConsoleDiagnosticsForTest,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";
import {
  resolveEffectiveCanvasTheme,
  resolveInCanvasThemeCssVariables,
} from "@/shared/theme/canvas-theme";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function isAppThemeId(value: unknown): value is AppThemeId {
  return value === "ayu-light" || value === "ayu-dark";
}

export const WorkbenchApp = observer(function WorkbenchApp({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const [pwaController] = useState(() => new PwaController());
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
      "game-arknights-auto-create-logistics-devices": {
        readValue: () => appHost.state.settings.hypergryphAutoCreateLogisticsDevices,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphAutoCreateLogisticsDevices === value) {
            return;
          }

          appHost.internalState.settings.hypergryphAutoCreateLogisticsDevices = value;
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

          if (appHost.internalState.settings.gameUseSimplifiedDeviceIcons) {
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
      "game-use-simplified-device-icons": {
        readValue: () => appHost.state.settings.gameUseSimplifiedDeviceIcons,
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

          if (appHost.internalState.settings.gameUseSimplifiedDeviceIcons === value
            && !shouldEnforceLinkedSettings) {
            return;
          }

          appHost.internalState.settings.gameUseSimplifiedDeviceIcons = value;

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

          if (appHost.internalState.settings.gameUseSimplifiedDeviceIcons) {
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
      "game-show-grass-background": {
        readValue: () => appHost.state.settings.showGrassBackground,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.gameUseSimplifiedDeviceIcons) {
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
        }),
      },
    },
    // 所有 keybinding 类型设置统一走 shortcutReader/shortcutWriter
    shortcutReader: (key) => appHost.internalActions.getKeyboardShortcutFor(key),
    shortcutWriter: (key, value) => {
      appHost.internalActions.setShortcutFor(key, value);
    },
    shortcutResetAll: () => {
      appHost.internalActions.resetAllShortcutsToDefaults();
    },
  }));
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
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
  const toolboxBottomDockGridHeight = resolveToolboxBottomDockGridHeight(appHost);
  const showToolboxBottomDock = toolboxBottomDockGridHeight > 0;
  const selectionCount = appHost.workspace.editor?.state.collections.selection.length ?? 0;
  const openInspectorOnSecondClick = appHost.state.settings.hypergryphInspectorOpenOnSecondClick;
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const isTouchLayout = isMobileOrTabletScreenProfile(screenProfile);
  const isCompactLeftToolbar = isTouchLayout;
  const effectiveLeftDockWidth = resolveLeftDockWidthForScreenProfile(leftDockWidth, screenProfile);
  const showFloatingTopBarControls = isTouchLandscape && topBarCollapsed;
  const showBottomStatusBar = !showFloatingTopBarControls;
  const showCanvasBottomLeftToolbar = !leftDockOpen;
  const showMobilePortraitGate = isMobilePortraitScreenProfile(screenProfile);
  const showRightDock = useInspectorPanel && rightDockOpen;
  const canKeepInspectorDialogOpen = !useInspectorPanel
    && (activeTool === "select" || activeTool === "dark-pipe-link")
    && selectionCount === 1;
  const shouldAutoOpenInspectorDialog = canKeepInspectorDialogOpen && !openInspectorOnSecondClick;
  const floatingOpenRightDockLabel = `${t("action.open")} ${t("topBar.rightPanel")}`;
  const previousScreenProfileRef = useRef(screenProfile);
  const prevUseInspectorPanelRef = useRef(useInspectorPanel);
  const hasVisibleDialogShell = isAnyDialogShellVisible(appHost, { showToolboxBottomDock });
  const effectiveCanvasTheme = resolveEffectiveCanvasTheme(
    appHost.state.theme,
    appHost.state.settings.gameUseSimplifiedDeviceIcons,
  );

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

  useEffect(() => {
    const disposeDebugLogCapture = installDebugLogCapture();
    clearDebugLogEntries();

    return () => {
      setDebugLogCaptureEnabled(false);
      setLogLevel(DEFAULT_WORKBENCH_LOG_LEVEL);
      disposeDebugLogCapture();
    };
  }, []);

  useEffect(() => {
    if (!appHost.state.settings.debugMode) {
      setLogLevel(DEFAULT_WORKBENCH_LOG_LEVEL);
      setDebugLogCaptureEnabled(false);
      if (appHost.internalState.workbench.dialogState["debug-log"]?.visible) {
        appHost.internalActions.closeDialog("debug-log");
      }
      return;
    }

    setDebugLogCaptureEnabled(true);
    setLogLevel("debug", { announce: true });

    // 初始 screen profile 日志在 debug log capture 安装前就已输出，
    // 此处 capture 已启用，重置去重状态后重新触发，确保初始 profile 出现在捕获日志中。
    resetScreenProfileConsoleDiagnosticsForTest();
    resolveScreenProfileFromWindow();
  }, [appHost, appHost.state.settings.debugMode]);

  useEffect(() => {
    const previousScreenProfile = previousScreenProfileRef.current;
    previousScreenProfileRef.current = screenProfile;

    if (!isMobilePortraitScreenProfile(previousScreenProfile)) {
      return;
    }

    if (!isMobileLandscapeScreenProfile(screenProfile)) {
      return;
    }

    if (resolveFullscreenState()) {
      return;
    }

    requestDocumentFullscreen();
  }, [screenProfile]);

  useEffect(() => {
    if (!hasVisibleDialogShell) {
      return;
    }

    appHost.gestureAdapter.handleBlur();
  }, [appHost, hasVisibleDialogShell]);

  useEffect(() => {

    const handleWindowKeyDown = (event: KeyboardEvent) => {

      // inspector dialog 特判：允许 M/Del 绑定的快捷键穿透
      const inspectorDialogState = appHost.internalState.workbench.dialogState.inspector;
      const isInspectorDialogVisible = inspectorDialogState?.visible === true;
      const isMoveKey = appHost.internalActions.isShortcutFor?.("shortcut-move-selection", event.code, event.key) || false;
      const isDeleteKey = appHost.internalActions.isShortcutFor?.("shortcut-delete-device", event.code, event.key) || false;

      if (hasVisibleDialogShell) {
        // inspector dialog 且是主操作快捷键，允许穿透
        if (isInspectorDialogVisible && (isMoveKey || isDeleteKey)) {
          // 允许事件继续
        } else {
          return;
        }
      }

      if (isEditableKeyboardTarget(event)) {
        return;
      }

      if (appHost.gestureAdapter.handleKeyDown(event) && event.cancelable) {
        event.preventDefault();
        return;
      }

      // 即使 gesture module 未消费，只要匹配任意已配置快捷键就拦截浏览器默认行为
      // （例如 Ctrl+S 在非多选状态下仍应阻止浏览器保存网页对话框）
      if (event.cancelable && appHost.internalActions.matchesAnyShortcut?.(
        event.code,
        event.key,
        { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey },
      )) {
        event.preventDefault();
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (hasVisibleDialogShell) {
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
    "--left-dock-width": leftDockOpen ? `${effectiveLeftDockWidth}px` : "0px",
    "--right-dock-width": showRightDock ? `${DEFAULT_RIGHT_DOCK_WIDTH}px` : "0px",
    "--top-bar-height": showFloatingTopBarControls ? "0px" : "48px",
    "--bottom-bar-height": showBottomStatusBar ? "28px" : "0px",
    "--toolbox-bottom-dock-height": `${toolboxBottomDockGridHeight}px`,
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
      <TopBar appHost={appHost} />
      {showFloatingTopBarControls ? (
        <div className={cm(styles, "workbench-floating-top-bar-controls")}>
          <SimulationControlButton
            appHost={appHost}
            className={cm(styles, "workbench-floating-top-bar-button")}
          />
          <FullscreenToggleButton
            appHost={appHost}
            className={cm(styles, "workbench-floating-top-bar-button workbench-floating-fullscreen-button")}
          />
          {useInspectorPanel && !rightDockOpen ? (
            <button
              aria-label={floatingOpenRightDockLabel}
              className={cm(styles, "workbench-floating-top-bar-button workbench-floating-right-dock-button")}
              onClick={appHost.internalActions.toggleRightDock}
              title={floatingOpenRightDockLabel}
              type="button"
            >
              <span className={cm(styles, "top-bar-toggle-icon")}>
                <WorkbenchIcon kind="panel-right-open" />
              </span>
              <span className={cm(styles, "sr-only")}>{floatingOpenRightDockLabel}</span>
            </button>
          ) : null}
          <button
            aria-label={`${t("action.expand")} ${t("topBar.controls")}`}
            className={cm(styles, "workbench-floating-top-bar-button workbench-floating-top-bar-toggle")}
            onClick={appHost.internalActions.toggleTopBarCollapsed}
            title={`${t("action.expand")} ${t("topBar.controls")}`}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind="panel-top-open" />
            </span>
            <span className={cm(styles, "sr-only")}>{`${t("action.expand")} ${t("topBar.controls")}`}</span>
          </button>
        </div>
      ) : null}
      <LeftToolbar appHost={appHost} />
      {leftDockOpen ? <LeftDock appHost={appHost} /> : null}
      <CanvasPanel appHost={appHost} />
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
      {canvasRightDockToolbar.visible && canvasRightDockToolbar.buttonIds.length > 0 ? (
        <CanvasRightDockToolbar
          appHost={appHost}
          buttonIds={canvasRightDockToolbar.buttonIds}
          mode={canvasRightDockToolbar.mode}
        />
      ) : null}
      {showRightDock ? <RightDock appHost={appHost} /> : null}
      {showToolboxBottomDock ? <ToolboxBottomDock appHost={appHost} /> : null}
      {showBottomStatusBar ? <BottomStatusBar appHost={appHost} /> : null}
      {appHost.state.settings.debugMode ? <DebugLogDialog appHost={appHost} /> : null}
      <BaseSelectDialog appHost={appHost} />
      <BlueprintFolderDialog appHost={appHost} controller={appHost.blueprintFolderDialog} />
      <BlueprintPreviewDialog appHost={appHost} controller={appHost.blueprintPreview} />
      <InspectorDialog appHost={appHost} />
      <SaveBlueprintDialog appHost={appHost} />
      <ToolboxDialog appHost={appHost} />
      <EncyclopediaPickerDialog appHost={appHost} />
      <RecipePickerDialog appHost={appHost} />
      <HelpDialog appHost={appHost} />
      <SettingsDialog appHost={appHost} controller={settingsDialog} pwaController={pwaController} />
      <PwaGateway appHost={appHost} pwaController={pwaController} />
      {showMobilePortraitGate ? <MobilePortraitGate appHost={appHost} /> : null}
    </div>
  );
});

function isAnyDialogShellVisible(
  appHost: AppHost,
  options: { showToolboxBottomDock: boolean },
): boolean {
  return Object.entries(appHost.internalState.workbench.dialogState).some(
    ([dialogKey, dialogState]) => {
      if (dialogKey === "debug-log" && !appHost.state.settings.debugMode) {
        return false;
      }

      if (dialogKey === "toolbox" && options.showToolboxBottomDock) {
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
