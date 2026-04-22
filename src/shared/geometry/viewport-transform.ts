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

export const WORLD_GRID_CELL_PIXEL_SIZE = 16;

export function resolveViewportGridSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return value;
}

export function resolveWorldGridCellPixelSize(gridSize: number): number {
  return WORLD_GRID_CELL_PIXEL_SIZE * resolveViewportGridSize(gridSize);
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
  gridSize: number;
}): ViewportCenterLike {
  const previousClientCenter = resolveViewportClientRectCenter(
    options.previousClientRect,
  );
  const nextClientCenter = resolveViewportClientRectCenter(
    options.nextClientRect,
  );
  const gridCellSize = resolveWorldGridCellPixelSize(options.gridSize);

  return {
    x:
      options.previousViewportCenter.x
      + (nextClientCenter.x - previousClientCenter.x) / gridCellSize,
    y:
      options.previousViewportCenter.y
      + (nextClientCenter.y - previousClientCenter.y) / gridCellSize,
  };
}