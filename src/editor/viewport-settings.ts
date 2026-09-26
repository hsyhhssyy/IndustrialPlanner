import { EDITOR_GRID_CELL_PIXEL_SIZE } from "./viewport-constants";

export const DEFAULT_VIEWPORT_GRID_SIZE = 1;

import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import { resolveBaseOuterBounds } from "@/shared/geometry/base-areas";

const VIEWPORT_ZOOM_STEPS_PER_DOUBLING = 6;
const BASE_WARNING_PADDING_CELLS = 2;
const MIN_VIEWPORT_GRID_SIZE = 0.5;
const MAX_VIEWPORT_GRID_SIZE = 8;

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

export function clampViewportCenterToBaseWarningBounds(options: {
  center: {
    x: number;
    y: number;
  };
  baseDefinition: BaseDefinition | null;
}): {
  x: number;
  y: number;
} {
  if (options.baseDefinition === null) {
    return {
      x: options.center.x,
      y: options.center.y,
    };
  }

  const bounds = resolveBaseWarningBounds(options.baseDefinition);

  if (bounds === null) {
    return {
      x: options.center.x,
      y: options.center.y,
    };
  }

  return {
    x: clampViewportAxisToBounds(options.center.x, bounds.minX, bounds.maxX),
    y: clampViewportAxisToBounds(options.center.y, bounds.minY, bounds.maxY),
  };
}

function resolveBaseWarningBounds(baseDefinition: BaseDefinition): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  // AI-REMOVED 2026-09-26:
  // Reason: 视口限制只考虑主区域时无法定位左上角分区。
  // Trigger: 草稿箱不连续建造区。
  // Evidence: resolveBaseOuterBounds 返回全部分区的外接范围。
  // Replacement: 下方按共享外接范围计算警告边界。
  // Risk: 外接范围内的空地可被视口居中，但仍不能放置。
  // Human Review: Required
  // Original code:
  // const minX = -baseDefinition.outerRing.left - BASE_WARNING_PADDING_CELLS;
  // const minY = -baseDefinition.outerRing.top - BASE_WARNING_PADDING_CELLS;
  // const maxX = baseDefinition.placeableArea.width + baseDefinition.outerRing.right + BASE_WARNING_PADDING_CELLS;
  // const maxY = baseDefinition.placeableArea.height + baseDefinition.outerRing.bottom + BASE_WARNING_PADDING_CELLS;
  const outerBounds = resolveBaseOuterBounds(baseDefinition);
  const minX = outerBounds.x - BASE_WARNING_PADDING_CELLS;
  const minY = outerBounds.y - BASE_WARNING_PADDING_CELLS;
  const maxX = outerBounds.x + outerBounds.width + BASE_WARNING_PADDING_CELLS;
  const maxY = outerBounds.y + outerBounds.height + BASE_WARNING_PADDING_CELLS;

  if (
    !Number.isFinite(minX)
    || !Number.isFinite(minY)
    || !Number.isFinite(maxX)
    || !Number.isFinite(maxY)
    || maxX < minX
    || maxY < minY
  ) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
  };
}

function clampViewportAxisToBounds(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
