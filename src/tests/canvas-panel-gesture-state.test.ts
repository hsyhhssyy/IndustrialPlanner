import { describe, expect, it } from "vitest";
import {
  advanceCanvasViewportPanGesture,
  beginCanvasViewportPanGesture,
  cancelCanvasPanelGesture,
  createIdleCanvasPanelGestureState,
  isCanvasViewportPanning,
} from "@/app-shell/components/canvas-panel-gesture-state";

describe("canvas panel gesture state", () => {
  it("stays pressed until the pan threshold is exceeded", () => {
    const pressedState = beginCanvasViewportPanGesture(7, { x: 10, y: 10 });
    const result = advanceCanvasViewportPanGesture(pressedState, 7, {
      x: 12,
      y: 12,
    });

    expect(result.nextState.phase).toBe("pan-pressed");
    expect(result.screenDelta).toBeNull();
    expect(isCanvasViewportPanning(result.nextState)).toBe(false);
  });

  it("enters panning and returns deltas after the threshold", () => {
    const pressedState = beginCanvasViewportPanGesture(7, { x: 10, y: 10 });
    const startPanningResult = advanceCanvasViewportPanGesture(pressedState, 7, {
      x: 20,
      y: 14,
    });

    expect(startPanningResult.nextState.phase).toBe("panning");
    expect(startPanningResult.screenDelta).toEqual({ x: 10, y: 4 });
    expect(isCanvasViewportPanning(startPanningResult.nextState)).toBe(true);

    const continuePanningResult = advanceCanvasViewportPanGesture(
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
    const pressedState = beginCanvasViewportPanGesture(7, { x: 10, y: 10 });
    const ignoredResult = advanceCanvasViewportPanGesture(pressedState, 8, {
      x: 40,
      y: 40,
    });

    expect(ignoredResult.nextState).toBe(pressedState);
    expect(ignoredResult.screenDelta).toBeNull();
    expect(cancelCanvasPanelGesture()).toEqual(
      createIdleCanvasPanelGestureState(),
    );
  });
});