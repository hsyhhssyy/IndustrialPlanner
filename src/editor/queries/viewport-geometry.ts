import {
  resolveViewportRectFromWorldGridRect,
} from "@/shared/geometry/viewport-transform";

import type { EditorStateReadWrite } from "../state-impl";

export function resolveGridCellAtClientPixelPoint(options: {
  clientPixelPoint: {
    x: number;
    y: number;
  };
  viewportState: EditorStateReadWrite["viewport"];
}): {
  x: number;
  y: number;
} | null {
  if (
    !Number.isFinite(options.clientPixelPoint.x)
    || !Number.isFinite(options.clientPixelPoint.y)
  ) {
    return null;
  }

  const gridCellSize = options.viewportState.gridCellPixelSize;

  if (gridCellSize <= 0) {
    return null;
  }

  const worldX =
    options.viewportState.center.x
    + (
      options.clientPixelPoint.x
      - options.viewportState.clientRect.left
      - options.viewportState.clientRect.width / 2
    ) / gridCellSize;
  const worldY =
    options.viewportState.center.y
    + (
      options.clientPixelPoint.y
      - options.viewportState.clientRect.top
      - options.viewportState.clientRect.height / 2
    ) / gridCellSize;

  return {
    x: Math.floor(worldX),
    y: Math.floor(worldY),
  };
}

export function resolveClientRectForGridCell(options: {
  gridCell: {
    x: number;
    y: number;
  };
  viewportState: EditorStateReadWrite["viewport"];
}): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (
    !Number.isFinite(options.gridCell.x)
    || !Number.isFinite(options.gridCell.y)
  ) {
    return null;
  }

  const gridCellSize = options.viewportState.gridCellPixelSize;

  if (gridCellSize <= 0) {
    return null;
  }

  return resolveViewportRectFromWorldGridRect({
    gridRect: {
      x: options.gridCell.x,
      y: options.gridCell.y,
      width: 1,
      height: 1,
    },
    viewportBounds: options.viewportState.clientRect,
    viewportCenter: options.viewportState.center,
    gridCellPixelSize: gridCellSize,
  });
}
