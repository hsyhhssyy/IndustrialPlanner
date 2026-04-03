import type { CanvasPoint } from "@/canvas/canvas-host";

export const POINTER_TAP_CANCEL_DISTANCE_PX = 4;

export type CanvasPanelPointerTapGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "pointer-tap-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    };

export function createIdleCanvasPanelPointerTapGestureState(): CanvasPanelPointerTapGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasPointerTapGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelPointerTapGestureState {
  return {
    phase: "pointer-tap-pressed",
    pointerId,
    origin: point,
    last: point,
  };
}

export function advanceCanvasPointerTapGesture(
  state: CanvasPanelPointerTapGestureState,
  pointerId: number,
  nextPoint: CanvasPoint,
): CanvasPanelPointerTapGestureState {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return state;
  }

  const movedDistance = Math.hypot(
    nextPoint.x - state.origin.x,
    nextPoint.y - state.origin.y,
  );

  if (movedDistance >= POINTER_TAP_CANCEL_DISTANCE_PX) {
    return createIdleCanvasPanelPointerTapGestureState();
  }

  return {
    ...state,
    last: nextPoint,
  };
}

export function removePointerFromCanvasPointerTapGesture(
  state: CanvasPanelPointerTapGestureState,
  pointerId: number,
): CanvasPanelPointerTapGestureState {
  if (state.phase === "idle") {
    return state;
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelPointerTapGestureState()
    : state;
}

export function shouldDispatchCanvasPointerTap(
  state: CanvasPanelPointerTapGestureState,
  pointerId: number,
): boolean {
  return state.phase === "pointer-tap-pressed" && state.pointerId === pointerId;
}
