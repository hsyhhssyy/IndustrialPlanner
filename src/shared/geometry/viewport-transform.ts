import type {
  GridFloatPoint,
  GridRect,
  GridRotation,
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
  displayRotation?: GridRotation;
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
  displayRotation?: GridRotation;
}): ViewportCenterLike {
  const previousClientCenter = resolveViewportClientRectCenter(
    options.previousClientRect,
  );
  const nextClientCenter = resolveViewportClientRectCenter(
    options.nextClientRect,
  );
  const gridCellSize = options.gridCellPixelSize;
  const worldVector = resolveWorldVectorFromViewportVector({
    viewportVector: {
      x: nextClientCenter.x - previousClientCenter.x,
      y: nextClientCenter.y - previousClientCenter.y,
    },
    displayRotation: options.displayRotation,
  });

  return {
    x:
      options.previousViewportCenter.x
      + worldVector.x / gridCellSize,
    y:
      options.previousViewportCenter.y
      + worldVector.y / gridCellSize,
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
  const viewportCenter = resolveViewportClientRectCenter(options.viewportBounds);
  const viewportVector = resolveViewportVectorFromWorldVector({
    worldVector: {
      x: (options.worldPoint.x - options.viewportCenter.x)
        * options.gridCellPixelSize,
      y: (options.worldPoint.y - options.viewportCenter.y)
        * options.gridCellPixelSize,
    },
    displayRotation: options.displayRotation,
  });

  return {
    x: viewportCenter.x + viewportVector.x,
    y: viewportCenter.y + viewportVector.y,
  };
}

export function resolveWorldPointFromViewportPoint(
  options: ViewportProjectionLike & {
    viewportPoint: GridFloatPoint;
  },
): GridFloatPoint | null {
  if (
    !Number.isFinite(options.viewportPoint.x)
    || !Number.isFinite(options.viewportPoint.y)
    || !Number.isFinite(options.gridCellPixelSize)
    || options.gridCellPixelSize <= 0
  ) {
    return null;
  }

  const viewportCenter = resolveViewportClientRectCenter(options.viewportBounds);
  const worldVector = resolveWorldVectorFromViewportVector({
    viewportVector: {
      x: options.viewportPoint.x - viewportCenter.x,
      y: options.viewportPoint.y - viewportCenter.y,
    },
    displayRotation: options.displayRotation,
  });

  return {
    x: options.viewportCenter.x + worldVector.x / options.gridCellPixelSize,
    y: options.viewportCenter.y + worldVector.y / options.gridCellPixelSize,
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

  const corners = [
    { x: options.gridRect.x, y: options.gridRect.y },
    { x: options.gridRect.x + options.gridRect.width, y: options.gridRect.y },
    { x: options.gridRect.x, y: options.gridRect.y + options.gridRect.height },
    {
      x: options.gridRect.x + options.gridRect.width,
      y: options.gridRect.y + options.gridRect.height,
    },
  ].map((worldPoint) => resolveViewportPointFromWorldPoint({
    viewportBounds: options.viewportBounds,
    viewportCenter: options.viewportCenter,
    gridCellPixelSize: options.gridCellPixelSize,
    displayRotation: options.displayRotation,
    worldPoint,
  }));
  const left = Math.min(...corners.map((corner) => corner.x));
  const right = Math.max(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y));
  const bottom = Math.max(...corners.map((corner) => corner.y));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function resolveWorldVectorFromViewportVector(options: {
  viewportVector: GridFloatPoint;
  displayRotation?: GridRotation;
}): GridFloatPoint {
  switch (options.displayRotation ?? 0) {
    case 90:
      return {
        x: options.viewportVector.y,
        y: -options.viewportVector.x,
      };
    case 180:
      return {
        x: -options.viewportVector.x,
        y: -options.viewportVector.y,
      };
    case 270:
      return {
        x: -options.viewportVector.y,
        y: options.viewportVector.x,
      };
    case 0:
    default:
      return {
        x: options.viewportVector.x,
        y: options.viewportVector.y,
      };
  }
}

export function resolveViewportVectorFromWorldVector(options: {
  worldVector: GridFloatPoint;
  displayRotation?: GridRotation;
}): GridFloatPoint {
  switch (options.displayRotation ?? 0) {
    case 90:
      return {
        x: -options.worldVector.y,
        y: options.worldVector.x,
      };
    case 180:
      return {
        x: -options.worldVector.x,
        y: -options.worldVector.y,
      };
    case 270:
      return {
        x: options.worldVector.y,
        y: -options.worldVector.x,
      };
    case 0:
    default:
      return {
        x: options.worldVector.x,
        y: options.worldVector.y,
      };
  }
}

export function resolveDisplayRotationRadians(displayRotation?: GridRotation): number {
  return ((displayRotation ?? 0) * Math.PI) / 180;
}

function isValidWorldGridRect(gridRect: GridRect): boolean {
  return Number.isFinite(gridRect.x)
    && Number.isFinite(gridRect.y)
    && Number.isFinite(gridRect.width)
    && Number.isFinite(gridRect.height)
    && gridRect.width > 0
    && gridRect.height > 0;
}
