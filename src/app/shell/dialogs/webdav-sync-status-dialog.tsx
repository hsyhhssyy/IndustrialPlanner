import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { WebDavSyncSettings } from "@/sync";
import { MAX_WEBDAV_MAX_CONCURRENT_REQUESTS, MIN_WEBDAV_MAX_CONCURRENT_REQUESTS } from "@/sync";
import type { UiKey } from "@/shared/i18n";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./settings-dialog.module.scss";
// AI-REMOVED 2026-07-29:
// Reason: 状态窗口的全部 CSS class 定义在 settings-dialog.module.scss，旧 import 返回的 class 均为 undefined。
// Trigger: 本次移除设备板块并复核状态窗口样式归属。
// Evidence: app-shell.module.scss 不包含任何 webdav-sync-status-* 选择器。
// Replacement: ./settings-dialog.module.scss。
// Risk: Low。
// Human Review: Required
//
// Original code:
// import styles from "@/app/shell/app-shell.module.scss";

// AI-CORRECTION 2026-08-01: 新增 useEffect/useState/useMemo 用于草稿状态和测试连接状态。
// 原组件只有 useCallback，即时保存每个字段。现在改为草稿模式，点击"应用设置"才提交。

export const WebDavSyncStatusDialog = observer(function WebDavSyncStatusDialog({
  compactMobileLayout,
  deleting,
  dialogState,
  onClose,
  onDeleteAllData,
  onOffsetChange,
  onResize,
  onTestConnection,
  onToggleMaximized,
  onUpdateSettings,
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
  onTestConnection: (draft: Pick<WebDavSyncSettings, "url" | "username" | "password">) => Promise<boolean>;
  onToggleMaximized: () => void;
  onUpdateSettings: (patch: Partial<WebDavSyncSettings>) => void;
  state: SyncState;
  t: AppHost["actions"]["translate"];
}) {
  const status = state.status;
  const settings = state.settings;

  // 草稿状态：对话框可见时从当前设置初始化
  const [draftUrl, setDraftUrl] = useState(settings.url);
  const [draftUsername, setDraftUsername] = useState(settings.username);
  const [draftPassword, setDraftPassword] = useState(settings.password);
  const [draftConcurrent, setDraftConcurrent] = useState(settings.maxConcurrentRequests);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "failed" | null>(null);

  // 对话框打开时重置草稿为当前设置
  useEffect(() => {
    if (dialogState.visible) {
      setDraftUrl(settings.url);
      setDraftUsername(settings.username);
      setDraftPassword(settings.password);
      setDraftConcurrent(settings.maxConcurrentRequests);
      setTesting(false);
      setTestResult(null);
    }
  }, [dialogState.visible, settings.url, settings.username, settings.password, settings.maxConcurrentRequests]);

  // 判断草稿是否有修改
  const isDirty = useMemo(
    () =>
      draftUrl !== settings.url
      || draftUsername !== settings.username
      || draftPassword !== settings.password
      || draftConcurrent !== settings.maxConcurrentRequests,
    [draftUrl, draftUsername, draftPassword, draftConcurrent, settings],
  );

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraftUrl(e.target.value);
      setTestResult(null);
    },
    [],
  );

  const handleUsernameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraftUsername(e.target.value);
      setTestResult(null);
    },
    [],
  );

  const handlePasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraftPassword(e.target.value);
      setTestResult(null);
    },
    [],
  );

  const handleConcurrentChange = useCallback(
    (concurrent: number) => {
      setDraftConcurrent(concurrent);
    },
    [],
  );

  const handleApplySettings = useCallback(() => {
    onUpdateSettings({
      url: draftUrl,
      username: draftUsername,
      password: draftPassword,
      maxConcurrentRequests: draftConcurrent,
    });
    setTestResult(null);
  }, [onUpdateSettings, draftUrl, draftUsername, draftPassword, draftConcurrent]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await onTestConnection({
        url: draftUrl,
        username: draftUsername,
        password: draftPassword,
      });
      setTestResult(ok ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  }, [onTestConnection, draftUrl, draftUsername, draftPassword]);

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
      onOffsetChange={onOffsetChange}
      onResize={onResize}
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
        <section
          className={cm(styles, "webdav-sync-status-section", "webdav-config-section")}
        >
          <h3>{t("webDavConfig.title")}</h3>
          <div className={cm(styles, "webdav-config-form")}>
            <label className={cm(styles, "webdav-config-field")}>
              <span>{t("webDavConfig.url")}</span>
              <input
                onChange={handleUrlChange}
                placeholder="https://dav.example.com/remote.php/dav/"
                type="text"
                value={draftUrl}
              />
            </label>

            <label className={cm(styles, "webdav-config-field")}>
              <span>{t("webDavConfig.username")}</span>
              <input
                onChange={handleUsernameChange}
                type="text"
                value={draftUsername}
              />
            </label>

            <label className={cm(styles, "webdav-config-field")}>
              <span>{t("webDavConfig.password")}</span>
              <input
                onChange={handlePasswordChange}
                type="password"
                value={draftPassword}
              />
            </label>

            <label className={cm(styles, "webdav-config-field")}>
              <span>
                {t("webDavConfig.maxConcurrent")}
                {": "}
                {draftConcurrent}
              </span>
              <input
                max={MAX_WEBDAV_MAX_CONCURRENT_REQUESTS}
                min={MIN_WEBDAV_MAX_CONCURRENT_REQUESTS}
                onChange={(e) => handleConcurrentChange(Number(e.target.value))}
                step={1}
                type="range"
                value={draftConcurrent}
              />
              <small>{t("webDavConfig.maxConcurrentDescription")}</small>
            </label>
          </div>

          {/*
            AI-CORRECTION 2026-08-01: 新增测试连接和应用设置按钮。
            测试连接始终可点，应用设置在草稿无改动时灰色禁用。
          */}
          <div className={cm(styles, "webdav-config-actions")}>
            {testResult !== null && (
              <span
                className={cm(
                  styles,
                  "webdav-config-test-result",
                  testResult === "success" ? "is-success" : "is-failed",
                )}
              >
                {t(testResult === "success" ? "webDavConfig.testSuccess" : "webDavConfig.testFailed")}
              </span>
            )}
            <div className={cm(styles, "webdav-config-buttons")}>
              <button
                className={cm(styles, "webdav-test-connection-btn")}
                disabled={testing}
                onClick={handleTestConnection}
                type="button"
              >
                {testing ? t("webDavConfig.testing") : t("webDavConfig.testConnection")}
              </button>
              <button
                className={cm(styles, "webdav-apply-settings-btn", isDirty ? "is-dirty" : "is-clean")}
                disabled={!isDirty}
                onClick={handleApplySettings}
                type="button"
              >
                {t("webDavConfig.applySettings")}
              </button>
            </div>
          </div>
        </section>

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
              {t("webDavConfig.deleteAllData")}
            </button>
          )}
        </section>

        {/*
          AI-REMOVED 2026-07-29:
          Reason: 状态窗口不再枚举没有同步决策价值的远端设备。
          Trigger: 用户确认设备列表没有意义，冲突只需要远端上传时间。
          Evidence: 逐个读取 39 个设备文件约耗时 17.9 秒，且不能归因具体 revision。
          Replacement: WebDAV 冲突窗口的 remoteUpdatedAt。
          Risk: Low。
          Human Review: Required

          Original code:
          <section className={cm(styles, "webdav-sync-status-section")}>
            <h3>{t("settingsField.experimental-webdav-devices")}</h3>
            <div className={cm(styles, "webdav-sync-device-list")}>
              {state.remoteDevices.length === 0 ? (
                <span>{t("settingsOption.none")}</span>
              ) : state.remoteDevices.map((device) => (
                <article key={device.deviceId}>
                  <strong>{device.label}</strong>
                  <span>{formatNullableTime(device.lastActive, t("settingsOption.none"))}</span>
                </article>
              ))}
            </div>
          </section>
        */}
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
