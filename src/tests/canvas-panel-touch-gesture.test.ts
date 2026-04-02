import { describe, expect, it } from "vitest";
import {
  advanceCanvasTouchPanGesture,
  advanceCanvasTouchPinchGesture,
  beginCanvasTouchGesture,
  beginCanvasTouchPinchGesture,
  createIdleCanvasPanelTouchGestureState,
  isCanvasTouchPanning,
  removePointerFromCanvasTouchGesture,
} from "@/app-shell/components/canvas-panel/canvas-panel-touch-gesture";

describe("canvas panel touch gesture", () => {
  it("only turns blank touch drag into viewport pan after the threshold", () => {
    const pressedState = beginCanvasTouchGesture(3, { x: 10, y: 10 }, { kind: "blank" });
    const beforeThreshold = advanceCanvasTouchPanGesture(pressedState, 3, {
      x: 13,
      y: 13,
    });

    expect(beforeThreshold.nextState.phase).toBe("touch-pressed-blank");
    expect(beforeThreshold.screenDelta).toBeNull();

    const afterThreshold = advanceCanvasTouchPanGesture(pressedState, 3, {
      x: 20,
      y: 16,
    });

    expect(afterThreshold.nextState.phase).toBe("touch-panning");
    expect(afterThreshold.screenDelta).toEqual({ x: 10, y: 6 });
    expect(isCanvasTouchPanning(afterThreshold.nextState)).toBe(true);
  });

  it("does not start blank pan when the first touch hits an entity", () => {
    const state = beginCanvasTouchGesture(3, { x: 10, y: 10 }, {
      kind: "entity",
      entityId: "filler-1",
      selected: false,
    });

    expect(state).toEqual(createIdleCanvasPanelTouchGestureState());
  });

  it("uses the two-finger midpoint for pinch zoom and pan updates", () => {
    const state = beginCanvasTouchPinchGesture(
      1,
      { x: 10, y: 10 },
      2,
      { x: 30, y: 10 },
    );
    const result = advanceCanvasTouchPinchGesture(state, 2, {
      x: 36,
      y: 16,
    });

    expect(result.nextState.phase).toBe("touch-pinching");
    expect(result.zoomAnchor).toEqual({ x: 20, y: 10 });
    expect(result.midpointDelta).toEqual({ x: 3, y: 3 });
    expect(result.scaleFactor).toBeCloseTo(Math.hypot(26, 6) / 20, 6);
    expect(removePointerFromCanvasTouchGesture(result.nextState, 1)).toEqual(
      createIdleCanvasPanelTouchGestureState(),
    );
  });
});
