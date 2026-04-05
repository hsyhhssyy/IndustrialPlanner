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
  beginCanvasTouchPinchGesture,
  cancelCanvasTouchGesture,
  createIdleCanvasPanelTouchGestureState,
  isCanvasTouchPanning,
  removePointerFromCanvasTouchGesture,
  type CanvasPanelTouchGestureState,
} from "./canvas-panel-touch-gesture";
import { resolveCanvasPanelTapIntent } from "./canvas-panel-tap-intent";
import { createCanvasPreviewRawInputScheduler } from "./canvas-preview-raw-input-scheduler";
import { WorkbenchIcon } from "@/app-shell/components/workbench-icons";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { createTranslator } from "@/i18n/messages";
import { RendererHost } from "@/renderer/host/renderer-host";
import { createLogger } from "@/shared/logging/logger";
import { observer } from "@/shared/mobx";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import type { RenderDerivedState } from "@/workbench/workspace-derived-state";
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
const TOUCH_PLACEMENT_TOOLBAR_HEIGHT_PX = 56;
const TOUCH_PLACEMENT_TOOLBAR_GAP_PX = 12;
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
  const anchoredPlacementActive =
    editor.session.placementDefinitionId !== null &&
    editor.session.placementStrategy === "anchored-confirm";
  const anchoredPlacementPreview =
    editor.session.placementPreview?.strategy === "anchored-confirm"
      ? editor.session.placementPreview
      : null;
  const anchoredPlacementScreenBox = render.anchoredPlacementScreenBox;
  const anchoredPlacementToolbarStyle = anchoredPlacementScreenBox
    ? {
        left: `${clampToRange(
          anchoredPlacementScreenBox.left +
            anchoredPlacementScreenBox.width / 2,
          12 + TOUCH_PLACEMENT_TOOLBAR_WIDTH_PX / 2,
          viewportSize.x - TOUCH_PLACEMENT_TOOLBAR_WIDTH_PX / 2 - 12,
        )}px`,
        top: `${clampToRange(
          anchoredPlacementScreenBox.top -
            TOUCH_PLACEMENT_TOOLBAR_HEIGHT_PX -
            TOUCH_PLACEMENT_TOOLBAR_GAP_PX,
          12,
          viewportSize.y - TOUCH_PLACEMENT_TOOLBAR_HEIGHT_PX - 12,
        )}px`,
        transform: "translateX(-50%)",
      }
    : null;

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
    cancelScheduledPlacementPreview();
    controller.clearPlacementPreview();
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

    updatePointerGestureState(cancelCanvasPanelPointerGesture());
    pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();
    cancelScheduledPlacementPreview();
    controller.clearPlacementPreview();
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
      controller.clearPlacementPreview();
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

  const dispatchCanvasTap = async (screenPoint: CanvasPoint) => {
    const target = controller.getCanvasInteractionTarget(screenPoint);
    const intent = resolveCanvasPanelTapIntent({
      mode: ui.mode,
      activeTool: editor.session.activeTool,
      placementDefinitionId: editor.session.placementDefinitionId,
      placementStrategy: editor.session.placementStrategy,
      target,
    });

    if (editor.session.placementDefinitionId) {
      logger.info("Resolved canvas tap intent during placement.", {
        screenPoint,
        mode: ui.mode,
        activeTool: editor.session.activeTool,
        placementDefinitionId: editor.session.placementDefinitionId,
        placementStrategy: editor.session.placementStrategy,
        target,
        intent,
      });
    }

    switch (intent.kind) {
      case "select-edit-entity":
        await controller.selectEntity(intent.entityId);
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

      if (anchoredPlacementActive) {
        if (touchPointsRef.current.size === 1) {
          touchPlacementGestureStateRef.current = beginCanvasTouchPlacementGesture(
            event.pointerId,
            point,
          );
        } else {
          touchTapSuppressedRef.current = true;
          touchPlacementGestureStateRef.current = cancelCanvasTouchPlacementGesture();
        }

        updateTouchGestureState(createIdleCanvasPanelTouchGestureState());
        return;
      }

      if (touchPointsRef.current.size >= 2) {
        touchTapSuppressedRef.current = true;
        const [firstPointer, secondPointer] = Array.from(
          touchPointsRef.current.entries(),
        );

        if (firstPointer && secondPointer) {
          updateTouchGestureState(
            beginCanvasTouchPinchGesture(
              firstPointer[0],
              firstPointer[1],
              secondPointer[0],
              secondPointer[1],
            ),
          );
        }
      } else {
        updateTouchGestureState(
          beginCanvasTouchGesture(
            event.pointerId,
            point,
            controller.getCanvasInteractionTarget(point),
          ),
        );
      }

      controller.clearPlacementPreview();
      return;
    }

    if (event.button === 0) {
      pointerTapGestureStateRef.current = beginCanvasPointerTapGesture(
        event.pointerId,
        toViewportPoint(event.clientX, event.clientY),
      );
      return;
    }

    if (event.button === 2 && editor.session.placementDefinitionId) {
      event.preventDefault();
      pointerTapGestureStateRef.current = createIdleCanvasPanelPointerTapGestureState();
      cancelPlacement();
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

      if (anchoredPlacementActive) {
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

    pointerTapGestureStateRef.current = advanceCanvasPointerTapGesture(
      pointerTapGestureStateRef.current,
      event.pointerId,
      toViewportPoint(event.clientX, event.clientY),
    );

    if (
      pointerGestureStateRef.current.phase === "idle" &&
      event.buttons === 0
    ) {
      schedulePlacementPreviewFromScreenPoint(
        toViewportPoint(event.clientX, event.clientY),
      );
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
        void dispatchCanvasTap(toViewportPoint(event.clientX, event.clientY));
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
      const shouldDispatchTap = shouldDispatchCanvasPointerTap(
        pointerTapGestureStateRef.current,
        event.pointerId,
      );

      if (shouldDispatchTap) {
        void dispatchCanvasTap(toViewportPoint(event.clientX, event.clientY));
      } else if (
        editor.session.placementDefinitionId &&
        editor.session.placementStrategy === "pointer-follow"
      ) {
        logger.info("Suppressed precise-pointer tap before placement dispatch.", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          activeTool: editor.session.activeTool,
          placementDefinitionId: editor.session.placementDefinitionId,
          placementStrategy: editor.session.placementStrategy,
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
    if (!editor.session.placementDefinitionId) {
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
        if (!editor.session.placementDefinitionId || event.repeat) {
          return;
        }

        event.preventDefault();
        controller.rotatePlacementClockwise();
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
            <div
              className="placement-action-toolbar"
              onClick={(event) => {
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              style={anchoredPlacementToolbarStyle}
            >
              <button
                aria-label={t("action.cancelPlacement")}
                className="placement-action-button is-cancel"
                onClick={() => {
                  cancelPlacement();
                }}
                type="button"
              >
                <WorkbenchIcon className="placement-action-icon" kind="cancel" />
                <span className="sr-only">{t("action.cancelPlacement")}</span>
              </button>
              <button
                aria-label={t("action.rotatePlacement")}
                className="placement-action-button is-rotate"
                onClick={() => {
                  controller.rotatePlacementClockwise();
                }}
                type="button"
              >
                <WorkbenchIcon className="placement-action-icon" kind="rotate" />
                <span className="sr-only">{t("action.rotatePlacement")}</span>
              </button>
              <button
                aria-label={t("action.confirmPlacement")}
                className="placement-action-button is-confirm"
                disabled={!anchoredPlacementPreview?.valid}
                onClick={() => {
                  void controller.confirmPlacementPreview();
                }}
                type="button"
              >
                <WorkbenchIcon className="placement-action-icon" kind="confirm" />
                <span className="sr-only">{t("action.confirmPlacement")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
});
