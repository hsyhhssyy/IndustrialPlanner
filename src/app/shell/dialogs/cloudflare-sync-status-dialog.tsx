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
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./settings-dialog.module.scss";

// CloudflareSyncStatusDialog — Cloudflare 同步专属状态弹窗。
//
// 与 WebDavSyncStatusDialog 的关键差异：
// - 无配置表单（URL 等复用 debug-backend-api-address-override）
// - 无并发数显示
// - 过滤掉 directory-maintenance 任务（Cloudflare 无目录概念，prepareCollections 是 no-op）
// - 服务器端错误置顶醒目展示（role="alert"）
// - 删除远端数据按钮保留，并有二次确认流程

// Cloudflare 不需要展示的任务类型
const CLOUDFLARE_EXCLUDED_TASK_KINDS: ReadonlySet<SyncTaskKind> = new Set([
  "directory-maintenance",
]);

export const CloudflareSyncStatusDialog = observer(function CloudflareSyncStatusDialog({
  compactMobileLayout,
  deleting,
  dialogState,
  onClose,
  onDeleteAllData,
  onOffsetChange,
  onResize,
  onToggleMaximized,
  state,
  t,
}: {
  compactMobileLayout: boolean;
  deleting: boolean;
  dialogState: DialogStateReadWrite;
  onClose: () => void;
  onDeleteAllData: () => void;
  onOffsetChange: (offsetX: number, offsetY: number) => void;
  onResize: (width: number, height: number) => void;
  onToggleMaximized: () => void;
  state: SyncState;
  t: AppHost["actions"]["translate"];
}) {
  const status = state.status;

  const filteredTasks = status.tasks.filter(
    (task) => !CLOUDFLARE_EXCLUDED_TASK_KINDS.has(task.kind),
  );

  return (
    <DialogShell
      bodyClassName={cm(styles, "webdav-sync-status-dialog-body")}
      className="cloudflare-sync-status-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={compactMobileLayout}
      dialogKey="cloudflare-sync-status"
      dialogState={dialogState}
      maximizeTitle={t("dialog.maximize")}
      onClose={onClose}
      onOffsetChange={onOffsetChange}
      onResize={onResize}
      onToggleMaximized={onToggleMaximized}
      restoreTitle={t("dialog.restore")}
      title={t("cloudflareStatus.title")}
      titleId="cloudflare-sync-status-dialog-title"
    >
      <div
        aria-live="polite"
        className={cm(styles, "webdav-sync-status-content")}
        data-cloudflare-sync-status-dialog
      >
        {/* 服务器端错误 — 置顶醒目展示 */}
        {status.lastError === null ? null : (
          <section
            className={cm(styles, "webdav-sync-status-section", "cloudflare-server-error")}
            role="alert"
          >
            <h3>{t("webDavStatus.lastError")}</h3>
            <div className={cm(styles, "webdav-sync-status-error")}>
              <span>{status.lastError}</span>
            </div>
          </section>
        )}

        {/* 概览 */}
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
        </section>

        {/* 网络 — 不含并发数 */}
        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.network")}</h3>
          <dl className={cm(styles, "webdav-sync-status-network-grid")}>
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

        {/* 任务 — 过滤掉 directory-maintenance */}
        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.tasks")}</h3>
          <div className={cm(styles, "webdav-sync-task-list")}>
            {filteredTasks.map((task) => (
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

        {/* 删除远端数据 */}
        <section className={cm(styles, "webdav-sync-status-section", "webdav-delete-section")}>
          {deleting ? (
            <div className={cm(styles, "webdav-delete-progress")}>
              {t("webDavConfig.deleteAllDataDeleting")}
            </div>
          ) : (
            <button
              className={cm(styles, "webdav-delete-all-btn")}
              onClick={onDeleteAllData}
              type="button"
            >
              {t("cloudflareStatus.deleteAllData")}
            </button>
          )}
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
