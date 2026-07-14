import { FullscreenToggleButton } from "@/app/shell/layout/fullscreen-toggle-button";
import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { observer } from "mobx-react-lite";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  isTouchLandscapeScreenProfile,
} from "@/shared/browser/screen-profile";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const SIMULATION_CONTROL_BUTTON_ID = "top-bar-simulation-control";
const SIMULATION_SPEED_OPTIONS = [0.25, 1, 2, 4, 16] as const;

function formatSimulationSpeedLabel(speed: number) {
  return `x${speed}`;
}

export const SimulationControlButton = observer(function SimulationControlButton({
  appHost,
  className,
}: {
  appHost: AppHost;
  className: string;
}) {
  const simulationState = appHost.workspace.simulation?.state.runningState ?? "stop";
  const isRunning = simulationState === "start";
  const iconKind = simulationState === "start"
    ? "pause"
    : simulationState === "pause"
      ? "resume"
      : "play";
  const label = appHost.actions.translate(
    isRunning
      ? "action.pause"
      : simulationState === "pause"
        ? "action.resume"
        : "action.start",
  );

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: SIMULATION_CONTROL_BUTTON_ID,
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      appHost.gestureAdapter.handleUiButtonTouchTap({
        uiButtonId: SIMULATION_CONTROL_BUTTON_ID,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) {
      return;
    }

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: SIMULATION_CONTROL_BUTTON_ID,
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };

  return (
    <button
      aria-label={label}
      aria-pressed={isRunning}
      className={cm(styles, className)}
      data-ui-button-id={SIMULATION_CONTROL_BUTTON_ID}
      onClick={handleClick}
      onPointerDown={preventTouchPointerCompatibilityMouseEvents}
      onPointerUp={handlePointerUp}
      title={label}
      type="button"
    >
      <span className={cm(styles, "top-bar-toggle-icon")}>
        <WorkbenchIcon kind={iconKind} />
      </span>
      <span className={cm(styles, "sr-only")}>{label}</span>
    </button>
  );
});

// AI-REMOVED 2026-06-19:
// Reason: 速度控制从逐级循环切换改为平铺直选按钮组（x0.25/x1/x2/x4/x16/停止）。
// Trigger: 用户需求 — topbar 展开时直接展示所有速度选项。
// Evidence: SimulationSecondaryButton 仅在 TopBar 内使用，已替换为 SimulationSpeedButtons。
// Replacement: SimulationSpeedButtons
// Risk: Low
// Human Review: Not Required
//
// Original code:
// export const SimulationSecondaryButton = observer(function SimulationSecondaryButton({
//   appHost,
// }: {
//   appHost: AppHost;
// }) {
//   ...
// });

export const SimulationSpeedButtons = observer(function SimulationSpeedButtons({
  appHost,
}: {
  appHost: AppHost;
}) {
  const simulation = appHost.workspace.simulation;
  const currentSpeed = simulation?.state.simulationSpeed ?? 1;
  const t = appHost.actions.translate;

  const handleSpeedClick = (speed: number) => {
    if (simulation === null) return;
    simulation.actions.setSimulationSpeed(speed);
  };

  const handleStopClick = () => {
    if (simulation === null) return;
    simulation.actions.stop();
  };

  return (
    <>
      {SIMULATION_SPEED_OPTIONS.map((speed) => (
        <button
          key={speed}
          aria-label={`${t("statusBar.speed")} ${formatSimulationSpeedLabel(speed)}`}
          aria-pressed={currentSpeed === speed}
          className={cm(styles, currentSpeed === speed
            ? "top-bar-speed-button top-bar-speed-active"
            : "top-bar-speed-button")}
          data-ui-button-id={`top-bar-speed-${speed}`}
          onClick={() => handleSpeedClick(speed)}
          title={`${t("statusBar.speed")} ${formatSimulationSpeedLabel(speed)}`}
          type="button"
        >
          <span className={cm(styles, "top-bar-speed-label")}>{formatSimulationSpeedLabel(speed)}</span>
        </button>
      ))}
      <button
        aria-label={t("action.stop")}
        className={cm(styles, "top-bar-icon-button")}
        data-ui-button-id="top-bar-simulation-stop"
        onClick={handleStopClick}
        title={t("action.stop")}
        type="button"
      >
        <span className={cm(styles, "top-bar-toggle-icon")}>
          <WorkbenchIcon kind="stop" />
        </span>
        <span className={cm(styles, "sr-only")}>{t("action.stop")}</span>
      </button>
    </>
  );
});

export const TimelineButton = observer(function TimelineButton({
  appHost,
  className,
}: {
  appHost: AppHost;
  className: string;
}) {
  const label = appHost.actions.translate("timelineDialog.title");
  const active = appHost.internalState.workbench.dialogState.timeline.visible;

  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cm(styles, className)}
      data-ui-button-id="top-bar-timeline"
      onClick={() => {
        appHost.internalActions.openDialog("timeline");
      }}
      title={label}
      type="button"
    >
      <span className={cm(styles, "top-bar-toggle-icon")}>
        <WorkbenchIcon kind="timeline" />
      </span>
      <span className={cm(styles, "sr-only")}>{label}</span>
    </button>
  );
});

export const TopBar = observer(function TopBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const {
    screenProfile,
    workbench: { topBarCollapsed },
  } = appHost.state;

    // Reason: The right dock toggle controls were removed from TopBar.
  // Trigger: ESLint reported unused vars in TopBar.
  // Evidence: npm run lint flagged toggleRightDock, rightPanelLabel, and rightPanelIconKind.
  // Replacement: None.
  // Risk: Low.
  // Human Review: Required.
  //
  // Original code:
  // const toggleRightDock = () => {
  //   appHost.internalActions.toggleRightDock();
  // };
  const toggleTopBarCollapsed = () => {
    appHost.internalActions.toggleTopBarCollapsed();
  };
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const collapseActionKey = isTouchLandscape && topBarCollapsed ? "action.expand" : "action.collapse";
  const collapseButtonLabel = `${t(collapseActionKey)} ${t("topBar.controls")}`;
    // Reason: Right dock button label and icon state are no longer rendered by TopBar.
  // Trigger: ESLint reported unused vars after the layout toggle buttons were removed.
  // Evidence: npm run lint flagged rightPanelLabel and rightPanelIconKind.
  // Replacement: None.
  // Risk: Low.
  // Human Review: Required.
  //
  // Original code:
  // const rightPanelLabel = `${t(rightDockOpen ? "action.close" : "action.open")} ${t("topBar.rightPanel")}`;
  // const rightPanelIconKind = rightDockOpen ? "panel-right-close" : "panel-right-open";

  if (isTouchLandscape && topBarCollapsed) {
    return null;
  }

  return (
    <header className={cm(styles, "top-bar")}>
      <div className={cm(styles, "top-bar-title-block")}>
        <div className={cm(styles, "top-bar-title")}>
          {t("app.title")}
          {window.__APP_VERSION__ ? (
            <span className={cm(styles, "top-bar-version")}>{window.__APP_VERSION__}</span>
          ) : (
            <span className={cm(styles, "top-bar-version")}>(Dev)</span>
          )}
        </div>
        <a
          className={cm(styles, "top-bar-old-version-link")}
          href={createPublicAssetUrl("../v2/")}
        >
          {t("topBar.switchToOldVersion")}
        </a>
      </div>
      <div className={cm(styles, "toolbar-group top-bar-controls")}>
        <SimulationControlButton
          appHost={appHost}
          className={cm(styles, "top-bar-icon-button")}
        />
        <SimulationSpeedButtons appHost={appHost} />
        <TimelineButton
          appHost={appHost}
          className={cm(styles, "top-bar-icon-button")}
        />
        <FullscreenToggleButton
          appHost={appHost}
          className={cm(styles, "top-bar-icon-button top-bar-fullscreen-button")}
        />
        {isTouchLandscape ? (
          <button
            aria-label={collapseButtonLabel}
            className={cm(styles, "top-bar-collapse-button top-bar-icon-button")}
            onClick={toggleTopBarCollapsed}
            title={collapseButtonLabel}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind="panel-top-close" />
            </span>
            <span className={cm(styles, "sr-only")}>{t("action.collapse")}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
});
