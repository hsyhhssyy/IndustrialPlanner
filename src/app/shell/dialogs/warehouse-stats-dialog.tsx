import { useMemo, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import LucideSearch from "~icons/lucide/search";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import {
  buildWarehouseStatsEntries,
  useWarehousePinnedItems,
  useWarehouseStats,
  WarehouseStatsView,
} from "@/app/shell/shared/warehouse-stats-view";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const WarehouseStatsDialog = observer(function WarehouseStatsDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState["warehouse-stats"];
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const [query, setQuery] = useState("");
  const stats = useWarehouseStats(appHost);
  const pinnedItems = useWarehousePinnedItems(appHost);
  const entries = useMemo(() => buildWarehouseStatsEntries({
    appHost,
    stats,
    pinnedItemIds: pinnedItems.pinnedItemIds,
  }), [appHost, pinnedItems.pinnedItemIds, stats]);

  if (!dialogState.visible) {
    return null;
  }

  const shellStyle: CSSProperties | undefined = isPhoneLayout
    ? {
      width: "100%",
      height: "100%",
      minHeight: 0,
      transform: "none",
    }
    : dialogState.width === null && dialogState.height === null
      ? {
        width: "min(880px, 94vw)",
        height: "min(680px, 88vh)",
        minHeight: "480px",
      }
      : undefined;

  return (
    <DialogShell
      bodyClassName="warehouse-stats-dialog-body"
      className="warehouse-stats-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="warehouse-stats"
      dialogState={dialogState}
      immersiveMaximized={isPhoneLayout || (dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile))}
      maximizeTitle={t("dialog.maximize")}
      onClose={() => appHost.internalActions.closeDialog("warehouse-stats")}
      onOffsetChange={isPhoneLayout ? undefined : (offsetX, offsetY) => appHost.internalActions.setDialogOffset("warehouse-stats", offsetX, offsetY)}
      onResize={isPhoneLayout ? undefined : (width, height) => appHost.internalActions.setDialogSize("warehouse-stats", width, height)}
      onToggleMaximized={() => appHost.internalActions.toggleDialogMaximized("warehouse-stats")}
      restoreTitle={t("dialog.restore")}
      shellStyle={shellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={t("warehouseStats.dialogTitle")}
      titleId="warehouse-stats-dialog-title"
    >
      <div className={cm(styles, "warehouse-stats-dialog-content")}> 
        <div className={cm(styles, "warehouse-stats-dialog-toolbar")}> 
          <label className={cm(styles, "warehouse-stats-search")}> 
            <LucideSearch aria-hidden="true" />
            <input
              aria-label={t("warehouseStats.search")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("warehouseStats.search")}
              type="search"
              value={query}
            />
          </label>
          <span className={cm(styles, "warehouse-stats-pin-counter")}> 
            {t("warehouseStats.pinnedCount")} {pinnedItems.pinnedItemIds.length}/{pinnedItems.maxPinnedItems}
          </span>
        </div>
        {stats === null ? (
          <div className={cm(styles, "warehouse-stats-dialog-empty")}>{t("warehouseStats.runToView")}</div>
        ) : (
          <WarehouseStatsView
            appHost={appHost}
            entries={entries}
            mode="dialog"
            onTogglePinned={pinnedItems.togglePinned}
            pinnedItemIds={pinnedItems.pinnedItemIds}
            query={query}
          />
        )}
      </div>
    </DialogShell>
  );
});
