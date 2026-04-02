import { describe, expect, it } from "vitest";
import {
  advanceCanvasPointerPanGesture,
  beginCanvasPointerPanGesture,
  cancelCanvasPanelPointerGesture,
  createIdleCanvasPanelPointerGestureState,
  isCanvasPointerPanning,
} from "@/app-shell/components/canvas-panel/canvas-panel-pointer-gesture";

describe("canvas panel pointer gesture", () => {
  it("stays pressed until the pan threshold is exceeded", () => {
    const pressedState = beginCanvasPointerPanGesture(7, { x: 10, y: 10 });
    const result = advanceCanvasPointerPanGesture(pressedState, 7, {
      x: 12,
      y: 12,
    });

    expect(result.nextState.phase).toBe("pan-pressed");
    expect(result.screenDelta).toBeNull();
    expect(isCanvasPointerPanning(result.nextState)).toBe(false);
  });

  it("enters panning and returns deltas after the threshold", () => {
    const pressedState = beginCanvasPointerPanGesture(7, { x: 10, y: 10 });
    const startPanningResult = advanceCanvasPointerPanGesture(pressedState, 7, {
      x: 20,
      y: 14,
    });

    expect(startPanningResult.nextState.phase).toBe("panning");
    expect(startPanningResult.screenDelta).toEqual({ x: 10, y: 4 });
    expect(isCanvasPointerPanning(startPanningResult.nextState)).toBe(true);

    const continuePanningResult = advanceCanvasPointerPanGesture(
      startPanningResult.nextState,
      7,
      {
        x: 26,
        y: 20,
      },
    );

    expect(continuePanningResult.nextState.phase).toBe("panning");
    expect(continuePanningResult.screenDelta).toEqual({ x: 6, y: 6 });
  });

  it("ignores mismatched pointers and cancels cleanly", () => {
    const pressedState = beginCanvasPointerPanGesture(7, { x: 10, y: 10 });
    const ignoredResult = advanceCanvasPointerPanGesture(pressedState, 8, {
      x: 40,
      y: 40,
    });

    expect(ignoredResult.nextState).toBe(pressedState);
    expect(ignoredResult.screenDelta).toBeNull();
    expect(cancelCanvasPanelPointerGesture()).toEqual(
      createIdleCanvasPanelPointerGestureState(),
    );
  });
});