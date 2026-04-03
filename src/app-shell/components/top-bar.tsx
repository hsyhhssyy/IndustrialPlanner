import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { SIMULATION_SPEED_PRESETS } from "@/app-shell/workbench-placeholders";
import { createTranslator } from "@/i18n/messages";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";

export interface TopBarProps {
  controller: WorkbenchController;
}

export function TopBar({ controller }: TopBarProps) {
  const ui = useExternalStore(controller.uiStore);
  const renderScene = useExternalStore(controller.renderSceneStore);
  const t = createTranslator(ui.locale);
  const cellSizeLabel = `${Math.round(renderScene.gridSize * renderScene.zoom)}px`;
  const simulationActive = ui.mode === "simulate";

  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          aria-label={t("topBar.leftPanel")}
          className={ui.leftDock.open ? "is-active" : undefined}
          onClick={() => controller.setDockOpen("left", !ui.leftDock.open)}
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
          className={ui.rightDock.open ? "is-active" : undefined}
          onClick={() => controller.setDockOpen("right", !ui.rightDock.open)}
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
      </div>
      <div className="toolbar-group top-bar-controls">
        <span className="top-bar-metric">
          {t("topBar.zoom")}: {cellSizeLabel}
        </span>
        <button
          onClick={() =>
            simulationActive
              ? controller.stopSimulation()
              : controller.startSimulation()
          }
          type="button"
        >
          {t(simulationActive ? "action.stop" : "action.start")}
        </button>
      </div>
      <div className="toolbar-group top-bar-speed-controls">
        <span className="top-bar-metric">{t("topBar.speed")}</span>
        {SIMULATION_SPEED_PRESETS.map((preset) => (
          <button
            className={ui.simulationSpeed === preset ? "is-active" : undefined}
            key={preset}
            onClick={() => controller.setSimulationSpeedPreset(preset)}
            type="button"
          >
            {preset}
          </button>
        ))}
      </div>
    </header>
  );
}
