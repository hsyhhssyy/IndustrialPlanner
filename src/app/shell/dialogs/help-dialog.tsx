import type { ReactNode } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell, type DialogShellTab } from "@/app/shell/shared/dialog-shell";
import { HELP_DIALOG_TAB_IDS, type HelpDialogTabId } from "@/app/state/state-impl";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { OperationGuideContent } from "@/app/shell/dialogs/help-dialog-operation-guide";
import { ChangelogSection } from "@/app/shell/dialogs/changelog-section";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

const HELP_DIALOG_TABS: Array<{
  id: HelpDialogTabId;
  labelKey: string;
}> = [
  {
    id: HELP_DIALOG_TAB_IDS[0],
    labelKey: "helpDialog.tab.overview",
  },
  {
    id: HELP_DIALOG_TAB_IDS[1],
    labelKey: "helpDialog.tab.shortcuts",
  },
  {
    id: HELP_DIALOG_TAB_IDS[2],
    labelKey: "helpDialog.tab.faq",
  },
  {
    id: HELP_DIALOG_TAB_IDS[3],
    labelKey: "helpDialog.tab.versionUpdates",
  },
];

export const HelpDialog = observer(function HelpDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.help;
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const tabs: DialogShellTab[] = HELP_DIALOG_TABS.map((tab) => {
    let content: ReactNode;
    if (tab.id === "shortcuts") {
      content = (
        <div className={cm(styles, "help-dialog-content")}>
          <OperationGuideContent
            deviceClass={appHost.state.screenProfile.deviceClass}
            getShortcut={(key) => appHost.internalActions.getKeyboardShortcutFor(key)}
            settings={appHost.state.settings}
          />
        </div>
      );
    } else if (tab.id === "version") {
      content = <ChangelogSection />;
    } else {
      content = (
        <div className={cm(styles, "help-dialog-content")}>
          <div className={cm(styles, "help-dialog-placeholder")}>
            <h3>{t(tab.labelKey)}</h3>
            <p>{t("helpDialog.empty")}</p>
          </div>
        </div>
      );
    }
    return { id: tab.id, label: t(tab.labelKey), content };
  });

  return (
    <DialogShell
      className="help-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="help"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("helpDialog.maximize")}
      onClose={() => {
        appHost.internalActions.closeDialog("help");
      }}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("help", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("help", width, height);
      }}
      onTabChange={(tabId) => {
        appHost.internalActions.setDialogTab("help", tabId);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("help");
      }}
      restoreTitle={t("helpDialog.restore")}
      tabs={tabs}
      title={t("helpDialog.title")}
      titleId="help-dialog-title"
    />
  );
});
