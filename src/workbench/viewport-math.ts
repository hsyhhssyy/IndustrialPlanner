import type { GridPoint } from "@/shared/geometry/grid";
import type {
  CanvasPoint,
  CanvasViewState,
} from "@/workbench/workspace-state";

export interface CanvasViewportMetrics {
  size: CanvasPoint;
  worldSize: CanvasPoint;
}

const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2.5;

export function clampCanvasZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
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
  const zoom = clampCanvasZoom(state.zoom);
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

  const nextZoom = clampCanvasZoom(state.zoom * scaleFactor);

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
