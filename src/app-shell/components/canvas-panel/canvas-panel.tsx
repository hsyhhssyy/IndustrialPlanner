import { CanvasActionToolbar } from "./canvas-action-toolbar";
import {
  resolveCanvasPointerDownRoute,
  resolveCanvasTouchDownRoute,
  routeCanvasGestureEvent,
} from "./canvas-panel-interaction-router";
import {
  createCanvasGestureSession,
  type CanvasGestureSessionResult,
  type CanvasGestureSessionSnapshot,
} from "./canvas-panel-gesture-session";
import {
  isCanvasPointerPanning,
} from "./canvas-panel-pointer-gesture";
import { createCanvasPreviewRawInputScheduler } from "./canvas-preview-raw-input-scheduler";
import {
  isCanvasTouchPanning,
} from "./canvas-panel-touch-gesture";
import {
  TOUCH_MARQUEE_LONG_PRESS_DURATION_MS,
} from "./canvas-panel-touch-marquee-gesture";
import {
  getManagedMarqueeDraft,
  getManagedMoveDraft,
  getManagedPlacementPreview,
  getSelectedEntityIds,
} from "@/editor/contracts/editor-session-helpers";
import {
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { createTranslator } from "@/i18n/messages";
import { RendererHost } from "@/renderer/host/renderer-host";
import { observer } from "@/shared/mobx";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import type {
  RenderDerivedScreenBox,
  RenderDerivedState,
} from "@/workbench/workspace-derived-state";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";
import type { CanvasPoint } from "@/workbench/workspace-state";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

const PIXELS_PER_WHEEL_LINE = 16;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const TOUCH_PLACEMENT_TOOLBAR_WIDTH_PX = 176;
const TOUCH_MOVE_TOOLBAR_WIDTH_PX = 176;
const TOUCH_SELECTION_TOOLBAR_WIDTH_PX = 120;
const TOUCH_ACTION_TOOLBAR_HEIGHT_PX = 56;
const TOUCH_ACTION_TOOLBAR_GAP_PX = 12;
const TOUCH_HOLD_INDICATOR_CIRCUMFERENCE = 100.53;

function isSelectionModifierActive(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey;
}

function normalizeWheelDelta(event: WheelEvent<HTMLDivElement>): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY * PIXELS_PER_WHEEL_LINE;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * window.innerHeight;
    default:
      return event.deltaY;
  }
}

function clampToRange(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function resolveAnchoredToolbarStyle(
  screenBox: RenderDerivedScreenBox | null,
  viewportSize: CanvasPoint,
  toolbarWidthPx: number,
) {
  if (!screenBox) {
    return null;
  }

  return {
    left: `${clampToRange(
      screenBox.left + screenBox.width / 2,
      12 + toolbarWidthPx / 2,
      viewportSize.x - toolbarWidthPx / 2 - 12,
    )}px`,
    top: `${clampToRange(
      screenBox.top - TOUCH_ACTION_TOOLBAR_HEIGHT_PX - TOUCH_ACTION_TOOLBAR_GAP_PX,
      12,
      viewportSize.y - TOUCH_ACTION_TOOLBAR_HEIGHT_PX - 12,
    )}px`,
    transform: "translateX(-50%)",
  };
}

export interface CanvasPanelProps {
  controller: WorkbenchController;
  renderDerivedStore: ReadonlySnapshotStore<RenderDerivedState>;
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

export const CanvasPanel = observer(function CanvasPanel({
  controller,
  renderDerivedStore,
  placementPreviewProfiler,
}: CanvasPanelProps) {
  const ui = controller.uiStore;
  const worldDocument = useExternalStore(controller.documentStore);
  const editor = controller.editorStore;
  const render = useExternalStore(renderDerivedStore);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const keyStateRef = useRef({ up: false, down: false, left: false, right: false });
  const frameRef = useRef<number | null>(null);
  const touchMarqueeHoldKeyRef = useRef<string | null>(null);
  const touchMarqueeHoldTimerRef = useRef<number | null>(null);
  const gestureSessionRef = useRef<ReturnType<typeof createCanvasGestureSession> | null>(
    null,
  );

  if (!gestureSessionRef.current) {
    gestureSessionRef.current = createCanvasGestureSession();
  }

  const [gestureSnapshot, setGestureSnapshot] = useState<CanvasGestureSessionSnapshot>(
    () => gestureSessionRef.current!.getSnapshot(),
  );
  const [viewportSize, setViewportSize] = useState<CanvasPoint>({
    x: 0,
    y: 0,
  });
  const [touchMarqueeHoldIndicator, setTouchMarqueeHoldIndicator] =
    useState<CanvasPoint | null>(null);
  const previewInputSchedulerRef = useRef<ReturnType<
    typeof createCanvasPreviewRawInputScheduler
  > | null>(null);
  const t = createTranslator(ui.locale);
  const placementMode = isPlacementInteractionMode(editor.session.currentMode)
    ? editor.session.currentMode
    : null;
  const moveMode = isMoveInteractionMode(editor.session.currentMode)
    ? editor.session.currentMode
    : null;
  const selectedEntityIds = getSelectedEntityIds(editor.session);
  const activePlacementPreview = getManagedPlacementPreview(editor.session);
  const activeMoveDraft = getManagedMoveDraft(editor.session, worldDocument);
  const anchoredPlacementActive =
    placementMode !== null && placementMode.inputMode === "touch";
  const pointerSelectionQuickActionsActive =
    ui.phase === "edit" &&
    editor.session.currentMode.key === "select" &&
    selectedEntityIds.length > 0 &&
    editor.session.selectionInputMode === "pointer";
  const anchoredPlacementPreview =
    activePlacementPreview?.interactionMode === "touch"
      ? activePlacementPreview
      : null;
  const anchoredMoveDraft =
    activeMoveDraft?.interactionMode === "touch"
      ? activeMoveDraft
      : null;
  const anchoredPlacementScreenBox = render.anchoredPlacementScreenBox;
  const anchoredMoveToolbarStyle = resolveAnchoredToolbarStyle(
    render.anchoredMoveScreenBox,
    viewportSize,
    TOUCH_MOVE_TOOLBAR_WIDTH_PX,
  );
  const anchoredPlacementToolbarStyle = resolveAnchoredToolbarStyle(
    anchoredPlacementScreenBox,
    viewportSize,
    TOUCH_PLACEMENT_TOOLBAR_WIDTH_PX,
  );
  const anchoredSelectionToolbarStyle = resolveAnchoredToolbarStyle(
    render.anchoredSelectionScreenBox,
    viewportSize,
    TOUCH_SELECTION_TOOLBAR_WIDTH_PX,
  );
  const pointerGestureState = gestureSnapshot.pointerGestureState;
  const touchGestureState = gestureSnapshot.touchGestureState;

  const syncGestureSnapshot = (nextSnapshot: CanvasGestureSessionSnapshot) => {
    setGestureSnapshot((currentSnapshot) =>
      currentSnapshot.pointerGestureState === nextSnapshot.pointerGestureState &&
      currentSnapshot.touchGestureState === nextSnapshot.touchGestureState
        ? currentSnapshot
        : nextSnapshot,
    );
  };

  const applyPointerCaptureCommands = (
    result: CanvasGestureSessionResult,
    target: HTMLDivElement | null,
  ) => {
    if (!target) {
      return;
    }

    for (const command of result.pointerCaptureCommands) {
      if (command.kind === "capture") {
        target.setPointerCapture(command.pointerId);
        continue;
      }

      if (target.hasPointerCapture(command.pointerId)) {
        target.releasePointerCapture(command.pointerId);
      }
    }
  };

  const dispatchPlacementPreviewFromScreenPoint = useEffectEvent(
    (screenPoint: CanvasPoint) => {
      if (placementPreviewProfiler) {
        placementPreviewProfiler.measureStage("canvas.pointerMoveDispatch", () => {
          controller.updatePlacementPreviewFromScreenPoint(screenPoint);
        });
        return;
      }

      controller.updatePlacementPreviewFromScreenPoint(screenPoint);
    },
  );

  const schedulePlacementPreviewFromScreenPoint = (screenPoint: CanvasPoint) => {
    if (!previewInputSchedulerRef.current) {
      dispatchPlacementPreviewFromScreenPoint(screenPoint);
      return;
    }

    previewInputSchedulerRef.current.schedule(screenPoint);
  };

  const cancelScheduledPlacementPreview = () => {
    previewInputSchedulerRef.current?.cancel();
  };

  const cancelPlacement = () => {
    cancelScheduledPlacementPreview();
    controller.cancelPlacement();
  };

  const cancelMove = () => {
    controller.cancelMove();
  };

  const cancelMarquee = () => {
    controller.cancelMarquee();
  };

  const routeGestureEvents = useEffectEvent(
    (events: readonly CanvasGestureSessionResult["events"][number][]) => {
      for (const event of events) {
        void routeCanvasGestureEvent({
          anchoredPlacementActive,
          cancelMarquee,
          cancelMove,
          cancelPlacement,
          cancelScheduledPlacementPreview,
          controller,
          currentMode: editor.session.currentMode,
          displayTool: editor.session.displayTool,
          event,
          phase: ui.phase,
          schedulePlacementPreviewFromScreenPoint,
        });
      }
    },
  );

  const applyGestureSessionResult = (
    result: CanvasGestureSessionResult,
    target: HTMLDivElement | null = viewportRef.current,
  ) => {
    applyPointerCaptureCommands(result, target);
    syncGestureSnapshot({
      pointerGestureState: result.pointerGestureState,
      touchGestureState: result.touchGestureState,
    });
    routeGestureEvents(result.events);
  };

  const clearTouchMarqueeHold = useEffectEvent(() => {
    if (touchMarqueeHoldTimerRef.current !== null) {
      window.clearTimeout(touchMarqueeHoldTimerRef.current);
      touchMarqueeHoldTimerRef.current = null;
    }

    touchMarqueeHoldKeyRef.current = null;
    setTouchMarqueeHoldIndicator(null);
  });

  const activateTouchMarqueeHold = useEffectEvent((pointerId: number) => {
    clearTouchMarqueeHold();
    applyGestureSessionResult(
      gestureSessionRef.current!.handleTouchLongPress({ pointerId }),
    );
  });

  const resetAllGestures = useEffectEvent(() => {
    clearTouchMarqueeHold();
    const result = gestureSessionRef.current!.resetAll();

    applyGestureSessionResult(result);

    if (isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode)) {
      controller.cancelMove();
    }

    if (getManagedMarqueeDraft(controller.editorStore.getSnapshot().session)) {
      controller.cancelMarquee();
    }
  });

  useEffect(() => {
    const touchCandidate =
      touchGestureState.phase === "touch-pan-pressed" &&
      touchGestureState.longPressMarqueeSelectionMode !== null
        ? touchGestureState
        : null;
    const nextKey = touchCandidate
      ? `${touchCandidate.pointerId}:${touchCandidate.origin.x}:${touchCandidate.origin.y}`
      : null;

    if (nextKey === touchMarqueeHoldKeyRef.current) {
      return;
    }

    clearTouchMarqueeHold();

    if (!touchCandidate) {
      return;
    }

    touchMarqueeHoldKeyRef.current = nextKey;
    setTouchMarqueeHoldIndicator(touchCandidate.origin);
    touchMarqueeHoldTimerRef.current = window.setTimeout(() => {
      activateTouchMarqueeHold(touchCandidate.pointerId);
    }, TOUCH_MARQUEE_LONG_PRESS_DURATION_MS);
  }, [activateTouchMarqueeHold, clearTouchMarqueeHold, touchGestureState]);

  useEffect(() => () => clearTouchMarqueeHold(), [clearTouchMarqueeHold]);

  const toViewportPoint = (clientX: number, clientY: number): CanvasPoint => {
    const bounds = viewportRef.current?.getBoundingClientRect();

    if (!bounds) {
      return { x: 0, y: 0 };
    }

    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    };
  };

  useEffect(() => {
    previewInputSchedulerRef.current = createCanvasPreviewRawInputScheduler({
      dispatch: dispatchPlacementPreviewFromScreenPoint,
    });

    return () => {
      previewInputSchedulerRef.current?.dispose();
      previewInputSchedulerRef.current = null;
    };
  }, [controller, placementPreviewProfiler]);

  useEffect(
    () =>
      controller.subscribeCanvasKeyboardFocusRequests(() => {
        stageRef.current?.focus();
      }),
    [controller],
  );

  useEffect(() => {
    if (
      !anchoredPlacementActive ||
      activePlacementPreview !== null ||
      viewportSize.x <= 0 ||
      viewportSize.y <= 0
    ) {
      return;
    }

    controller.centerPlacementPreview();
  }, [
    anchoredPlacementActive,
    controller,
    activePlacementPreview,
    viewportSize.x,
    viewportSize.y,
  ]);

  useEffect(() => {
    const stageElement = stageRef.current;

    if (!stageElement) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      setViewportSize({
        x: entry.contentRect.width,
        y: entry.contentRect.height,
      });
      controller.setCanvasViewportSize({
        x: entry.contentRect.width,
        y: entry.contentRect.height,
      });
    });

    resizeObserver.observe(stageElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [controller]);

  const startKeyboardPanLoop = () => {
    if (frameRef.current !== null) {
      return;
    }

    const tick = () => {
      const keyState = keyStateRef.current;
      const screenDelta = {
        x: (keyState.left ? -14 : 0) + (keyState.right ? 14 : 0),
        y: (keyState.up ? -14 : 0) + (keyState.down ? 14 : 0),
      };

      if (screenDelta.x === 0 && screenDelta.y === 0) {
        frameRef.current = null;
        return;
      }

      controller.panCanvasBy(screenDelta);
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
  };

  const stopKeyboardPanLoop = () => {
    keyStateRef.current = { up: false, down: false, left: false, right: false };

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  useEffect(() => {
    const handleWindowBlur = () => {
      resetAllGestures();
      stopKeyboardPanLoop();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleWindowBlur();
      }
    };

    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleViewportPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    stageRef.current?.focus();

    const point = toViewportPoint(event.clientX, event.clientY);

    if (event.pointerType === "touch") {
      event.preventDefault();

      const touchRoute = resolveCanvasTouchDownRoute({
        anchoredMoveScreenBox: render.anchoredMoveScreenBox,
        anchoredPlacementActive,
        anchoredPlacementScreenBox,
        currentMode: editor.session.currentMode,
        phase: ui.phase,
        screenPoint: point,
        selection: selectedEntityIds,
        target: controller.getCanvasInteractionTarget(point),
      });
      const result = gestureSessionRef.current!.handlePointerDown({
        button: event.button,
        selectionModifierActive: false,
        point,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        route: touchRoute,
      });

      applyGestureSessionResult(result, event.currentTarget);
      return;
    }

    const pointerRoute = resolveCanvasPointerDownRoute({
      button: event.button,
      currentMode: editor.session.currentMode,
      phase: ui.phase,
      selectionModifierActive: isSelectionModifierActive(event),
      screenPoint: point,
      selection: selectedEntityIds,
      target:
        event.button === 0
          ? controller.getCanvasInteractionTarget(point)
          : { kind: "blank" },
    });

    if (event.button === 1 || (event.button === 2 && (placementMode || moveMode))) {
      event.preventDefault();
    }

    const result = gestureSessionRef.current!.handlePointerDown({
      button: event.button,
      selectionModifierActive: isSelectionModifierActive(event),
      point,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      route: pointerRoute,
    });

    applyGestureSessionResult(result, event.currentTarget);
  };

  const handleViewportPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const result = gestureSessionRef.current!.handlePointerMove({
      buttons: event.buttons,
      point: toViewportPoint(event.clientX, event.clientY),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });

    applyGestureSessionResult(result);
  };

  const handleViewportPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    const result = gestureSessionRef.current!.handlePointerEnter({
      buttons: event.buttons,
      point: toViewportPoint(event.clientX, event.clientY),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });

    applyGestureSessionResult(result);
  };

  const handleViewportPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    const result = gestureSessionRef.current!.handlePointerLeave({
      buttons: event.buttons,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });

    applyGestureSessionResult(result);

    if (!anchoredPlacementActive) {
      cancelScheduledPlacementPreview();
      controller.clearPlacementPreview();
    }
  };

  const handleViewportPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const result = gestureSessionRef.current!.handlePointerUp({
      anchoredPlacementActive,
      button: event.button,
      selectionModifierActive:
        event.pointerType === "touch" ? false : isSelectionModifierActive(event),
      point: toViewportPoint(event.clientX, event.clientY),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });

    applyGestureSessionResult(result, event.currentTarget);
  };

  const handleViewportLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    const result = gestureSessionRef.current!.handleLostPointerCapture({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });

    applyGestureSessionResult(result);

    if (
      event.pointerType !== "touch" &&
      isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode) &&
      result.events.some(
        (gestureEvent) =>
          gestureEvent.kind === "drag-end" &&
          gestureEvent.recognizer === "pointer-move" &&
          gestureEvent.outcome === "cancel",
      )
    ) {
      controller.cancelMove();
    }

    if (
      event.pointerType !== "touch" &&
      getManagedMarqueeDraft(controller.editorStore.getSnapshot().session) &&
      result.events.some(
        (gestureEvent) =>
          gestureEvent.kind === "drag-end" &&
          gestureEvent.recognizer === "pointer-marquee" &&
          gestureEvent.outcome === "cancel",
      )
    ) {
      controller.cancelMarquee();
    }
  };

  const handleViewportPointerCancel = () => {
    resetAllGestures();
  };

  const handleViewportWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (gestureSessionRef.current!.getSnapshot().pointerGestureState.phase !== "idle") {
      return;
    }

    const deltaY = normalizeWheelDelta(event);
    const scaleFactor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);

    if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.001) {
      return;
    }

    event.preventDefault();
    stageRef.current?.focus();

    const bounds = event.currentTarget.getBoundingClientRect();

    controller.zoomCanvasAt(
      {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      },
      scaleFactor,
    );
  };

  const handleViewportContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!placementMode && !moveMode) {
      return;
    }

    event.preventDefault();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key.toLowerCase()) {
      case "w":
        keyStateRef.current.up = true;
        break;
      case "a":
        keyStateRef.current.left = true;
        break;
      case "s":
        keyStateRef.current.down = true;
        break;
      case "d":
        keyStateRef.current.right = true;
        break;
      case "r":
        if (event.repeat) {
          return;
        }

        if (moveMode) {
          event.preventDefault();
          controller.rotateMoveClockwise();
          return;
        }

        if (placementMode) {
          event.preventDefault();
          controller.rotatePlacementClockwise();
          return;
        }

        if (!pointerSelectionQuickActionsActive) {
          return;
        }

        event.preventDefault();
        void controller.rotateSelectionClockwise();
        return;
      case "delete":
      case "f":
        if (!pointerSelectionQuickActionsActive) {
          return;
        }

        event.preventDefault();
        void controller.removeSelection();
        return;
      default:
        return;
    }

    event.preventDefault();
    startKeyboardPanLoop();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key.toLowerCase()) {
      case "w":
        keyStateRef.current.up = false;
        break;
      case "a":
        keyStateRef.current.left = false;
        break;
      case "s":
        keyStateRef.current.down = false;
        break;
      case "d":
        keyStateRef.current.right = false;
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  return (
    <main className="canvas-panel panel-surface">
      <div
        className="canvas-stage"
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
          }

          resetAllGestures();
          stopKeyboardPanLoop();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        ref={stageRef}
        tabIndex={0}
      >
        <div
          className={
            isCanvasPointerPanning(pointerGestureState) ||
            isCanvasTouchPanning(touchGestureState)
              ? "canvas-viewport-surface is-panning"
              : "canvas-viewport-surface"
          }
          onContextMenu={handleViewportContextMenu}
          onLostPointerCapture={handleViewportLostPointerCapture}
          onPointerCancel={handleViewportPointerCancel}
          onPointerDown={handleViewportPointerDown}
          onPointerEnter={handleViewportPointerEnter}
          onPointerLeave={handleViewportPointerLeave}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onWheel={handleViewportWheel}
          ref={viewportRef}
        >
          <RendererHost
            placementPreviewProfiler={placementPreviewProfiler}
            sceneSource={controller}
          />
          {render.marqueeScreenBox ? (
            <div
              aria-hidden="true"
              className="canvas-marquee-box"
              style={{
                left: `${render.marqueeScreenBox.left}px`,
                top: `${render.marqueeScreenBox.top}px`,
                width: `${render.marqueeScreenBox.width}px`,
                height: `${render.marqueeScreenBox.height}px`,
              }}
            />
          ) : null}
          {touchMarqueeHoldIndicator ? (
            <div
              aria-hidden="true"
              className="canvas-touch-hold-indicator"
              style={{
                left: `${touchMarqueeHoldIndicator.x}px`,
                top: `${touchMarqueeHoldIndicator.y}px`,
              }}
            >
              <svg
                className="canvas-touch-hold-indicator-ring"
                viewBox="0 0 40 40"
              >
                <circle
                  className="canvas-touch-hold-indicator-track"
                  cx="20"
                  cy="20"
                  r="16"
                />
                <circle
                  className="canvas-touch-hold-indicator-progress"
                  cx="20"
                  cy="20"
                  r="16"
                  style={{
                    animationDuration: `${TOUCH_MARQUEE_LONG_PRESS_DURATION_MS}ms`,
                    strokeDasharray: `${TOUCH_HOLD_INDICATOR_CIRCUMFERENCE}`,
                    strokeDashoffset: `${TOUCH_HOLD_INDICATOR_CIRCUMFERENCE}`,
                  }}
                />
              </svg>
              <div className="canvas-touch-hold-indicator-core" />
            </div>
          ) : null}
          {anchoredPlacementToolbarStyle ? (
            <CanvasActionToolbar
              actions={[
                {
                  id: "cancel-placement",
                  ariaLabel: t("action.cancelPlacement"),
                  icon: "cancel",
                  onClick: cancelPlacement,
                  tone: "cancel",
                },
                {
                  id: "rotate-placement",
                  ariaLabel: t("action.rotatePlacement"),
                  icon: "rotate",
                  onClick: () => {
                    controller.rotatePlacementClockwise();
                  },
                  tone: "rotate",
                },
                {
                  id: "confirm-placement",
                  ariaLabel: t("action.confirmPlacement"),
                  disabled: !anchoredPlacementPreview?.valid,
                  icon: "confirm",
                  onClick: () => {
                    void controller.confirmPlacementPreview();
                  },
                  tone: "confirm",
                },
              ]}
              className="placement-action-toolbar"
              style={anchoredPlacementToolbarStyle}
            />
          ) : null}
          {anchoredMoveToolbarStyle ? (
            <CanvasActionToolbar
              actions={[
                {
                  id: "cancel-move",
                  ariaLabel: t("action.cancelMove"),
                  icon: "cancel",
                  onClick: cancelMove,
                  tone: "cancel",
                },
                {
                  id: "rotate-move",
                  ariaLabel: t("action.rotateMove"),
                  icon: "rotate",
                  onClick: () => {
                    controller.rotateMoveClockwise();
                  },
                  tone: "rotate",
                },
                {
                  id: "confirm-move",
                  ariaLabel: t("action.confirmMove"),
                  disabled: !anchoredMoveDraft?.valid,
                  icon: "confirm",
                  onClick: () => {
                    void controller.confirmMovePreview();
                  },
                  tone: "confirm",
                },
              ]}
              className="move-action-toolbar"
              style={anchoredMoveToolbarStyle}
            />
          ) : null}
          {anchoredSelectionToolbarStyle ? (
            <CanvasActionToolbar
              actions={[
                {
                  id: "rotate-selection",
                  ariaLabel: t("action.rotateSelection"),
                  icon: "rotate",
                  onClick: () => {
                    void controller.rotateSelectionClockwise();
                  },
                  tone: "rotate",
                },
                {
                  id: "delete-selection",
                  ariaLabel: t("action.deleteSelection"),
                  icon: "delete",
                  onClick: () => {
                    void controller.removeSelection();
                  },
                  tone: "delete",
                },
              ]}
              className="selection-action-toolbar"
              style={anchoredSelectionToolbarStyle}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
});
