import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { CanvasPoint } from "@/workbench/workspace-state";

export const TOUCH_MARQUEE_LONG_PRESS_DURATION_MS = 420;

export type CanvasPanelTouchMarqueeGestureState =
  | {
      phase: "idle";
    }
  | CanvasPanelTouchMarqueeSelectingGestureState;

export interface CanvasPanelTouchMarqueeSelectingGestureState {
      phase: "touch-marquee-selecting";
      pointerId: number;
      origin: CanvasPoint;
      last: CanvasPoint;
      selectionMode: EditorSelectionUpdateMode;
    }

export interface CanvasPanelTouchMarqueeAdvanceResult {
  nextState: CanvasPanelTouchMarqueeGestureState;
  dragPoint: CanvasPoint | null;
}

export function createIdleCanvasPanelTouchMarqueeGestureState(): CanvasPanelTouchMarqueeGestureState {
  return {
    phase: "idle",
  };
}

export function beginCanvasTouchMarqueeGesture(
  pointerId: number,
  point: CanvasPoint,
  selectionMode: EditorSelectionUpdateMode,
): CanvasPanelTouchMarqueeSelectingGestureState {
  return {
    phase: "touch-marquee-selecting",
    pointerId,
    origin: point,
    last: point,
    selectionMode,
  };
}

export function cancelCanvasTouchMarqueeGesture(): CanvasPanelTouchMarqueeGestureState {
  return createIdleCanvasPanelTouchMarqueeGestureState();
}

export function advanceCanvasTouchMarqueeGesture(
  state: CanvasPanelTouchMarqueeGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchMarqueeAdvanceResult {
  if (state.phase === "idle" || state.pointerId !== pointerId) {
    return {
      nextState: state,
      dragPoint: null,
    };
  }

  return {
    nextState: {
      ...state,
      last: point,
    },
    dragPoint: point,
  };
}

export function removePointerFromCanvasTouchMarqueeGesture(
  state: CanvasPanelTouchMarqueeGestureState,
  pointerId: number,
): CanvasPanelTouchMarqueeGestureState {
  if (state.phase === "idle") {
    return state;
  }

  return state.pointerId === pointerId
    ? createIdleCanvasPanelTouchMarqueeGestureState()
    : state;
}
