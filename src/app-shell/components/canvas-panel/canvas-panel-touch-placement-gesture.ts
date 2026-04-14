import type { CanvasPoint } from "@/workbench/state/workspace-state";
import type { CanvasPanelTouchGestureState } from "./canvas-panel-touch-gesture";
import {
  advanceCanvasTouchDragGesture,
  beginCanvasTouchDragGesture,
  cancelCanvasTouchDragGesture,
  createIdleCanvasPanelTouchDragGestureState,
  removePointerFromCanvasTouchDragGesture,
  type CanvasPanelTouchDragGestureState,
} from "./canvas-panel-touch-drag-gesture";

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
      origin: CanvasPoint;
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

function toPlacementState(
  state: CanvasPanelTouchDragGestureState,
): CanvasPanelTouchPlacementGestureState {
  switch (state.phase) {
    case "idle":
      return {
        phase: "idle",
      };
    case "touch-drag-pressed":
      return {
        phase: "touch-placement-pressed",
        pointerId: state.pointerId,
        origin: state.origin,
        last: state.last,
      };
    case "touch-dragging":
      return {
        phase: "touch-placement-dragging",
        pointerId: state.pointerId,
        origin: state.origin,
        last: state.last,
      };
  }
}

function toSharedState(
  state: CanvasPanelTouchPlacementGestureState,
): CanvasPanelTouchDragGestureState {
  switch (state.phase) {
    case "idle":
      return createIdleCanvasPanelTouchDragGestureState();
    case "touch-placement-pressed":
      return {
        phase: "touch-drag-pressed",
        pointerId: state.pointerId,
        origin: state.origin,
        last: state.last,
      };
    case "touch-placement-dragging":
      return {
        phase: "touch-dragging",
        pointerId: state.pointerId,
        origin: state.origin,
        last: state.last,
      };
  }
}

export function createIdleCanvasPanelTouchPlacementGestureState(): CanvasPanelTouchPlacementGestureState {
  return toPlacementState(createIdleCanvasPanelTouchDragGestureState());
}

export function beginCanvasTouchPlacementGesture(
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchPlacementGestureState {
  return toPlacementState(beginCanvasTouchDragGesture(pointerId, point));
}

export function cancelCanvasTouchPlacementGesture(): CanvasPanelTouchPlacementGestureState {
  return toPlacementState(cancelCanvasTouchDragGesture());
}

export function advanceCanvasTouchPlacementGesture(
  state: CanvasPanelTouchPlacementGestureState,
  pointerId: number,
  point: CanvasPoint,
): CanvasPanelTouchPlacementAdvanceResult {
  const result = advanceCanvasTouchDragGesture(
    toSharedState(state),
    pointerId,
    point,
  );

  return {
    nextState: toPlacementState(result.nextState),
    previewPoint: result.dragPoint,
  };
}

export function removePointerFromCanvasTouchPlacementGesture(
  state: CanvasPanelTouchPlacementGestureState,
  pointerId: number,
): CanvasPanelTouchPlacementGestureState {
  return toPlacementState(
    removePointerFromCanvasTouchDragGesture(toSharedState(state), pointerId),
  );
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
