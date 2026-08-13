import type { AppAction } from "@/domain/app/app-action";
import type { SyncState } from "@/domain/sync";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { observer } from "mobx-react-lite";

import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const SyncSaveIndicator = observer(function SyncSaveIndicator({
  className,
  syncState,
  translate,
}: {
  className?: string;
  syncState: SyncState;
  translate: AppAction["translate"];
}) {
  if (!syncState.settings.enabled) {
    return null;
  }

  const saveState = syncState.status.saveState;
  const syncFailed = syncState.status.phase === "error";
  if (saveState === "idle" && !syncFailed) {
    return null;
  }

  const failed = saveState === "error" || syncFailed;
  const label = translate(
    syncFailed
      ? "syncSave.syncFailed"
      : failed ? "syncSave.failed" : "syncSave.saving",
  );

  return (
    <div
      aria-label={label}
      className={cm(
        styles,
        className,
        failed
          ? "sync-save-indicator sync-save-indicator-failed"
          : "sync-save-indicator sync-save-indicator-saving",
      )}
      data-sync-save-state={failed ? "error" : saveState}
      role={failed ? "alert" : "status"}
      title={label}
    >
      {failed ? (
        <WorkbenchIcon kind="save-failed" />
      ) : (
        <span className={cm(styles, "sync-save-icon-stack")}>
          <WorkbenchIcon
            className={cm(styles, "sync-save-base-icon")}
            kind="save-blueprint"
          />
          <WorkbenchIcon
            className={cm(styles, "sync-save-progress-icon")}
            kind="save-progress"
          />
        </span>
      )}
      <span className={cm(styles, "sr-only")}>{label}</span>
    </div>
  );
});
