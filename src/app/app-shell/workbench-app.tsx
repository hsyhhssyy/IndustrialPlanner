import { action } from "mobx";
import { useEffect, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import { BottomStatusBar } from "@/app/app-shell/components/bottom-status-bar";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
import { CanvasFloatingToolbar } from "@/app/app-shell/components/canvas-panel-files/canvas-floating-toolbar";
import { CanvasTopLeftCornerToolbar } from "@/app/app-shell/components/canvas-panel-files/canvas-top-left-corner-toolbar";
import { CanvasRightDockToolbar } from "@/app/app-shell/components/canvas-panel-files/canvas-right-dock-toolbar";
import { FullscreenToggleButton } from "@/app/app-shell/components/fullscreen-toggle-button";
import { SettingsDialog } from "@/app/app-shell/components/settings-dialog";
import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import LeftDock from "@/app/app-shell/components/left-dock";
import { LeftToolbar } from "@/app/app-shell/components/left-toolbar";
import { WorkbenchSettingsDialogController } from "@/app/app-shell/settings-dialog-state";
import { RightDock } from "@/app/app-shell/components/right-dock";
import { TopBar } from "@/app/app-shell/components/top-bar";
import {
  preventMiddleMousePointerDownBrowserBehavior,
  preventNativeBrowserEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";
import { DEFAULT_RIGHT_DOCK_WIDTH } from "@/app/state-impl";
import { resolveLeftDockWidthForScreenProfile } from "@/app/state-impl";
import type { AppThemeId } from "@/domain/state/theme";
import {
  isMobileLandscapeScreenProfile,
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

          const nextImmediateMove = value
            ? true
            : appHost.internalState.settings.hypergryphImmediateMove;

          if (
            appHost.internalState.settings.hypergryphImmediateMarquee === value
            && appHost.internalState.settings.hypergryphImmediateMove === nextImmediateMove
          ) {
            return;
          }

          appHost.internalState.settings.hypergryphImmediateMarquee = value;
          appHost.internalState.settings.hypergryphImmediateMove = nextImmediateMove;
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
  const effectiveLeftDockWidth = resolveLeftDockWidthForScreenProfile(leftDockWidth, screenProfile);
  const showFloatingTopBarControls = isTouchLandscape && topBarCollapsed;
  const showBottomStatusBar = !showFloatingTopBarControls;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      appHost.internalActions.setScreenProfile(resolveScreenProfileFromWindow());
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [appHost]);

  useEffect(() => {
    return () => {
      settingsDialog.dispose();
    };
  }, [settingsDialog]);

  const workbenchStyle = {
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
          <FullscreenToggleButton
            appHost={appHost}
            className="workbench-floating-top-bar-button workbench-floating-fullscreen-button"
          />
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
      <LeftToolbar
        appHost={appHost}
        onOpenSettings={() => {
          void settingsDialog.open();
        }}
      />
      {leftDockOpen ? <LeftDock appHost={appHost} /> : null}
      <CanvasPanel appHost={appHost} />
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
      {canvasRightDockToolbar.visible && !rightDockOpen && canvasRightDockToolbar.buttonIds.length > 0 ? (
        <CanvasRightDockToolbar
          appHost={appHost}
          buttonIds={canvasRightDockToolbar.buttonIds}
        />
      ) : null}
      {rightDockOpen ? <RightDock appHost={appHost} /> : null}
      {showBottomStatusBar ? <BottomStatusBar appHost={appHost} /> : null}
      <SettingsDialog appHost={appHost} controller={settingsDialog} />
    </div>
  );
});
