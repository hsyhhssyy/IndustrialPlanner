import type { AppAction } from "@/domain/app/app-action";
import type { SyncState } from "@/domain/sync";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { observer } from "mobx-react-lite";

import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const WebDavSaveIndicator = observer(function WebDavSaveIndicator({
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
  if (saveState === "idle") {
    return null;
  }

  const failed = saveState === "error";
  const label = translate(
    failed ? "webDavSave.failed" : "webDavSave.saving",
  );

  return (
    <div
      aria-label={label}
      className={cm(
        styles,
        className,
        failed
          ? "webdav-save-indicator webdav-save-indicator-failed"
          : "webdav-save-indicator webdav-save-indicator-saving",
      )}
      data-webdav-save-state={saveState}
      role={failed ? "alert" : "status"}
      title={label}
    >
      {failed ? (
        <WorkbenchIcon kind="save-failed" />
      ) : (
        <span className={cm(styles, "webdav-save-icon-stack")}>
          <WorkbenchIcon
            className={cm(styles, "webdav-save-base-icon")}
            kind="save-blueprint"
          />
          <WorkbenchIcon
            className={cm(styles, "webdav-save-progress-icon")}
            kind="save-progress"
          />
        </span>
      )}
      <span className={cm(styles, "sr-only")}>{label}</span>
    </div>
  );
});
