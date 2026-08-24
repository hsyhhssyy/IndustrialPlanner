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

export type SyncInitialSyncFeature =
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

export function isSyncInitialSyncFeatureLocked(
  state: SyncState,
  feature: SyncInitialSyncFeature,
): boolean {
  return (
    state.settings.enabled
    && !state.status.hasCompletedInitialFeatureSync
    && INITIAL_SYNC_STAGE_ORDER[state.status.initialSyncStage]
      <= INITIAL_SYNC_STAGE_ORDER[feature]
  );
}

export const SyncInitialSyncGate = observer(function SyncInitialSyncGate({
  sync,
  translate,
}: {
  sync: SyncContract;
  translate: AppAction["translate"];
}) {
  const state = sync.state;
  // AI-CORRECTION 2026-08-13: 小检查（interval）发现远端变化触发的下载期间也应锁定画布，
  // 下载完成（phase 回到 idle）后自动解锁；小检查短路（远端无变化）时不进入 downloading，不锁定。
  // AI-CORRECTION 2026-08-24: 上述“小检查”现统一称为“更新检查”；interval 仍表示定时触发原因。
  // 冲突待决策时由冲突对话框接管交互，不再叠加画布遮罩。
  const locksCanvasForIntervalDownload =
    state.status.phase === "downloading"
    && state.status.currentRunReason === "interval"
    && state.pendingConflict === null;
  // AI-CORRECTION 2026-08-13: 下载不容忍中止后引擎置 canvasLocked，
  // 阻断继续编辑直到本轮同步（含冲突决议应用）结束。
  const locksCanvasForDirtyAbort =
    state.status.canvasLocked
    && state.pendingConflict === null;
  if (
    !state.settings.enabled
    || (
      state.status.initialSyncStage !== "canvas"
      && !locksCanvasForIntervalDownload
      && !locksCanvasForDirtyAbort
    )
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
    <OverlayStackLayer layerId="sync-initial-sync-gate" visible>
      {({ zIndex }) => (
        <section
          aria-label={translate(
            failed
              ? "syncInitialSync.failed"
              : "syncInitialSync.canvasSyncing",
          )}
          aria-live="assertive"
          aria-modal="true"
          className={cm(styles, "sync-initial-sync-gate")}
          data-sync-initial-sync-stage="canvas"
          role={failed ? "alertdialog" : "dialog"}
          style={{ zIndex }}
        >
          <div className={cm(styles, "sync-initial-sync-gate-content")}>
            <WorkbenchIcon
              className={cm(
                styles,
                failed
                  ? "sync-initial-sync-gate-error-icon"
                  : "sync-initial-sync-gate-spinner",
              )}
              kind={failed ? "save-failed" : "save-progress"}
            />
            <p>
              {translate(
                failed
                  ? "syncInitialSync.failed"
                  : "syncInitialSync.canvasSyncing",
              )}
            </p>
            {!failed ? (
              <div
                className={cm(styles, "sync-initial-sync-gate-progress")}
              >
                <progress
                  aria-label={translate("syncInitialSync.canvasProgress")}
                  data-sync-initial-sync-progress
                  max={100}
                  value={canvasProgress}
                />
                <output>{canvasProgress}%</output>
              </div>
            ) : null}
            {failed ? (
              <div className={cm(styles, "sync-initial-sync-gate-actions")}>
                <button
                  onClick={() => {
                    void sync.actions.syncNow();
                  }}
                  type="button"
                >
                  {translate("syncInitialSync.retry")}
                </button>
                <button
                  onClick={() => {
                    sync.actions.updateSettings({ enabled: false });
                  }}
                  type="button"
                >
                  {translate("syncInitialSync.disable")}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      )}
    </OverlayStackLayer>
  );
});

export const SyncInitialSyncFeatureGate = observer(
  function SyncInitialSyncFeatureGate({
    children,
    className,
    feature,
    state,
    translate,
  }: {
    children?: ReactNode;
    className?: string;
    feature: SyncInitialSyncFeature;
    state: SyncState | null;
    translate: AppAction["translate"];
  }) {
    if (
      state === null
      || !isSyncInitialSyncFeatureLocked(state, feature)
    ) {
      return children;
    }

    return (
      <section
        aria-label={translate("syncInitialSync.syncing")}
        aria-live="polite"
        className={cm(
          styles,
          `sync-initial-sync-feature-gate${className === undefined ? "" : ` ${className}`}`,
        )}
        data-sync-initial-sync-feature={feature}
        role="status"
      >
        <WorkbenchIcon
          className={cm(styles, "sync-initial-sync-gate-spinner")}
          kind="save-progress"
        />
        <p>{translate("syncInitialSync.syncing")}</p>
      </section>
    );
  },
);
