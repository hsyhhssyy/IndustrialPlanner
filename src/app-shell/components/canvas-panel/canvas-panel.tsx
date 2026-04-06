import {
  advanceCanvasPointerPanGesture,
  beginCanvasPointerPanGesture,
  cancelCanvasPanelPointerGesture,
  createIdleCanvasPanelPointerGestureState,
  isCanvasPointerPanning,
  type CanvasPanelPointerGestureState,
} from "./canvas-panel-pointer-gesture";
import {
  advanceCanvasPointerTapGesture,
  beginCanvasPointerTapGesture,
  createIdleCanvasPanelPointerTapGestureState,
  POINTER_TAP_CANCEL_DISTANCE_PX,
  removePointerFromCanvasPointerTapGesture,
  shouldDispatchCanvasPointerTap,
  type CanvasPanelPointerTapGestureState,
} from "./canvas-panel-pointer-tap-gesture";
import {
  advanceCanvasTouchPlacementGesture,
  beginCanvasTouchPlacementGesture,
  cancelCanvasTouchPlacementGesture,
  createIdleCanvasPanelTouchPlacementGestureState,
  removePointerFromCanvasTouchPlacementGesture,
  shouldDispatchCanvasTouchTap,
} from "./canvas-panel-touch-placement-gesture";
import type { CanvasPanelTouchPlacementGestureState } from "./canvas-panel-touch-placement-gesture";
import {
  advanceCanvasTouchPanGesture,
  advanceCanvasTouchPinchGesture,
  beginCanvasTouchGesture,
  beginCanvasTouchPanGesture,
  beginCanvasTouchPinchGesture,
  cancelCanvasTouchGesture,
  createIdleCanvasPanelTouchGestureState,
  isCanvasTouchPanning,
  removePointerFromCanvasTouchGesture,
  type CanvasPanelTouchGestureState,
} from "./canvas-panel-touch-gesture";
import { CanvasActionToolbar } from "./canvas-action-toolbar";
import { resolveCanvasPanelTapIntent } from "./canvas-panel-tap-intent";
import { createCanvasPreviewRawInputScheduler } from "./canvas-preview-raw-input-scheduler";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { createTranslator } from "@/i18n/messages";
import { RendererHost } from "@/renderer/host/renderer-host";
import { createLogger } from "@/shared/logging/logger";
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
const TOUCH_SELECTION_TOOLBAR_WIDTH_PX = 120;
const TOUCH_ACTION_TOOLBAR_HEIGHT_PX = 56;
const TOUCH_ACTION_TOOLBAR_GAP_PX = 12;
const logger = createLogger("app.canvas-panel");

type CanvasPanelPointerMoveGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "pointer-move-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    }
  | {
      phase: "pointer-move-dragging";
      pointerId: number;
      last: CanvasPoint;
    };

interface CanvasPanelPointerMoveAdvanceResult {
  nextState: CanvasPanelPointerMoveGestureState;
  previewPoint: CanvasPoint | null;
}

function createIdleCanvasPanelPointerMoveGestureState(): CanvasPanelPointerMoveGestureState {
  return {
    phase: "idle",
  };
}

function beginCanvasPointerMoveGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelPointerMoveGestureState {
  return {
    phase: "pointer-move-pressed",
    pointerId,
    origin: point,
    last: point,
  };
}

function advanceCanvasPointerMoveGesture(
  state: CanvasPanelPointerMoveGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelPointerMoveAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      previewPoint: null,
    };
  }

  if (state.phase === "pointer-move-pressed") {
    const movedDistance = Math.hypot(
      point.x - state.origin.x,
      point.y - state.origin.y,
    );

    if (movedDistance < POINTER_TAP_CANCEL_DISTANCE_PX) {
      return {
        nextState: {
          ...state,
          last: point,
        },
        previewPoint: null,
      };
    }

    return {
      nextState: {
        phase: "pointer-move-dragging",
        pointerId: state.pointerId,
        last: point,
      },
      previewPoint: point,
    };
  }

  return {
    nextState: {
      ...state,
      last: point,
    },
    previewPoint: point,
  };
}

function removePointerFromCanvasPointerMoveGesture(
  state: CanvasPanelPointerMoveGestureState,
  pointerId: number,
): CanvasPanelPointerMoveGestureState {
  if (state.phase === "idle") {
    return state;
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelPointerMoveGestureState()
    : state;
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

function isPointInsideScreenBox(
  point: CanvasPoint,
  screenBox: RenderDerivedScreenBox | null,
): boolean {
  if (!screenBox) {
    return false;
  }

  return (
    point.x >= screenBox.left &&
    point.x <= screenBox.left + screenBox.width &&
    point.y >= screenBox.top &&
    point.y <= screenBox.top + screenBox.height
  );
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

function resolveInteractionModeFromPointerType(
  pointerType: string,
): PlacementInteractionMode {
  return pointerType === "touch" ? "touch" : "pointer";
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
  const editor = controller.editorStore;
  const render = useExternalStore(renderDerivedStore);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const keyStateRef = useRef({ up: false, down: false, left: false, right: false });
  const frameRef = useRef<number | null>(null);
  const touchPointsRef = useRef<Map<number, CanvasPoint>>(new Map());
  const pointerMoveGestureStateRef = useRef<CanvasPanelPointerMoveGestureState>(
    createIdleCanvasPanelPointerMoveGestureState(),
  );
  const touchPlacementGestureStateRef = useRef<CanvasPanelTouchPlacementGestureState>(
    createIdleCanvasPanelTouchPlacementGestureState(),
  );
  const touchTapSuppressedRef = useRef(false);
  const pointerTapGestureStateRef = useRef<CanvasPanelPointerTapGestureState>(
    createIdleCanvasPanelPointerTapGestureState(),
  );
  const [pointerGestureState, setPointerGestureState] = useState<CanvasPanelPointerGestureState>(
    createIdleCanvasPanelPointerGestureState,
  );
  const [touchGestureState, setTouchGestureState] = useState<CanvasPanelTouchGestureState>(
    createIdleCanvasPanelTouchGestureState,
  );
  const [viewportSize, setViewportSize] = useState<CanvasPoint>({
    x: 0,
    y: 0,
  });
  const pointerGestureStateRef = useRef<CanvasPanelPointerGestureState>(pointerGestureState);
  const touchGestureStateRef = useRef<CanvasPanelTouchGestureState>(touchGestureState);
  const previewInputSchedulerRef = useRef<ReturnType<
    typeof createCanvasPreviewRawInputScheduler
  > | null>(null);
  const t = createTranslator(ui.locale);
  const getEditorSession = () => controller.editorStore.getSnapshot().session;
  const anchoredPlacementActive =
    editor.session.placementDefinitionId !== null &&
    editor.session.placementInteractionMode === "touch";
  const anchoredMovePreview =
    editor.session.movePreview?.interactionMode === "touch"
      ? editor.session.movePreview
      : null;
  const anchoredMoveActive = anchoredMovePreview !== null;
  const anchoredPreviewActive = anchoredPlacementActive || anchoredMoveActive;
  const pointerSelectionQuickActionsActive =
    ui.mode === "edit" &&
    editor.session.activeTool === "select" &&
    editor.session.placementDefinitionId === null &&
    editor.session.movePreview === null &&
    editor.session.selection.length > 0 &&
    editor.session.selectionInteractionMode === "pointer";
  const anchoredPlacementPreview =
    editor.session.placementPreview?.interactionMode === "touch"
      ? editor.session.placementPreview
      : null;
  const anchoredPlacementScreenBox = render.anchoredPlacementScreenBox;
  const anchoredMoveScreenBox = render.anchoredMoveScreenBox;
  const anchoredPlacementToolbarStyle = resolveAnchoredToolbarStyle(
    anchoredPlacementScreenBox,
    viewportSize,
    TOUCH_PLACEMENT_TOOLBAR_WIDTH_PX,
  );
  const anchoredMoveToolbarStyle = resolveAnchoredToolbarStyle(
    anchoredMoveScreenBox,
    viewportSize,
    TOUCH_PLACEMENT_TOOLBAR_WIDTH_PX,
  );
  const anchoredSelectionToolbarStyle = resolveAnchoredToolbarStyle(
    render.anchoredSelectionScreenBox,
    viewportSize,
    TOUCH_SELECTION_TOOLBAR_WIDTH_PX,
  );

  const dispatchPreviewFromScreenPoint = useEffectEvent(
    (screenPoint: CanvasPoint) => {
      const session = getEditorSession();

      if (session.movePreview) {
        controller.updateMovePreviewFromScreenPoint(screenPoint);
        return;
      }

      if (!session.placementDefinitionId) {
        return;
      }

      if (placementPreviewProfiler) {
        placementPreviewProfiler.measureStage("canvas.pointerMoveDispatch", () => {
          controller.updatePlacementPreviewFromScreenPoint(screenPoint);
        });
        return;
      }

      controller.updatePlacementPreviewFromScreenPoint(screenPoint);
    },
  );

  const schedulePreviewFromScreenPoint = (screenPoint: CanvasPoint) => {
    if (!previewInputSchedulerRef.current) {
      dispatchPreviewFromScreenPoint(screenPoint);
      return;
    }

    previewInputSchedulerRef.current.schedule(screenPoint);
  };

  const cancelScheduledPreview = () => {
    previewInputSchedulerRef.current?.cancel();
  };

  const cancelPlacement = () => {
    cancelScheduledPreview();
    controller.cancelPlacement();
  };

  const cancelMove = () => {
    cancelScheduledPreview();
    controller.cancelMove();
  };

  const clearTransientPreview = useEffectEvent(() => {
    if (getEditorSession().movePreview) {
      controller.cancelMove();
      return;
    }

    controller.clearPlacementPreview();
  });

  const beginTouchAnchoredPreviewOrPanGesture = (
    pointerId: number,
    point: CanvasPoint,
  ) => {
    const activeScreenBox = anchoredMoveActive
      ? anchoredMoveScreenBox
      : anchoredPlacementScreenBox;

    if (isPointInsideScreenBox(point, activeScreenBox)) {
      touchPlacementGestureStateRef.current = beginCanvasTouchPlacementGesture(
        pointerId,
        point,
      );
      updateTouchGestureState(createIdleCanvasPanelTouchGestureState());
      return;
    }

    touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
    updateTouchGestureState(beginCanvasTouchPanGesture(pointerId, point));
  };

  const beginTouchPinchFromTrackedPoints = () => {
    const [firstPointer, secondPointer] = Array.from(
      touchPointsRef.current.entries(),
    );

    touchTapSuppressedRef.current = true;
    touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
    cancelScheduledPreview();

    if (!firstPointer || !secondPointer) {
      updateTouchGestureState(createIdleCanvasPanelTouchGestureState());
      return;
    }

    updateTouchGestureState(
      beginCanvasTouchPinchGesture(
        firstPointer[0],
        firstPointer[1],
        secondPointer[0],
        secondPointer[1],
      ),
    );
  };

  const updatePointerGestureState = (nextState: CanvasPanelPointerGestureState) => {
    pointerGestureStateRef.current = nextState;
    setPointerGestureState(nextState);
  };

  const updateTouchGestureState = (nextState: CanvasPanelTouchGestureState) => {
    touchGestureStateRef.current = nextState;
    setTouchGestureState(nextState);
  };

  const resetTouchGestureState = () => {
    const viewportElement = viewportRef.current;

    for (const pointerId of touchPointsRef.current.keys()) {
      if (viewportElement?.hasPointerCapture(pointerId)) {
        viewportElement.releasePointerCapture(pointerId);
      }
    }

    touchPointsRef.current.clear();
    touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
    touchTapSuppressedRef.current = false;
    updateTouchGestureState(cancelCanvasTouchGesture());
    cancelScheduledPreview();
    clearTransientPreview();
  };

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

  const resetPointerGestureState = () => {
    const currentState = pointerGestureStateRef.current;
    const viewportElement = viewportRef.current;

    if (
      currentState.phase !== "idle" &&
      viewportElement?.hasPointerCapture(currentState.pointerId)
    ) {
      viewportElement.releasePointerCapture(currentState.pointerId);
    }

    const pointerMoveState = pointerMoveGestureStateRef.current;

    if (
      pointerMoveState.phase !== "idle" &&
      viewportElement?.hasPointerCapture(pointerMoveState.pointerId)
    ) {
      viewportElement.releasePointerCapture(pointerMoveState.pointerId);
    }

    updatePointerGestureState(cancelCanvasPanelPointerGesture());
    pointerMoveGestureStateRef.current = createIdleCanvasPanelPointerMoveGestureState();
    pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();
    cancelScheduledPreview();
    clearTransientPreview();
  };

  useEffect(() => {
    previewInputSchedulerRef.current = createCanvasPreviewRawInputScheduler({
      dispatch: dispatchPreviewFromScreenPoint,
    });

    return () => {
      previewInputSchedulerRef.current?.dispose();
      previewInputSchedulerRef.current = null;
    };
  }, [controller, placementPreviewProfiler]);

  useEffect(() => {
    if (
      !anchoredPlacementActive ||
      editor.session.placementPreview !== null ||
      viewportSize.x <= 0 ||
      viewportSize.y <= 0
    ) {
      return;
    }

    controller.centerPlacementPreview();
  }, [
    anchoredPlacementActive,
    controller,
    editor.session.placementPreview,
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
      const currentState = pointerGestureStateRef.current;
      const viewportElement = viewportRef.current;

      if (
        currentState.phase !== "idle" &&
        viewportElement?.hasPointerCapture(currentState.pointerId)
      ) {
        viewportElement.releasePointerCapture(currentState.pointerId);
      }

      pointerGestureStateRef.current = cancelCanvasPanelPointerGesture();
      pointerMoveGestureStateRef.current = createIdleCanvasPanelPointerMoveGestureState();
      setPointerGestureState(pointerGestureStateRef.current);
      pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();

      for (const pointerId of touchPointsRef.current.keys()) {
        if (viewportElement?.hasPointerCapture(pointerId)) {
          viewportElement.releasePointerCapture(pointerId);
        }
      }

      touchPointsRef.current.clear();
      touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
      touchTapSuppressedRef.current = false;
      touchGestureStateRef.current = cancelCanvasTouchGesture();
      setTouchGestureState(touchGestureStateRef.current);
      stopKeyboardPanLoop();
      clearTransientPreview();
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
  }, [controller]);

  const dispatchCanvasTap = async (
    screenPoint: CanvasPoint,
    interactionMode: PlacementInteractionMode,
  ) => {
    if (getEditorSession().movePreview) {
      return;
    }

    const target = controller.getCanvasInteractionTarget(screenPoint);
    const intent = resolveCanvasPanelTapIntent({
      mode: ui.mode,
      activeTool: editor.session.activeTool,
      placementDefinitionId: editor.session.placementDefinitionId,
      placementInteractionMode: editor.session.placementInteractionMode,
      target,
    });

    if (editor.session.placementDefinitionId) {
      logger.info("Resolved canvas tap intent during placement.", {
        screenPoint,
        mode: ui.mode,
        activeTool: editor.session.activeTool,
        placementDefinitionId: editor.session.placementDefinitionId,
        placementInteractionMode: editor.session.placementInteractionMode,
        target,
        intent,
      });
    }

    switch (intent.kind) {
      case "select-edit-entity":
        await controller.selectEntity(intent.entityId, interactionMode);
        return;
      case "clear-edit-selection":
        await controller.clearSelection();
        return;
      case "activate-link-target":
        await controller.activateLinkTarget(intent.entityId);
        return;
      case "commit-placement":
        await controller.commitPlacementAtScreenPoint(screenPoint);
        return;
      case "select-simulation-entity":
        await controller.selectSimulationEntity(intent.entityId);
        return;
      case "noop":
        return;
    }
  };

  const handleViewportPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    stageRef.current?.focus();

    if (event.pointerType === "touch") {
      event.preventDefault();
      const point = toViewportPoint(event.clientX, event.clientY);
      const target = controller.getCanvasInteractionTarget(point);
      touchPointsRef.current.set(event.pointerId, point);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (touchPointsRef.current.size >= 2) {
        beginTouchPinchFromTrackedPoints();
        return;
      }

      if (anchoredPreviewActive) {
        beginTouchAnchoredPreviewOrPanGesture(event.pointerId, point);
        return;
      }

      if (
        ui.mode === "edit" &&
        editor.session.activeTool === "select" &&
        editor.session.placementDefinitionId === null &&
        editor.session.movePreview === null &&
        editor.session.selection.length === 1 &&
        target.kind === "entity" &&
        target.selected
      ) {
        touchPlacementGestureStateRef.current = beginCanvasTouchPlacementGesture(
          event.pointerId,
          point,
        );
        updateTouchGestureState(createIdleCanvasPanelTouchGestureState());
        return;
      }

      updateTouchGestureState(
        beginCanvasTouchGesture(
          event.pointerId,
          point,
          target,
        ),
      );

      controller.clearPlacementPreview();
      return;
    }

    if (event.button === 0) {
      const point = toViewportPoint(event.clientX, event.clientY);
      const target = controller.getCanvasInteractionTarget(point);

      pointerTapGestureStateRef.current = beginCanvasPointerTapGesture(
        event.pointerId,
        point,
      );

      if (
        ui.mode === "edit" &&
        editor.session.activeTool === "select" &&
        editor.session.placementDefinitionId === null &&
        editor.session.movePreview === null &&
        editor.session.selection.length === 1 &&
        target.kind === "entity" &&
        target.selected
      ) {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerMoveGestureStateRef.current = beginCanvasPointerMoveGesture(
          event.pointerId,
          point,
        );
      }

      return;
    }

    if (
      event.button === 2 &&
      (editor.session.placementDefinitionId || editor.session.movePreview)
    ) {
      event.preventDefault();
      pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();
      pointerMoveGestureStateRef.current = createIdleCanvasPanelPointerMoveGestureState();

      if (editor.session.movePreview) {
        cancelMove();
      } else {
        cancelPlacement();
      }
      return;
    }

    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    controller.clearPlacementPreview();
    updatePointerGestureState(
      beginCanvasPointerPanGesture(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      }),
    );
  };

  const handleViewportPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      const point = toViewportPoint(event.clientX, event.clientY);
      touchPointsRef.current.set(event.pointerId, point);

      if (
        touchPlacementGestureStateRef.current.phase !== "idle"
      ) {
        if (touchPointsRef.current.size !== 1) {
          return;
        }

        const result = advanceCanvasTouchPlacementGesture(
          touchPlacementGestureStateRef.current,
          event.pointerId,
          point,
        );

        touchPlacementGestureStateRef.current = result.nextState;

        if (result.previewPoint) {
          touchTapSuppressedRef.current = true;

          if (
            !getEditorSession().movePreview &&
            getEditorSession().placementDefinitionId === null
          ) {
            const didBeginMove = controller.beginMoveSelection("touch");

            if (!didBeginMove) {
              touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
              return;
            }
          }

          schedulePreviewFromScreenPoint(result.previewPoint);
        }

        return;
      }

      if (touchGestureStateRef.current.phase === "touch-pinching") {
        const result = advanceCanvasTouchPinchGesture(
          touchGestureStateRef.current,
          event.pointerId,
          point,
        );

        if (result.nextState !== touchGestureStateRef.current) {
          updateTouchGestureState(result.nextState);
        }

        if (result.scaleFactor && result.zoomAnchor) {
          touchTapSuppressedRef.current = true;
          controller.zoomCanvasAt(result.zoomAnchor, result.scaleFactor);
        }

        if (result.midpointDelta) {
          const distance = Math.hypot(result.midpointDelta.x, result.midpointDelta.y);

          if (distance > 0) {
            touchTapSuppressedRef.current = true;
            controller.panCanvasBy(result.midpointDelta);
          }
        }

        return;
      }

      const result = advanceCanvasTouchPanGesture(
        touchGestureStateRef.current,
        event.pointerId,
        point,
      );

      if (result.nextState !== touchGestureStateRef.current) {
        updateTouchGestureState(result.nextState);
      }

      if (result.screenDelta) {
        touchTapSuppressedRef.current = true;
        controller.panCanvasBy(result.screenDelta);
      }

      return;
    }

    pointerTapGestureStateRef.current = advanceCanvasPointerTapGesture(
      pointerTapGestureStateRef.current,
      event.pointerId,
      toViewportPoint(event.clientX, event.clientY),
    );

    if (pointerMoveGestureStateRef.current.phase !== "idle") {
      const result = advanceCanvasPointerMoveGesture(
        pointerMoveGestureStateRef.current,
        event.pointerId,
        toViewportPoint(event.clientX, event.clientY),
      );

      pointerMoveGestureStateRef.current = result.nextState;

      if (result.previewPoint) {
        pointerTapGestureStateRef.current =
          createIdleCanvasPanelPointerTapGestureState();

        if (!getEditorSession().movePreview) {
          const didBeginMove = controller.beginMoveSelection("pointer");

          if (!didBeginMove) {
            pointerMoveGestureStateRef.current =
              createIdleCanvasPanelPointerMoveGestureState();
            return;
          }
        }

        controller.updateMovePreviewFromScreenPoint(result.previewPoint);
      }

      return;
    }

    if (
      pointerGestureStateRef.current.phase === "idle" &&
      event.buttons === 0
    ) {
      if (
        editor.session.placementDefinitionId &&
        editor.session.placementInteractionMode === "pointer"
      ) {
        schedulePreviewFromScreenPoint(toViewportPoint(event.clientX, event.clientY));
      }
      return;
    }

    const result = advanceCanvasPointerPanGesture(
      pointerGestureStateRef.current,
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );

    if (result.nextState !== pointerGestureStateRef.current) {
      updatePointerGestureState(result.nextState);
    }

    if (result.screenDelta) {
      controller.panCanvasBy(result.screenDelta);
    }
  };

  const handleViewportPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType === "touch" ||
      pointerGestureStateRef.current.phase !== "idle" ||
      event.buttons !== 0
    ) {
      return;
    }

    if (
      editor.session.placementDefinitionId &&
      editor.session.placementInteractionMode === "pointer"
    ) {
      schedulePreviewFromScreenPoint(toViewportPoint(event.clientX, event.clientY));
    }
  };

  const handleViewportPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.buttons !== 0) {
      pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
        pointerTapGestureStateRef.current,
        event.pointerId,
      );
    }

    if (
      !anchoredPreviewActive &&
      editor.session.placementDefinitionId &&
      editor.session.placementInteractionMode === "pointer"
    ) {
      cancelScheduledPreview();
      controller.clearPlacementPreview();
    }
  };

  const handleViewportPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      const shouldHandleTap = shouldDispatchCanvasTouchTap({
        activeTouchCount: touchPointsRef.current.size,
        anchoredPreviewActive,
        placementGestureState: touchPlacementGestureStateRef.current,
        tapSuppressed: touchTapSuppressedRef.current,
        touchGestureState: touchGestureStateRef.current,
      });

      if (shouldHandleTap) {
        void dispatchCanvasTap(
          toViewportPoint(event.clientX, event.clientY),
          resolveInteractionModeFromPointerType(event.pointerType),
        );
      }

      touchPointsRef.current.delete(event.pointerId);
      touchPlacementGestureStateRef.current = removePointerFromCanvasTouchPlacementGesture(
        touchPlacementGestureStateRef.current,
        event.pointerId,
      );

      if (touchPointsRef.current.size === 0) {
        touchTapSuppressedRef.current = false;
      }

      updateTouchGestureState(
        removePointerFromCanvasTouchGesture(
          touchGestureStateRef.current,
          event.pointerId,
        ),
      );
      return;
    }

    if (event.button === 0) {
      if (pointerMoveGestureStateRef.current.phase === "pointer-move-dragging") {
        pointerMoveGestureStateRef.current = removePointerFromCanvasPointerMoveGesture(
          pointerMoveGestureStateRef.current,
          event.pointerId,
        );
        void controller.commitMoveAtScreenPoint(
          toViewportPoint(event.clientX, event.clientY),
        );
        return;
      }

      const shouldDispatchTap = shouldDispatchCanvasPointerTap(
        pointerTapGestureStateRef.current,
        event.pointerId,
      );

      if (shouldDispatchTap) {
        void dispatchCanvasTap(
          toViewportPoint(event.clientX, event.clientY),
          resolveInteractionModeFromPointerType(event.pointerType),
        );
      } else if (
        editor.session.placementDefinitionId &&
        editor.session.placementInteractionMode === "pointer"
      ) {
        logger.info("Suppressed precise-pointer tap before placement dispatch.", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          activeTool: editor.session.activeTool,
          placementDefinitionId: editor.session.placementDefinitionId,
          placementInteractionMode: editor.session.placementInteractionMode,
          tapGestureState: pointerTapGestureStateRef.current,
        });
      }

      pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
        pointerTapGestureStateRef.current,
        event.pointerId,
      );
      pointerMoveGestureStateRef.current = removePointerFromCanvasPointerMoveGesture(
        pointerMoveGestureStateRef.current,
        event.pointerId,
      );
      return;
    }

    if (
      pointerGestureStateRef.current.phase !== "idle" &&
      pointerGestureStateRef.current.pointerId === event.pointerId
    ) {
      resetPointerGestureState();
    }
  };

  const handleViewportLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      touchPointsRef.current.delete(event.pointerId);
      touchPlacementGestureStateRef.current = removePointerFromCanvasTouchPlacementGesture(
        touchPlacementGestureStateRef.current,
        event.pointerId,
      );

      if (touchPointsRef.current.size === 0) {
        touchTapSuppressedRef.current = false;
      }

      const nextTouchState = removePointerFromCanvasTouchGesture(
        touchGestureStateRef.current,
        event.pointerId,
      );

      if (nextTouchState !== touchGestureStateRef.current) {
        updateTouchGestureState(nextTouchState);
      }

      return;
    }

    pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
      pointerTapGestureStateRef.current,
      event.pointerId,
    );
    pointerMoveGestureStateRef.current = removePointerFromCanvasPointerMoveGesture(
      pointerMoveGestureStateRef.current,
      event.pointerId,
    );
    resetPointerGestureState();
  };

  const handleViewportPointerCancel = () => {
    resetPointerGestureState();
    resetTouchGestureState();
  };

  const handleViewportWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (pointerGestureStateRef.current.phase !== "idle") {
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
    if (!editor.session.placementDefinitionId && !editor.session.movePreview) {
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

        if (editor.session.movePreview) {
          event.preventDefault();
          controller.rotateMoveClockwise();
          return;
        }

        if (editor.session.placementDefinitionId) {
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

          resetPointerGestureState();
          resetTouchGestureState();
          stopKeyboardPanLoop();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        ref={stageRef}
        tabIndex={0}
      >
        <div
          className={isCanvasPointerPanning(pointerGestureState) || isCanvasTouchPanning(touchGestureState)
            ? "canvas-viewport-surface is-panning"
            : "canvas-viewport-surface"}
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
          {anchoredMoveToolbarStyle ? (
            <CanvasActionToolbar
              actions={[
                {
                  id: "cancel-move",
                  ariaLabel: t("action.cancelPlacement"),
                  icon: "cancel",
                  onClick: cancelMove,
                  tone: "cancel",
                },
                {
                  id: "rotate-move",
                  ariaLabel: t("action.rotatePlacement"),
                  icon: "rotate",
                  onClick: () => {
                    controller.rotateMoveClockwise();
                  },
                  tone: "rotate",
                },
                {
                  id: "confirm-move",
                  ariaLabel: t("action.confirmMove"),
                  disabled: !anchoredMovePreview?.valid,
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
