import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell, type DialogShellTab } from "@/app/shell/shared/dialog-shell";
import { EncyclopediaPanel } from "@/app/shell/encyclopedia/encyclopedia-panel";
import { ModuleBalancingPanel } from "@/app/shell/module-balancing/module-balancing-panel";
import { ProductionPlanningPanel } from "@/app/shell/production-planning";
import { TOOLBOX_DIALOG_TAB_IDS, type ToolboxDialogTabId } from "@/app/state/state-impl";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

const TOOLBOX_DIALOG_TABS: Array<{
  id: ToolboxDialogTabId;
  labelKey: string;
}> = [
  {
    id: TOOLBOX_DIALOG_TAB_IDS[0],
    labelKey: "toolboxDialog.tab.itemEncyclopedia",
  },
  {
    id: TOOLBOX_DIALOG_TAB_IDS[1],
    labelKey: "toolboxDialog.tab.productionPlanning",
  },
  {
    id: TOOLBOX_DIALOG_TAB_IDS[2],
    labelKey: "toolboxDialog.tab.moduleBalancing",
  },
];

export const ToolboxDialog = observer(function ToolboxDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.toolbox;
  const isTouch = shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile);
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";

  const tabContents: Record<string, ReactNode> = {
    [TOOLBOX_DIALOG_TAB_IDS[0]]: (
      <EncyclopediaPanel appHost={appHost} isTouch={isTouch} />
    ),
    [TOOLBOX_DIALOG_TAB_IDS[1]]: (
      <ProductionPlanningPanel appHost={appHost} isTouch={isTouch} />
    ),
    [TOOLBOX_DIALOG_TAB_IDS[2]]: (
      <ModuleBalancingPanel appHost={appHost} isTouch={isTouch} />
    ),
  };

  const tabs: DialogShellTab[] = TOOLBOX_DIALOG_TABS.map((tab) => {
    const customContent = tabContents[tab.id];
    return {
      id: tab.id,
      label: t(tab.labelKey),
      content: customContent ?? (
        <div className={cm(styles, "toolbox-dialog-content")}>
          <div className={cm(styles, "toolbox-dialog-placeholder")}>
            <h3>{t(tab.labelKey)}</h3>
            <p>{t("toolboxDialog.empty")}</p>
          </div>
        </div>
      ),
    };
  });

  return (
    <DialogShell
      className="toolbox-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="toolbox"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("toolboxDialog.maximize")}
      onClose={() => {
        appHost.internalActions.closeDialog("toolbox");
      }}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("toolbox", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("toolbox", width, height);
      }}
      onTabChange={(tabId) => {
        appHost.internalActions.setDialogTab("toolbox", tabId);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("toolbox");
      }}
      restoreTitle={t("toolboxDialog.restore")}
      tabs={tabs}
      title={t("toolboxDialog.title")}
      titleId="toolbox-dialog-title"
    />
  );
});
