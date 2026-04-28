import { Graphics } from "pixi.js";
import type { GridRect } from "@/domain/types/grid";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;

export function resolveWorldAuxiliaryStrokeWidth(
  gridCellPixelSize: number,
): number {
  const width = gridCellPixelSize / 8;

  return Math.max(
    WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH,
    Math.min(WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH, width),
  );
}

export function resolveMarqueeGridRectLayout(options: {
  gridRect: GridRect;
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
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!isValidMarqueeGridRect(options.gridRect)) {
    return null;
  }

  const gridCellSize = options.gridCellPixelSize;
  const worldOriginX =
    options.viewportBounds.left
    + options.viewportBounds.width / 2
    - options.viewportCenter.x * gridCellSize;
  const worldOriginY =
    options.viewportBounds.top
    + options.viewportBounds.height / 2
    - options.viewportCenter.y * gridCellSize;

  return {
    x: worldOriginX + options.gridRect.x * gridCellSize,
    y: worldOriginY + options.gridRect.y * gridCellSize,
    width: options.gridRect.width * gridCellSize,
    height: options.gridRect.height * gridCellSize,
  };
}

export function resolveMarqueeGridRectStrokeStyle(
  gridCellPixelSize: number,
): {
  width: number;
  color: number;
} {
  return {
    width: resolveWorldAuxiliaryStrokeWidth(gridCellPixelSize),
    color: 0xffffff,
  };
}

function isValidMarqueeGridRect(gridRect: GridRect): boolean {
  return Number.isFinite(gridRect.x)
    && Number.isFinite(gridRect.y)
    && Number.isFinite(gridRect.width)
    && Number.isFinite(gridRect.height)
    && gridRect.width > 0
    && gridRect.height > 0;
}

export function createMarqueeRectDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const marqueeGridRect =
        ctx.workspace.editor!.state.marqueeGridRect;

      graphics.clear();

      if (marqueeGridRect === null) {
        return;
      }

      const layout = resolveMarqueeGridRectLayout({
        gridRect: marqueeGridRect,
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      });

      if (layout === null) {
        return;
      }

      graphics
        .rect(layout.x, layout.y, layout.width, layout.height)
        .stroke({
          width: resolveWorldAuxiliaryStrokeWidth(
            ctx.viewportState.gridCellPixelSize,
          ),
          color: 0xffffff,
        });
    },

    destroy(): void {
      graphics.destroy({ children: true });
    },
  };
}
