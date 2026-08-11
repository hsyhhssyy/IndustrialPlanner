import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type {
  SyncInitialSyncStage,
  SyncPhase,
  SyncRunReason,
  SyncState,
  SyncTaskDirection,
  SyncTaskKind,
  SyncTaskPhase,
} from "@/domain/sync";
import type { UiKey } from "@/shared/i18n";
import {
  MAX_CLOUDFLARE_SPACE_NAME_LENGTH,
  readCloudflareSyncSettings,
  writeCloudflareSyncSettings,
} from "@/shared/storage/cloudflare-sync-settings";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./settings-dialog.module.scss";

// CloudflareSyncStatusDialog — Cloudflare 同步专属状态弹窗。
//
// 与 WebDavSyncStatusDialog 的关键差异：
// - 无配置表单（URL 等复用 debug-backend-api-address-override）
// - 无并发数显示
// - 过滤掉 directory-maintenance 任务（Cloudflare 无目录概念）
// - 服务器端错误置顶醒目展示（role="alert"）
// - 显示小检查倒计时
// - 显示 interval-check 任务卡片
// AI-CORRECTION 2026-08-08: Cloudflare 弹窗现包含独立的空间名称配置表单；
// 输入先保留为本地草稿，只有按下保存按钮后才写入设置并切换同步空间。

const DEFAULT_SMALL_CHECK_INTERVAL_MS = 60_000;

const CLOUDFLARE_EXCLUDED_TASK_KINDS: ReadonlySet<SyncTaskKind> = new Set([
  "directory-maintenance",
]);

// 小检查任务放在任务列表的最前面
const TASK_ORDER: Record<SyncTaskKind, number> = {
  "interval-check": 0,
  "canvas": 1,
  "blueprints": 2,
  "modules": 3,
  "toolbox": 4,
  "background-documents": 5,
  "directory-maintenance": 99,
};

function sortTasks<TTask extends { readonly kind: SyncTaskKind }>(tasks: readonly TTask[]): TTask[] {
  return [...tasks].sort((a, b) => (TASK_ORDER[a.kind] ?? 50) - (TASK_ORDER[b.kind] ?? 50));
}

export const CloudflareSyncStatusDialog = observer(function CloudflareSyncStatusDialog({
  aborting,
  compactMobileLayout,
  deleting,
  dialogState,
  onAbortCurrentTransaction,
  onClose,
  onDeleteAllData,
  onOffsetChange,
  onResize,
  onToggleMaximized,
  state,
  t,
}: {
  aborting: boolean;
  compactMobileLayout: boolean;
  deleting: boolean;
  dialogState: DialogStateReadWrite;
  onAbortCurrentTransaction: () => void;
  onClose: () => void;
  onDeleteAllData: () => void;
  onOffsetChange: (offsetX: number, offsetY: number) => void;
  onResize: (width: number, height: number) => void;
  onToggleMaximized: () => void;
  state: SyncState;
  t: AppHost["actions"]["translate"];
}) {
  const status = state.status;
  const [savedSpaceName, setSavedSpaceName] = useState("");
  const [draftSpaceName, setDraftSpaceName] = useState("");
  const [loadingSpaceName, setLoadingSpaceName] = useState(true);
  const [savingSpaceName, setSavingSpaceName] = useState(false);
  const [spaceNameSaveFailed, setSpaceNameSaveFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void readCloudflareSyncSettings().then((settings) => {
      if (!active) {
        return;
      }
      setSavedSpaceName(settings.spaceName);
      setDraftSpaceName(settings.spaceName);
      setLoadingSpaceName(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const normalizedDraftSpaceName = draftSpaceName.trim();
  const spaceNameIsDirty = normalizedDraftSpaceName !== savedSpaceName;
  const canSaveSpaceName = !loadingSpaceName
    && !savingSpaceName
    && normalizedDraftSpaceName !== ""
    && spaceNameIsDirty;
  const handleSaveSpaceName = async () => {
    if (!canSaveSpaceName) {
      return;
    }

    setSavingSpaceName(true);
    setSpaceNameSaveFailed(false);
    try {
      const settings = await writeCloudflareSyncSettings({
        spaceName: normalizedDraftSpaceName,
      });
      setSavedSpaceName(settings.spaceName);
      setDraftSpaceName(settings.spaceName);
    } catch {
      setSpaceNameSaveFailed(true);
    } finally {
      setSavingSpaceName(false);
    }
  };

  const filteredTasks = useMemo(
    () => sortTasks(status.tasks.filter((task) => !CLOUDFLARE_EXCLUDED_TASK_KINDS.has(task.kind))),
    [status.tasks],
  );

  // 倒计时 — 每秒更新
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const smallCountdown = useMemo(() => {
    if (status.lastSmallCheckAt === null) return null;
    const last = new Date(status.lastSmallCheckAt).getTime();
    const next = last + DEFAULT_SMALL_CHECK_INTERVAL_MS;
    const remaining = Math.max(0, next - now);
    if (remaining <= 0) return "...";
    return formatDuration(remaining);
  }, [status.lastSmallCheckAt, now]);

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
        <section
          className={cm(styles, "webdav-sync-status-section", "webdav-config-section")}
        >
          <h3>{t("cloudflareStatus.spaceSettings")}</h3>
          <div className={cm(styles, "webdav-config-form")}>
            <label className={cm(styles, "webdav-config-field")}>
              <span>{t("cloudflareStatus.spaceName")}</span>
              <input
                data-cloudflare-space-name-input
                disabled={loadingSpaceName || savingSpaceName}
                maxLength={MAX_CLOUDFLARE_SPACE_NAME_LENGTH}
                onChange={(event) => {
                  setDraftSpaceName(event.target.value);
                  setSpaceNameSaveFailed(false);
                }}
                type="text"
                value={draftSpaceName}
              />
              <small>{t("cloudflareStatus.spaceNameDescription")}</small>
            </label>
          </div>
          <div className={cm(styles, "webdav-config-actions")}>
            {spaceNameSaveFailed ? (
              <span
                className={cm(styles, "webdav-config-test-result", "is-failed")}
                role="alert"
              >
                {t("cloudflareStatus.spaceNameSaveFailed")}
              </span>
            ) : null}
            <div className={cm(styles, "webdav-config-buttons")}>
              <button
                className={cm(
                  styles,
                  "webdav-apply-settings-btn",
                  spaceNameIsDirty ? "is-dirty" : "is-clean",
                )}
                data-cloudflare-space-name-save
                disabled={!canSaveSpaceName}
                onClick={() => void handleSaveSpaceName()}
                type="button"
              >
                {t(savingSpaceName
                  ? "cloudflareStatus.savingSpaceName"
                  : "cloudflareStatus.saveSpaceName")}
              </button>
            </div>
          </div>
        </section>

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

        {/* 概览 — 使用 Cloudflare 专用 label */}
        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.overview")}</h3>
          <dl className={cm(styles, "webdav-sync-status-summary-grid")}>
            <StatusValue
              label={t("cloudflareStatus.syncEnabled")}
              value={t(state.settings.enabled
                ? "webDavStatus.enabled"
                : "webDavStatus.disabled")}
            />
            <StatusValue
              label={t("cloudflareStatus.phase")}
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
            {/* 小检查倒计时 */}
            {smallCountdown === null ? null : (
              <StatusValue
                label={t("cloudflareStatus.smallCountdown")}
                value={smallCountdown}
              />
            )}
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

        {/* 任务 — 含 interval-check，按顺序排列 */}
        <section className={cm(styles, "webdav-sync-status-section")}>
          <h3>{t("webDavStatus.tasks")}</h3>
          <div className={cm(styles, "webdav-sync-task-list")}>
            {filteredTasks.map((task) => (
              <article
                className={cm(
                  styles,
                  `webdav-sync-task-card is-${task.phase}`,
                )}
                data-sync-task-direction={task.direction ?? "none"}
                data-sync-task-kind={task.kind}
                data-sync-task-phase={task.phase}
                key={task.kind}
              >
                <header>
                  <strong>{t(resolveTaskKindKey(task.kind))}</strong>
                  <span>
                    {task.direction === null
                      ? t(resolveTaskPhaseKey(task.phase))
                      : `${t(resolveTaskPhaseKey(task.phase))} (${t(resolveTaskDirectionKey(task.direction))})`}
                  </span>
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

        {/* 立即结束当前事务 */}
        <section className={cm(styles, "webdav-sync-status-section", "webdav-delete-section")}>
          {aborting ? (
            <div className={cm(styles, "webdav-delete-progress")}>
              {t("cloudflareStatus.abortingTransaction")}
            </div>
          ) : (
            <button
              className={cm(styles, "webdav-delete-all-btn")}
              onClick={onAbortCurrentTransaction}
              type="button"
            >
              {t("cloudflareStatus.abortCurrentTransaction")}
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

function resolveTaskDirectionKey(direction: SyncTaskDirection): UiKey {
  return direction === "upload"
    ? "settingsField.experimental-webdav-status-uploading"
    : "settingsField.experimental-webdav-status-downloading";
}

function formatNullableTime(value: string | null, fallback: string): string {
  return value === null ? fallback : new Date(value).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}
