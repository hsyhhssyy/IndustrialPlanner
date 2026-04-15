import type { CanvasInteractionTarget } from "@/workspace/workspace-facade";
import type { CanvasPoint } from "@/workspace/workspace-state";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";

export const TOUCH_PAN_START_DISTANCE_PX = 6;

export type CanvasPanelTouchGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "touch-pan-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
      longPressMarqueeSelectionMode: EditorSelectionUpdateMode | null;
    }
  | {
      phase: "touch-panning";
      pointerId: number;
      last: CanvasPoint;
    }
  | {
      phase: "touch-pinching";
      pointers: [
        { pointerId: number; point: CanvasPoint },
        { pointerId: number; point: CanvasPoint },
      ];
      midpoint: CanvasPoint;
      distance: number;
    };

export interface CanvasPanelTouchPanAdvanceResult {
  nextState: CanvasPanelTouchGestureState;
  screenDelta: CanvasPoint | null;
}

export interface CanvasPanelTouchPinchAdvanceResult {
  nextState: CanvasPanelTouchGestureState;
  midpointDelta: CanvasPoint | null;
  scaleFactor: number | null;
  zoomAnchor: CanvasPoint | null;
}

export function createIdleCanvasPanelTouchGestureState(): CanvasPanelTouchGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasTouchPanGesture(
  pointerId: number,
  point: CanvasPoint,
  longPressMarqueeSelectionMode: EditorSelectionUpdateMode | null = null,
): CanvasPanelTouchGestureState {
  return {
    phase: "touch-pan-pressed",
    pointerId,
    origin: point,
    last: point,
    longPressMarqueeSelectionMode,
  };
}

export function beginCanvasTouchGesture(
  pointerId: number,
  point: CanvasPoint,
  target: CanvasInteractionTarget,
  longPressMarqueeSelectionMode: EditorSelectionUpdateMode | null = null,
): CanvasPanelTouchGestureState {
  if (target.kind !== "blank") {
    return createIdleCanvasPanelTouchGestureState();
  }

  return beginCanvasTouchPanGesture(
    pointerId,
    point,
    longPressMarqueeSelectionMode,
  );
}

export function isCanvasTouchPanning(
  state: CanvasPanelTouchGestureState,
): boolean {
  return state.phase === "touch-panning" || state.phase === "touch-pinching";
}

export function cancelCanvasTouchGesture(): CanvasPanelTouchGestureState {
  return createIdleCanvasPanelTouchGestureState();
}

function buildMidpoint(pointA: CanvasPoint, pointB: CanvasPoint): CanvasPoint {
  return {
    x: (pointA.x + pointB.x) / 2,
    y: (pointA.y + pointB.y) / 2,
  };
}

function buildDistance(pointA: CanvasPoint, pointB: CanvasPoint): number {
  return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
}

export function advanceCanvasTouchPanGesture(
  state: CanvasPanelTouchGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchPanAdvanceResult {
  if (state.phase === "idle" || state.phase === "touch-pinching") {
    return {
      nextState: state,
      screenDelta: null,
    };
  }

  if (state.pointerId !== pointerId) {
    return {
      nextState: state,
      screenDelta: null,
    };
  }

  const screenDelta = {
    x: point.x - state.last.x,
    y: point.y - state.last.y,
  };

  if (state.phase === "touch-pan-pressed") {
    const movedDistance = Math.hypot(point.x - state.origin.x, point.y - state.origin.y);

    if (movedDistance < TOUCH_PAN_START_DISTANCE_PX) {
      return {
        nextState: {
          ...state,
          last: point,
        },
        screenDelta: null,
      };
    }

    return {
      nextState: {
        phase: "touch-panning",
        pointerId: state.pointerId,
        last: point,
      },
      screenDelta,
    };
  }

  return {
    nextState: {
      ...state,
      last: point,
    },
    screenDelta,
  };
}

export function beginCanvasTouchPinchGesture(
  firstPointerId: number,
  firstPoint: CanvasPoint,
  secondPointerId: number,
  secondPoint: CanvasPoint,
): CanvasPanelTouchGestureState {
  return {
    phase: "touch-pinching",
    pointers: [
      { pointerId: firstPointerId, point: firstPoint },
      { pointerId: secondPointerId, point: secondPoint },
    ],
    midpoint: buildMidpoint(firstPoint, secondPoint),
    distance: buildDistance(firstPoint, secondPoint),
  };
}

export function advanceCanvasTouchPinchGesture(
  state: CanvasPanelTouchGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchPinchAdvanceResult {
  if (state.phase !== "touch-pinching") {
    return {
      nextState: state,
      midpointDelta: null,
      scaleFactor: null,
      zoomAnchor: null,
    };
  }

  const nextPointers = state.pointers.map((entry) =>
    entry.pointerId === pointerId ? { ...entry, point } : entry,
  ) as [
    { pointerId: number; point: CanvasPoint },
    { pointerId: number; point: CanvasPoint },
  ];

  const pointerMatched = nextPointers.some(
    (entry) => entry.pointerId === pointerId,
  );

  if (!pointerMatched) {
    return {
      nextState: state,
      midpointDelta: null,
      scaleFactor: null,
      zoomAnchor: null,
    };
  }

  const nextMidpoint = buildMidpoint(
    nextPointers[0].point,
    nextPointers[1].point,
  );
  const nextDistance = buildDistance(
    nextPointers[0].point,
    nextPointers[1].point,
  );
  const scaleFactor =
    state.distance > 0 && Number.isFinite(nextDistance)
      ? nextDistance / state.distance
      : 1;

  const nextState: CanvasPanelTouchGestureState = {
    phase: "touch-pinching",
    pointers: nextPointers,
    midpoint: nextMidpoint,
    distance: nextDistance,
  };

  return {
    nextState,
    midpointDelta: {
      x: nextMidpoint.x - state.midpoint.x,
      y: nextMidpoint.y - state.midpoint.y,
    },
    scaleFactor:
      Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : null,
    zoomAnchor: state.midpoint,
  };
}

export function removePointerFromCanvasTouchGesture(
  state: CanvasPanelTouchGestureState,
  pointerId: number,
): CanvasPanelTouchGestureState {
  if (state.phase === "idle") {
    return state;
  }

  if (state.phase === "touch-pinching") {
    return createIdleCanvasPanelTouchGestureState();
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelTouchGestureState()
    : state;
}
