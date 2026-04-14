import type { CanvasPoint } from "@/workbench/state/workspace-state";

export const TOUCH_DRAG_START_DISTANCE_PX = 6;

export type CanvasPanelTouchDragGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "touch-drag-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    }
  | {
      phase: "touch-dragging";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    };

export interface CanvasPanelTouchDragAdvanceResult {
  nextState: CanvasPanelTouchDragGestureState;
  dragPoint: CanvasPoint | null;
  didStartDragging: boolean;
}

export function createIdleCanvasPanelTouchDragGestureState(): CanvasPanelTouchDragGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasTouchDragGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchDragGestureState {
  return {
    phase: "touch-drag-pressed",
    pointerId,
    origin: point,
    last: point,
  };
}

export function cancelCanvasTouchDragGesture(): CanvasPanelTouchDragGestureState {
  return createIdleCanvasPanelTouchDragGestureState();
}

export function advanceCanvasTouchDragGesture(
  state: CanvasPanelTouchDragGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchDragAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      dragPoint: null,
      didStartDragging: false,
    };
  }

  if (state.phase === "touch-drag-pressed") {
    const movedDistance = Math.hypot(
      point.x - state.origin.x,
      point.y - state.origin.y,
    );

    if (movedDistance < TOUCH_DRAG_START_DISTANCE_PX) {
      return {
        nextState: {
          ...state,
          last: point,
        },
        dragPoint: null,
        didStartDragging: false,
      };
    }

    return {
      nextState: {
        phase: "touch-dragging",
        pointerId: state.pointerId,
        origin: state.origin,
        last: point,
      },
      dragPoint: point,
      didStartDragging: true,
    };
  }

  return {
    nextState: {
      ...state,
      last: point,
    },
    dragPoint: point,
    didStartDragging: false,
  };
}

export function removePointerFromCanvasTouchDragGesture(
  state: CanvasPanelTouchDragGestureState,
  pointerId: number,
): CanvasPanelTouchDragGestureState {
  if (state.phase === "idle") {
    return state;
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelTouchDragGestureState()
    : state;
}
