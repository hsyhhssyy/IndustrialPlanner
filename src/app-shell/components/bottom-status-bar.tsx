import type { WorkbenchController } from "@/app-shell/contracts/workbench-facade";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import {
  LEFT_RAIL_PRIMARY_ITEMS,
} from "@/app-shell/workbench-placeholders";
import type { EditorTool } from "@/editor/contracts/editor-session";
import {
  createTranslator,
  type MessageKey,
} from "@/i18n/messages";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";

export interface BottomStatusBarProps {
  controller: WorkbenchController;
}

const TOOL_LABEL_KEYS: Record<EditorTool, MessageKey> = {
  select: "tool.select",
  place: "tool.place",
  belt: "tool.belt",
  pipe: "tool.pipe",
  link: "tool.link",
  inspect: "tool.inspect",
};

export function BottomStatusBar({ controller }: BottomStatusBarProps) {
  const ui = useExternalStore(controller.uiStore);
  const editor = useExternalStore(controller.editorStore);
  const canvas = useExternalStore(controller.canvasStore);
  const topology = useExternalStore(controller.topologyStore);
  const simulation = useExternalStore(controller.simulationStore);
  const t = createTranslator(ui.locale);
  const selectedEntityId = canvas.activeCanvas.selectedEntityIds[0] ?? null;
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
          {t(ui.mode === "edit" ? "mode.edit" : "mode.simulate")}
        </span>
        <span className="status-chip">
          {t("statusBar.tool")}:{" "}
          {t(TOOL_LABEL_KEYS[editor.session.activeTool])}
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
          {t("statusBar.entities")}: {editor.document.entityOrder.length}
        </span>
        <span className="status-chip">
          {t("statusBar.links")}: {editor.document.explicitLinks.length}
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
}
