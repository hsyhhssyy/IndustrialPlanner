import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import {
  LEFT_RAIL_PRIMARY_ITEMS,
  LEFT_RAIL_UTILITY_ITEMS,
  localizeText,
} from "@/app-shell/workbench-placeholders";
import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";

export interface LeftToolbarProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function LeftToolbar({ controller, snapshot }: LeftToolbarProps) {
  const locale = snapshot.ui.locale;
  const activeLeftPanelMode = snapshot.ui.leftPanelMode;
  const leftDockOpen = snapshot.ui.leftDock.open;
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
                  controller.setDockOpen("left", false);
                  return;
                }

                controller.setLeftPanelMode(item.id);
              }}
              type="button"
            >
              <span className="rail-button-short">
                <WorkbenchIcon kind={iconByItemId[item.id] ?? "settings"} />
              </span>
              <span className="rail-button-label">
                {localizeText(locale, item.label)}
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
              {localizeText(locale, item.label)}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
