import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import {
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

const LEFT_DOCK_BUTTONS = [
  { id: "dock-button-1", icon: "pointer" as const, labelKey: "tool.select" },
  { id: "dock-button-2", icon: "placement" as const, labelKey: "tool.place" },
  { id: "dock-button-3", icon: "history" as const, labelKey: "action.undo" },
];

const PANEL_TITLE_KEYS = {
  placement: "workbench.panel.placement.title",
  delete: "workbench.panel.delete.title",
  blueprint: "workbench.panel.blueprint.title",
  history: "workbench.panel.history.title",
} as const;

const ACTIVE_TOOL_KEYS = {
  placement: "tool.place",
  delete: "action.deleteSelection",
  blueprint: "workbench.leftRail.blueprint",
  history: "action.undo",
} as const;

export function LeftDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
  const currentPanelLabel = t(PANEL_TITLE_KEYS[activePanel]);
  const activeToolLabel = t(ACTIVE_TOOL_KEYS[activePanel]);

  return (
    <aside className="dock dock-left panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <div className="section-header-copy">
            <p className="section-kicker">{t("leftDock.currentMode")}</p>
            <h2>{currentPanelLabel}</h2>
          </div>
          <div className="header-actions">
            <span className="pill">{t("leftDock.activeTool")}</span>
            <button onClick={handleUiEvent} type="button">
              {activeToolLabel}
            </button>
          </div>
        </div>
        <div className="section-body stack">
          <div className="cluster">
            <div className="pill-row">
              <span className="pill">{t("tool.select")}</span>
              <span className="pill">{t("tool.place")}</span>
              <span className="pill">{t("tool.inspect")}</span>
            </div>
            <p className="mono-line">{t("label.touchPlacementHint")}</p>
          </div>
          <section className="placeholder-section">
            <div className="placeholder-section-header">
              <h3>{t("section.quickActions")}</h3>
              <span className="pill">{t("toolbar.tools")}</span>
            </div>
            <div className="placeholder-button-grid">
              {LEFT_DOCK_BUTTONS.map((button) => {
                const label = t(button.labelKey);

                return (
                  <button
                    key={button.id}
                    onClick={handleUiEvent}
                    onPointerDown={handleUiEvent}
                    type="button"
                  >
                    <span className="button-icon button-icon-glyph" aria-hidden="true">
                      <WorkbenchIcon kind={button.icon} />
                    </span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </aside>
  );
}
