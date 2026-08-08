import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, useState } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import {
  clearLogEntries,
  getLogCollectorStatus,
  queryLogEntries,
  subscribeLogCollectorStatus,
} from "@/shared/logging/log-collector-client";
import type { PersistedLogEntry } from "@/shared/logging/log-collector-protocol";
import { buildDiagnosticHeader } from "@/shared/logging/diagnostic-header";
import { getDebugLogSessionStartedAt } from "@/shared/logging/debug-logging-runtime";
import { getLogLevel } from "@/shared/logging/logger";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

const EXPORT_FILENAME_PREFIX = "industrial-planner-diagnostic";

export const DebugLogDialog = observer(function DebugLogDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState["debug-log"];
  const collectorStatus = useSyncExternalStore(
    subscribeLogCollectorStatus,
    getLogCollectorStatus,
    getLogCollectorStatus,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [entries, setEntries] = useState<readonly PersistedLogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const snapshotText = useMemo(() => formatLogEntries(entries), [entries]);

  useEffect(() => {
    if (dialogState?.visible !== true || clearing || collectorStatus !== "ready") {
      return;
    }

    let disposed = false;
    let queryInFlight = false;
    const refresh = async (): Promise<void> => {
      if (disposed || queryInFlight) {
        return;
      }
      queryInFlight = true;
      try {
        const result = await queryLogEntries({ limit: 500 });
        if (!disposed) {
          setEntries(result.entries);
        }
      } catch {
        // Client 会发布 collector error 状态，UI 由状态统一呈现。
      } finally {
        queryInFlight = false;
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [clearing, collectorStatus, dialogState?.visible, pollGeneration]);

  const handleCopy = useCallback(async () => {
    const text = snapshotText;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = textareaRef.current;
      if (textarea !== null) {
        textarea.select();
      }
    }
  }, [snapshotText]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const header = buildDiagnosticHeader({
        entryCount: entries.length,
        logLevel: getLogLevel(),
        sessionStartedAt: getDebugLogSessionStartedAt(),
      });
      const content = header + snapshotText;
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      a.download = `${EXPORT_FILENAME_PREFIX}-${ts}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // 降级到复制
      await handleCopy();
    } finally {
      setExporting(false);
    }
  }, [entries.length, snapshotText, handleCopy]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await clearLogEntries();
      setEntries([]);
    } catch {
      // collectorStatus 会切换为 error。
    } finally {
      setClearing(false);
      setPollGeneration((value) => value + 1);
    }
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea === null) {
      return;
    }

    textarea.scrollTop = textarea.scrollHeight;
  }, [snapshotText]);

  if (dialogState === undefined) {
    return null;
  }

  const hasLogs = snapshotText.length > 0;
  const exportLabel = exporting ? t("debugLogDialog.exporting") : t("debugLogDialog.export");
  const copyLabel = copied ? t("debugLogDialog.copied") : t("debugLogDialog.copy");

  const headerActions = (
    <>
      <button
        className={cm(styles, "debug-log-dialog-header-action")}
        disabled={exporting}
        onClick={() => void handleExport()}
        type="button"
      >
        {exportLabel}
      </button>
      <button
        className={cm(styles, "debug-log-dialog-header-action")}
        disabled={!hasLogs}
        onClick={() => void handleCopy()}
        type="button"
      >
        {copyLabel}
      </button>
      <button
        className={cm(styles, "debug-log-dialog-header-action")}
        disabled={!hasLogs}
        onClick={() => void handleClear()}
        type="button"
      >
        {t("debugLogDialog.clear")}
      </button>
    </>
  );

  return (
    <DialogShell
      bodyClassName="debug-log-dialog-body"
      className="debug-log-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={appHost.state.screenProfile.deviceClass === "mobile"}
      dialogKey="debug-log"
      dialogState={dialogState}
      headerActions={headerActions}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("debugLogDialog.maximize")}
      onClose={() => {
        appHost.internalActions.closeDialog("debug-log");
      }}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("debug-log", offsetX, offsetY);
      }}
      onResize={(width, height) => {
        appHost.internalActions.setDialogSize("debug-log", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("debug-log");
      }}
      restoreTitle={t("debugLogDialog.restore")}
      title={t("debugLogDialog.title")}
      titleId="debug-log-dialog-title"
    >
      <div className={cm(styles, "debug-log-dialog-guidance")}>
        <p>{t("debugLogDialog.guidance")}</p>
        {hasLogs ? (
          <span className={cm(styles, "debug-log-dialog-count")}>
            {entries.length} 条日志
          </span>
        ) : null}
      </div>
      <textarea
        aria-label={t("debugLogDialog.title")}
        className={cm(styles, "json-debug-textarea debug-log-dialog-textarea")}
        placeholder={collectorStatus === "ready"
          ? t("debugLogDialog.empty")
          : t("debugLogDialog.unavailable")}
        readOnly
        ref={textareaRef}
        spellCheck={false}
        value={snapshotText}
      />
    </DialogShell>
  );
});

function formatLogEntries(entries: readonly PersistedLogEntry[]): string {
  return entries
    .slice()
    .reverse()
    .map((entry) => `${new Date(entry.occurredAt).toISOString()} [${entry.level.toUpperCase()}] [${entry.source}:${entry.instanceId}] ${entry.message}`)
    .join("\n");
}
