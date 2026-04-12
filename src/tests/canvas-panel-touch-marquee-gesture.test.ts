import { describe, expect, it } from "vitest";
import {
  advanceCanvasTouchMarqueeGesture,
  beginCanvasTouchMarqueeGesture,
  cancelCanvasTouchMarqueeGesture,
  createIdleCanvasPanelTouchMarqueeGestureState,
  removePointerFromCanvasTouchMarqueeGesture,
} from "@/app-shell/components/canvas-panel/canvas-panel-touch-marquee-gesture";

describe("canvas panel touch marquee gesture", () => {
  it("keeps an active touch marquee pointer bound to its origin and latest point", () => {
    const activeState = beginCanvasTouchMarqueeGesture(
      14,
      { x: 20, y: 24 },
      "replace",
    );
    const update = advanceCanvasTouchMarqueeGesture(activeState, 14, {
      x: 42,
      y: 48,
    });

    expect(update.dragPoint).toEqual({ x: 42, y: 48 });
    expect(update.nextState).toEqual({
      phase: "touch-marquee-selecting",
      pointerId: 14,
      origin: { x: 20, y: 24 },
      last: { x: 42, y: 48 },
      selectionMode: "replace",
    });
    expect(
      removePointerFromCanvasTouchMarqueeGesture(update.nextState, 14),
    ).toEqual(createIdleCanvasPanelTouchMarqueeGestureState());
  });

  it("cancels back to idle when the touch marquee session is discarded", () => {
    expect(cancelCanvasTouchMarqueeGesture()).toEqual(
      createIdleCanvasPanelTouchMarqueeGestureState(),
    );
  });
});
