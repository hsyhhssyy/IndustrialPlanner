import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";

const PRIMARY_TOOLBAR_ITEMS = [
  { id: "primary-placement", icon: "placement" as const },
  { id: "primary-delete", icon: "delete" as const },
  { id: "primary-blueprint", icon: "blueprint" as const },
];

const UTILITY_TOOLBAR_ITEMS = [
  { id: "utility-toolbox", icon: "toolbox" as const },
  { id: "utility-help", icon: "help" as const },
  { id: "utility-settings", icon: "settings" as const },
];

export function LeftToolbar() {
  return (
    <aside className="left-toolbar panel-surface">
      <div className="toolbar-rail-group">
        {PRIMARY_TOOLBAR_ITEMS.map((item) => (
          <button
            aria-label={STATIC_UI_PLACEHOLDER_TEXT}
            className="rail-button"
            key={item.id}
            onClick={handleUiEvent}
            type="button"
          >
            <span className="rail-button-short">
              <WorkbenchIcon kind={item.icon} />
            </span>
            <span className="rail-button-label">{STATIC_UI_PLACEHOLDER_TEXT}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-rail-group toolbar-rail-utility">
        {UTILITY_TOOLBAR_ITEMS.map((item) => (
          <button
            className="rail-button rail-button-utility"
            key={item.id}
            onClick={handleUiEvent}
            type="button"
          >
            <span className="rail-button-short">
              <WorkbenchIcon kind={item.icon} />
            </span>
            <span className="rail-button-label">{STATIC_UI_PLACEHOLDER_TEXT}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
