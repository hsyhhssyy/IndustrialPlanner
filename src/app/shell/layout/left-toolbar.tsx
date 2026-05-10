import { observer } from "mobx-react-lite";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import {
  handleUiEvent,
} from "@/app/shell/shared/ui-shell-null-handlers";
import type { AppHost } from "@/app/host/app-host";
import type { ActivePanel } from "@/app/state/state-impl";

// AI-REMOVED 2026-05-10:
// Reason: 左侧删除模式按钮已废弃，不再注册到主工具栏。
// Trigger: 产品要求移除左侧“删除模式”和整个删除面板。
// Evidence: 删除面板只通过 LeftToolbar 和 LeftDock 暴露，没有其他入口设置 activePanel 为 delete。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// {
//   id: "primary-delete",
//   icon: "delete" as const,
//   labelKey: "workbench.leftRail.delete",
//   panel: "delete" as LeftToolbarPanel,
// },

type LeftToolbarPanel = Exclude<ActivePanel, null>;

const PRIMARY_TOOLBAR_ITEMS = [
  {
    id: "primary-placement",
    icon: "placement" as const,
    labelKey: "workbench.leftRail.placement",
    panel: "placement" as LeftToolbarPanel,
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
  {
    id: "primary-base",
    icon: "base" as const,
    labelKey: "workbench.leftRail.base",
    panel: "base" as LeftToolbarPanel,
  },
  {
    id: "primary-simulation",
    icon: "simulation" as const,
    labelKey: "workbench.leftRail.simulation",
    panel: "simulation" as LeftToolbarPanel,
  },
];

const UTILITY_TOOLBAR_ITEMS = [
  {
    id: "utility-debug-log",
    icon: "debug-log" as const,
    labelKey: "workbench.utility.debugLogs",
    dialogKey: "debug-log",
    debugOnly: true,
  },
  {
    id: "utility-toolbox",
    icon: "toolbox" as const,
    labelKey: "workbench.utility.toolbox",
    dialogKey: "toolbox",
  },
  {
    id: "utility-help",
    icon: "help" as const,
    labelKey: "workbench.utility.help",
    dialogKey: "help",
  },
  {
    id: "utility-settings",
    icon: "settings" as const,
    labelKey: "workbench.utility.settings",
    dialogKey: "settings",
  },
];

export const LeftToolbar = observer(function LeftToolbar({
  appHost,
}: {
  appHost: AppHost;
}) {
  const t = appHost.actions.translate;
  const leftDockOpen = appHost.state.workbench.leftDockOpen;
  const activePanel = appHost.internalState.runtime.activePanel ?? "placement";
  const toolboxDialogVisible = appHost.internalState.workbench.dialogState.toolbox.visible;
  const helpDialogVisible = appHost.internalState.workbench.dialogState.help.visible;
  const settingsDialogVisible = appHost.internalState.workbench.dialogState.settings.visible;
  const debugLogDialogVisible = appHost.internalState.workbench.dialogState["debug-log"]?.visible ?? false;
  const utilityToolbarItems = UTILITY_TOOLBAR_ITEMS.filter((item) => {
    return item.debugOnly !== true || appHost.state.settings.debugMode;
  });

  return (
    <aside className="left-toolbar panel-surface">
      <div className="toolbar-rail-group">
        {PRIMARY_TOOLBAR_ITEMS.map((item) => {
          const label = t(item.labelKey);
          const isActive = leftDockOpen && activePanel === item.panel;

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
        {utilityToolbarItems.map((item) => {
          const label = t(item.labelKey);
          const isDebugLogButton = item.id === "utility-debug-log";
          const isToolboxButton = item.id === "utility-toolbox";
          const isHelpButton = item.id === "utility-help";
          const isSettingsButton = item.id === "utility-settings";
          const isActive = (isDebugLogButton && debugLogDialogVisible)
            || (isToolboxButton && toolboxDialogVisible)
            || (isHelpButton && helpDialogVisible)
            || (isSettingsButton && settingsDialogVisible);
          const handleClick = item.dialogKey === undefined
            ? handleUiEvent
            : () => {
              appHost.internalActions.openDialog(item.dialogKey);
            };

          return (
            <button
              aria-label={label}
              aria-pressed={isDebugLogButton || isToolboxButton || isHelpButton || isSettingsButton ? isActive : undefined}
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
