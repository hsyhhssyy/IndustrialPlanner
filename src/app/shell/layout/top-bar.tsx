import { FullscreenToggleButton } from "@/app/shell/layout/fullscreen-toggle-button";
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

const SIMULATION_CONTROL_BUTTON_ID = "top-bar-simulation-control";

export const SimulationControlButton = observer(function SimulationControlButton({
  appHost,
  className,
}: {
  appHost: AppHost;
  className: string;
}) {
  const simulationState = appHost.workspace.simulation?.state ?? "stop";
  const isRunning = simulationState === "start";
  const label = appHost.actions.translate(isRunning ? "action.pause" : "action.start");

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
      className={className}
      data-ui-button-id={SIMULATION_CONTROL_BUTTON_ID}
      onClick={handleClick}
      onPointerUp={handlePointerUp}
      title={label}
      type="button"
    >
      <span className="top-bar-toggle-icon">
        <WorkbenchIcon kind={isRunning ? "pause" : "play"} />
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
});

export const TopBar = observer(function TopBar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const {
    screenProfile,
    workbench: { leftDockOpen, rightDockOpen, topBarCollapsed },
  } = appHost.state;

  const toggleLeftDock = () => {
    appHost.internalActions.toggleLeftDock();
  };
  const toggleRightDock = () => {
    appHost.internalActions.toggleRightDock();
  };
  const toggleTopBarCollapsed = () => {
    appHost.internalActions.toggleTopBarCollapsed();
  };
  const leftPanelLabel = `${t(leftDockOpen ? "action.close" : "action.open")} ${t("topBar.leftPanel")}`;
  const rightPanelLabel = `${t(rightDockOpen ? "action.close" : "action.open")} ${t("topBar.rightPanel")}`;
  const isTouchLandscape = isTouchLandscapeScreenProfile(screenProfile);
  const collapseActionKey = isTouchLandscape && topBarCollapsed ? "action.expand" : "action.collapse";
  const collapseButtonLabel = `${t(collapseActionKey)} ${t("topBar.controls")}`;
  const leftPanelIconKind = leftDockOpen ? "panel-left-close" : "panel-left-open";
  const rightPanelIconKind = rightDockOpen ? "panel-right-close" : "panel-right-open";

  if (isTouchLandscape && topBarCollapsed) {
    return null;
  }

  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          aria-label={leftPanelLabel}
          aria-pressed={leftDockOpen}
          className={leftDockOpen ? "is-active" : undefined}
          onClick={toggleLeftDock}
          title={leftPanelLabel}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind={leftPanelIconKind} />
          </span>
          <span className="sr-only">{leftPanelLabel}</span>
        </button>
        <button
          aria-label={rightPanelLabel}
          aria-pressed={rightDockOpen}
          className={rightDockOpen ? "is-active" : undefined}
          onClick={toggleRightDock}
          title={rightPanelLabel}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind={rightPanelIconKind} />
          </span>
          <span className="sr-only">{rightPanelLabel}</span>
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{t("app.title")}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <SimulationControlButton
          appHost={appHost}
          className="top-bar-icon-button"
        />
        <FullscreenToggleButton
          appHost={appHost}
          className="top-bar-icon-button top-bar-fullscreen-button"
        />
        {isTouchLandscape ? (
          <button
            aria-label={collapseButtonLabel}
            className="top-bar-collapse-button top-bar-icon-button"
            onClick={toggleTopBarCollapsed}
            title={collapseButtonLabel}
            type="button"
          >
            <span className="top-bar-toggle-icon">
              <WorkbenchIcon kind="panel-top-close" />
            </span>
            <span className="sr-only">{t("action.collapse")}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
});
