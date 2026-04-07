import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import {
  LEFT_RAIL_PRIMARY_ITEMS,
} from "@/app-shell/workbench-placeholders";
import type { DisplayTool } from "@/editor/contracts/interaction-mode";
import {
  createTranslator,
  type MessageKey,
} from "@/i18n/messages";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";

export interface BottomStatusBarProps {
  controller: WorkbenchController;
}

const TOOL_LABEL_KEYS: Record<DisplayTool, MessageKey> = {
  select: "tool.select",
  place: "tool.place",
  belt: "tool.belt",
  pipe: "tool.pipe",
  link: "tool.link",
  inspect: "tool.inspect",
};

export const BottomStatusBar = observer(function BottomStatusBar({
  controller,
}: BottomStatusBarProps) {
  const ui = controller.uiStore;
  const document = useExternalStore(controller.documentStore);
  const editor = controller.editorStore;
  const topology = useExternalStore(controller.topologyStore);
  const simulation = useExternalStore(controller.simulationStore);
  const t = createTranslator(ui.locale);
  const selectedEntityId =
    ui.phase === "simulate"
      ? simulation.selection[0] ?? null
      : editor.session.selection[0] ?? null;
  const selectedDefinition = selectedEntityId
    ? topology.entityViews[selectedEntityId]?.definition ?? null
    : null;
  const activeView = LEFT_RAIL_PRIMARY_ITEMS.find(
    (item) => item.id === ui.leftPanelMode,
  );
  const selectionLabel = selectedDefinition
    ? getLocalizedStage1EntityName(ui.locale, selectedDefinition)
    : t("statusBar.none");

  return (
    <footer className="status-bar">
      <div className="status-bar-group">
        <span className="status-chip">
          {t("statusBar.view")}:{" "}
          {activeView
            ? localizeWorkbenchText(ui.locale, activeView.label)
            : t("statusBar.none")}
        </span>
        <span className="status-chip">
          {t("statusBar.mode")}:{" "}
          {t(ui.phase === "edit" ? "mode.edit" : "mode.simulate")}
        </span>
        <span className="status-chip">
          {t("statusBar.tool")}:{" "}
          {t(TOOL_LABEL_KEYS[editor.session.displayTool])}
        </span>
        <span className="status-chip">
          {t("statusBar.locale")}: {t(`locale.${ui.locale}`)}
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
          {t("statusBar.entities")}: {document.entityOrder.length}
        </span>
        <span className="status-chip">
          {t("statusBar.links")}: {document.explicitLinks.length}
        </span>
        <span className="status-chip">
          {t("statusBar.diagnostics")}: {topology.diagnostics.length}
        </span>
        <span className="status-chip">
          {t("statusBar.compile")}: {topology.compileVersion}
        </span>
        <span className="status-chip">
          {t("statusBar.tick")}: {simulation.telemetry.tick}
        </span>
        <span className="status-chip">
          {t("statusBar.simHz")}: {simulation.telemetry.simulatedHertz}
        </span>
        <span className="status-chip">
          {t("statusBar.speed")}: {ui.simulationSpeed}
        </span>
      </div>
    </footer>
  );
});
