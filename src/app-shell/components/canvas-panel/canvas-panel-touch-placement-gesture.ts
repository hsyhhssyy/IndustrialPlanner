import type { CanvasPoint } from "@/canvas/canvas-host";
import type { CanvasPanelTouchGestureState } from "./canvas-panel-touch-gesture";

export const TOUCH_PLACEMENT_DRAG_START_DISTANCE_PX = 6;

export type CanvasPanelTouchPlacementGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "touch-placement-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    }
  | {
      phase: "touch-placement-dragging";
      pointerId: number;
      last: CanvasPoint;
    };

export interface CanvasPanelTouchPlacementAdvanceResult {
  nextState: CanvasPanelTouchPlacementGestureState;
  previewPoint: CanvasPoint | null;
}

export interface ShouldDispatchCanvasTouchTapOptions {
  activeTouchCount: number;
  anchoredPlacementActive: boolean;
  placementGestureState: CanvasPanelTouchPlacementGestureState;
  tapSuppressed: boolean;
  touchGestureState: CanvasPanelTouchGestureState;
}

export function createIdleCanvasPanelTouchPlacementGestureState(): CanvasPanelTouchPlacementGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasTouchPlacementGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchPlacementGestureState {
  return {
    phase: "touch-placement-pressed",
    pointerId,
    origin: point,
    last: point,
  };
}

export function cancelCanvasTouchPlacementGesture(): CanvasPanelTouchPlacementGestureState {
  return createIdleCanvasPanelTouchPlacementGestureState();
}

export function advanceCanvasTouchPlacementGesture(
  state: CanvasPanelTouchPlacementGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchPlacementAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      previewPoint: null,
    };
  }

  if (state.phase === "touch-placement-pressed") {
    const movedDistance = Math.hypot(
      point.x - state.origin.x,
      point.y - state.origin.y,
    );

    if (movedDistance < TOUCH_PLACEMENT_DRAG_START_DISTANCE_PX) {
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
        phase: "touch-placement-dragging",
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

export function removePointerFromCanvasTouchPlacementGesture(
  state: CanvasPanelTouchPlacementGestureState,
  pointerId: number,
): CanvasPanelTouchPlacementGestureState {
  if (state.phase === "idle") {
    return state;
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelTouchPlacementGestureState()
    : state;
}

export function shouldDispatchCanvasTouchTap(
  options: ShouldDispatchCanvasTouchTapOptions,
): boolean {
  if (
    options.anchoredPlacementActive ||
    options.tapSuppressed ||
    options.activeTouchCount !== 1 ||
    options.placementGestureState.phase !== "idle"
  ) {
    return false;
  }

  return (
    options.touchGestureState.phase !== "touch-panning" &&
    options.touchGestureState.phase !== "touch-pinching"
  );
}
