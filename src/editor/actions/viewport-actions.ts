import type { EditorAction } from "@/domain/editor/editor-action";
import { action } from "mobx";
import type { GridRotation } from "@/domain/shared/grid";
import {
  resolveCompensatedViewportCenter,
  resolveWorldVectorFromViewportVector,
} from "@/shared/geometry/viewport-transform";

import {
  persistWorldDocumentViewportSettings,
} from "../document-viewport";
import type { EditorStateReadWrite } from "../state-impl";
import {
  clampViewportCenterToBaseWarningBounds,
  resolveViewportGridCellPixelSize,
  resolveViewportGridSizeAfterZoom,
} from "../viewport-settings";
import type { EditorActionsContext } from "./types";

type EditorViewportActions = Pick<
  EditorAction,
  | "moveViewportByClientPixelVector"
  | "setViewportClientRect"
  | "setViewportDisplayRotation"
  | "zoom"
>;

export function createEditorViewportActions({
  document,
  documentWriter,
  state,
  workspace,
}: EditorActionsContext): EditorViewportActions {
  const persistViewportSettings = (): void => {
    persistWorldDocumentViewportSettings({
      document,
      documentWriter,
      state,
    });
  };

  const clampViewportCenter = (): void => {
    const baseDefinition = workspace.registry.baseDefinitions.find(
      (definition) => definition.id === document.getSnapshot().baseId,
    ) ?? null;
    const nextViewportCenter = clampViewportCenterToBaseWarningBounds({
      center: state.viewport.center,
      baseDefinition,
    });

    state.viewport.center.x = nextViewportCenter.x;
    state.viewport.center.y = nextViewportCenter.y;
  };

  return {
    setViewportClientRect: action(({ left, top, width, height }) => {
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
          displayRotation: state.viewport.displayRotation,
        });

        state.viewport.center.x = nextViewportCenter.x;
        state.viewport.center.y = nextViewportCenter.y;
      } else {
        state.internalTransientState.hasMeasuredViewportClientRect = true;
      }

      clampViewportCenter();

      state.viewport.clientRect.left = nextClientRect.left;
      state.viewport.clientRect.top = nextClientRect.top;
      state.viewport.clientRect.width = nextClientRect.width;
      state.viewport.clientRect.height = nextClientRect.height;

      persistViewportSettings();
    }),
    moveViewportByClientPixelVector: action(({
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

      const worldVector = resolveWorldVectorFromViewportVector({
        viewportVector: viewportPixelVector,
        displayRotation: state.viewport.displayRotation,
      });

      state.viewport.center.x -= worldVector.x / gridCellSize;
      state.viewport.center.y -= worldVector.y / gridCellSize;

      clampViewportCenter();

      persistViewportSettings();
    }),
    zoom: action((step) => {
      const nextGridSize = resolveViewportGridSizeAfterZoom({
        currentGridSize: state.viewport.gridSize,
        step,
      });

      if (nextGridSize === null || nextGridSize === state.viewport.gridSize) {
        return;
      }

      state.viewport.gridSize = nextGridSize;
      state.viewport.gridCellPixelSize = resolveViewportGridCellPixelSize(
        nextGridSize,
      );

      persistViewportSettings();
    }),
    setViewportDisplayRotation: action((displayRotation) => {
      const nextDisplayRotation = normalizeViewportDisplayRotation(displayRotation);
      if (
        nextDisplayRotation === null
        || nextDisplayRotation === state.viewport.displayRotation
      ) {
        return;
      }

      state.viewport.displayRotation = nextDisplayRotation;

      persistViewportSettings();
    }),
  };
}

function normalizeViewportDisplayRotation(value: unknown): GridRotation | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) {
    return value;
  }

  return null;
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
