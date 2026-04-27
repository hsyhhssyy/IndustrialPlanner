import type { EditorAction } from "@/domain/action/editor-action";
import {
  resolveCompensatedViewportCenter,
} from "@/shared/geometry/viewport-transform";

import type { EditorStateReadWrite } from "../state-impl";
import { EDITOR_GRID_CELL_PIXEL_SIZE } from "../viewport-constants";
import type { EditorActionsContext } from "./types";

type EditorViewportActions = Pick<
  EditorAction,
  "moveViewportByClientPixelVector" | "setViewportClientRect" | "zoom"
>;

const VIEWPORT_ZOOM_STEPS_PER_DOUBLING = 6;
const MIN_VIEWPORT_GRID_SIZE = 1 / 16;
const MAX_VIEWPORT_GRID_SIZE = 16;

export function createEditorViewportActions({
  state,
}: EditorActionsContext): EditorViewportActions {
  return {
    setViewportClientRect: ({ left, top, width, height }) => {
      const previousClientRect = {
        ...state.viewport.clientRect,
      };
      const nextClientRect = {
        left: resolveViewportClientOffset(
          left,
          state.viewport.clientRect.left,
        ),
        top: resolveViewportClientOffset(
          top,
          state.viewport.clientRect.top,
        ),
        width: resolveViewportAxisSize(
          width,
          state.viewport.clientRect.width,
        ),
        height: resolveViewportAxisSize(
          height,
          state.viewport.clientRect.height,
        ),
      };

      if (state.internalTransientState.hasMeasuredViewportClientRect) {
        const nextViewportCenter = resolveCompensatedViewportCenter({
          previousClientRect,
          nextClientRect,
          previousViewportCenter: state.viewport.center,
          gridCellPixelSize: state.viewport.gridCellPixelSize,
        });

        state.viewport.center.x = nextViewportCenter.x;
        state.viewport.center.y = nextViewportCenter.y;
      } else {
        state.internalTransientState.hasMeasuredViewportClientRect = true;
      }

      state.viewport.clientRect.left = nextClientRect.left;
      state.viewport.clientRect.top = nextClientRect.top;
      state.viewport.clientRect.width = nextClientRect.width;
      state.viewport.clientRect.height = nextClientRect.height;
    },
    moveViewportByClientPixelVector: ({
      startClientPixel,
      endClientPixel,
    }) => {
      const viewportPixelVector = resolveViewportPixelVector({
        startViewportPixel: resolveViewportPixelPoint(
          startClientPixel,
          state.viewport,
        ),
        endViewportPixel: resolveViewportPixelPoint(
          endClientPixel,
          state.viewport,
        ),
      });

      if (viewportPixelVector === null) {
        return;
      }

      const gridCellSize = state.viewport.gridCellPixelSize;

      if (gridCellSize <= 0) {
        return;
      }

      state.viewport.center.x -= viewportPixelVector.x / gridCellSize;
      state.viewport.center.y -= viewportPixelVector.y / gridCellSize;
    },
    zoom: (step) => {
      const nextGridSize = resolveViewportGridSizeAfterZoom({
        currentGridSize: state.viewport.gridSize,
        step,
      });

      if (nextGridSize === null || nextGridSize === state.viewport.gridSize) {
        return;
      }

      state.viewport.gridSize = nextGridSize;
      state.viewport.gridCellPixelSize = EDITOR_GRID_CELL_PIXEL_SIZE * nextGridSize;
    },
  };
}

function resolveViewportClientOffset(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function resolveViewportGridSizeAfterZoom(options: {
  currentGridSize: number;
  step: number;
}): number | null {
  if (!Number.isFinite(options.step) || options.step === 0) {
    return null;
  }

  const zoomFactor = Math.pow(
    2,
    options.step / VIEWPORT_ZOOM_STEPS_PER_DOUBLING,
  );

  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return null;
  }

  return clampViewportGridSize(
    clampViewportGridSize(options.currentGridSize) * zoomFactor,
  );
}

function clampViewportGridSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(MAX_VIEWPORT_GRID_SIZE, Math.max(MIN_VIEWPORT_GRID_SIZE, value));
}

function resolveViewportPixelVector(options: {
  startViewportPixel: {
    x: number;
    y: number;
  };
  endViewportPixel: {
    x: number;
    y: number;
  };
}): {
  x: number;
  y: number;
} | null {
  if (
    !Number.isFinite(options.startViewportPixel.x)
    || !Number.isFinite(options.startViewportPixel.y)
    || !Number.isFinite(options.endViewportPixel.x)
    || !Number.isFinite(options.endViewportPixel.y)
  ) {
    return null;
  }

  return {
    x: options.endViewportPixel.x - options.startViewportPixel.x,
    y: options.endViewportPixel.y - options.startViewportPixel.y,
  };
}

function resolveViewportPixelPoint(
  clientPixelPoint: {
    x: number;
    y: number;
  },
  viewportState: EditorStateReadWrite["viewport"],
): {
  x: number;
  y: number;
} {
  return {
    x: clientPixelPoint.x - viewportState.clientRect.left,
    y: clientPixelPoint.y - viewportState.clientRect.top,
  };
}
