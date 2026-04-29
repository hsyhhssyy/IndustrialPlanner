import { Graphics } from "pixi.js";
import type { AppTheme } from "@/domain/state/theme";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const WORLD_GRID_LINE_ALPHA = 0.12;
const WORLD_GRID_LINE_WIDTH = 1;
const WORLD_GRID_MAJOR_LINE_INTERVAL = 5;
const WORLD_GRID_MAJOR_LINE_WIDTH_MULTIPLIER = 2;
const WORLD_GRID_FINE_LINE_MIN_CELL_PIXEL_SIZE = 10;

interface WorldGridLinePosition {
  lineIndex: number;
  position: number;
}

export interface WorldGridLineAxisGroup {
  fine: number[];
  major: number[];
}

export function resolveWorldGridStrokeStyle(
  theme: AppTheme,
  options: {
    widthMultiplier?: number;
  } = {},
): {
  width: number;
  color: number;
  alpha: number;
  pixelLine: boolean;
} {
  return {
    width: WORLD_GRID_LINE_WIDTH * (options.widthMultiplier ?? 1),
    color: resolveAppThemeColorNumber(
      theme,
      theme.renderer.worldGridLineColorKey,
    ),
    alpha: WORLD_GRID_LINE_ALPHA,
    pixelLine: false,
  };
}

export function resolveWorldGridMajorStrokeStyle(theme: AppTheme): {
  width: number;
  color: number;
  alpha: number;
  pixelLine: boolean;
} {
  return resolveWorldGridStrokeStyle(theme, {
    widthMultiplier: WORLD_GRID_MAJOR_LINE_WIDTH_MULTIPLIER,
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

function drawGridLineAxes(options: {
  graphics: Graphics;
  vertical: number[];
  horizontal: number[];
  viewportBounds: DecorationSyncContext["viewportBounds"];
}): void {
  for (const x of options.vertical) {
    options.graphics
      .moveTo(x, options.viewportBounds.top)
      .lineTo(x, options.viewportBounds.top + options.viewportBounds.height);
  }

  for (const y of options.horizontal) {
    options.graphics
      .moveTo(options.viewportBounds.left, y)
      .lineTo(options.viewportBounds.left + options.viewportBounds.width, y);
  }
}

export function createGridLineDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const theme = ctx.workspace.app!.state.theme;

      const lineAxes = resolveWorldGridLineAxes({
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      });

      graphics.clear();

      if (
        lineAxes.vertical.fine.length > 0
        || lineAxes.horizontal.fine.length > 0
      ) {
        drawGridLineAxes({
          graphics,
          vertical: lineAxes.vertical.fine,
          horizontal: lineAxes.horizontal.fine,
          viewportBounds: ctx.viewportBounds,
        });
        graphics.stroke(resolveWorldGridStrokeStyle(theme));
      }

      if (
        lineAxes.vertical.major.length > 0
        || lineAxes.horizontal.major.length > 0
      ) {
        drawGridLineAxes({
          graphics,
          vertical: lineAxes.vertical.major,
          horizontal: lineAxes.horizontal.major,
          viewportBounds: ctx.viewportBounds,
        });
        const fineLinesVisible =
          ctx.viewportState.gridCellPixelSize >= WORLD_GRID_FINE_LINE_MIN_CELL_PIXEL_SIZE;
        graphics.stroke(
          fineLinesVisible
            ? resolveWorldGridMajorStrokeStyle(theme)
            : resolveWorldGridStrokeStyle(theme),
        );
      }
    },

    destroy(): void {
      graphics.destroy({ children: true });
    },
  };
}
