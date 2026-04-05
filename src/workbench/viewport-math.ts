import type { GridPoint } from "@/shared/geometry/grid";
import type {
  CanvasPoint,
  CanvasViewState,
} from "@/workbench/workspace-state";

export interface CanvasViewportMetrics {
  gridSize: number;
  size: CanvasPoint;
  worldSize: CanvasPoint;
}

const MIN_CANVAS_CELL_SIZE_PX = 12;
const MAX_CANVAS_CELL_SIZE_PX = 96;

function getCanvasZoomBounds(gridSize: number) {
  const safeGridSize = gridSize > 0 ? gridSize : 1;

  return {
    minZoom: MIN_CANVAS_CELL_SIZE_PX / safeGridSize,
    maxZoom: MAX_CANVAS_CELL_SIZE_PX / safeGridSize,
  };
}

export function clampCanvasZoom(zoom: number, metrics: CanvasViewportMetrics): number {
  const { minZoom, maxZoom } = getCanvasZoomBounds(metrics.gridSize);

  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

export function clampCanvasViewportSize(size: CanvasPoint): CanvasPoint {
  return {
    x: Math.max(0, size.x),
    y: Math.max(0, size.y),
  };
}

export function clampCanvasOffset(
  offset: CanvasPoint,
  zoom: number,
  metrics: CanvasViewportMetrics,
): CanvasPoint {
  const viewportSize = clampCanvasViewportSize(metrics.size);
  const maxOffsetX = Math.max(0, metrics.worldSize.x - viewportSize.x / zoom);
  const maxOffsetY = Math.max(0, metrics.worldSize.y - viewportSize.y / zoom);

  return {
    x: Math.min(Math.max(0, offset.x), maxOffsetX),
    y: Math.min(Math.max(0, offset.y), maxOffsetY),
  };
}

export function clampCanvasViewState(
  state: CanvasViewState,
  metrics: CanvasViewportMetrics,
): CanvasViewState {
  const zoom = clampCanvasZoom(state.zoom, metrics);
  const offset = clampCanvasOffset(state.offset, zoom, metrics);

  if (
    zoom === state.zoom &&
    offset.x === state.offset.x &&
    offset.y === state.offset.y
  ) {
    return state;
  }

  return {
    zoom,
    offset,
  };
}

export function screenToWorldPoint(
  screenPoint: CanvasPoint,
  canvasView: CanvasViewState,
): CanvasPoint {
  return {
    x: screenPoint.x / canvasView.zoom + canvasView.offset.x,
    y: screenPoint.y / canvasView.zoom + canvasView.offset.y,
  };
}

export function worldToGridPoint(
  worldPoint: CanvasPoint,
  gridSize: number,
): GridPoint {
  return {
    x: Math.max(0, Math.floor(worldPoint.x / gridSize)),
    y: Math.max(0, Math.floor(worldPoint.y / gridSize)),
  };
}

export function panCanvasView(
  state: CanvasViewState,
  screenDelta: CanvasPoint,
  metrics: CanvasViewportMetrics,
): CanvasViewState {
  const nextOffset = clampCanvasOffset(
    {
      x: state.offset.x - screenDelta.x / state.zoom,
      y: state.offset.y - screenDelta.y / state.zoom,
    },
    state.zoom,
    metrics,
  );

  if (nextOffset.x === state.offset.x && nextOffset.y === state.offset.y) {
    return state;
  }

  return {
    ...state,
    offset: nextOffset,
  };
}

export function scaleCanvasViewAt(
  state: CanvasViewState,
  screenPoint: CanvasPoint,
  scaleFactor: number,
  metrics: CanvasViewportMetrics,
): CanvasViewState {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return state;
  }

  const nextZoom = clampCanvasZoom(state.zoom * scaleFactor, metrics);

  if (nextZoom === state.zoom) {
    return state;
  }

  const anchorWorldPoint = screenToWorldPoint(screenPoint, state);
  const nextOffset = clampCanvasOffset(
    {
      x: anchorWorldPoint.x - screenPoint.x / nextZoom,
      y: anchorWorldPoint.y - screenPoint.y / nextZoom,
    },
    nextZoom,
    metrics,
  );

  return {
    zoom: nextZoom,
    offset: nextOffset,
  };
}
