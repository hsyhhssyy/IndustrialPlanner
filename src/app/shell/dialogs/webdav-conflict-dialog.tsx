import { makeAutoObservable } from "mobx";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { cm } from "@/app/shell/shared/css-module-class";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type {
  SyncConflictDecision,
  SyncConflictResolution,
  SyncContract,
} from "@/domain/sync";
import styles from "./webdav-conflict-dialog.module.scss";

interface WebDavConflictDialogProps {
  readonly compactMobileLayout: boolean;
  readonly sync: SyncContract;
  readonly t: AppHost["actions"]["translate"];
}

export const WebDavConflictDialog = observer(function WebDavConflictDialog({
  compactMobileLayout,
  sync,
  t,
}: WebDavConflictDialogProps) {
  const dialogState = useMemo(() => makeAutoObservable<DialogStateReadWrite>({
    visible: true,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: 720,
    height: 560,
    activeTab: null,
  }), []);
  const [decisions, setDecisions] = useState(
    () => new Map<string, SyncConflictResolution>(),
  );
  const conflict = sync.state.pendingConflict;
  const itemKey = conflict?.items.map(
    (item) => createConflictItemKey(item.adapterId, item.assetId),
  ).join("\u0001") ?? "";

  useEffect(() => {
    setDecisions(new Map());
  }, [itemKey]);

  if (!sync.state.settings.enabled || conflict === null) {
    return null;
  }

  const allDecisionsSelected = conflict.items.length > 0
    && conflict.items.every((item) =>
      decisions.has(createConflictItemKey(item.adapterId, item.assetId))
    );
  const submitDecisions = (): void => {
    if (!allDecisionsSelected) {
      return;
    }

    sync.actions.resolveConflicts(conflict.items.map((item) => ({
      adapterId: item.adapterId,
      assetId: item.assetId,
      resolution: decisions.get(
        createConflictItemKey(item.adapterId, item.assetId),
      )!,
    } satisfies SyncConflictDecision)));
  };

  return (
    <DialogShell
      bodyClassName={cm(styles, "webdav-conflict-dialog-body")}
      className={cm(styles, "webdav-conflict-dialog")}
      closeTitle={t("action.close")}
      compactMobileLayout={compactMobileLayout}
      dialogKey="webdav-conflict"
      dialogState={dialogState}
      dismissible={false}
      maximizeTitle=""
      onClose={() => {}}
      onToggleMaximized={() => {}}
      overlayKind="system"
      restoreTitle=""
      showMaximizeButton={false}
      title={t("settingsField.experimental-webdav-conflict-title")}
      titleId="webdav-conflict-dialog-title"
    >
      {conflict.phase === "awaiting-resolution" ? (
        <form
          className={cm(styles, "webdav-conflict-content")}
          onSubmit={(event) => {
            event.preventDefault();
            submitDecisions();
          }}
        >
          <p className={cm(styles, "webdav-conflict-summary")}>
            {t("webDavConflict.summary").replace(
              "{count}",
              String(conflict.items.length),
            )}
          </p>
          <div className={cm(styles, "webdav-conflict-list")}>
            {conflict.items.map((item) => {
              const key = createConflictItemKey(
                item.adapterId,
                item.assetId,
              );
              const selectedResolution = decisions.get(key);

              return (
                <fieldset
                  className={cm(styles, "webdav-conflict-item")}
                  key={key}
                >
                  <legend>
                    <strong>{item.adapterId}</strong>
                    <span>{item.assetId}</span>
                  </legend>
                  <p>
                    {t("webDavConflict.remoteUpdatedAt").replace(
                      "{time}",
                      formatRemoteUpdatedAt(
                        item.remoteUpdatedAt,
                        t("webDavConflict.unknownTime"),
                      ),
                    )}
                  </p>
                  <div className={cm(styles, "webdav-conflict-options")}>
                    {CONFLICT_RESOLUTIONS.map((resolution) => (
                      <label key={resolution}>
                        <input
                          checked={selectedResolution === resolution}
                          name={`webdav-conflict-${key}`}
                          onChange={() => {
                            setDecisions((current) => {
                              const next = new Map(current);
                              next.set(key, resolution);
                              return next;
                            });
                          }}
                          type="radio"
                          value={resolution}
                        />
                        <span>{t(resolveResolutionLabel(resolution))}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className={cm(styles, "webdav-conflict-actions")}>
            <button
              disabled={!allDecisionsSelected}
              type="submit"
            >
              {t("webDavConflict.apply")}
            </button>
          </div>
        </form>
      ) : (
        <div
          aria-live="polite"
          className={cm(styles, "webdav-conflict-progress")}
          role="status"
        >
          <WorkbenchIcon
            className={cm(styles, "webdav-conflict-spinner")}
            kind="save-progress"
          />
          <p>
            {t(conflict.phase === "discovering"
              ? "webDavConflict.discovering"
              : "webDavConflict.applying")}
          </p>
        </div>
      )}
    </DialogShell>
  );
});

const CONFLICT_RESOLUTIONS: readonly SyncConflictResolution[] = [
  "use-local",
  "use-remote",
  "pause",
];

function createConflictItemKey(adapterId: string, assetId: string): string {
  return `${adapterId}\u0000${assetId}`;
}

function resolveResolutionLabel(
  resolution: SyncConflictResolution,
):
  | "settingsField.experimental-webdav-conflict-use-local"
  | "settingsField.experimental-webdav-conflict-use-remote"
  | "settingsField.experimental-webdav-conflict-pause" {
  if (resolution === "use-local") {
    return "settingsField.experimental-webdav-conflict-use-local";
  }
  if (resolution === "use-remote") {
    return "settingsField.experimental-webdav-conflict-use-remote";
  }

  return "settingsField.experimental-webdav-conflict-pause";
}

function formatRemoteUpdatedAt(
  value: string | null,
  fallback: string,
): string {
  if (value === null) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}
