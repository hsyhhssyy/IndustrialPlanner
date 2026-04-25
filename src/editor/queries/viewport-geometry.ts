import { resolveWorldGridCellPixelSize } from "@/shared/geometry/viewport-transform";

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

  const gridCellSize = resolveWorldGridCellPixelSize(
    options.viewportState.gridSize,
  );

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

  const gridCellSize = resolveWorldGridCellPixelSize(
    options.viewportState.gridSize,
  );

  if (gridCellSize <= 0) {
    return null;
  }

  return {
    left:
      options.viewportState.clientRect.left
      +
      options.viewportState.clientRect.width / 2
      + (options.gridCell.x - options.viewportState.center.x) * gridCellSize,
    top:
      options.viewportState.clientRect.top
      +
      options.viewportState.clientRect.height / 2
      + (options.gridCell.y - options.viewportState.center.y) * gridCellSize,
    width: gridCellSize,
    height: gridCellSize,
  };
}
