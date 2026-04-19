import { WorkbenchIcon } from "@/app/app-shell/components/workbench-icons";
import {
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";

const PRIMARY_TOOLBAR_ITEMS = [
  {
    id: "primary-placement",
    icon: "placement" as const,
    labelKey: "workbench.leftRail.placement",
  },
  {
    id: "primary-delete",
    icon: "delete" as const,
    labelKey: "workbench.leftRail.delete",
  },
  {
    id: "primary-blueprint",
    icon: "blueprint" as const,
    labelKey: "workbench.leftRail.blueprint",
  },
];

const UTILITY_TOOLBAR_ITEMS = [
  {
    id: "utility-toolbox",
    icon: "toolbox" as const,
    labelKey: "workbench.utility.toolbox",
  },
  {
    id: "utility-help",
    icon: "help" as const,
    labelKey: "workbench.utility.help",
  },
  {
    id: "utility-settings",
    icon: "settings" as const,
    labelKey: "workbench.utility.settings",
  },
];

export function LeftToolbar({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;

  return (
    <aside className="left-toolbar panel-surface">
      <div className="toolbar-rail-group">
        {PRIMARY_TOOLBAR_ITEMS.map((item) => {
          const label = t(item.labelKey);

          return (
            <button
              aria-label={label}
              className="rail-button"
              key={item.id}
              onClick={handleUiEvent}
              title={label}
              type="button"
            >
              <span className="rail-button-short">
                <WorkbenchIcon kind={item.icon} />
              </span>
              <span className="rail-button-label">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="toolbar-rail-group toolbar-rail-utility">
        {UTILITY_TOOLBAR_ITEMS.map((item) => {
          const label = t(item.labelKey);

          return (
            <button
              aria-label={label}
              className="rail-button rail-button-utility"
              key={item.id}
              onClick={handleUiEvent}
              title={label}
              type="button"
            >
              <span className="rail-button-short">
                <WorkbenchIcon kind={item.icon} />
              </span>
              <span className="rail-button-label">{label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
