import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import { SIMULATION_SPEED_PRESETS } from "@/app-shell/workbench-placeholders";
import {
  SUPPORTED_LOCALES,
  createTranslator,
} from "@/i18n/messages";

export interface TopBarProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function TopBar({ controller, snapshot }: TopBarProps) {
  const t = createTranslator(snapshot.ui.locale);

  return (
    <header className="top-bar">
      <div className="toolbar-group top-bar-layout-controls">
        <button
          className={snapshot.ui.leftDock.open ? "is-active" : undefined}
          onClick={() =>
            controller.setDockOpen("left", !snapshot.ui.leftDock.open)
          }
          type="button"
        >
          {t("topBar.leftPanel")}
        </button>
        <button
          className={snapshot.ui.rightDock.open ? "is-active" : undefined}
          onClick={() =>
            controller.setDockOpen("right", !snapshot.ui.rightDock.open)
          }
          type="button"
        >
          {t("topBar.rightPanel")}
        </button>
      </div>
      <div className="top-bar-title-block">
        <div className="top-bar-title">{t("app.title")}</div>
        <div className="top-bar-subtitle">{t(snapshot.ui.statusMessageKey)}</div>
      </div>
      <div className="toolbar-group top-bar-controls">
        <button
          className={snapshot.ui.mode === "edit" ? "is-active" : undefined}
          onClick={() => controller.setMode("edit")}
          type="button"
        >
          {t("mode.edit")}
        </button>
        <button
          className={snapshot.ui.mode === "simulate" ? "is-active" : undefined}
          onClick={() => controller.setMode("simulate")}
          type="button"
        >
          {t("mode.simulate")}
        </button>
        <button onClick={() => controller.startSimulation()} type="button">
          {t("action.start")}
        </button>
        <button onClick={() => controller.pauseSimulation()} type="button">
          {t("action.pause")}
        </button>
        <button onClick={() => controller.stepSimulation()} type="button">
          {t("action.step")}
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
      <div className="toolbar-group top-bar-locale">
        <span className="top-bar-metric">
          {t("topBar.zoom")}: {(snapshot.session.viewport.zoom * 100).toFixed(0)}
          %
        </span>
        <button onClick={() => controller.zoomOut()} type="button">
          -
        </button>
        <button onClick={() => controller.zoomIn()} type="button">
          +
        </button>
        {SUPPORTED_LOCALES.map((locale) => (
          <button
            className={snapshot.ui.locale === locale ? "is-active" : undefined}
            key={locale}
            onClick={() => controller.setLocale(locale)}
            type="button"
          >
            {t(`locale.${locale}`)}
          </button>
        ))}
        <button onClick={() => undefined} type="button">
          {t("topBar.settings")}
        </button>
      </div>
    </header>
  );
}
