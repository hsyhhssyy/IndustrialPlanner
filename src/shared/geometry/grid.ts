export type {
  GridPoint,
  GridRectSize,
  GridRotation,
} from "@/domain/shared/grid";

import type { GridPoint, GridRectSize, GridRotation } from "@/domain/shared/grid";

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

export function rotateGridRotation(
  rotation: GridRotation,
  offset: GridRotation,
): GridRotation {
  return ((rotation + offset) % 360) as GridRotation;
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

/**
 * 将 rotation=0 坐标系下的 spriteOffset 旋转到指定 rotation 坐标系。
 * 旋转公式：90° CW = (x,y) → (-y,x)，尺寸宽高互换。
 *
 * @param offset rotation=0 下的精灵偏移 { x, y, width, height }
 * @param rotation 目标旋转角度
 * @returns 旋转后的偏移
 */
export function rotateSpriteOffset(
  offset: { x: number; y: number; width: number; height: number },
  rotation: GridRotation,
): { x: number; y: number; width: number; height: number } {
  switch (rotation) {
    case 0:
      return offset
    case 90:
      return {
        x: -offset.y || 0,
        y: offset.x || 0,
        width: offset.height,
        height: offset.width,
      }
    case 180:
      return {
        x: -offset.x || 0,
        y: -offset.y || 0,
        width: offset.width,
        height: offset.height,
      }
    case 270:
      return {
        x: offset.y || 0,
        y: -offset.x || 0,
        width: offset.height,
        height: offset.width,
      }
    default:
      return offset
  }
}

/**
 * 根据 footprint / spriteOffset / rotation 计算精灵在世界坐标中的实际
 * 网格矩形（单位：格子）。
 *
 * 当 spriteOffset 为 null 时，精灵矩形 = footprint 旋转后的矩形。
 * 当 spriteOffset 存在时，精灵矩形 = position + rotatedOffset。
 */
export function resolveSpriteGridRect(
  position: GridPoint,
  footprint: GridRectSize,
  spriteOffset: { x: number; y: number; width: number; height: number } | null,
  rotation: GridRotation,
): { x: number; y: number; width: number; height: number } {
  if (spriteOffset === null) {
    const rotated = getRotatedGridFootprint(footprint, rotation)
    return {
      x: position.x,
      y: position.y,
      width: rotated.width,
      height: rotated.height,
    }
  }

  const rotatedOffset = rotateSpriteOffset(spriteOffset, rotation)
  return {
    x: position.x + rotatedOffset.x,
    y: position.y + rotatedOffset.y,
    width: rotatedOffset.width,
    height: rotatedOffset.height,
  }
}
