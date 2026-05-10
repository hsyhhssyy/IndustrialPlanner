import { EDITOR_GRID_CELL_PIXEL_SIZE } from "./viewport-constants";

export const DEFAULT_VIEWPORT_GRID_SIZE = 1;

const VIEWPORT_ZOOM_STEPS_PER_DOUBLING = 6;
const MIN_VIEWPORT_GRID_SIZE = 1 / 16;
const MAX_VIEWPORT_GRID_SIZE = 16;

export function resolveViewportGridSizeAfterZoom(options: {
  currentGridSize: number;
  step: number;
}): number | null {
  if (!Number.isFinite(options.step) || options.step === 0) {
    return null;
  }

  const zoomFactor = Math.pow(
    2,
    options.step / VIEWPORT_ZOOM_STEPS_PER_DOUBLING,
  );

  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return null;
  }

  return clampViewportGridSize(
    clampViewportGridSize(options.currentGridSize) * zoomFactor,
  );
}

export function resolveViewportGridCellPixelSize(gridSize: number): number {
  return EDITOR_GRID_CELL_PIXEL_SIZE * clampViewportGridSize(gridSize);
}

export function clampViewportGridSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_VIEWPORT_GRID_SIZE;
  }

  return Math.min(MAX_VIEWPORT_GRID_SIZE, Math.max(MIN_VIEWPORT_GRID_SIZE, value));
}
