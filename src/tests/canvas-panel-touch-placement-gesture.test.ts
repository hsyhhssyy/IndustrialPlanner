import { describe, expect, it } from "vitest";
import {
  advanceCanvasTouchPlacementGesture,
  beginCanvasTouchPlacementGesture,
  createIdleCanvasPanelTouchPlacementGestureState,
  removePointerFromCanvasTouchPlacementGesture,
  shouldDispatchCanvasTouchTap,
} from "@/app-shell/components/canvas-panel/canvas-panel-touch-placement-gesture";
import { createIdleCanvasPanelTouchGestureState } from "@/app-shell/components/canvas-panel/canvas-panel-touch-gesture";

describe("canvas panel touch placement gesture", () => {
  it("does not move anchored placement preview until drag crosses the threshold", () => {
    const pressedState = beginCanvasTouchPlacementGesture(7, { x: 10, y: 10 });
    const beforeThreshold = advanceCanvasTouchPlacementGesture(pressedState, 7, {
      x: 13,
      y: 13,
    });

    expect(beforeThreshold.nextState.phase).toBe("touch-placement-pressed");
    expect(beforeThreshold.previewPoint).toBeNull();

    const afterThreshold = advanceCanvasTouchPlacementGesture(pressedState, 7, {
      x: 20,
      y: 16,
    });

    expect(afterThreshold.nextState.phase).toBe("touch-placement-dragging");
    expect(afterThreshold.previewPoint).toEqual({ x: 20, y: 16 });

    const continueDragging = advanceCanvasTouchPlacementGesture(
      afterThreshold.nextState,
      7,
      {
        x: 24,
        y: 18,
      },
    );

    expect(continueDragging.nextState.phase).toBe("touch-placement-dragging");
    expect(continueDragging.previewPoint).toEqual({ x: 24, y: 18 });
    expect(
      removePointerFromCanvasTouchPlacementGesture(continueDragging.nextState, 7),
    ).toEqual(createIdleCanvasPanelTouchPlacementGestureState());
  });

  it("suppresses touch tap fallback for anchored placement, multi-touch, and drag sequences", () => {
    const idleTouchGesture = createIdleCanvasPanelTouchGestureState();
    const idlePlacementGesture = createIdleCanvasPanelTouchPlacementGestureState();

    expect(
      shouldDispatchCanvasTouchTap({
        activeTouchCount: 1,
        anchoredPreviewActive: false,
        placementGestureState: idlePlacementGesture,
        tapSuppressed: false,
        touchGestureState: idleTouchGesture,
      }),
    ).toBe(true);

    expect(
      shouldDispatchCanvasTouchTap({
        activeTouchCount: 1,
        anchoredPreviewActive: true,
        placementGestureState: idlePlacementGesture,
        tapSuppressed: false,
        touchGestureState: idleTouchGesture,
      }),
    ).toBe(false);

    expect(
      shouldDispatchCanvasTouchTap({
        activeTouchCount: 2,
        anchoredPreviewActive: false,
        placementGestureState: idlePlacementGesture,
        tapSuppressed: true,
        touchGestureState: idleTouchGesture,
      }),
    ).toBe(false);

    expect(
      shouldDispatchCanvasTouchTap({
        activeTouchCount: 1,
        anchoredPreviewActive: false,
        placementGestureState: beginCanvasTouchPlacementGesture(9, { x: 0, y: 0 }),
        tapSuppressed: false,
        touchGestureState: idleTouchGesture,
      }),
    ).toBe(true);

    expect(
      shouldDispatchCanvasTouchTap({
        activeTouchCount: 1,
        anchoredPreviewActive: false,
        placementGestureState: idlePlacementGesture,
        tapSuppressed: false,
        touchGestureState: {
          phase: "touch-pinching",
          pointers: [
            { pointerId: 1, point: { x: 10, y: 10 } },
            { pointerId: 2, point: { x: 30, y: 10 } },
          ],
          midpoint: { x: 20, y: 10 },
          distance: 20,
        },
      }),
    ).toBe(false);
  });
});
