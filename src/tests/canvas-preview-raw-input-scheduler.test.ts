import {
  createCanvasPreviewRawInputScheduler,
} from "@/app-shell/components/canvas-panel/canvas-preview-raw-input-scheduler";
import { describe, expect, it, vi } from "vitest";

describe("CanvasPreviewRawInputScheduler", () => {
  it("coalesces multiple raw input updates into one frame using the latest screen point", () => {
    const callbacks: FrameRequestCallback[] = [];
    const dispatch = vi.fn();
    const scheduler = createCanvasPreviewRawInputScheduler({
      dispatch,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: vi.fn(),
    });

    scheduler.schedule({ x: 10, y: 20 });
    scheduler.schedule({ x: 30, y: 40 });

    expect(callbacks).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalled();

    callbacks[0]?.(16);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ x: 30, y: 40 });
  });

  it("cancels pending raw input work before the frame flushes", () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    const dispatch = vi.fn();
    const scheduler = createCanvasPreviewRawInputScheduler({
      dispatch,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame,
    });

    scheduler.schedule({ x: 10, y: 20 });
    scheduler.cancel();
    callbacks[0]?.(16);

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
