import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { CanvasPoint } from "@/workbench/workspace-state";
import { POINTER_MOVE_START_DISTANCE_PX } from "./canvas-panel-pointer-move-gesture";

export type CanvasPanelPointerMarqueeGestureState =
  | {
      phase: "idle";
    }
  | {
      phase: "marquee-pressed";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
      selectionMode: EditorSelectionUpdateMode;
    }
  | {
      phase: "marquee-dragging";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
      selectionMode: EditorSelectionUpdateMode;
    };

export interface CanvasPanelPointerMarqueeAdvanceResult {
  nextState: CanvasPanelPointerMarqueeGestureState;
  dragPoint: CanvasPoint | null;
  didStartDragging: boolean;
}

export function createIdleCanvasPanelPointerMarqueeGestureState(): CanvasPanelPointerMarqueeGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasPointerMarqueeGesture(
  pointerId: number,
  point: CanvasPoint,
  selectionMode: EditorSelectionUpdateMode,
): CanvasPanelPointerMarqueeGestureState {
  return {
    phase: "marquee-pressed",
    pointerId,
    origin: point,
    last: point,
    selectionMode,
  };
}

export function cancelCanvasPointerMarqueeGesture(): CanvasPanelPointerMarqueeGestureState {
  return createIdleCanvasPanelPointerMarqueeGestureState();
}

export function advanceCanvasPointerMarqueeGesture(
  state: CanvasPanelPointerMarqueeGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelPointerMarqueeAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      dragPoint: null,
      didStartDragging: false,
    };
  }

  if (state.phase === "marquee-pressed") {
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
        phase: "marquee-dragging",
        pointerId: state.pointerId,
        origin: state.origin,
        last: point,
        selectionMode: state.selectionMode,
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

export function removePointerFromCanvasPointerMarqueeGesture(
  state: CanvasPanelPointerMarqueeGestureState,
  pointerId: number,
): CanvasPanelPointerMarqueeGestureState {
  if (state.phase === "idle") {
    return state;
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelPointerMarqueeGestureState()
    : state;
}