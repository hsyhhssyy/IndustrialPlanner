import { Graphics } from "pixi.js";
import type { AppTheme } from "@/domain/state/theme";
import {
  EntityCollectionType,
  type ActiveTool,
} from "@/domain/state/types";
import type { GridRect } from "@/domain/types/grid";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const WORLD_GRID_LINE_ALPHA = 0.30;
const WORLD_GRID_LINE_WIDTH = 1.5;
const WORLD_GRID_MAJOR_LINE_INTERVAL = 5;
const WORLD_GRID_MAJOR_LINE_WIDTH_MULTIPLIER = 2;
const WORLD_GRID_FINE_LINE_MIN_CELL_PIXEL_SIZE = 10;
const WORLD_GRID_PREVIEW_PADDING_CELLS = 4;
const WORLD_GRID_PREVIEW_MIN_HALF_SPAN_CELLS = 8;
const WORLD_GRID_SEGMENT_LENGTH_RATIO = 0.5;
const WORLD_GRID_INTERSECTION_DOT_SIZE_RATIO = 0.24;
const WORLD_GRID_INTERSECTION_DOT_MIN_SIZE = 2.5;
const WORLD_GRID_INTERSECTION_DOT_MAX_SIZE = 4.5;
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

export function resolveWorldGridStrokeStyle(
  theme: AppTheme,
  options: {
    widthMultiplier?: number;
    forceColor?: number;
  } = {},
): {
  width: number;
  color: number;
  alpha: number;
} {
  return {
    width: WORLD_GRID_LINE_WIDTH * (options.widthMultiplier ?? 1),
    color:
      options.forceColor ??
      resolveAppThemeColorNumber(
        theme,
        theme.renderer.worldGridLineColorKey,
      ),
    alpha: WORLD_GRID_LINE_ALPHA,
  };
}

export function resolveWorldGridMajorStrokeStyle(
  theme: AppTheme,
  options?: { forceColor?: number },
): {
  width: number;
  color: number;
  alpha: number;
} {
  return resolveWorldGridStrokeStyle(theme, {
    widthMultiplier: WORLD_GRID_MAJOR_LINE_WIDTH_MULTIPLIER,
    forceColor: options?.forceColor,
  });
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
  const shouldShowFineLines = options.gridCellSize
    >= WORLD_GRID_FINE_LINE_MIN_CELL_PIXEL_SIZE;
  const group: WorldGridLineAxisGroup = {
    fine: [],
    major: [],
  };

  for (const linePosition of linePositions) {
    if (linePosition.lineIndex % WORLD_GRID_MAJOR_LINE_INTERVAL === 0) {
      group.major.push(linePosition.position);
      continue;
    }

    if (shouldShowFineLines) {
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
    WORLD_GRID_INTERSECTION_DOT_MAX_SIZE,
    Math.max(
      WORLD_GRID_INTERSECTION_DOT_MIN_SIZE,
      gridCellPixelSize * WORLD_GRID_INTERSECTION_DOT_SIZE_RATIO,
    ),
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

      const app = ctx.workspace.app;
      if (!app) {
        return;
      }

      const theme = app.state.theme;
      const showGrass = app.state.settings.showGrassBackground;
      const forceColor = showGrass
        ? GRASS_BACKGROUND_GRID_LINE_COLOR
        : undefined;
      const visibilityScope = resolveWorldGridVisibilityScope({
        alwaysShowGridLines: app.state.settings.gameAlwaysShowGridLines,
        activeTool: app.state.activeTool,
        previewGridRect:
          ctx.workspace.editor?.queries.findEntityCollectionGridRect(
            EntityCollectionType.preview,
          ) ?? null,
      });

      if (visibilityScope.kind === "hidden") {
        return;
      }

      const drawViewportBounds = visibilityScope.kind === "local"
        ? resolveWorldGridLocalViewportBounds({
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          lineBounds: visibilityScope.lineBounds,
        })
        : ctx.viewportBounds;

      if (drawViewportBounds === null) {
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
      const lineAxes = visibilityScope.kind === "local"
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
      const fineLinesVisible =
        ctx.viewportState.gridCellPixelSize >= WORLD_GRID_FINE_LINE_MIN_CELL_PIXEL_SIZE;
      const fineStrokeStyle = resolveWorldGridStrokeStyle(theme, { forceColor });
      const majorStrokeStyle = fineLinesVisible
        ? resolveWorldGridMajorStrokeStyle(theme, { forceColor })
        : fineStrokeStyle;

      if (
        lineAxes.vertical.fine.length > 0
        || lineAxes.horizontal.fine.length > 0
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
        drawGridIntersectionDots({
          graphics,
          vertical: allVerticalPositions,
          horizontal: allHorizontalPositions,
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          style: fineStrokeStyle,
        });
      }

      if (
        lineAxes.vertical.major.length > 0
        || lineAxes.horizontal.major.length > 0
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
        drawGridIntersectionDots({
          graphics,
          vertical: lineAxes.vertical.major,
          horizontal: allHorizontalPositions,
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          style: majorStrokeStyle,
        });
        drawGridIntersectionDots({
          graphics,
          vertical: lineAxes.vertical.fine,
          horizontal: lineAxes.horizontal.major,
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          style: majorStrokeStyle,
        });
      }
    },

    destroy(): void {
      graphics.destroy({ children: true });
    },
  };
}
