export type GridRotation = 0 | 90 | 180 | 270;

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridFootprint {
  width: number;
  height: number;
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
  footprint: GridFootprint,
  rotation: GridRotation,
): GridFootprint {
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
  footprint: GridFootprint,
): {
  x: number;
  y: number;
} {
  return {
    x: gridPoint.x + footprint.width / 2,
    y: gridPoint.y + footprint.height / 2,
  };
}

export function resolveCenteredGridPoint(
  centerCells: {
    x: number;
    y: number;
  },
  footprint: GridFootprint,
): GridPoint {
  return {
    x: Math.max(0, Math.round(centerCells.x - footprint.width / 2)),
    y: Math.max(0, Math.round(centerCells.y - footprint.height / 2)),
  };
}
