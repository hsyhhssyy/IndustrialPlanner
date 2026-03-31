import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import { SIMULATION_SPEED_PRESETS } from "@/app-shell/workbench-placeholders";
import {
  createTranslator,
} from "@/i18n/messages";
import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";

export interface TopBarProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function TopBar({ controller, snapshot }: TopBarProps) {
  const t = createTranslator(snapshot.ui.locale);
  const cellSizeLabel = `${Math.round(
    snapshot.renderScene.gridSize * snapshot.session.viewport.zoom,
  )}px`;
  const simulationRunning = snapshot.runtimeSnapshot.status === "running";

  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          aria-label={t("topBar.leftPanel")}
          className={snapshot.ui.leftDock.open ? "is-active" : undefined}
          onClick={() =>
            controller.setDockOpen("left", !snapshot.ui.leftDock.open)
          }
          title={t("topBar.leftPanel")}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-left" />
          </span>
          <span className="sr-only">{t("topBar.leftPanel")}</span>
        </button>
        <button
          aria-label={t("topBar.rightPanel")}
          className={snapshot.ui.rightDock.open ? "is-active" : undefined}
          onClick={() =>
            controller.setDockOpen("right", !snapshot.ui.rightDock.open)
          }
          title={t("topBar.rightPanel")}
          type="button"
        >
          <span className="top-bar-toggle-icon">
            <WorkbenchIcon kind="panel-right" />
          </span>
          <span className="sr-only">{t("topBar.rightPanel")}</span>
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{t("app.title")}</div>
        <div className="top-bar-subtitle">{t(snapshot.ui.statusMessageKey)}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <button
          onClick={() =>
            simulationRunning
              ? controller.pauseSimulation()
              : controller.startSimulation()
          }
          type="button"
        >
          {t(simulationRunning ? "action.stop" : "action.start")}
        </button>
      </div>
      <div className="toolbar-group top-bar-speed-controls">
        <span className="top-bar-metric">{t("topBar.speed")}</span>
        {SIMULATION_SPEED_PRESETS.map((preset) => (
          <button
            className={snapshot.ui.simulationSpeed === preset ? "is-active" : undefined}
            key={preset}
            onClick={() => controller.setSimulationSpeedPreset(preset)}
            type="button"
          >
            {preset}
          </button>
        ))}
      </div>
      <div className="toolbar-group top-bar-meta-group">
        <span className="top-bar-metric">
          {t("topBar.zoom")}: {cellSizeLabel}
        </span>
      </div>
    </header>
  );
}
