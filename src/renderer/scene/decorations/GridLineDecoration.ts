import { Graphics } from "pixi.js";
import type { AppTheme } from "@/domain/app/types/theme";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { ActiveTool } from "@/domain/app/types/app-types";
import type { GridRect } from "@/domain/shared/grid";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import {
  BASE_OUTER_WARNING_PADDING_CELLS,
  resolveBaseOuterGridRect,
  resolveCurrentBaseDefinition,
  resolveExpandedGridRect,
} from "./BaseBoundaryDecoration";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const WORLD_GRID_LINE_ALPHA = 0.30;
// Reason: 固定 1.5px 线宽无法表达 REQ-059 的分级降级规则。
// Trigger: ST1-RQ-059 要求格线宽度随缩放级别从 2px 逐级收敛到 1px。
// Evidence: .docs/stages/stage1/requirements/REQ-059-fluid-grid-line-drawing-rules.md
// Replacement: 同文件中的 WORLD_GRID_FINE_LINE_WIDTH、WORLD_GRID_MAJOR_LINE_WIDTH、WORLD_GRID_REDUCED_LINE_WIDTH。
// Risk: Low
// Human Review: Required
//
// Original code:
// const WORLD_GRID_LINE_WIDTH = 1.5;
const WORLD_GRID_FINE_LINE_WIDTH = 1;
const WORLD_GRID_MAJOR_LINE_WIDTH = 2;
const WORLD_GRID_REDUCED_LINE_WIDTH = 1;
const WORLD_GRID_MAJOR_LINE_INTERVAL = 5;
// Reason: 粗格线不再通过固定倍率从细线样式推导，而是按 Level 直接指定 2px 或 1px。
// Trigger: ST1-RQ-059 要求 Level 1-3 粗线 2px，Level 4-5 粗线 1px。
// Evidence: .docs/stages/stage1/requirements/REQ-059-fluid-grid-line-drawing-rules.md
// Replacement: 同文件中的 WORLD_GRID_MAJOR_LINE_WIDTH 与 WORLD_GRID_REDUCED_LINE_WIDTH。
// Risk: Low
// Human Review: Required
//
// Original code:
// const WORLD_GRID_MAJOR_LINE_WIDTH_MULTIPLIER = 2;
/** 缩放阈值：zoom >= A 时所有格线都不需要 pixelLine。 */
export const WORLD_GRID_ZOOM_THRESHOLD_A = 48;
/** 缩放阈值：B <= zoom < A 时仅细格线启用 pixelLine。 */
export const WORLD_GRID_ZOOM_THRESHOLD_B = 28;
/** 缩放阈值：C <= zoom < B 时全部格线启用 pixelLine，粗线保持 2px。 */
export const WORLD_GRID_ZOOM_THRESHOLD_C = 16;
/** 缩放阈值：D <= zoom < C 时细格线开始淡出，粗线和交点切换到 1px。 */
export const WORLD_GRID_ZOOM_THRESHOLD_D = 8;
/** 缩放阈值：E <= zoom < D 时仅粗线与交点继续淡出。 */
export const WORLD_GRID_ZOOM_THRESHOLD_E = 4;
const WORLD_GRID_PREVIEW_PADDING_CELLS = 4;
const WORLD_GRID_PREVIEW_MIN_HALF_SPAN_CELLS = 8;
const WORLD_GRID_SEGMENT_LENGTH_RATIO = 0.5;
const WORLD_GRID_INTERSECTION_DOT_SIZE_RATIO = 0.24;
// Reason: 交点尺寸不再使用固定最小值，避免远缩放下放大成噪声。
// Trigger: ST1-RQ-059 要求交点尺寸按 Level 上限收敛到 2px / 1px。
// Evidence: .docs/stages/stage1/requirements/REQ-059-fluid-grid-line-drawing-rules.md
// Replacement: 同文件中的 WORLD_GRID_INTERSECTION_DOT_FULL_SIZE 与 WORLD_GRID_INTERSECTION_DOT_REDUCED_SIZE。
// Risk: Low
// Human Review: Required
//
// Original code:
// const WORLD_GRID_INTERSECTION_DOT_MIN_SIZE = 2.5;
// Reason: 交点尺寸不再使用固定最大值，而是按缩放 Level 选择 2px 或 1px 的上限。
// Trigger: ST1-RQ-059 需要交点在 Level 4-5 缩到 1px。
// Evidence: .docs/stages/stage1/requirements/REQ-059-fluid-grid-line-drawing-rules.md
// Replacement: 同文件中的 WORLD_GRID_INTERSECTION_DOT_FULL_SIZE 与 WORLD_GRID_INTERSECTION_DOT_REDUCED_SIZE。
// Risk: Low
// Human Review: Required
//
// Original code:
// const WORLD_GRID_INTERSECTION_DOT_MAX_SIZE = 4.5;
const WORLD_GRID_INTERSECTION_DOT_FULL_SIZE = 2;
const WORLD_GRID_INTERSECTION_DOT_REDUCED_SIZE = 1;
const WORLD_GRID_INTERSECTION_DOT_ALPHA_MULTIPLIER = 1.75;
const GRASS_BACKGROUND_GRID_LINE_COLOR = 0x000000;

interface WorldGridLinePosition {
  lineIndex: number;
  position: number;
}

export interface WorldGridLineAxisGroup {
  fine: number[];
  major: number[];
}

export interface WorldGridLineSegmentSpan {
  start: number;
  end: number;
}

export interface WorldGridLineBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type WorldGridVisibilityScope =
  | { kind: "all" }
  | { kind: "hidden" }
  | { kind: "local"; lineBounds: WorldGridLineBounds };

export function resolveWorldGridLineBoundsFromGridRect(
  gridRect: GridRect,
): WorldGridLineBounds | null {
  if (
    !Number.isFinite(gridRect.x)
    || !Number.isFinite(gridRect.y)
    || !Number.isFinite(gridRect.width)
    || !Number.isFinite(gridRect.height)
    || gridRect.width <= 0
    || gridRect.height <= 0
  ) {
    return null;
  }

  return {
    left: gridRect.x,
    top: gridRect.y,
    right: gridRect.x + gridRect.width,
    bottom: gridRect.y + gridRect.height,
  };
}

export function intersectWorldGridLineBounds(
  leftBounds: WorldGridLineBounds,
  rightBounds: WorldGridLineBounds,
): WorldGridLineBounds | null {
  const bounds: WorldGridLineBounds = {
    left: Math.max(leftBounds.left, rightBounds.left),
    top: Math.max(leftBounds.top, rightBounds.top),
    right: Math.min(leftBounds.right, rightBounds.right),
    bottom: Math.min(leftBounds.bottom, rightBounds.bottom),
  };

  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return null;
  }

  return bounds;
}

export function resolveWorldGridStrokeStyle(
  theme: AppTheme,
  options: {
    width?: number;
    alpha?: number;
    pixelLine?: boolean;
    forceColor?: number;
  } = {},
): {
  width: number;
  color: number;
  alpha: number;
  pixelLine?: boolean;
} {
  const strokeStyle: {
    width: number;
    color: number;
    alpha: number;
    pixelLine?: boolean;
  } = {
    width: options.width ?? WORLD_GRID_FINE_LINE_WIDTH,
    color:
      options.forceColor ??
      resolveAppThemeColorNumber(
        theme,
        theme.renderer.worldGridLineColorKey,
      ),
    alpha: options.alpha ?? WORLD_GRID_LINE_ALPHA,
  };

  if (options.pixelLine === true) {
    strokeStyle.pixelLine = true;
  }

  return strokeStyle;
}

export function resolveWorldGridMajorStrokeStyle(
  theme: AppTheme,
  options: {
    width?: number;
    alpha?: number;
    pixelLine?: boolean;
    forceColor?: number;
  } = {},
): {
  width: number;
  color: number;
  alpha: number;
  pixelLine?: boolean;
} {
  return resolveWorldGridStrokeStyle(theme, {
    width: options.width ?? WORLD_GRID_MAJOR_LINE_WIDTH,
    alpha: options.alpha,
    pixelLine: options.pixelLine,
    forceColor: options.forceColor,
  });
}

export function computeFadeAlpha(
  zoom: number,
  upper: number,
  lower: number,
): number {
  if (upper <= lower) {
    return zoom > lower ? 1 : 0;
  }

  return Math.max(0, Math.min(1, (zoom - lower) / (upper - lower)));
}

export function resolveWorldGridRenderState(gridCellPixelSize: number): {
  fineVisible: boolean;
  fineAlpha: number;
  fineWidth: number;
  finePixelLine: boolean;
  majorVisible: boolean;
  majorAlpha: number;
  majorWidth: number;
  majorPixelLine: boolean;
  dotVisible: boolean;
  dotAlpha: number;
  dotMaxSize: number;
} {
  const fineAlpha = gridCellPixelSize >= WORLD_GRID_ZOOM_THRESHOLD_C
    ? 1
    : computeFadeAlpha(
      gridCellPixelSize,
      WORLD_GRID_ZOOM_THRESHOLD_C,
      WORLD_GRID_ZOOM_THRESHOLD_D,
    );
  const majorAlpha = gridCellPixelSize >= WORLD_GRID_ZOOM_THRESHOLD_D
    ? 1
    : computeFadeAlpha(
      gridCellPixelSize,
      WORLD_GRID_ZOOM_THRESHOLD_D,
      WORLD_GRID_ZOOM_THRESHOLD_E,
    );

  return {
    fineVisible: fineAlpha > 0,
    fineAlpha,
    fineWidth: WORLD_GRID_FINE_LINE_WIDTH,
    finePixelLine: gridCellPixelSize < WORLD_GRID_ZOOM_THRESHOLD_A,
    majorVisible: majorAlpha > 0,
    majorAlpha,
    majorWidth: gridCellPixelSize >= WORLD_GRID_ZOOM_THRESHOLD_C
      ? WORLD_GRID_MAJOR_LINE_WIDTH
      : WORLD_GRID_REDUCED_LINE_WIDTH,
    majorPixelLine: gridCellPixelSize < WORLD_GRID_ZOOM_THRESHOLD_B,
    dotVisible: majorAlpha > 0,
    dotAlpha: majorAlpha,
    dotMaxSize: gridCellPixelSize >= WORLD_GRID_ZOOM_THRESHOLD_C
      ? WORLD_GRID_INTERSECTION_DOT_FULL_SIZE
      : WORLD_GRID_INTERSECTION_DOT_REDUCED_SIZE,
  };
}

export function resolveWorldGridLineAxes(options: {
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
}): {
  vertical: WorldGridLineAxisGroup;
  horizontal: WorldGridLineAxisGroup;
} {
  const gridCellSize = options.gridCellPixelSize;

  return {
    vertical: resolveWorldGridAxisGroup({
      viewportStart: options.viewportBounds.left,
      viewportSpan: options.viewportBounds.width,
      worldCenter: options.viewportCenter.x,
      gridCellSize,
    }),
    horizontal: resolveWorldGridAxisGroup({
      viewportStart: options.viewportBounds.top,
      viewportSpan: options.viewportBounds.height,
      worldCenter: options.viewportCenter.y,
      gridCellSize,
    }),
  };
}

export function resolveWorldGridPreviewFocusLineBounds(
  previewGridRect: GridRect,
): WorldGridLineBounds {
  const expandedBounds: WorldGridLineBounds = {
    left: previewGridRect.x - WORLD_GRID_PREVIEW_PADDING_CELLS,
    top: previewGridRect.y - WORLD_GRID_PREVIEW_PADDING_CELLS,
    right:
      previewGridRect.x
      + previewGridRect.width
      + WORLD_GRID_PREVIEW_PADDING_CELLS,
    bottom:
      previewGridRect.y
      + previewGridRect.height
      + WORLD_GRID_PREVIEW_PADDING_CELLS,
  };
  const previewCenterCellX = Math.floor(
    previewGridRect.x + previewGridRect.width / 2,
  );
  const previewCenterCellY = Math.floor(
    previewGridRect.y + previewGridRect.height / 2,
  );
  const centeredBounds: WorldGridLineBounds = {
    left: previewCenterCellX - WORLD_GRID_PREVIEW_MIN_HALF_SPAN_CELLS,
    top: previewCenterCellY - WORLD_GRID_PREVIEW_MIN_HALF_SPAN_CELLS,
    right: previewCenterCellX + WORLD_GRID_PREVIEW_MIN_HALF_SPAN_CELLS + 1,
    bottom: previewCenterCellY + WORLD_GRID_PREVIEW_MIN_HALF_SPAN_CELLS + 1,
  };

  return {
    left: Math.min(expandedBounds.left, centeredBounds.left),
    top: Math.min(expandedBounds.top, centeredBounds.top),
    right: Math.max(expandedBounds.right, centeredBounds.right),
    bottom: Math.max(expandedBounds.bottom, centeredBounds.bottom),
  };
}

export function resolveWorldGridVisibilityScope(options: {
  alwaysShowGridLines: boolean;
  activeTool: ActiveTool;
  previewGridRect: GridRect | null;
}): WorldGridVisibilityScope {
  if (options.alwaysShowGridLines || options.activeTool === "marquee") {
    return { kind: "all" };
  }

  if (options.previewGridRect === null) {
    return { kind: "hidden" };
  }

  return {
    kind: "local",
    lineBounds: resolveWorldGridPreviewFocusLineBounds(options.previewGridRect),
  };
}

function resolveWorldGridAxisGroup(options: {
  viewportStart: number;
  viewportSpan: number;
  worldCenter: number;
  gridCellSize: number;
}): WorldGridLineAxisGroup {
  const linePositions = resolveWorldGridAxisPositions(options);
  const renderState = resolveWorldGridRenderState(options.gridCellSize);
  const group: WorldGridLineAxisGroup = {
    fine: [],
    major: [],
  };

  if (!renderState.fineVisible && !renderState.majorVisible) {
    return group;
  }

  for (const linePosition of linePositions) {
    if (linePosition.lineIndex % WORLD_GRID_MAJOR_LINE_INTERVAL === 0) {
      if (renderState.majorVisible) {
        group.major.push(linePosition.position);
      }
      continue;
    }

    if (renderState.fineVisible) {
      group.fine.push(linePosition.position);
    }
  }

  return group;
}

function resolveWorldGridAxisPositions(options: {
  viewportStart: number;
  viewportSpan: number;
  worldCenter: number;
  gridCellSize: number;
}): WorldGridLinePosition[] {
  if (options.viewportSpan <= 0 || options.gridCellSize <= 0) {
    return [];
  }

  const axisCenter = options.viewportStart + options.viewportSpan / 2;
  const worldOrigin = axisCenter - options.worldCenter * options.gridCellSize;
  const firstLineIndex = Math.ceil(
    (options.viewportStart - worldOrigin) / options.gridCellSize,
  );
  const linePositions: WorldGridLinePosition[] = [];
  const viewportEnd = options.viewportStart + options.viewportSpan;

  for (
    let lineIndex = firstLineIndex;
    worldOrigin + lineIndex * options.gridCellSize <= viewportEnd;
    lineIndex += 1
  ) {
    linePositions.push({
      lineIndex,
      position: worldOrigin + lineIndex * options.gridCellSize,
    });
  }

  return linePositions;
}

function resolveWorldGridVisibleAxisPositions(
  axisGroup: WorldGridLineAxisGroup,
): number[] {
  return Array.from(new Set([...axisGroup.fine, ...axisGroup.major])).sort(
    (left, right) => left - right,
  );
}

function filterWorldGridAxisPositionsWithinBounds(options: {
  axisPositions: readonly number[];
  viewportStart: number;
  viewportSpan: number;
}): number[] {
  const viewportEnd = options.viewportStart + options.viewportSpan;

  return options.axisPositions.filter(
    (position) => position >= options.viewportStart && position <= viewportEnd,
  );
}

export function clipWorldGridLineAxesToViewportBounds(options: {
  lineAxes: {
    vertical: WorldGridLineAxisGroup;
    horizontal: WorldGridLineAxisGroup;
  };
  viewportBounds: DecorationSyncContext["viewportBounds"];
}): {
  vertical: WorldGridLineAxisGroup;
  horizontal: WorldGridLineAxisGroup;
} {
  return {
    vertical: {
      fine: filterWorldGridAxisPositionsWithinBounds({
        axisPositions: options.lineAxes.vertical.fine,
        viewportStart: options.viewportBounds.left,
        viewportSpan: options.viewportBounds.width,
      }),
      major: filterWorldGridAxisPositionsWithinBounds({
        axisPositions: options.lineAxes.vertical.major,
        viewportStart: options.viewportBounds.left,
        viewportSpan: options.viewportBounds.width,
      }),
    },
    horizontal: {
      fine: filterWorldGridAxisPositionsWithinBounds({
        axisPositions: options.lineAxes.horizontal.fine,
        viewportStart: options.viewportBounds.top,
        viewportSpan: options.viewportBounds.height,
      }),
      major: filterWorldGridAxisPositionsWithinBounds({
        axisPositions: options.lineAxes.horizontal.major,
        viewportStart: options.viewportBounds.top,
        viewportSpan: options.viewportBounds.height,
      }),
    },
  };
}

export function resolveWorldGridDisconnectedSegmentSpans(options: {
  axisPositions: readonly number[];
  viewportStart: number;
  viewportSpan: number;
}): WorldGridLineSegmentSpan[] {
  if (options.viewportSpan <= 0) {
    return [];
  }

  const viewportEnd = options.viewportStart + options.viewportSpan;
  const stops = Array.from(
    new Set([options.viewportStart, ...options.axisPositions, viewportEnd]),
  ).sort((left, right) => left - right);
  const spans: WorldGridLineSegmentSpan[] = [];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const intervalStart = stops[index];
    const intervalEnd = stops[index + 1];

    if (intervalStart === undefined || intervalEnd === undefined) {
      continue;
    }

    if (intervalEnd <= intervalStart) {
      continue;
    }

    const segmentLength
      = (intervalEnd - intervalStart) * WORLD_GRID_SEGMENT_LENGTH_RATIO;
    const segmentCenter = (intervalStart + intervalEnd) / 2;
    const halfSegmentLength = segmentLength / 2;

    spans.push({
      start: segmentCenter - halfSegmentLength,
      end: segmentCenter + halfSegmentLength,
    });
  }

  return spans;
}

export function resolveWorldGridIntersectionDotSize(
  gridCellPixelSize: number,
): number {
  return Math.min(
    resolveWorldGridRenderState(gridCellPixelSize).dotMaxSize,
    gridCellPixelSize * WORLD_GRID_INTERSECTION_DOT_SIZE_RATIO,
  );
}

function resolveWorldGridLinePixelPosition(options: {
  viewportStart: number;
  viewportSpan: number;
  worldCenter: number;
  gridCellSize: number;
  lineCoordinate: number;
}): number {
  const axisCenter = options.viewportStart + options.viewportSpan / 2;
  const worldOrigin = axisCenter - options.worldCenter * options.gridCellSize;

  return worldOrigin + options.lineCoordinate * options.gridCellSize;
}

export function resolveWorldGridLocalViewportBounds(options: {
  viewportBounds: DecorationSyncContext["viewportBounds"];
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
  lineBounds: WorldGridLineBounds;
}): DecorationSyncContext["viewportBounds"] | null {
  const rawLeft = resolveWorldGridLinePixelPosition({
    viewportStart: options.viewportBounds.left,
    viewportSpan: options.viewportBounds.width,
    worldCenter: options.viewportCenter.x,
    gridCellSize: options.gridCellPixelSize,
    lineCoordinate: options.lineBounds.left,
  });
  const rawRight = resolveWorldGridLinePixelPosition({
    viewportStart: options.viewportBounds.left,
    viewportSpan: options.viewportBounds.width,
    worldCenter: options.viewportCenter.x,
    gridCellSize: options.gridCellPixelSize,
    lineCoordinate: options.lineBounds.right,
  });
  const rawTop = resolveWorldGridLinePixelPosition({
    viewportStart: options.viewportBounds.top,
    viewportSpan: options.viewportBounds.height,
    worldCenter: options.viewportCenter.y,
    gridCellSize: options.gridCellPixelSize,
    lineCoordinate: options.lineBounds.top,
  });
  const rawBottom = resolveWorldGridLinePixelPosition({
    viewportStart: options.viewportBounds.top,
    viewportSpan: options.viewportBounds.height,
    worldCenter: options.viewportCenter.y,
    gridCellSize: options.gridCellPixelSize,
    lineCoordinate: options.lineBounds.bottom,
  });
  const viewportRight = options.viewportBounds.left + options.viewportBounds.width;
  const viewportBottom = options.viewportBounds.top + options.viewportBounds.height;
  const left = Math.max(
    options.viewportBounds.left,
    Math.min(rawLeft, rawRight),
  );
  const right = Math.min(viewportRight, Math.max(rawLeft, rawRight));
  const top = Math.max(
    options.viewportBounds.top,
    Math.min(rawTop, rawBottom),
  );
  const bottom = Math.min(viewportBottom, Math.max(rawTop, rawBottom));

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function resolveWorldGridIntersectionDotAlpha(baseAlpha: number): number {
  return Math.min(0.72, baseAlpha * WORLD_GRID_INTERSECTION_DOT_ALPHA_MULTIPLIER);
}

function drawGridLineAxes(options: {
  graphics: Graphics;
  vertical: number[];
  horizontal: number[];
  allVertical: number[];
  allHorizontal: number[];
  viewportBounds: DecorationSyncContext["viewportBounds"];
}): void {
  const horizontalSegments = resolveWorldGridDisconnectedSegmentSpans({
    axisPositions: options.allVertical,
    viewportStart: options.viewportBounds.left,
    viewportSpan: options.viewportBounds.width,
  });

  for (const y of options.horizontal) {
    for (const segment of horizontalSegments) {
      options.graphics.moveTo(segment.start, y).lineTo(segment.end, y);
    }
  }

  const verticalSegments = resolveWorldGridDisconnectedSegmentSpans({
    axisPositions: options.allHorizontal,
    viewportStart: options.viewportBounds.top,
    viewportSpan: options.viewportBounds.height,
  });

  for (const x of options.vertical) {
    for (const segment of verticalSegments) {
      options.graphics.moveTo(x, segment.start).lineTo(x, segment.end);
    }
  }
}

function drawGridIntersectionDots(options: {
  graphics: Graphics;
  vertical: number[];
  horizontal: number[];
  gridCellPixelSize: number;
  style: ReturnType<typeof resolveWorldGridStrokeStyle>;
}): void {
  if (options.vertical.length === 0 || options.horizontal.length === 0) {
    return;
  }

  const dotSize = resolveWorldGridIntersectionDotSize(options.gridCellPixelSize);
  const dotOffset = dotSize / 2;

  for (const x of options.vertical) {
    for (const y of options.horizontal) {
      options.graphics.rect(x - dotOffset, y - dotOffset, dotSize, dotSize);
    }
  }

  options.graphics.fill({
    color: options.style.color,
    alpha: resolveWorldGridIntersectionDotAlpha(options.style.alpha),
  });
}

export function createGridLineDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const app = ctx.renderHost.workspace.app;
      if (!app) {
        return;
      }

      const theme = ctx.theme;
      const showGrass = app.state.settings.showGrassBackground;
      const forceColor = showGrass
        ? GRASS_BACKGROUND_GRID_LINE_COLOR
        : undefined;
      const visibilityScope = resolveWorldGridVisibilityScope({
        alwaysShowGridLines: app.state.settings.gameAlwaysShowGridLines,
        activeTool: app.state.activeTool,
        previewGridRect:
          ctx.renderHost.workspace.editor?.queries.findEntityCollectionGridRect(
            EntityCollectionType.preview,
          ) ?? null,
      });

      if (visibilityScope.kind === "hidden") {
        return;
      }

      const baseDefinition = resolveCurrentBaseDefinition(ctx)
      const baseOuterGridRect = baseDefinition === null
        ? null
        : resolveBaseOuterGridRect(baseDefinition)
      const baseWarningGridRect = baseOuterGridRect === null
        ? null
        : resolveExpandedGridRect(
          baseOuterGridRect,
          BASE_OUTER_WARNING_PADDING_CELLS,
        )
      const baseLineBounds = baseWarningGridRect === null
        ? null
        : resolveWorldGridLineBoundsFromGridRect(baseWarningGridRect)
      const lineBounds = visibilityScope.kind === "all"
        ? baseLineBounds
        : visibilityScope.kind === "local"
          ? (baseLineBounds === null
            ? visibilityScope.lineBounds
            : intersectWorldGridLineBounds(
              baseLineBounds,
              visibilityScope.lineBounds,
            ))
          : null

      if (visibilityScope.kind === "local" && lineBounds === null) {
        return
      }

      const drawViewportBounds = lineBounds === null
        ? ctx.viewportBounds
        : resolveWorldGridLocalViewportBounds({
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          lineBounds,
        })

      if (drawViewportBounds === null) {
        return;
      }

      const renderState = resolveWorldGridRenderState(
        ctx.viewportState.gridCellPixelSize,
      );

      if (!renderState.fineVisible && !renderState.majorVisible) {
        return;
      }

      const fullViewportLineAxes = resolveWorldGridLineAxes({
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      });
      const lineAxes = lineBounds !== null
        ? clipWorldGridLineAxesToViewportBounds({
          lineAxes: fullViewportLineAxes,
          viewportBounds: drawViewportBounds,
        })
        : fullViewportLineAxes;

      const allVerticalPositions = resolveWorldGridVisibleAxisPositions(
        lineAxes.vertical,
      );
      const allHorizontalPositions = resolveWorldGridVisibleAxisPositions(
        lineAxes.horizontal,
      );
      const fineStrokeStyle = renderState.fineVisible
        ? resolveWorldGridStrokeStyle(theme, {
          forceColor,
          width: renderState.fineWidth,
          alpha: WORLD_GRID_LINE_ALPHA * renderState.fineAlpha,
          pixelLine: renderState.finePixelLine,
        })
        : null;
      const majorStrokeStyle = renderState.majorVisible
        ? resolveWorldGridMajorStrokeStyle(theme, {
          forceColor,
          width: renderState.majorWidth,
          alpha: WORLD_GRID_LINE_ALPHA * renderState.majorAlpha,
          pixelLine: renderState.majorPixelLine,
        })
        : null;
      const dotStyle = renderState.dotVisible
        ? resolveWorldGridStrokeStyle(theme, {
          forceColor,
          alpha: WORLD_GRID_LINE_ALPHA * renderState.dotAlpha,
        })
        : null;

      if (
        fineStrokeStyle !== null && (
        lineAxes.vertical.fine.length > 0
        || lineAxes.horizontal.fine.length > 0
        )
      ) {
        drawGridLineAxes({
          graphics,
          vertical: lineAxes.vertical.fine,
          horizontal: lineAxes.horizontal.fine,
          allVertical: allVerticalPositions,
          allHorizontal: allHorizontalPositions,
          viewportBounds: drawViewportBounds,
        });
        graphics.stroke(fineStrokeStyle);
      }

      if (
        majorStrokeStyle !== null && (
        lineAxes.vertical.major.length > 0
        || lineAxes.horizontal.major.length > 0
        )
      ) {
        drawGridLineAxes({
          graphics,
          vertical: lineAxes.vertical.major,
          horizontal: lineAxes.horizontal.major,
          allVertical: allVerticalPositions,
          allHorizontal: allHorizontalPositions,
          viewportBounds: drawViewportBounds,
        });
        graphics.stroke(majorStrokeStyle);
      }

      const dotVerticalPositions = renderState.fineVisible
        ? allVerticalPositions
        : lineAxes.vertical.major;
      const dotHorizontalPositions = renderState.fineVisible
        ? allHorizontalPositions
        : lineAxes.horizontal.major;

      if (dotStyle !== null) {
        drawGridIntersectionDots({
          graphics,
          vertical: dotVerticalPositions,
          horizontal: dotHorizontalPositions,
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          style: dotStyle,
        });
      }
    },

    destroy(): void {
      graphics.destroy({ children: true });
    },
  };
}
