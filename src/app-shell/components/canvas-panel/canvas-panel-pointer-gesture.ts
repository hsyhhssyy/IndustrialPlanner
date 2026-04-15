import type { CanvasPoint } from "@/workspace/workspace-state";

export const VIEWPORT_PAN_START_DISTANCE_PX = 4;

export type CanvasPanelPointerGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "pan-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    }
  | {
      phase: "panning";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
    };

export interface CanvasPanelPointerGestureAdvanceResult {
  nextState: CanvasPanelPointerGestureState;
  screenDelta: CanvasPoint | null;
}

export function createIdleCanvasPanelPointerGestureState(): CanvasPanelPointerGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasPointerPanGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelPointerGestureState {
  return {
    phase: "pan-pressed",
    pointerId,
    origin: point,
    last: point,
  };
}

export function cancelCanvasPanelPointerGesture(): CanvasPanelPointerGestureState {
  return createIdleCanvasPanelPointerGestureState();
}

export function isCanvasPointerPanning(
  state: CanvasPanelPointerGestureState,
): boolean {
  return state.phase === "panning";
}

export function advanceCanvasPointerPanGesture(
  state: CanvasPanelPointerGestureState,
  pointerId: number,
  nextPoint: CanvasPoint,
): CanvasPanelPointerGestureAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      screenDelta: null,
    };
  }

  const screenDelta = {
    x: nextPoint.x - state.last.x,
    y: nextPoint.y - state.last.y,
  };

  if (state.phase === "pan-pressed") {
    const movedX = nextPoint.x - state.origin.x;
    const movedY = nextPoint.y - state.origin.y;
    const movedDistance = Math.hypot(movedX, movedY);

    if (movedDistance < VIEWPORT_PAN_START_DISTANCE_PX) {
      return {
        nextState: {
          ...state,
          last: nextPoint,
        },
        screenDelta: null,
      };
    }

    return {
      nextState: {
        phase: "panning",
        pointerId: state.pointerId,
        origin: state.origin,
        last: nextPoint,
      },
      screenDelta,
    };
  }

  return {
    nextState: {
      ...state,
      last: nextPoint,
    },
    screenDelta,
  };
}
