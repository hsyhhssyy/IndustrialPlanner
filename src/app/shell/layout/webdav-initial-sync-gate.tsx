import type {
  SyncContract,
  SyncInitialSyncStage,
  SyncState,
} from "@/domain/sync";
import type { AppAction } from "@/domain/app/app-action";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export type WebDavInitialSyncFeature =
  | "blueprints"
  | "modules"
  | "toolbox";

const INITIAL_SYNC_STAGE_ORDER: Record<SyncInitialSyncStage, number> = {
  canvas: 0,
  blueprints: 1,
  modules: 2,
  toolbox: 3,
  ready: 4,
};

export function isWebDavInitialSyncFeatureLocked(
  state: SyncState,
  feature: WebDavInitialSyncFeature,
): boolean {
  return (
    state.settings.enabled
    && !state.status.hasCompletedInitialFeatureSync
    && INITIAL_SYNC_STAGE_ORDER[state.status.initialSyncStage]
      <= INITIAL_SYNC_STAGE_ORDER[feature]
  );
}

export const WebDavInitialSyncGate = observer(function WebDavInitialSyncGate({
  sync,
  translate,
}: {
  sync: SyncContract;
  translate: AppAction["translate"];
}) {
  const state = sync.state;
  if (
    !state.settings.enabled
    || state.status.initialSyncStage !== "canvas"
  ) {
    return null;
  }

  const failed = state.status.phase === "error";
  const canvasTask = state.status.tasks.find((task) => task.kind === "canvas");
  const canvasProgress = canvasTask === undefined
    || canvasTask.totalUnitCount <= 0
    ? 0
    : Math.round(
      Math.min(
        100,
        Math.max(
          0,
          canvasTask.completedUnitCount / canvasTask.totalUnitCount * 100,
        ),
      ),
    );

  return (
    <OverlayStackLayer layerId="webdav-initial-sync-gate" visible>
      {({ zIndex }) => (
        <section
          aria-label={translate(
            failed
              ? "webDavInitialSync.failed"
              : "webDavInitialSync.canvasSyncing",
          )}
          aria-live="assertive"
          aria-modal="true"
          className={cm(styles, "webdav-initial-sync-gate")}
          data-webdav-initial-sync-stage="canvas"
          role={failed ? "alertdialog" : "dialog"}
          style={{ zIndex }}
        >
          <div className={cm(styles, "webdav-initial-sync-gate-content")}>
            <WorkbenchIcon
              className={cm(
                styles,
                failed
                  ? "webdav-initial-sync-gate-error-icon"
                  : "webdav-initial-sync-gate-spinner",
              )}
              kind={failed ? "save-failed" : "save-progress"}
            />
            <p>
              {translate(
                failed
                  ? "webDavInitialSync.failed"
                  : "webDavInitialSync.canvasSyncing",
              )}
            </p>
            {!failed ? (
              <div
                className={cm(styles, "webdav-initial-sync-gate-progress")}
              >
                <progress
                  aria-label={translate("webDavInitialSync.canvasProgress")}
                  data-webdav-initial-sync-progress
                  max={100}
                  value={canvasProgress}
                />
                <output>{canvasProgress}%</output>
              </div>
            ) : null}
            {failed ? (
              <div className={cm(styles, "webdav-initial-sync-gate-actions")}>
                <button
                  onClick={() => {
                    void sync.actions.syncNow();
                  }}
                  type="button"
                >
                  {translate("webDavInitialSync.retry")}
                </button>
                <button
                  onClick={() => {
                    sync.actions.updateSettings({ enabled: false });
                  }}
                  type="button"
                >
                  {translate("webDavInitialSync.disable")}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      )}
    </OverlayStackLayer>
  );
});

export const WebDavInitialSyncFeatureGate = observer(
  function WebDavInitialSyncFeatureGate({
    children,
    className,
    feature,
    state,
    translate,
  }: {
    children?: ReactNode;
    className?: string;
    feature: WebDavInitialSyncFeature;
    state: SyncState | null;
    translate: AppAction["translate"];
  }) {
    if (
      state === null
      || !isWebDavInitialSyncFeatureLocked(state, feature)
    ) {
      return children;
    }

    return (
      <section
        aria-label={translate("webDavInitialSync.syncing")}
        aria-live="polite"
        className={cm(
          styles,
          `webdav-initial-sync-feature-gate${className === undefined ? "" : ` ${className}`}`,
        )}
        data-webdav-initial-sync-feature={feature}
        role="status"
      >
        <WorkbenchIcon
          className={cm(styles, "webdav-initial-sync-gate-spinner")}
          kind="save-progress"
        />
        <p>{translate("webDavInitialSync.syncing")}</p>
      </section>
    );
  },
);
