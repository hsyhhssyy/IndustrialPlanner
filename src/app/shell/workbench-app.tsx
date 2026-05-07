import { action } from "mobx";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import { BottomStatusBar } from "@/app/shell/layout/bottom-status-bar";
import { CanvasPanel } from "@/app/shell/canvas/canvas-panel";
import { CanvasFloatingToolbar } from "@/app/shell/canvas/canvas-floating-toolbar";
import { CanvasLeftBottomToolbar } from "@/app/shell/canvas/canvas-left-bottom-toolbar";
import { CanvasTopLeftCornerToolbar } from "@/app/shell/canvas/canvas-top-left-corner-toolbar";
import { CanvasRightDockToolbar } from "@/app/shell/canvas/canvas-right-dock-toolbar";
import {
  FullscreenToggleButton,
  requestDocumentFullscreen,
  resolveFullscreenState,
} from "@/app/shell/layout/fullscreen-toggle-button";
import { HelpDialog } from "@/app/shell/dialogs/help-dialog";
import { MobilePortraitGate } from "@/app/shell/layout/mobile-portrait-gate";
import { SettingsDialog } from "@/app/shell/dialogs/settings-dialog";
import { EncyclopediaPickerDialog } from "@/app/shell/encyclopedia/encyclopedia-picker-dialog";
import { ToolboxDialog } from "@/app/shell/dialogs/toolbox-dialog";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
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
  isMobileLandscapeScreenProfile,
  isMobilePortraitScreenProfile,
  isTouchLandscapeScreenProfile,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";

function isAppThemeId(value: unknown): value is AppThemeId {
  return value === "ayu-light" || value === "ayu-dark";
}

export const WorkbenchApp = observer(function WorkbenchApp({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
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
      "game-arknights-operation-mode": {
        readValue: () => appHost.state.settings.hypergryphOperationMode,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
            return;
          }

          if (appHost.internalState.settings.hypergryphOperationMode === value) {
            return;
          }

          appHost.internalState.settings.hypergryphOperationMode = value;
        }),
      },
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
      "game-always-show-grid-lines": {
        readValue: () => appHost.state.settings.gameAlwaysShowGridLines,
        writeValue: action((value) => {
          if (typeof value !== "boolean") {
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
  }));
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const rightDockOpen = appHost.state.workbench.rightDockOpen;
  const leftDockWidth = appHost.state.workbench.leftDockWidth;
  const topBarCollapsed = appHost.state.workbench.topBarCollapsed;
  const screenProfile = appHost.state.screenProfile;
  const canvasFloatingToolbar = appHost.internalState.runtime.canvasFloatingToolbar;
  const canvasRightDockToolbar = appHost.internalState.runtime.canvasRightDockToolbar;
  const canvasTopLeftCornerToolbar = appHost.internalState.runtime.canvasTopLeftCornerToolbar;
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const isCompactLeftToolbar = screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
  const effectiveLeftDockWidth = resolveLeftDockWidthForScreenProfile(leftDockWidth, screenProfile);
  const showFloatingTopBarControls = isTouchLandscape && topBarCollapsed;
  const showBottomStatusBar = !showFloatingTopBarControls;
  const showCanvasLeftBottomToolbar = screenProfile.deviceClass === "mobile" && !leftDockOpen;
  const showMobilePortraitGate = isMobilePortraitScreenProfile(screenProfile);
  const floatingOpenRightDockLabel = `${t("action.open")} ${t("topBar.rightPanel")}`;
  const previousScreenProfileRef = useRef(screenProfile);
  const hasVisibleDialogShell = isAnyDialogShellVisible(appHost);

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
      if (hasVisibleDialogShell) {
        return;
      }

      appHost.gestureAdapter.handleKeyDown(event);
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (hasVisibleDialogShell) {
        return;
      }

      appHost.gestureAdapter.handleKeyUp(event);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
    };
  }, [appHost, hasVisibleDialogShell]);


  const workbenchStyle = {
    "--left-toolbar-width": isCompactLeftToolbar ? "51px" : "68px",
    "--left-toolbar-button-scale": isCompactLeftToolbar ? "0.75" : "1",
    "--left-dock-width": leftDockOpen ? `${effectiveLeftDockWidth}px` : "0px",
    "--right-dock-width": rightDockOpen ? `${DEFAULT_RIGHT_DOCK_WIDTH}px` : "0px",
    "--top-bar-height": showFloatingTopBarControls ? "0px" : "48px",
    "--bottom-bar-height": showBottomStatusBar ? "28px" : "0px",
  } as CSSProperties;

  return (
    <div
      className="workbench"
      onAuxClick={preventNativeBrowserEvent}
      onContextMenu={preventNativeBrowserEvent}
      onDragStart={preventNativeBrowserEvent}
      onPointerDownCapture={preventMiddleMousePointerDownBrowserBehavior}
      style={workbenchStyle}
    >
      <TopBar appHost={appHost} />
      {showFloatingTopBarControls ? (
        <div className="workbench-floating-top-bar-controls">
          <SimulationControlButton
            appHost={appHost}
            className="workbench-floating-top-bar-button"
          />
          <FullscreenToggleButton
            appHost={appHost}
            className="workbench-floating-top-bar-button workbench-floating-fullscreen-button"
          />
          {!rightDockOpen ? (
            <button
              aria-label={floatingOpenRightDockLabel}
              className="workbench-floating-top-bar-button workbench-floating-right-dock-button"
              onClick={appHost.internalActions.toggleRightDock}
              title={floatingOpenRightDockLabel}
              type="button"
            >
              <span className="top-bar-toggle-icon">
                <WorkbenchIcon kind="panel-right-open" />
              </span>
              <span className="sr-only">{floatingOpenRightDockLabel}</span>
            </button>
          ) : null}
          <button
            aria-label={`${t("action.expand")} ${t("topBar.controls")}`}
            className="workbench-floating-top-bar-button workbench-floating-top-bar-toggle"
            onClick={appHost.internalActions.toggleTopBarCollapsed}
            title={`${t("action.expand")} ${t("topBar.controls")}`}
            type="button"
          >
            <span className="top-bar-toggle-icon">
              <WorkbenchIcon kind="panel-top-open" />
            </span>
            <span className="sr-only">{`${t("action.expand")} ${t("topBar.controls")}`}</span>
          </button>
        </div>
      ) : null}
      <LeftToolbar appHost={appHost} />
      {leftDockOpen ? <LeftDock appHost={appHost} /> : null}
      <CanvasPanel appHost={appHost} />
      {showCanvasLeftBottomToolbar ? <CanvasLeftBottomToolbar appHost={appHost} /> : null}
      {canvasTopLeftCornerToolbar.visible && canvasTopLeftCornerToolbar.buttonIds.length > 0 ? (
        <CanvasTopLeftCornerToolbar
          appHost={appHost}
          buttonIds={canvasTopLeftCornerToolbar.buttonIds}
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
        />
      ) : null}
      {rightDockOpen ? <RightDock appHost={appHost} /> : null}
      {showBottomStatusBar ? <BottomStatusBar appHost={appHost} /> : null}
      <ToolboxDialog appHost={appHost} />
      <EncyclopediaPickerDialog appHost={appHost} />
      <HelpDialog appHost={appHost} />
      <SettingsDialog appHost={appHost} controller={settingsDialog} />
      {showMobilePortraitGate ? <MobilePortraitGate appHost={appHost} /> : null}
    </div>
  );
});

function isAnyDialogShellVisible(appHost: AppHost): boolean {
  return Object.values(appHost.internalState.workbench.dialogState).some(
    (dialogState) => dialogState?.visible === true,
  ) || appHost.encyclopediaPicker.dialogState.visible;
}
