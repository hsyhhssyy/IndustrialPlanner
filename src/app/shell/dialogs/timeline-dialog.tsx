import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type { SimulationTimelineMark } from "@/domain/simulation/types/simulation-types";
import {
  COLLAPSED_TIMELINE_BOTTOM_DOCK_HEIGHT,
  DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT,
} from "@/app/state/state-impl";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import {
  createTimelineFrameApplyPerformanceWindow,
  getTimelineFrameApplyPerformancePeriodMs,
  recordTimelineFrameApplyPerformance,
  takeTimelineFrameApplyPerformanceReport,
} from "@/app/shell/dialogs/timeline-performance-statistics";

let skipTimelineEditRollbackWarning = false;
const TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT = 10;
const TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT = 90;
const TIMELINE_DRAG_EDGE_SCROLL_MIN_TICKS_PER_SECOND = 120;
const TIMELINE_DRAG_EDGE_SCROLL_MAX_TICKS_PER_SECOND = 600;

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export function canUseTimelineBottomDock(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "desktop" || screenProfile.deviceClass === "tablet";
}

export function shouldRenderTimelineBottomDock(appHost: AppHost): boolean {
  return (
    appHost.internalState.workbench.dialogState.timeline.visible
    && (
      appHost.state.screenProfile.deviceClass === "mobile"
      || (
        appHost.internalState.workbench.timelineDockPreference === "bottom"
        && canUseTimelineBottomDock(appHost.state.screenProfile)
      )
    )
  );
}

export function resolveTimelineBottomDockGridHeight(appHost: AppHost): number {
  if (!shouldRenderTimelineBottomDock(appHost)) {
    return 0;
  }

  return appHost.internalState.workbench.timelineBottomDockCollapsed
    ? COLLAPSED_TIMELINE_BOTTOM_DOCK_HEIGHT
    : DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT;
}

export const TimelineDialog = observer(function TimelineDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.timeline;
  const simulation = appHost.workspace.simulation;
  const timelineEnabled = simulation?.state.timeline.enabled ?? false;
  const simulationRunningState = simulation?.state.runningState ?? "stop";

  useEffect(() => {
    if (!dialogState.visible || simulation === null) {
      return;
    }

    return () => {
      simulation.actions.disableTimeline();
    };
  }, [dialogState.visible, simulation]);

  useEffect(() => {
    if (
      !dialogState.visible
      || simulation === null
      || timelineEnabled
      || simulationRunningState === "stop"
    ) {
      return;
    }

    void simulation.actions.enableTimeline();
  }, [dialogState.visible, simulation, simulationRunningState, timelineEnabled]);

  if (shouldRenderTimelineBottomDock(appHost)) {
    return null;
  }

  const canDockToBottom = canUseTimelineBottomDock(appHost.state.screenProfile);
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const dockToBottomTitle = t("timelineDialog.dockToBottom");

  return (
    <DialogShell
      bodyClassName="timeline-dialog-body"
      className="timeline-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="timeline"
      dialogState={dialogState}
      headerActions={canDockToBottom ? (
        <button
          aria-label={dockToBottomTitle}
          className={cm(styles, "dialog-shell-header-button timeline-dialog-header-button")}
          onClick={() => {
            appHost.internalActions.setTimelineDockPreference("bottom");
          }}
          title={dockToBottomTitle}
          type="button"
        >
          <span className={cm(styles, "top-bar-toggle-icon")}>
            <WorkbenchIcon kind="panel-bottom-close" />
          </span>
          <span className={cm(styles, "sr-only")}>{dockToBottomTitle}</span>
        </button>
      ) : null}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("timelineDialog.maximize")}
      modal={false}
      onClose={() => {
        appHost.internalActions.closeDialog("timeline");
      }}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("timeline", offsetX, offsetY);
      }}
      onResize={(width) => {
        appHost.internalActions.setDialogSize("timeline", width, null);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("timeline");
      }}
      resizableHeight={false}
      restoreTitle={t("timelineDialog.restore")}
      shellStyle={dialogState.maximized ? undefined : { height: "250px" }}
      title={t("timelineDialog.title")}
      titleId="timeline-dialog-title"
    >
      <TimelineRuler appHost={appHost} />
    </DialogShell>
  );
});

export const TimelineBottomDock = observer(function TimelineBottomDock({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const timelineCollapsed = appHost.internalState.workbench.timelineBottomDockCollapsed;
  const collapseTitle = timelineCollapsed
    ? t("timelineDialog.expandBottomDock")
    : t("timelineDialog.collapseBottomDock");
  const canUndock = appHost.state.screenProfile.deviceClass !== "mobile";

  if (!shouldRenderTimelineBottomDock(appHost)) {
    return null;
  }

  // AI-REMOVED 2026-07-14:
  // Reason: 时间轴底部停靠态高度不应由用户拖拽调整，避免底部区域留下过大空白。
  // Trigger: 用户要求时间轴停靠后也不可以调整高度。
  // Evidence: resolveTimelineBottomDockGridHeight 现在对展开态返回 DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT。
  // Replacement: fixed height in resolveTimelineBottomDockGridHeight in this file.
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const resizeCleanupRef = useRef<(() => void) | null>(null);
  //
  // useEffect(() => {
  //   return () => {
  //     resizeCleanupRef.current?.();
  //   };
  // }, []);
  //
  // const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
  //   if (event.pointerType === "mouse" && event.button !== 0) {
  //     return;
  //   }
  //
  //   event.preventDefault();
  //   event.stopPropagation();
  //
  //   const pointerId = event.pointerId;
  //   const startY = event.clientY;
  //   const originHeight = appHost.internalState.workbench.timelineBottomDockHeight;
  //
  //   resizeCleanupRef.current?.();
  //   document.body.classList.add("is-resizing-timeline-bottom-dock");
  //
  //   const cleanup = () => {
  //     document.body.classList.remove("is-resizing-timeline-bottom-dock");
  //     window.removeEventListener("pointermove", handlePointerMove);
  //     window.removeEventListener("pointerup", handlePointerEnd);
  //     window.removeEventListener("pointercancel", handlePointerEnd);
  //
  //     if (resizeCleanupRef.current === cleanup) {
  //       resizeCleanupRef.current = null;
  //     }
  //   };
  //
  //   const handlePointerMove = (moveEvent: PointerEvent) => {
  //     if (moveEvent.pointerId !== pointerId) {
  //       return;
  //     }
  //
  //     appHost.internalActions.setTimelineBottomDockHeight(
  //       originHeight + startY - moveEvent.clientY,
  //     );
  //   };
  //
  //   const handlePointerEnd = (endEvent: PointerEvent) => {
  //     if (endEvent.pointerId !== pointerId) {
  //       return;
  //     }
  //
  //     cleanup();
  //   };
  //
  //   window.addEventListener("pointermove", handlePointerMove);
  //   window.addEventListener("pointerup", handlePointerEnd);
  //   window.addEventListener("pointercancel", handlePointerEnd);
  //   resizeCleanupRef.current = cleanup;
  // };

  return (
    <section
      aria-labelledby="timeline-bottom-dock-title"
      className={cm(styles, timelineCollapsed
        ? "timeline-bottom-dock panel-surface is-collapsed"
        : "timeline-bottom-dock panel-surface")}
    >
      {/* AI-REMOVED 2026-07-14:
          Reason: 时间轴底部停靠态高度不应由用户拖拽调整，避免底部区域留下过大空白。
          Trigger: 用户要求时间轴停靠后也不可以调整高度。
          Evidence: resolveTimelineBottomDockGridHeight 现在对展开态返回 DEFAULT_TIMELINE_BOTTOM_DOCK_HEIGHT。
          Replacement: fixed height in resolveTimelineBottomDockGridHeight in this file.
          Risk: Low
          Human Review: Required

          Original code:
          {timelineCollapsed ? null : (
            <div
              aria-label={t("timelineDialog.resizeBottomDock")}
              className={cm(styles, "timeline-bottom-dock-resize-handle")}
              onPointerDown={handleResizePointerDown}
              role="separator"
              title={t("timelineDialog.resizeBottomDock")}
            />
          )}
      */}
      <header className={cm(styles, "timeline-bottom-dock-header")}>
        <div className={cm(styles, "timeline-bottom-dock-title")}>
          <h2 id="timeline-bottom-dock-title">{t("timelineDialog.title")}</h2>
        </div>
        <div className={cm(styles, "timeline-bottom-dock-actions")}>
          <button
            aria-label={collapseTitle}
            className={cm(styles, "dialog-shell-header-button timeline-bottom-dock-action-button")}
            onClick={() => {
              appHost.internalActions.setTimelineBottomDockCollapsed(!timelineCollapsed);
            }}
            title={collapseTitle}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind={timelineCollapsed ? "panel-bottom-open" : "panel-bottom-close"} />
            </span>
            <span className={cm(styles, "sr-only")}>{collapseTitle}</span>
          </button>
          {canUndock ? (
            <button
              aria-label={t("timelineDialog.undock")}
              className={cm(styles, "dialog-shell-header-button timeline-bottom-dock-action-button")}
              onClick={() => {
                appHost.internalActions.setTimelineDockPreference("floating");
              }}
              title={t("timelineDialog.undock")}
              type="button"
            >
              <span className={cm(styles, "top-bar-toggle-icon")}>
                <WorkbenchIcon kind="panel-bottom-open" />
              </span>
              <span className={cm(styles, "sr-only")}>{t("timelineDialog.undock")}</span>
            </button>
          ) : null}
          <button
            aria-label={t("action.close")}
            className={cm(styles, "dialog-shell-header-button timeline-bottom-dock-action-button")}
            onClick={() => {
              appHost.internalActions.closeDialog("timeline");
            }}
            title={t("action.close")}
            type="button"
          >
            <span className={cm(styles, "top-bar-toggle-icon")}>
              <WorkbenchIcon kind="cancel" />
            </span>
            <span className={cm(styles, "sr-only")}>{t("action.close")}</span>
          </button>
        </div>
      </header>
      {timelineCollapsed ? null : (
        <div className={cm(styles, "timeline-bottom-dock-body")}>
          <TimelineRuler appHost={appHost} />
        </div>
      )}
    </section>
  );
});

const TimelineRuler = observer(function TimelineRuler({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const simulation = appHost.workspace.simulation;
  const timeline = simulation?.state.timeline ?? null;
  const debugMode = appHost.state.settings.debugMode;
  const [dragTickNumber, setDragTickNumber] = useState<number | null>(null);
  const [dragWindowStartTickNumber, setDragWindowStartTickNumber] = useState<number | null>(null);
  const [pendingSeek, setPendingSeek] = useState<{
    readonly tickNumber: number;
    readonly crossedMarks: readonly SimulationTimelineMark[];
  } | null>(null);
  const [doNotWarnAgain, setDoNotWarnAgain] = useState(false);
  const lastAcceptedTickRef = useRef(0);
  const dragActiveRef = useRef(false);
  const dragWasRunningRef = useRef(false);
  const pendingSeekShouldResumeRef = useRef(false);
  const lastSeekPromiseRef = useRef<Promise<boolean> | null>(null);
  const rollbackSeekInFlightRef = useRef(false);
  const edgeScrollFrameRef = useRef<number | null>(null);
  const edgeScrollLastFrameMsRef = useRef<number | null>(null);
  const edgeScrollTickCarryRef = useRef(0);
  const edgeScrollDirectionRef = useRef<"left" | "right" | null>(null);
  const edgeScrollPointerPercentRef = useRef<number | null>(null);
  const edgeScrollLastSeekTickRef = useRef<number | null>(null);
  const simulationRef = useRef(simulation);
  const frameApplyPerformanceWindowRef = useRef<ReturnType<
    typeof createTimelineFrameApplyPerformanceWindow
  > | null>(null);
  const timelineMarksRef = useRef<readonly SimulationTimelineMark[]>([]);
  const timelineMetricsRef = useRef({
    availableFromTick: 0,
    availableToTick: 0,
    retainedAvailableFromTick: 0,
    retainedAvailableToTick: 0,
    totalTimelineTicks: 1,
    windowStartTick: 0,
  });

  simulationRef.current = simulation;

  useEffect(() => {
    if (timeline === null) {
      return;
    }

    lastAcceptedTickRef.current = Math.trunc(timeline.cursorTickNumber);
    if (dragTickNumber !== null && !timeline.isSeeking && !dragActiveRef.current) {
      setDragTickNumber(null);
      setDragWindowStartTickNumber(null);
    }
  }, [dragTickNumber, timeline, timeline?.cursorTickNumber, timeline?.isSeeking]);

  useEffect(() => {
    return () => {
      if (edgeScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(edgeScrollFrameRef.current);
        edgeScrollFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!debugMode) {
      frameApplyPerformanceWindowRef.current = null;
      return;
    }

    const performanceWindow = createTimelineFrameApplyPerformanceWindow(performance.now());
    frameApplyPerformanceWindowRef.current = performanceWindow;
    const intervalId = window.setInterval(() => {
      const report = takeTimelineFrameApplyPerformanceReport(
        performanceWindow,
        performance.now(),
      );
      if (report !== null) {
        console.debug(`[timeline-frame-apply-perf] ${JSON.stringify(report)}`);
      }
    }, getTimelineFrameApplyPerformancePeriodMs());

    return () => {
      window.clearInterval(intervalId);
      if (frameApplyPerformanceWindowRef.current === performanceWindow) {
        frameApplyPerformanceWindowRef.current = null;
      }
    };
  }, [debugMode]);

  if (simulation === null || timeline === null) {
    return (
      <div className={cm(styles, "timeline-empty-state")}>
        {t("timelineDialog.unavailable")}
      </div>
    );
  }

  const tickDurationSeconds = timeline.tickDurationSeconds;
  const totalTimelineTicks = Math.max(
    1,
    Math.round(timeline.rulerDurationSeconds / tickDurationSeconds),
  );
  const windowStartTick = Math.max(0, dragWindowStartTickNumber ?? timeline.windowStartTickNumber);
  const windowEndTick = windowStartTick + totalTimelineTicks - 1;
  const timelineCursorTick = dragTickNumber ?? timeline.cursorTickNumber;
  const visibleCursorTick = clampNumber(
    timelineCursorTick,
    windowStartTick,
    windowEndTick,
  );
  const availableFromTick = Math.max(windowStartTick, Math.floor(timeline.availableFromTickNumber));
  const retainedAvailableFromTick = Math.max(0, Math.floor(timeline.availableFromTickNumber));
  const retainedAvailableToTick = Math.max(
    retainedAvailableFromTick,
    Math.floor(timeline.availableToTickNumber),
  );
  const availableToTick = clampNumber(
    retainedAvailableToTick,
    availableFromTick,
    windowEndTick,
  );
  const availableLeft = resolveTimelinePercent(availableFromTick, windowStartTick, totalTimelineTicks);
  const availableRight = resolveTimelinePercent(availableToTick, windowStartTick, totalTimelineTicks);
  const availableWidth = Math.max(0, availableRight - availableLeft);
  const cursorLeft = dragActiveRef.current && edgeScrollDirectionRef.current === "left"
    ? TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT
    : dragActiveRef.current && edgeScrollDirectionRef.current === "right"
      ? TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT
      : resolveTimelinePercent(visibleCursorTick, windowStartTick, totalTimelineTicks);
  const majorTicks = createMajorTimelineTicks(windowStartTick, totalTimelineTicks, tickDurationSeconds);
  timelineMarksRef.current = timeline.marks;
  timelineMetricsRef.current = {
    availableFromTick,
    availableToTick,
    retainedAvailableFromTick,
    retainedAvailableToTick,
    totalTimelineTicks,
    windowStartTick,
  };

  const stopEdgeScroll = () => {
    if (edgeScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(edgeScrollFrameRef.current);
      edgeScrollFrameRef.current = null;
    }
    edgeScrollLastFrameMsRef.current = null;
    edgeScrollTickCarryRef.current = 0;
    edgeScrollDirectionRef.current = null;
    edgeScrollPointerPercentRef.current = null;
    edgeScrollLastSeekTickRef.current = null;
  };

  const applyTimelineFrame = async (targetTickNumber: number): Promise<boolean> => {
    const currentSimulation = simulationRef.current;
    if (currentSimulation === null) {
      return false;
    }

    const performanceWindow = debugMode
      ? frameApplyPerformanceWindowRef.current
      : null;
    const startedAtMs = performanceWindow === null ? 0 : performance.now();
    let applied = false;
    try {
      applied = await currentSimulation.actions.seekTimelineToTick(targetTickNumber);
      return applied;
    } finally {
      if (performanceWindow !== null && frameApplyPerformanceWindowRef.current === performanceWindow) {
        recordTimelineFrameApplyPerformance(
          performanceWindow,
          performance.now() - startedAtMs,
          applied,
        );
      }
    }
  };

  const requestSeek = (
    rawTickNumber: number,
    options: { readonly allowEdgeOverflow?: boolean } = {},
  ) => {
    const metrics = timelineMetricsRef.current;
    const leftEdgeAnchorTick = metrics.windowStartTick + resolveTimelineDragLeftEdgeAnchorOffset(metrics.totalTimelineTicks);
    const rightEdgeAnchorTick = metrics.windowStartTick + resolveTimelineDragRightEdgeAnchorOffset(metrics.totalTimelineTicks);
    const canScrollLeft = metrics.retainedAvailableFromTick < metrics.windowStartTick;
    const seekMinTick = dragActiveRef.current && options.allowEdgeOverflow !== true && canScrollLeft
      ? Math.max(metrics.retainedAvailableFromTick, leftEdgeAnchorTick)
      : metrics.retainedAvailableFromTick;
    const seekMaxTick = dragActiveRef.current && options.allowEdgeOverflow !== true
      ? Math.min(metrics.availableToTick, rightEdgeAnchorTick)
      : metrics.retainedAvailableToTick;
    const targetTickNumber = clampNumber(
      Math.trunc(rawTickNumber),
      seekMinTick,
      seekMaxTick,
    );
    setDragTickNumber(targetTickNumber);

    const crossedMarks = resolveCrossedTimelineMarks(timelineMarksRef.current, targetTickNumber);

    if (crossedMarks.length > 0 && !skipTimelineEditRollbackWarning) {
      stopEdgeScroll();
      simulation.actions.pause();
      setPendingSeek({
        tickNumber: targetTickNumber,
        crossedMarks,
      });
      return;
    }

    lastSeekPromiseRef.current = crossedMarks.length === 0
      ? seekToTick(targetTickNumber)
      : rollbackAndSeekToTick(targetTickNumber, crossedMarks);
  };

  const seekToTick = async (targetTickNumber: number) => {
    const currentSimulation = simulationRef.current;
    if (currentSimulation === null) {
      return false;
    }

    const moved = await applyTimelineFrame(targetTickNumber);
    if (moved) {
      lastAcceptedTickRef.current = targetTickNumber;
      if (!dragActiveRef.current) {
        setDragTickNumber(null);
        setDragWindowStartTickNumber(null);
      }
    }
    return moved;
  };

  const rollbackAndSeekToTick = async (
    targetTickNumber: number,
    crossedMarks: readonly SimulationTimelineMark[],
  ) => {
    if (rollbackSeekInFlightRef.current) {
      return false;
    }

    rollbackSeekInFlightRef.current = true;
    try {
      const rollbackSequence = resolveDocumentHistoryRollbackSequence(appHost, crossedMarks);
      if (rollbackSequence === undefined) {
        setDragTickNumber(lastAcceptedTickRef.current);
        return false;
      }

      const currentSimulation = simulationRef.current;
      if (currentSimulation === null) {
        return false;
      }

      const moved = await applyTimelineFrame(targetTickNumber);
      if (!moved) {
        return false;
      }

      if (
        rollbackSequence !== null
        && !restoreDocumentHistoryToTimelineSequence(appHost, rollbackSequence)
      ) {
        setDragTickNumber(lastAcceptedTickRef.current);
        return false;
      }

      lastAcceptedTickRef.current = targetTickNumber;
      if (!dragActiveRef.current) {
        setDragTickNumber(null);
        setDragWindowStartTickNumber(null);
      }
      return true;
    } finally {
      rollbackSeekInFlightRef.current = false;
    }
  };

  const runEdgeScrollFrame = (frameMs: number) => {
    const direction = edgeScrollDirectionRef.current;
    const pointerPercent = edgeScrollPointerPercentRef.current;
    if (
      direction === null
      || pointerPercent === null
      || !dragActiveRef.current
    ) {
      stopEdgeScroll();
      return;
    }

    if (
      direction === "left"
      && pointerPercent >= TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT
    ) {
      stopEdgeScroll();
      return;
    }

    if (
      direction === "right"
      && pointerPercent <= TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT
    ) {
      stopEdgeScroll();
      return;
    }

    const previousFrameMs = edgeScrollLastFrameMsRef.current ?? frameMs;
    edgeScrollLastFrameMsRef.current = frameMs;
    const elapsedSeconds = clampNumber((frameMs - previousFrameMs) / 1000, 0, 0.12);
    const metrics = timelineMetricsRef.current;
    const leftEdgeAnchorTick = metrics.windowStartTick + resolveTimelineDragLeftEdgeAnchorOffset(metrics.totalTimelineTicks);
    const rightEdgeAnchorTick = metrics.windowStartTick + resolveTimelineDragRightEdgeAnchorOffset(metrics.totalTimelineTicks);
    const intensity = direction === "left"
      ? clampNumber(
        (TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT - pointerPercent) / TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT,
        0,
        1,
      )
      : clampNumber(
        (pointerPercent - TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT) / (100 - TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT),
        0,
        1,
      );
    const ticksPerSecond = TIMELINE_DRAG_EDGE_SCROLL_MIN_TICKS_PER_SECOND
      + (TIMELINE_DRAG_EDGE_SCROLL_MAX_TICKS_PER_SECOND - TIMELINE_DRAG_EDGE_SCROLL_MIN_TICKS_PER_SECOND)
      * intensity
      * intensity;
    edgeScrollTickCarryRef.current += ticksPerSecond * elapsedSeconds;
    const deltaTicks = Math.floor(edgeScrollTickCarryRef.current);

    if (deltaTicks > 0) {
      edgeScrollTickCarryRef.current -= deltaTicks;
      const baseTargetTickNumber = edgeScrollLastSeekTickRef.current
        ?? (direction === "left" ? leftEdgeAnchorTick : rightEdgeAnchorTick);
      const targetTickNumber = direction === "left"
        ? clampNumber(
          baseTargetTickNumber - deltaTicks,
          metrics.retainedAvailableFromTick,
          metrics.availableToTick,
        )
        : clampNumber(
          baseTargetTickNumber + deltaTicks,
          metrics.retainedAvailableFromTick,
          metrics.retainedAvailableToTick,
        );
      if (targetTickNumber !== edgeScrollLastSeekTickRef.current) {
        edgeScrollLastSeekTickRef.current = targetTickNumber;
        const targetWindowStartTickNumber = direction === "left"
          ? Math.max(
            metrics.retainedAvailableFromTick,
            targetTickNumber - resolveTimelineDragLeftEdgeAnchorOffset(metrics.totalTimelineTicks),
          )
          : Math.max(
            0,
            targetTickNumber - resolveTimelineDragRightEdgeAnchorOffset(metrics.totalTimelineTicks),
          );
        setDragWindowStartTickNumber(targetWindowStartTickNumber);
        requestSeek(targetTickNumber, { allowEdgeOverflow: true });
      }
    }

    edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeScrollFrame);
  };

  const updateEdgeScrollFromPointer = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (!dragActiveRef.current) {
      return;
    }

    const pointerPercent = resolveTimelinePointerPercent(event.currentTarget, event.clientX);
    const metrics = timelineMetricsRef.current;
    const canScrollLeft = metrics.retainedAvailableFromTick < metrics.windowStartTick;
    const direction = pointerPercent < TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT && canScrollLeft
      ? "left"
      : pointerPercent > TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT
        ? "right"
        : null;

    if (direction === null) {
      stopEdgeScroll();
      return;
    }

    edgeScrollDirectionRef.current = direction;
    edgeScrollPointerPercentRef.current = pointerPercent;
    if (edgeScrollFrameRef.current === null) {
      edgeScrollLastFrameMsRef.current = null;
      edgeScrollFrameRef.current = window.requestAnimationFrame(runEdgeScrollFrame);
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (dragActiveRef.current) {
      return;
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic E2E pointer events may not have an active browser pointer capture target.
    }
    dragActiveRef.current = true;
    dragWasRunningRef.current = simulation.state.runningState === "start";
    pendingSeekShouldResumeRef.current = false;
    lastSeekPromiseRef.current = null;
    if (dragWasRunningRef.current) {
      simulation.actions.pause();
    }
    updateEdgeScrollFromPointer(event);
  };

  const finishDrag = () => {
    if (!dragActiveRef.current) {
      return;
    }

    stopEdgeScroll();
    dragActiveRef.current = false;
    if (pendingSeek !== null) {
      pendingSeekShouldResumeRef.current = dragWasRunningRef.current;
      return;
    }

    const shouldResume = dragWasRunningRef.current;
    const seekPromise = lastSeekPromiseRef.current;
    dragWasRunningRef.current = false;
    if (!shouldResume) {
      if (seekPromise === null) {
        setDragTickNumber(null);
        setDragWindowStartTickNumber(null);
        return;
      }

      void seekPromise.finally(() => {
        setDragTickNumber(null);
        setDragWindowStartTickNumber(null);
        lastSeekPromiseRef.current = null;
      });
      return;
    }

    if (seekPromise === null) {
      setDragTickNumber(null);
      setDragWindowStartTickNumber(null);
      simulation.actions.resume();
      return;
    }

    void seekPromise.finally(() => {
      setDragTickNumber(null);
      setDragWindowStartTickNumber(null);
      lastSeekPromiseRef.current = null;
      simulation.actions.resume();
    });
  };

  const cancelPendingSeek = () => {
    stopEdgeScroll();
    setPendingSeek(null);
    setDoNotWarnAgain(false);
    setDragTickNumber(lastAcceptedTickRef.current);
    setDragWindowStartTickNumber(null);
    if (pendingSeekShouldResumeRef.current) {
      simulation.actions.resume();
    }
    pendingSeekShouldResumeRef.current = false;
    dragWasRunningRef.current = false;
  };

  const confirmPendingSeek = async () => {
    if (pendingSeek === null) {
      return;
    }

    if (doNotWarnAgain) {
      skipTimelineEditRollbackWarning = true;
    }

    const targetTickNumber = pendingSeek.tickNumber;
    const crossedMarks = pendingSeek.crossedMarks;
    const shouldResume = pendingSeekShouldResumeRef.current;
    stopEdgeScroll();
    setPendingSeek(null);
    setDoNotWarnAgain(false);
    pendingSeekShouldResumeRef.current = false;
    await rollbackAndSeekToTick(targetTickNumber, crossedMarks);
    if (shouldResume) {
      simulation.actions.resume();
    }
    dragWasRunningRef.current = false;
  };

  return (
    <div className={cm(styles, "timeline-ruler-panel")}>
      <div className={cm(styles, "timeline-ruler-meta")}>
        <span>{formatTimelineTime(timelineCursorTick, tickDurationSeconds)}</span>
        <span>{`${formatTimelineTime(availableFromTick, tickDurationSeconds)} - ${formatTimelineTime(availableToTick, tickDurationSeconds)}`}</span>
      </div>
      <div className={cm(styles, "timeline-ruler")}>
        <div className={cm(styles, "timeline-ruler-track")}>
          <div
            className={cm(styles, "timeline-ruler-available")}
            style={{
              left: `${availableLeft}%`,
              width: `${availableWidth}%`,
            }}
          />
          {majorTicks.map((tick) => (
            <span
              className={cm(styles, "timeline-ruler-major-tick")}
              key={tick.tickNumber}
              style={{ left: `${tick.leftPercent}%` }}
            />
          ))}
          {timeline.marks.map((mark) => {
            if (mark.tickNumber < windowStartTick || mark.tickNumber > windowEndTick) {
              return null;
            }

            return (
              <span
                className={cm(styles, `timeline-ruler-mark is-${mark.kind}`)}
                key={mark.id}
                style={{
                  left: `${resolveTimelinePercent(mark.tickNumber, windowStartTick, totalTimelineTicks)}%`,
                }}
              />
            );
          })}
          <span
            className={cm(styles, "timeline-ruler-cursor")}
            style={{ left: `${cursorLeft}%` }}
          />
          <input
            aria-label={t("timelineDialog.title")}
            className={cm(styles, "timeline-ruler-input")}
            max={windowEndTick}
            min={windowStartTick}
            onBlur={finishDrag}
            onInput={(event) => {
              if (!dragActiveRef.current) {
                event.currentTarget.value = String(Math.trunc(visibleCursorTick));
                return;
              }

              requestSeek(Number(event.currentTarget.value));
            }}
            onPointerCancel={finishDrag}
            onPointerDown={startDrag}
            onPointerMove={updateEdgeScrollFromPointer}
            onPointerUp={finishDrag}
            step={1}
            type="range"
            value={Math.trunc(visibleCursorTick)}
          />
        </div>
        <div className={cm(styles, "timeline-ruler-second-labels")}>
          {majorTicks.map((label) => (
            <span
              className={cm(styles, "timeline-ruler-second-label")}
              key={label.tickNumber}
              style={{ left: `${label.leftPercent}%` }}
            >
              {label.text}
            </span>
          ))}
        </div>
      </div>
      <TimelineRollbackConfirmDialog
        appHost={appHost}
        checked={doNotWarnAgain}
        onCancel={cancelPendingSeek}
        onCheckedChange={setDoNotWarnAgain}
        onConfirm={confirmPendingSeek}
        visible={pendingSeek !== null}
      />
    </div>
  );
});

function TimelineRollbackConfirmDialog({
  appHost,
  checked,
  onCancel,
  onCheckedChange,
  onConfirm,
  visible,
}: {
  readonly appHost: AppHost;
  readonly checked: boolean;
  readonly onCancel: () => void;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly onConfirm: () => void;
  readonly visible: boolean;
}) {
  const t = appHost.actions.translate;
  const dialogState = {
    visible,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  };

  return (
    <DialogShell
      bodyClassName={cm(styles, "timeline-confirm-dialog-body")}
      className="timeline-confirm-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={false}
      dialogKey="timeline-confirm"
      dialogState={dialogState}
      maximizeTitle=""
      onClose={onCancel}
      onToggleMaximized={() => {}}
      restoreTitle=""
      showMaximizeButton={false}
      title={t("timelineDialog.rollbackTitle")}
      titleId="timeline-confirm-dialog-title"
    >
      <div className={cm(styles, "timeline-confirm-content")}>
        <p>{t("timelineDialog.rollbackWarning")}</p>
        <label className={cm(styles, "timeline-confirm-checkbox")}>
          <input
            checked={checked}
            onChange={(event) => {
              onCheckedChange(event.currentTarget.checked);
            }}
            type="checkbox"
          />
          <span>{t("timelineDialog.doNotWarnAgain")}</span>
        </label>
        <div className={cm(styles, "timeline-confirm-actions")}>
          <button onClick={onCancel} type="button">
            {t("action.cancel")}
          </button>
          <button onClick={onConfirm} type="button">
            {t("action.confirm")}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

function resolveTimelinePercent(
  tickNumber: number,
  windowStartTick: number,
  totalTimelineTicks: number,
): number {
  if (totalTimelineTicks <= 1) {
    return 0;
  }

  return clampNumber(
    (tickNumber - windowStartTick) / (totalTimelineTicks - 1) * 100,
    0,
    100,
  );
}

function resolveTimelineDragLeftEdgeAnchorOffset(totalTimelineTicks: number): number {
  return Math.round(Math.max(0, totalTimelineTicks - 1) * TIMELINE_DRAG_LEFT_EDGE_SCROLL_START_PERCENT / 100);
}

function resolveTimelineDragRightEdgeAnchorOffset(totalTimelineTicks: number): number {
  return Math.round(Math.max(0, totalTimelineTicks - 1) * TIMELINE_DRAG_EDGE_SCROLL_START_PERCENT / 100);
}

function resolveTimelinePointerPercent(element: HTMLElement, clientX: number): number {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) {
    return 0;
  }

  return clampNumber((clientX - rect.left) / rect.width * 100, 0, 100);
}

function createMajorTimelineTicks(
  windowStartTick: number,
  totalTimelineTicks: number,
  tickDurationSeconds: number,
): Array<{ readonly tickNumber: number; readonly text: string; readonly leftPercent: number }> {
  const tickInterval = Math.max(1, Math.round(30 / tickDurationSeconds));
  const windowEndTick = windowStartTick + totalTimelineTicks - 1;
  const firstTickNumber = Math.ceil(windowStartTick / tickInterval) * tickInterval;
  const ticks: Array<{ readonly tickNumber: number; readonly text: string; readonly leftPercent: number }> = [];
  for (let tickNumber = firstTickNumber; tickNumber <= windowEndTick; tickNumber += tickInterval) {
    ticks.push({
      tickNumber,
      text: formatTimelineMajorTickTime(tickNumber, tickDurationSeconds),
      leftPercent: resolveTimelinePercent(tickNumber, windowStartTick, totalTimelineTicks),
    });
  }
  return ticks;
}

function formatTimelineTime(tickNumber: number, tickDurationSeconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(tickNumber * tickDurationSeconds * 100));
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = totalCentiseconds % 100;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function formatTimelineMajorTickTime(tickNumber: number, tickDurationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(tickNumber * tickDurationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function resolveCrossedTimelineMarks(
  marks: readonly SimulationTimelineMark[],
  targetTickNumber: number,
): readonly SimulationTimelineMark[] {
  return marks
    .filter((mark) => mark.tickNumber > targetTickNumber)
    .sort((left, right) => right.tickNumber - left.tickNumber);
}

function resolveDocumentHistoryRollbackSequence(
  appHost: AppHost,
  crossedMarks: readonly SimulationTimelineMark[],
): number | null | undefined {
  const documentChangeCount = crossedMarks.filter((mark) => mark.kind === "document-change").length;
  if (documentChangeCount === 0) {
    return null;
  }

  const editor = appHost.workspace.editor;
  if (editor === undefined || editor === null) {
    return undefined;
  }

  const targetSequence = editor.state.history.cursorSequence - documentChangeCount;
  if (targetSequence < 0 || editor.state.history.undoDepth < documentChangeCount) {
    return undefined;
  }

  return targetSequence;
}

function restoreDocumentHistoryToTimelineSequence(
  appHost: AppHost,
  targetSequence: number,
): boolean {
  const editor = appHost.workspace.editor;
  if (editor === undefined || editor === null) {
    return false;
  }

  return editor.actions.restoreDocumentHistoryTo(targetSequence);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
