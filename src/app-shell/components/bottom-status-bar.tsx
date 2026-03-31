import type { WorkbenchSnapshot } from "@/app-shell/controller/workbench-controller";
import {
  LEFT_RAIL_PRIMARY_ITEMS,
  localizeText,
} from "@/app-shell/workbench-placeholders";
import {
  getLocalizedStage1EntityName,
} from "@/domain/registry/stage1-registry-i18n";
import { createTranslator } from "@/i18n/messages";

export interface BottomStatusBarProps {
  snapshot: WorkbenchSnapshot;
}

export function BottomStatusBar({ snapshot }: BottomStatusBarProps) {
  const t = createTranslator(snapshot.ui.locale);
  const selectedEntityId = snapshot.session.selection[0] ?? null;
  const selectedDefinition = selectedEntityId
    ? snapshot.topology.entityViews[selectedEntityId]?.definition ?? null
    : null;
  const activeView = LEFT_RAIL_PRIMARY_ITEMS.find(
    (item) => item.id === snapshot.ui.leftPanelMode,
  );
  const selectionLabel = selectedDefinition
    ? getLocalizedStage1EntityName(snapshot.ui.locale, selectedDefinition)
    : t("statusBar.none");

  return (
    <footer className="status-bar">
      <div className="status-bar-group">
        <span className="status-chip">
          {t("statusBar.view")}:{" "}
          {activeView
            ? localizeText(snapshot.ui.locale, activeView.label)
            : t("statusBar.none")}
        </span>
        <span className="status-chip">
          {t("statusBar.mode")}:{" "}
          {t(snapshot.ui.mode === "edit" ? "mode.edit" : "mode.simulate")}
        </span>
        <span className="status-chip">
          {t("statusBar.locale")}: {t(`locale.${snapshot.ui.locale}`)}
        </span>
        <span className="status-chip">
          {t("statusBar.theme")}: Ayu Dark
        </span>
      </div>
      <div className="status-bar-group">
        <span className="status-chip">
          {t("statusBar.selection")}: {selectionLabel}
        </span>
        <span className="status-chip">
          {t("statusBar.diagnostics")}: {snapshot.topology.diagnostics.length}
        </span>
        <span className="status-chip">
          {t("statusBar.tick")}: {snapshot.telemetry.tick}
        </span>
        <span className="status-chip">
          {t("statusBar.simHz")}: {snapshot.telemetry.simulatedHertz}
        </span>
        <span className="status-chip">
          {t("statusBar.speed")}: {snapshot.ui.simulationSpeed}
        </span>
      </div>
    </footer>
  );
}
