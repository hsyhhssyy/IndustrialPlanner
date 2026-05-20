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
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const SIMULATION_CONTROL_BUTTON_ID = "top-bar-simulation-control";
const SIMULATION_SECONDARY_BUTTON_ID = "top-bar-simulation-secondary-control";
const SIMULATION_SPEED_OPTIONS = [0.25, 1, 2, 4, 8, 16] as const;

function getNextSimulationSpeed(current: number): number {
  const currentIndex = SIMULATION_SPEED_OPTIONS.findIndex((candidate) => candidate === current);
  if (currentIndex !== -1) {
    return SIMULATION_SPEED_OPTIONS[(currentIndex + 1) % SIMULATION_SPEED_OPTIONS.length] ?? 1;
  }

  const nextIndex = SIMULATION_SPEED_OPTIONS.findIndex((candidate) => candidate > current);
  if (nextIndex !== -1) {
    return SIMULATION_SPEED_OPTIONS[nextIndex] ?? 1;
  }

  return SIMULATION_SPEED_OPTIONS[0] ?? 1;
}

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

export const SimulationSecondaryButton = observer(function SimulationSecondaryButton({
  appHost,
}: {
  appHost: AppHost;
}) {
  const simulation = appHost.workspace.simulation;
  const simulationState = simulation?.state.runningState ?? "stop";
  const isRunning = simulationState === "start";
  const simulationSpeed = simulation?.state.simulationSpeed ?? 1;
  const speedLabel = formatSimulationSpeedLabel(simulationSpeed);
  const label = isRunning
    ? `${appHost.actions.translate("statusBar.speed")} ${speedLabel}`
    : appHost.actions.translate("action.stop");

  const handleClick = () => {
    if (simulation === null) {
      return;
    }

    if (!isRunning) {
      simulation.actions.stop();
      return;
    }

    simulation.actions.setSimulationSpeed(getNextSimulationSpeed(simulation.state.simulationSpeed));
  };

  return (
    <button
      aria-label={label}
      className={cm(styles, isRunning
        ? "top-bar-simulation-secondary-button top-bar-speed-button"
        : "top-bar-simulation-secondary-button top-bar-icon-button")}
      data-ui-button-id={SIMULATION_SECONDARY_BUTTON_ID}
      onClick={handleClick}
      title={label}
      type="button"
    >
      {isRunning ? (
        <span className={cm(styles, "top-bar-speed-label")}>{speedLabel}</span>
      ) : (
        <>
          <span className={cm(styles, "top-bar-toggle-icon")}>
            <WorkbenchIcon kind="stop" />
          </span>
          <span className={cm(styles, "sr-only")}>{label}</span>
        </>
      )}
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
      </div>
      <div className={cm(styles, "toolbar-group top-bar-controls")}>
        <SimulationControlButton
          appHost={appHost}
          className={cm(styles, "top-bar-icon-button")}
        />
        <SimulationSecondaryButton appHost={appHost} />
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
