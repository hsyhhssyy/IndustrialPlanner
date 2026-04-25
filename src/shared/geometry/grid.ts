export type {
  GridPoint,
  GridRectSize,
  GridRotation,
} from "@/domain/types/grid";

import type { GridPoint, GridRectSize, GridRotation } from "@/domain/types/grid";

export interface GridBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridArea {
  position: GridPoint;
  footprint: GridRectSize;
}

export function rotateGridRotationClockwise(
  rotation: GridRotation,
): GridRotation {
  switch (rotation) {
    case 0:
      return 90;
    case 90:
      return 180;
    case 180:
      return 270;
    case 270:
    default:
      return 0;
  }
}

export function getRotatedGridFootprint(
  footprint: GridRectSize,
  rotation: GridRotation,
): GridRectSize {
  if (rotation === 90 || rotation === 270) {
    return {
      width: footprint.height,
      height: footprint.width,
    };
  }

  return {
    width: footprint.width,
    height: footprint.height,
  };
}

export function getGridFootprintCenterCells(
  gridPoint: GridPoint,
  footprint: GridRectSize,
): {
  x: number;
  y: number;
} {
  return {
    x: gridPoint.x + footprint.width / 2,
    y: gridPoint.y + footprint.height / 2,
  };
}

export function getGridBoundsCenterCells(
  bounds: GridBounds,
): {
  x: number;
  y: number;
} {
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
}

export function getGridBoundingBox(
  areas: readonly GridArea[],
): GridBounds | null {
  if (areas.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const area of areas) {
    left = Math.min(left, area.position.x);
    top = Math.min(top, area.position.y);
    right = Math.max(right, area.position.x + area.footprint.width);
    bottom = Math.max(bottom, area.position.y + area.footprint.height);
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function rotateGridCenterCellsClockwise(options: {
  centerCells: {
    x: number;
    y: number;
  };
  rotationCenterCells: {
    x: number;
    y: number;
  };
}): {
  x: number;
  y: number;
} {
  const relativeX = options.centerCells.x - options.rotationCenterCells.x;
  const relativeY = options.centerCells.y - options.rotationCenterCells.y;

  return {
    x: options.rotationCenterCells.x - relativeY,
    y: options.rotationCenterCells.y + relativeX,
  };
}

export function resolveCenteredGridPoint(
  centerCells: {
    x: number;
    y: number;
  },
  footprint: GridRectSize,
): GridPoint {
  return {
    x: Math.max(0, Math.round(centerCells.x - footprint.width / 2)),
    y: Math.max(0, Math.round(centerCells.y - footprint.height / 2)),
  };
}

export function resolveCenteredRotatedGridPoint(options: {
  gridPoint: GridPoint;
  currentFootprint: GridRectSize;
  nextFootprint: GridRectSize;
}): GridPoint {
  return resolveCenteredGridPoint(
    getGridFootprintCenterCells(options.gridPoint, options.currentFootprint),
    options.nextFootprint,
  );
}
