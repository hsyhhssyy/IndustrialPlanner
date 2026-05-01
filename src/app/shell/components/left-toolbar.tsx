import { observer } from "mobx-react-lite";
import { WorkbenchIcon } from "@/app/shell/components/workbench-icons";
import {
  handleUiEvent,
} from "@/app/shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";
import type { ActivePanel } from "@/app/state/state-impl";

type LeftToolbarPanel = Exclude<ActivePanel, null>;

const PRIMARY_TOOLBAR_ITEMS = [
  {
    id: "primary-placement",
    icon: "placement" as const,
    labelKey: "workbench.leftRail.placement",
    panel: "placement" as LeftToolbarPanel,
  },
  {
    id: "primary-delete",
    icon: "delete" as const,
    labelKey: "workbench.leftRail.delete",
    panel: "delete" as LeftToolbarPanel,
  },
  {
    id: "primary-blueprint",
    icon: "blueprint" as const,
    labelKey: "workbench.leftRail.blueprint",
    panel: "blueprint" as LeftToolbarPanel,
  },
  {
    id: "primary-history",
    icon: "history" as const,
    labelKey: "workbench.leftRail.history",
    panel: "history" as LeftToolbarPanel,
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

export const LeftToolbar = observer(function LeftToolbar({
  appHost,
  onOpenSettings,
}: {
  appHost: AppHost;
  onOpenSettings?: () => void;
}) {
  const t = appHost.actions.translate;
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
  const helpDialogVisible = appHost.internalState.runtime.helpDialog.visible;

  return (
    <aside className="left-toolbar panel-surface">
      <div className="toolbar-rail-group">
        {PRIMARY_TOOLBAR_ITEMS.map((item) => {
          const label = t(item.labelKey);
          const isActive = activePanel === item.panel;

          return (
            <button
              aria-label={label}
              aria-pressed={isActive}
              className={isActive ? "rail-button is-active" : "rail-button"}
              key={item.id}
              onClick={() => {
                if (leftDockOpen && isActive) {
                  appHost.internalActions.toggleLeftDock();

                  return;
                }

                appHost.internalActions.setActivePanel(item.panel);
              }}
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
          const isHelpButton = item.id === "utility-help";
          const isActive = isHelpButton && helpDialogVisible;
          let handleClick = handleUiEvent;

          if (item.id === "utility-help") {
            handleClick = () => {
              appHost.internalActions.openHelpDialog();
            };
          } else if (item.id === "utility-settings") {
            handleClick = onOpenSettings ?? handleUiEvent;
          }

          return (
            <button
              aria-label={label}
              aria-pressed={isHelpButton ? isActive : undefined}
              className={isActive
                ? "rail-button rail-button-utility is-active"
                : "rail-button rail-button-utility"}
              key={item.id}
              onClick={handleClick}
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
});
