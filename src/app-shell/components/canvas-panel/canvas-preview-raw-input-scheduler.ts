import type { CanvasPoint } from "@/workbench/workspace-state";

export interface CanvasPreviewRawInputScheduler {
  schedule: (screenPoint: CanvasPoint) => void;
  cancel: () => void;
  dispose: () => void;
}

export interface CreateCanvasPreviewRawInputSchedulerOptions {
  dispatch: (screenPoint: CanvasPoint) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

export function createCanvasPreviewRawInputScheduler(
  options: CreateCanvasPreviewRawInputSchedulerOptions,
): CanvasPreviewRawInputScheduler {
  const requestFrame =
    options.requestFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame =
    options.cancelFrame ?? window.cancelAnimationFrame.bind(window);

  let disposed = false;
  let pendingFrameHandle: number | null = null;
  let pendingScreenPoint: CanvasPoint | null = null;

  const cancelPendingFrame = () => {
    if (pendingFrameHandle === null) {
      return;
    }

    cancelFrame(pendingFrameHandle);
    pendingFrameHandle = null;
  };

  const flush = () => {
    pendingFrameHandle = null;

    if (disposed || pendingScreenPoint === null) {
      return;
    }

    const nextPoint = pendingScreenPoint;
    pendingScreenPoint = null;
    options.dispatch(nextPoint);
  };

  return {
    schedule: (screenPoint) => {
      if (disposed) {
        return;
      }

      pendingScreenPoint = {
        x: screenPoint.x,
        y: screenPoint.y,
      };

      if (pendingFrameHandle !== null) {
        return;
      }

      pendingFrameHandle = requestFrame(() => {
        flush();
      });
    },
    cancel: () => {
      pendingScreenPoint = null;
      cancelPendingFrame();
    },
    dispose: () => {
      disposed = true;
      pendingScreenPoint = null;
      cancelPendingFrame();
    },
  };
}
