import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type {
  SyncInitialSyncStage,
  SyncPhase,
  SyncRunReason,
  SyncState,
  SyncTaskKind,
  SyncTaskPhase,
} from "@/domain/sync";
import type { UiKey } from "@/shared/i18n";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const WebDavSyncStatusDialog = observer(function WebDavSyncStatusDialog({
  compactMobileLayout,
  dialogState,
  onClose,
  onToggleMaximized,
  state,
  t,
}: {
  compactMobileLayout: boolean;
  dialogState: DialogStateReadWrite;
  onClose: () => void;
  onToggleMaximized: () => void;
  state: SyncState;
  t: AppHost["actions"]["translate"];
}) {
  const status = state.status;

  return (
    <DialogShell
      bodyClassName={cm(styles, "webdav-sync-status-dialog-body")}
      className="webdav-sync-status-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={compactMobileLayout}
      dialogKey="webdav-sync-status"
      dialogState={dialogState}
      maximizeTitle={t("dialog.maximize")}
      onClose={onClose}
      onToggleMaximized={onToggleMaximized}
      restoreTitle={t("dialog.restore")}
      title={t("webDavStatus.title")}
      titleId="webdav-sync-status-dialog-title"
    >
      <div
        aria-live="polite"
        className={cm(styles, "webdav-sync-status-content")}
        data-webdav-sync-status-dialog
      >
        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.overview")}</h3>
          <dl className={cm(styles, "webdav-sync-status-summary-grid")}>
            <StatusValue
              label={t("webDavStatus.syncEnabled")}
              value={t(state.settings.enabled
                ? "webDavStatus.enabled"
                : "webDavStatus.disabled")}
            />
            <StatusValue
              label={t("settingsField.experimental-webdav-status")}
              value={t(resolvePhaseKey(status.phase))}
            />
            <StatusValue
              label={t("webDavStatus.currentRunReason")}
              value={status.currentRunReason === null
                ? t("settingsOption.none")
                : t(resolveRunReasonKey(status.currentRunReason))}
            />
            <StatusValue
              label={t("webDavStatus.initialStage")}
              value={t(resolveStageKey(status.initialSyncStage))}
            />
            <StatusValue
              label={t("webDavStatus.pendingLocalChanges")}
              value={String(status.pendingLocalChangeCount)}
            />
            <StatusValue
              label={t("webDavStatus.lastUpload")}
              value={formatNullableTime(
                status.lastUploadAt,
                t("settingsOption.none"),
              )}
            />
            <StatusValue
              label={t("webDavStatus.lastDownload")}
              value={formatNullableTime(
                status.lastDownloadAt,
                t("settingsOption.none"),
              )}
            />
          </dl>
          {status.lastError === null ? null : (
            <div
              className={cm(styles, "webdav-sync-status-error")}
              role="alert"
            >
              <strong>{t("webDavStatus.lastError")}</strong>
              <span>{status.lastError}</span>
            </div>
          )}
        </section>

        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.network")}</h3>
          <dl className={cm(styles, "webdav-sync-status-network-grid")}>
            <StatusValue
              label={t("webDavStatus.maxConcurrentRequests")}
              value={String(state.settings.maxConcurrentRequests)}
            />
            <StatusValue
              label={t("webDavStatus.activeRequests")}
              value={String(status.activeRequestCount)}
            />
            <StatusValue
              label={t("webDavStatus.queuedRequests")}
              value={String(status.queuedRequestCount)}
            />
          </dl>
        </section>

        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.tasks")}</h3>
          <div className={cm(styles, "webdav-sync-task-list")}>
            {status.tasks.map((task) => (
              <article
                className={cm(
                  styles,
                  `webdav-sync-task-card is-${task.phase}`,
                )}
                data-sync-task-kind={task.kind}
                data-sync-task-phase={task.phase}
                key={task.kind}
              >
                <header>
                  <strong>{t(resolveTaskKindKey(task.kind))}</strong>
                  <span>{t(resolveTaskPhaseKey(task.phase))}</span>
                </header>
                <div className={cm(styles, "webdav-sync-task-metadata")}>
                  <span>
                    {t("webDavStatus.taskProgress")
                      .replace("{completed}", String(task.completedUnitCount))
                      .replace("{total}", String(task.totalUnitCount))}
                  </span>
                  <span>
                    {t("webDavStatus.taskLastStarted").replace(
                      "{time}",
                      formatNullableTime(
                        task.lastStartedAt,
                        t("settingsOption.none"),
                      ),
                    )}
                  </span>
                  <span>
                    {t("webDavStatus.taskLastFinished").replace(
                      "{time}",
                      formatNullableTime(
                        task.lastFinishedAt,
                        t("settingsOption.none"),
                      ),
                    )}
                  </span>
                  {task.lastError === null ? null : (
                    <span className={cm(styles, "webdav-sync-task-error")}>
                      {task.lastError}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("settingsField.experimental-webdav-devices")}</h3>
          <div className={cm(styles, "webdav-sync-device-list")}>
            {state.remoteDevices.length === 0 ? (
              <span>{t("settingsOption.none")}</span>
            ) : state.remoteDevices.map((device) => (
              <article key={device.deviceId}>
                <strong>{device.label}</strong>
                <span>
                  {formatNullableTime(
                    device.lastActive,
                    t("settingsOption.none"),
                  )}
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </DialogShell>
  );
});

function StatusValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function resolvePhaseKey(phase: SyncPhase): UiKey {
  if (phase === "uploading") {
    return "settingsField.experimental-webdav-status-uploading";
  }
  if (phase === "downloading") {
    return "settingsField.experimental-webdav-status-downloading";
  }
  if (phase === "error") {
    return "settingsField.experimental-webdav-status-error";
  }

  return "settingsField.experimental-webdav-status-idle";
}

function resolveRunReasonKey(reason: SyncRunReason): UiKey {
  return `webDavStatus.runReason.${reason}`;
}

function resolveStageKey(stage: SyncInitialSyncStage): UiKey {
  return `webDavStatus.stage.${stage}`;
}

function resolveTaskKindKey(kind: SyncTaskKind): UiKey {
  return `webDavStatus.task.${kind}`;
}

function resolveTaskPhaseKey(phase: SyncTaskPhase): UiKey {
  return `webDavStatus.taskPhase.${phase}`;
}

function formatNullableTime(value: string | null, fallback: string): string {
  return value === null ? fallback : new Date(value).toLocaleString();
}
