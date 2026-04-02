import type { CanvasPoint } from "@/canvas/canvas-host";

export const VIEWPORT_PAN_START_DISTANCE_PX = 4;

export type CanvasPanelGestureState =
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

export interface CanvasPanelGestureAdvanceResult {
  nextState: CanvasPanelGestureState;
  screenDelta: CanvasPoint | null;
}

export function createIdleCanvasPanelGestureState(): CanvasPanelGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasViewportPanGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelGestureState {
  return {
    phase: "pan-pressed",
    pointerId,
    origin: point,
    last: point,
  };
}

export function cancelCanvasPanelGesture(): CanvasPanelGestureState {
  return createIdleCanvasPanelGestureState();
}

export function isCanvasViewportPanning(
  state: CanvasPanelGestureState,
): boolean {
  return state.phase === "panning";
}

export function advanceCanvasViewportPanGesture(
  state: CanvasPanelGestureState,
  pointerId: number,
  nextPoint: CanvasPoint,
): CanvasPanelGestureAdvanceResult {
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