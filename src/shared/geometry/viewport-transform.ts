import type {
  GridFloatPoint,
  GridRect,
} from "@/domain/shared/grid";

export interface ViewportClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportCenterLike {
  x: number;
  y: number;
}

export interface ViewportProjectionLike {
  viewportBounds: ViewportClientRectLike;
  viewportCenter: ViewportCenterLike;
  gridCellPixelSize: number;
}

export const WORLD_GRID_CELL_PIXEL_SIZE = 16;

export function resolveViewportGridSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return value;
}

export function resolveViewportClientRectCenter(rect: ViewportClientRectLike): {
  x: number;
  y: number;
} {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function resolveCompensatedViewportCenter(options: {
  previousClientRect: ViewportClientRectLike;
  nextClientRect: ViewportClientRectLike;
  previousViewportCenter: ViewportCenterLike;
  gridCellPixelSize: number;
}): ViewportCenterLike {
  const previousClientCenter = resolveViewportClientRectCenter(
    options.previousClientRect,
  );
  const nextClientCenter = resolveViewportClientRectCenter(
    options.nextClientRect,
  );
  const gridCellSize = options.gridCellPixelSize;

  return {
    x:
      options.previousViewportCenter.x
      + (nextClientCenter.x - previousClientCenter.x) / gridCellSize,
    y:
      options.previousViewportCenter.y
      + (nextClientCenter.y - previousClientCenter.y) / gridCellSize,
  };
}

export function resolveViewportAxisPixelPosition(options: {
  viewportStart: number;
  viewportSpan: number;
  viewportCenter: number;
  gridCellPixelSize: number;
  worldCoordinate: number;
}): number {
  return (
    options.viewportStart
    + options.viewportSpan / 2
    + (options.worldCoordinate - options.viewportCenter)
      * options.gridCellPixelSize
  );
}

export function resolveViewportPointFromWorldPoint(
  options: ViewportProjectionLike & {
    worldPoint: GridFloatPoint;
  },
): GridFloatPoint {
  return {
    x: resolveViewportAxisPixelPosition({
      viewportStart: options.viewportBounds.left,
      viewportSpan: options.viewportBounds.width,
      viewportCenter: options.viewportCenter.x,
      gridCellPixelSize: options.gridCellPixelSize,
      worldCoordinate: options.worldPoint.x,
    }),
    y: resolveViewportAxisPixelPosition({
      viewportStart: options.viewportBounds.top,
      viewportSpan: options.viewportBounds.height,
      viewportCenter: options.viewportCenter.y,
      gridCellPixelSize: options.gridCellPixelSize,
      worldCoordinate: options.worldPoint.y,
    }),
  };
}

export function resolveViewportRectFromWorldGridRect(
  options: ViewportProjectionLike & {
    gridRect: GridRect;
  },
): ViewportClientRectLike | null {
  if (!isValidWorldGridRect(options.gridRect)) {
    return null;
  }

  const topLeft = resolveViewportPointFromWorldPoint({
    viewportBounds: options.viewportBounds,
    viewportCenter: options.viewportCenter,
    gridCellPixelSize: options.gridCellPixelSize,
    worldPoint: {
      x: options.gridRect.x,
      y: options.gridRect.y,
    },
  });

  return {
    left: topLeft.x,
    top: topLeft.y,
    width: options.gridRect.width * options.gridCellPixelSize,
    height: options.gridRect.height * options.gridCellPixelSize,
  };
}

function isValidWorldGridRect(gridRect: GridRect): boolean {
  return Number.isFinite(gridRect.x)
    && Number.isFinite(gridRect.y)
    && Number.isFinite(gridRect.width)
    && Number.isFinite(gridRect.height)
    && gridRect.width > 0
    && gridRect.height > 0;
}
