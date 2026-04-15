import { describe, expect, it } from "vitest";
import {
  advanceCanvasPointerTapGesture,
  beginCanvasPointerTapGesture,
  createIdleCanvasPanelPointerTapGestureState,
  removePointerFromCanvasPointerTapGesture,
  shouldDispatchCanvasPointerTap,
} from "@/app/app-shell/components/canvas-panel/canvas-panel-pointer-tap-gesture";

describe("canvas panel pointer tap gesture", () => {
  it("keeps a precise-pointer tap candidate alive until movement crosses the threshold", () => {
    const pressedState = beginCanvasPointerTapGesture(5, { x: 10, y: 10 });

    expect(
      advanceCanvasPointerTapGesture(pressedState, 5, {
        x: 12,
        y: 12,
      }),
    ).toEqual({
      phase: "pointer-tap-pressed",
      pointerId: 5,
      origin: { x: 10, y: 10 },
      last: { x: 12, y: 12 },
    });

    expect(
      advanceCanvasPointerTapGesture(pressedState, 5, {
        x: 16,
        y: 10,
      }),
    ).toEqual(createIdleCanvasPanelPointerTapGestureState());
  });

  it("dispatches tap only for the owning pointer and removes cleanly", () => {
    const pressedState = beginCanvasPointerTapGesture(9, { x: 20, y: 20 });

    expect(shouldDispatchCanvasPointerTap(pressedState, 9)).toBe(true);
    expect(shouldDispatchCanvasPointerTap(pressedState, 8)).toBe(false);
    expect(
      removePointerFromCanvasPointerTapGesture(pressedState, 9),
    ).toEqual(createIdleCanvasPanelPointerTapGestureState());
  });
});
