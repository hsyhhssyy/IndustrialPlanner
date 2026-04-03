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
import type { WorkbenchController } from "@/app-shell/contracts/workbench-facade";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import type { CanvasPoint } from "@/canvas/canvas-host";
import { createTranslator } from "@/i18n/messages";
import { RendererHost } from "@/renderer/host/renderer-host";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

const PIXELS_PER_WHEEL_LINE = 16;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

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
}

export function CanvasPanel({ controller }: CanvasPanelProps) {
  const ui = useExternalStore(controller.uiStore);
  const editor = useExternalStore(controller.editorStore);
  const canvasSnapshot = useExternalStore(controller.canvasStore);
  const renderScene = useExternalStore(controller.renderSceneStore);
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
  const pointerGestureStateRef = useRef<CanvasPanelPointerGestureState>(pointerGestureState);
  const touchGestureStateRef = useRef<CanvasPanelTouchGestureState>(touchGestureState);
  const t = createTranslator(ui.locale);
  const anchoredPlacementActive =
    editor.session.placementDefinitionId !== null &&
    editor.session.placementStrategy === "anchored-confirm";
  const anchoredPlacementPreview =
    renderScene.placementPreview?.strategy === "anchored-confirm"
      ? renderScene.placementPreview
      : null;
  const viewport = canvasSnapshot.canvas.viewport;
  const anchoredPlacementScreenBox = anchoredPlacementPreview
    ? {
        left:
          (anchoredPlacementPreview.x - renderScene.viewportOffset.x) * renderScene.zoom,
        top:
          (anchoredPlacementPreview.y - renderScene.viewportOffset.y) * renderScene.zoom,
        width: anchoredPlacementPreview.width * renderScene.zoom,
        height: anchoredPlacementPreview.height * renderScene.zoom,
      }
    : null;
  const anchoredPlacementHintStyle = anchoredPlacementScreenBox
    ? {
        left: `${clampToRange(
          anchoredPlacementScreenBox.left,
          12,
          viewport.size.x - 240,
        )}px`,
        top: `${clampToRange(
          anchoredPlacementScreenBox.top - 40,
          12,
          viewport.size.y - 76,
        )}px`,
      }
    : null;
  const anchoredPlacementConfirmStyle = anchoredPlacementScreenBox
    ? {
        left: `${clampToRange(
          anchoredPlacementScreenBox.left + anchoredPlacementScreenBox.width - 120,
          12,
          viewport.size.x - 132,
        )}px`,
        top: `${clampToRange(
          anchoredPlacementScreenBox.top + anchoredPlacementScreenBox.height + 10,
          12,
          viewport.size.y - 52,
        )}px`,
      }
    : null;

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
    controller.clearPlacementPreview();
  };

  useEffect(() => {
    if (
      !anchoredPlacementActive ||
      renderScene.placementPreview !== null ||
      viewport.size.x <= 0 ||
      viewport.size.y <= 0
    ) {
      return;
    }

    controller.centerPlacementPreview();
  }, [
    anchoredPlacementActive,
    controller,
    renderScene.placementPreview,
    viewport.size.x,
    viewport.size.y,
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
    const intent = resolveCanvasPanelTapIntent({
      mode: ui.mode,
      activeTool: editor.session.activeTool,
      placementDefinitionId: editor.session.placementDefinitionId,
      placementStrategy: editor.session.placementStrategy,
      target: controller.getCanvasInteractionTarget(screenPoint),
    });

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
          controller.updatePlacementPreviewFromScreenPoint(result.previewPoint);
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
      controller.updatePlacementPreviewFromScreenPoint(
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

    controller.updatePlacementPreviewFromScreenPoint(
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
      if (shouldDispatchCanvasPointerTap(pointerTapGestureStateRef.current, event.pointerId)) {
        void dispatchCanvasTap(toViewportPoint(event.clientX, event.clientY));
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
          <RendererHost scene={renderScene} />
          {anchoredPlacementHintStyle ? (
            <div className="placement-affordance-hint" style={anchoredPlacementHintStyle}>
              {t("label.touchPlacementHint")}
            </div>
          ) : null}
          {anchoredPlacementConfirmStyle ? (
            <button
              className="placement-confirm-button"
              disabled={!anchoredPlacementPreview?.valid}
              onClick={(event) => {
                event.stopPropagation();
                void controller.confirmPlacementPreview();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              style={anchoredPlacementConfirmStyle}
              type="button"
            >
              {t("action.confirmPlacement")}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
