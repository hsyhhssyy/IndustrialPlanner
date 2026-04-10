import {
  advanceCanvasPointerMoveGesture,
  beginCanvasPointerMoveGesture,
  cancelCanvasPointerMoveGesture,
  createIdleCanvasPanelPointerMoveGestureState,
  removePointerFromCanvasPointerMoveGesture,
  type CanvasPanelPointerMoveGestureState,
} from "./canvas-panel-pointer-move-gesture";
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
  removePointerFromCanvasPointerTapGesture,
  shouldDispatchCanvasPointerTap,
  type CanvasPanelPointerTapGestureState,
} from "./canvas-panel-pointer-tap-gesture";
import {
  advanceCanvasTouchDragGesture,
  beginCanvasTouchDragGesture,
  cancelCanvasTouchDragGesture,
  createIdleCanvasPanelTouchDragGestureState,
  removePointerFromCanvasTouchDragGesture,
  type CanvasPanelTouchDragGestureState,
} from "./canvas-panel-touch-drag-gesture";
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
import {
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
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
const TOUCH_MOVE_TOOLBAR_WIDTH_PX = 176;
const TOUCH_SELECTION_TOOLBAR_WIDTH_PX = 120;
const TOUCH_ACTION_TOOLBAR_HEIGHT_PX = 56;
const TOUCH_ACTION_TOOLBAR_GAP_PX = 12;
const logger = createLogger("app.canvas-panel");

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
  const touchMoveGestureStateRef = useRef<CanvasPanelTouchDragGestureState>(
    createIdleCanvasPanelTouchDragGestureState(),
  );
  const touchPlacementGestureStateRef = useRef<CanvasPanelTouchPlacementGestureState>(
    createIdleCanvasPanelTouchPlacementGestureState(),
  );
  const touchTapSuppressedRef = useRef(false);
  const pointerTapGestureStateRef = useRef<CanvasPanelPointerTapGestureState>(
    createIdleCanvasPanelPointerTapGestureState(),
  );
  const pointerMoveGestureStateRef = useRef<CanvasPanelPointerMoveGestureState>(
    createIdleCanvasPanelPointerMoveGestureState(),
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
  const placementMode = isPlacementInteractionMode(editor.session.currentMode)
    ? editor.session.currentMode
    : null;
  const moveMode = isMoveInteractionMode(editor.session.currentMode)
    ? editor.session.currentMode
    : null;
  const anchoredPlacementActive =
    placementMode !== null && placementMode.inputMode === "touch";
  const pointerSelectionQuickActionsActive =
    ui.phase === "edit" &&
    editor.session.currentMode.key === "select" &&
    editor.session.selection.length > 0 &&
    editor.session.selectionInputMode === "pointer";
  const anchoredPlacementPreview =
    editor.session.placementPreview?.interactionMode === "touch"
      ? editor.session.placementPreview
      : null;
  const anchoredMoveDraft =
    editor.session.moveDraft?.interactionMode === "touch"
      ? editor.session.moveDraft
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

  const getSelectedEntityIdForMove = (): string | null => {
    const selection = controller.editorStore.getSnapshot().session.selection;

    return selection.length === 1 ? selection[0] ?? null : null;
  };

  const isSelectedEntityMoveCandidate = (screenPoint: CanvasPoint) => {
    if (
      ui.phase !== "edit" ||
      editor.session.currentMode.key !== "select" ||
      editor.session.selection.length !== 1
    ) {
      return null;
    }

    const target = controller.getCanvasInteractionTarget(screenPoint);

    return target.kind === "entity" && target.selected
      ? target.entityId
      : null;
  };

  const shouldBeginTouchMoveGesture = (screenPoint: CanvasPoint): boolean => {
    if (moveMode?.inputMode === "touch") {
      return isPointInsideScreenBox(screenPoint, render.anchoredMoveScreenBox);
    }

    return isSelectedEntityMoveCandidate(screenPoint) !== null;
  };

  const clearPointerMoveGestureState = (pointerId?: number) => {
    const currentState = pointerMoveGestureStateRef.current;
    const viewportElement = viewportRef.current;

    if (
      currentState.phase !== "idle" &&
      (pointerId === undefined || currentState.pointerId === pointerId) &&
      viewportElement?.hasPointerCapture(currentState.pointerId)
    ) {
      viewportElement.releasePointerCapture(currentState.pointerId);
    }

    if (pointerId === undefined || currentState.phase === "idle") {
      pointerMoveGestureStateRef.current = cancelCanvasPointerMoveGesture();
      return;
    }

    pointerMoveGestureStateRef.current = removePointerFromCanvasPointerMoveGesture(
      currentState,
      pointerId,
    );
  };

  const clearTouchMoveGestureState = (pointerId?: number) => {
    const currentState = touchMoveGestureStateRef.current;

    touchMoveGestureStateRef.current =
      pointerId === undefined
        ? cancelCanvasTouchDragGesture()
        : removePointerFromCanvasTouchDragGesture(currentState, pointerId);
  };

  const handleTouchMoveDraftAtScreenPoint = (
    previousState: CanvasPanelTouchDragGestureState,
    dragPoint: CanvasPoint,
    didStartDragging: boolean,
  ) => {
    if (didStartDragging && previousState.phase !== "idle") {
      const entityId = getSelectedEntityIdForMove();

      if (!entityId) {
        return;
      }

      controller.beginMoveFromScreenPoint(entityId, previousState.origin, "touch");
    }

    if (
      isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode)
    ) {
      controller.updateMoveDraftFromScreenPoint(dragPoint);
    }
  };

  const handlePointerMoveDraftAtScreenPoint = (
    previousState: CanvasPanelPointerMoveGestureState,
    dragPoint: CanvasPoint,
    didStartDragging: boolean,
  ) => {
    if (
      didStartDragging &&
      previousState.phase !== "idle"
    ) {
      controller.beginMoveFromScreenPoint(
        previousState.entityId,
        previousState.origin,
        "pointer",
      );
    }

    if (
      isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode)
    ) {
      controller.updateMoveDraftFromScreenPoint(dragPoint);
    }
  };

  const beginTouchPlacementOrPanGesture = (
    pointerId: number,
    point: CanvasPoint,
  ) => {
    if (isPointInsideScreenBox(point, anchoredPlacementScreenBox)) {
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
    clearTouchMoveGestureState();
    touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
    cancelScheduledPlacementPreview();

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
    clearTouchMoveGestureState();
    touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
    touchTapSuppressedRef.current = false;
    updateTouchGestureState(cancelCanvasTouchGesture());
    cancelScheduledPlacementPreview();
    controller.clearPlacementPreview();

    if (isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode)) {
      controller.cancelMove();
    }
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

    clearPointerMoveGestureState();
    updatePointerGestureState(cancelCanvasPanelPointerGesture());
    pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();
    cancelScheduledPlacementPreview();
    controller.clearPlacementPreview();

    if (isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode)) {
      controller.cancelMove();
    }
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

  useEffect(() => controller.subscribeCanvasKeyboardFocusRequests(() => {
    stageRef.current?.focus();
  }), [controller]);

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
      clearPointerMoveGestureState();
      setPointerGestureState(pointerGestureStateRef.current);
      pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();

      for (const pointerId of touchPointsRef.current.keys()) {
        if (viewportElement?.hasPointerCapture(pointerId)) {
          viewportElement.releasePointerCapture(pointerId);
        }
      }

      touchPointsRef.current.clear();
      clearTouchMoveGestureState();
      touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
      touchTapSuppressedRef.current = false;
      touchGestureStateRef.current = cancelCanvasTouchGesture();
      setTouchGestureState(touchGestureStateRef.current);
      stopKeyboardPanLoop();
      controller.clearPlacementPreview();

      if (isMoveInteractionMode(controller.editorStore.getSnapshot().session.currentMode)) {
        controller.cancelMove();
      }
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
    const target = controller.getCanvasInteractionTarget(screenPoint);
    const intent = resolveCanvasPanelTapIntent({
      phase: ui.phase,
      currentMode: editor.session.currentMode,
      target,
    });

    if (placementMode) {
      logger.info("Resolved canvas tap intent during placement.", {
        screenPoint,
        phase: ui.phase,
        currentMode: editor.session.currentMode,
        displayTool: editor.session.displayTool,
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
      touchPointsRef.current.set(event.pointerId, point);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (touchPointsRef.current.size >= 2) {
        beginTouchPinchFromTrackedPoints();
        return;
      }

      if (anchoredPlacementActive) {
        beginTouchPlacementOrPanGesture(event.pointerId, point);
        return;
      }

      if (shouldBeginTouchMoveGesture(point)) {
        clearTouchMoveGestureState();
        touchMoveGestureStateRef.current = beginCanvasTouchDragGesture(
          event.pointerId,
          point,
        );
        updateTouchGestureState(createIdleCanvasPanelTouchGestureState());
        controller.clearPlacementPreview();
        return;
      }

      updateTouchGestureState(
        beginCanvasTouchGesture(
          event.pointerId,
          point,
          controller.getCanvasInteractionTarget(point),
        ),
      );

      controller.clearPlacementPreview();
      return;
    }

    if (event.button === 0) {
      const point = toViewportPoint(event.clientX, event.clientY);
      pointerTapGestureStateRef.current = beginCanvasPointerTapGesture(
        event.pointerId,
        point,
      );

      const moveEntityId = isSelectedEntityMoveCandidate(point);

      if (moveEntityId) {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerMoveGestureStateRef.current = beginCanvasPointerMoveGesture(
          event.pointerId,
          moveEntityId,
          point,
        );
      } else {
        clearPointerMoveGestureState();
      }

      return;
    }

    if (event.button === 2 && (placementMode || moveMode)) {
      event.preventDefault();
      pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();
      clearPointerMoveGestureState();

      if (moveMode) {
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

      if (touchMoveGestureStateRef.current.phase !== "idle") {
        if (touchPointsRef.current.size !== 1) {
          return;
        }

        const previousState = touchMoveGestureStateRef.current;
        const result = advanceCanvasTouchDragGesture(
          previousState,
          event.pointerId,
          point,
        );

        touchMoveGestureStateRef.current = result.nextState;

        if (result.dragPoint) {
          touchTapSuppressedRef.current = true;
          handleTouchMoveDraftAtScreenPoint(
            previousState,
            result.dragPoint,
            result.didStartDragging,
          );
        }

        return;
      }

      if (
        anchoredPlacementActive &&
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
          schedulePlacementPreviewFromScreenPoint(result.previewPoint);
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

    const point = toViewportPoint(event.clientX, event.clientY);

    pointerTapGestureStateRef.current = advanceCanvasPointerTapGesture(
      pointerTapGestureStateRef.current,
      event.pointerId,
      point,
    );

    if (pointerMoveGestureStateRef.current.phase !== "idle") {
      const previousState = pointerMoveGestureStateRef.current;
      const result = advanceCanvasPointerMoveGesture(
        previousState,
        event.pointerId,
        point,
      );

      pointerMoveGestureStateRef.current = result.nextState;

      if (result.dragPoint) {
        handlePointerMoveDraftAtScreenPoint(
          previousState,
          result.dragPoint,
          result.didStartDragging,
        );
      }

      return;
    }

    if (
      pointerGestureStateRef.current.phase === "idle" &&
      event.buttons === 0
    ) {
      schedulePlacementPreviewFromScreenPoint(point);
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

    schedulePlacementPreviewFromScreenPoint(
      toViewportPoint(event.clientX, event.clientY),
    );
  };

  const handleViewportPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.buttons !== 0) {
      pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
        pointerTapGestureStateRef.current,
        event.pointerId,
      );
    }

    if (!anchoredPlacementActive) {
      cancelScheduledPlacementPreview();
      controller.clearPlacementPreview();
    }
  };

  const handleViewportPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      const shouldHandleTap = shouldDispatchCanvasTouchTap({
        activeTouchCount: touchPointsRef.current.size,
        anchoredPlacementActive,
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
      clearTouchMoveGestureState(event.pointerId);
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
      const pointerMoveState = pointerMoveGestureStateRef.current;
      const didDragMove =
        pointerMoveState.phase === "move-dragging" &&
        pointerMoveState.pointerId === event.pointerId;
      clearPointerMoveGestureState(event.pointerId);

      if (didDragMove) {
        const currentMoveDraft = controller.editorStore.getSnapshot().session.moveDraft;

        if (currentMoveDraft?.valid) {
          void controller.confirmMovePreview();
        } else {
          controller.cancelMove();
        }

        pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
          pointerTapGestureStateRef.current,
          event.pointerId,
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
        placementMode &&
        placementMode.inputMode === "pointer"
      ) {
        logger.info("Suppressed precise-pointer tap before placement dispatch.", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          currentMode: editor.session.currentMode,
          displayTool: editor.session.displayTool,
          tapGestureState: pointerTapGestureStateRef.current,
        });
      }

      pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
        pointerTapGestureStateRef.current,
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
      clearTouchMoveGestureState(event.pointerId);
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

    const hadPointerPan =
      pointerGestureStateRef.current.phase !== "idle" &&
      pointerGestureStateRef.current.pointerId === event.pointerId;
    const pointerMoveState = pointerMoveGestureStateRef.current;
    const hadPointerMove =
      pointerMoveState.phase !== "idle" &&
      pointerMoveState.pointerId === event.pointerId;

    pointerTapGestureStateRef.current = removePointerFromCanvasPointerTapGesture(
      pointerTapGestureStateRef.current,
      event.pointerId,
    );
    const didLoseDraggingMove = pointerMoveState.phase === "move-dragging";
    clearPointerMoveGestureState(event.pointerId);

    if (!hadPointerPan && !hadPointerMove) {
      return;
    }

    if (didLoseDraggingMove) {
      controller.cancelMove();
    }

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
