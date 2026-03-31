import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import {
  LEFT_RAIL_PRIMARY_ITEMS,
  LEFT_RAIL_UTILITY_ITEMS,
  localizeText,
} from "@/app-shell/workbench-placeholders";

export interface LeftToolbarProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function LeftToolbar({ controller, snapshot }: LeftToolbarProps) {
  const locale = snapshot.ui.locale;

  return (
    <aside className="left-toolbar panel-surface">
      <div className="toolbar-rail-group">
        {LEFT_RAIL_PRIMARY_ITEMS.map((item) => (
          <button
            aria-pressed={snapshot.ui.leftPanelMode === item.id}
            className={`rail-button ${
              snapshot.ui.leftPanelMode === item.id ? "is-active" : ""
            }`.trim()}
            key={item.id}
            onClick={() => controller.setLeftPanelMode(item.id)}
            type="button"
          >
            <span className="rail-button-short">{item.shortLabel}</span>
            <span className="rail-button-label">
              {localizeText(locale, item.label)}
            </span>
          </button>
        ))}
      </div>
      <div className="toolbar-rail-group toolbar-rail-utility">
        {LEFT_RAIL_UTILITY_ITEMS.map((item) => (
          <button
            className="rail-button rail-button-utility"
            key={item.id}
            onClick={() => undefined}
            type="button"
          >
            <span className="rail-button-short">{item.shortLabel}</span>
            <span className="rail-button-label">
              {localizeText(locale, item.label)}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
