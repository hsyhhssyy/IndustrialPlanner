import type { CanvasPoint } from "@/workbench/workspace-state";

export const POINTER_MOVE_START_DISTANCE_PX = 4;

export type CanvasPanelPointerMoveGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "move-pressed";
      pointerId: number;
      entityId: string;
      origin: CanvasPoint;
      last: CanvasPoint;
    }
  | {
      phase: "move-dragging";
      pointerId: number;
      entityId: string;
      origin: CanvasPoint;
      last: CanvasPoint;
    };

export interface CanvasPanelPointerMoveAdvanceResult {
  nextState: CanvasPanelPointerMoveGestureState;
  dragPoint: CanvasPoint | null;
  didStartDragging: boolean;
}

export function createIdleCanvasPanelPointerMoveGestureState(): CanvasPanelPointerMoveGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasPointerMoveGesture(
  pointerId: number,
  entityId: string,
  point: CanvasPoint,
): CanvasPanelPointerMoveGestureState {
  return {
    phase: "move-pressed",
    pointerId,
    entityId,
    origin: point,
    last: point,
  };
}

export function cancelCanvasPointerMoveGesture(): CanvasPanelPointerMoveGestureState {
  return createIdleCanvasPanelPointerMoveGestureState();
}

export function advanceCanvasPointerMoveGesture(
  state: CanvasPanelPointerMoveGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelPointerMoveAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      dragPoint: null,
      didStartDragging: false,
    };
  }

  if (state.phase === "move-pressed") {
    const movedDistance = Math.hypot(
      point.x - state.origin.x,
      point.y - state.origin.y,
    );

    if (movedDistance < POINTER_MOVE_START_DISTANCE_PX) {
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
        phase: "move-dragging",
        pointerId: state.pointerId,
        entityId: state.entityId,
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

export function removePointerFromCanvasPointerMoveGesture(
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
