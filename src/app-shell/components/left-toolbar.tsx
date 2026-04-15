import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import {
  LEFT_RAIL_PRIMARY_ITEMS,
  LEFT_RAIL_UTILITY_ITEMS,
} from "@/app-shell/workbench-placeholders";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";

export interface LeftToolbarProps {
  controller: WorkbenchController;
}

export function LeftToolbar({ controller }: LeftToolbarProps) {
  const ui = useExternalStore(controller.workspaceState.uiStore);
  const locale = ui.locale;
  const activeLeftPanelMode = ui.leftPanelMode;
  const leftDockOpen = ui.leftDock.open;
  const iconByItemId = {
    placement: "placement",
    delete: "delete",
    blueprint: "blueprint",
    history: "history",
    feedback: "feedback",
    toolbox: "toolbox",
    help: "help",
    settings: "settings",
  } as const;

  return (
    <aside className="left-toolbar panel-surface">
      <div className="toolbar-rail-group">
        {LEFT_RAIL_PRIMARY_ITEMS.map((item) => {
          const isActive = activeLeftPanelMode === item.id;

          return (
            <button
              aria-pressed={isActive}
              className={`rail-button ${isActive ? "is-active" : ""}`.trim()}
              key={item.id}
              onClick={() => {
                if (isActive && leftDockOpen) {
                  controller.app.action.setDockOpen("left", false);
                  return;
                }

                controller.app.action.setLeftPanelMode(item.id);
              }}
              type="button"
            >
              <span className="rail-button-short">
                <WorkbenchIcon kind={iconByItemId[item.id] ?? "settings"} />
              </span>
              <span className="rail-button-label">
                {localizeWorkbenchText(locale, item.label)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="toolbar-rail-group toolbar-rail-utility">
        {LEFT_RAIL_UTILITY_ITEMS.map((item) => (
          <button
            className="rail-button rail-button-utility"
            key={item.id}
            onClick={() => undefined}
            type="button"
          >
            <span className="rail-button-short">
              <WorkbenchIcon kind={iconByItemId[item.id] ?? "settings"} />
            </span>
            <span className="rail-button-label">
              {localizeWorkbenchText(locale, item.label)}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
