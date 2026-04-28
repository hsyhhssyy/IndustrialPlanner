import { Graphics } from "pixi.js";
import type { AppTheme } from "@/domain/state/theme";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const WORLD_GRID_LINE_ALPHA = 0.12;
const WORLD_GRID_LINE_WIDTH = 1;

export function resolveWorldGridStrokeStyle(theme: AppTheme): {
  width: number;
  color: number;
  alpha: number;
  pixelLine: true;
} {
  return {
    width: WORLD_GRID_LINE_WIDTH,
    color: resolveAppThemeColorNumber(
      theme,
      theme.renderer.worldGridLineColorKey,
    ),
    alpha: WORLD_GRID_LINE_ALPHA,
    pixelLine: true,
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
  vertical: number[];
  horizontal: number[];
} {
  const gridCellSize = options.gridCellPixelSize;

  return {
    vertical: resolveWorldGridAxisPositions({
      viewportStart: options.viewportBounds.left,
      viewportSpan: options.viewportBounds.width,
      worldCenter: options.viewportCenter.x,
      gridCellSize,
    }),
    horizontal: resolveWorldGridAxisPositions({
      viewportStart: options.viewportBounds.top,
      viewportSpan: options.viewportBounds.height,
      worldCenter: options.viewportCenter.y,
      gridCellSize,
    }),
  };
}

function resolveWorldGridAxisPositions(options: {
  viewportStart: number;
  viewportSpan: number;
  worldCenter: number;
  gridCellSize: number;
}): number[] {
  if (options.viewportSpan <= 0 || options.gridCellSize <= 0) {
    return [];
  }

  const axisCenter = options.viewportStart + options.viewportSpan / 2;
  const worldOrigin = axisCenter - options.worldCenter * options.gridCellSize;
  const firstLineIndex = Math.ceil(
    (options.viewportStart - worldOrigin) / options.gridCellSize,
  );
  const linePositions: number[] = [];
  const viewportEnd = options.viewportStart + options.viewportSpan;

  for (
    let lineIndex = firstLineIndex;
    worldOrigin + lineIndex * options.gridCellSize <= viewportEnd;
    lineIndex += 1
  ) {
    linePositions.push(worldOrigin + lineIndex * options.gridCellSize);
  }

  return linePositions;
}

export function createGridLineDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const theme = ctx.workspace.app.state.theme;

      const lineAxes = resolveWorldGridLineAxes({
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      });

      graphics.clear();

      for (const x of lineAxes.vertical) {
        graphics
          .moveTo(x, ctx.viewportBounds.top)
          .lineTo(x, ctx.viewportBounds.top + ctx.viewportBounds.height);
      }

      for (const y of lineAxes.horizontal) {
        graphics
          .moveTo(ctx.viewportBounds.left, y)
          .lineTo(ctx.viewportBounds.left + ctx.viewportBounds.width, y);
      }

      graphics.stroke(resolveWorldGridStrokeStyle(theme));
    },

    destroy(): void {
      graphics.destroy({ children: true });
    },
  };
}
