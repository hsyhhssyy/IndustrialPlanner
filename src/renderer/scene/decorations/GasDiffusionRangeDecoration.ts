import { Graphics } from "pixi.js";

import type { GridRect } from "@/domain/shared/grid";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import {
  areGridRectsIntersecting,
} from "@/shared/geometry/power-range";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  resolveVisibleWorldRect,
  type VisibleWorldRect,
} from "./BeltVisualGeometry";
import {
  resolveMarqueeGridRectLayout,
  resolveWorldAuxiliaryStrokeWidth,
} from "./MarqueeRectDecoration";

const GAS_RANGE_STROKE_ALPHA = 0.86;
const GAS_RANGE_FILL_ALPHA = 0.07;
const GAS_RANGE_STROKE_WIDTH_SCALE = 1.1;
const DEFAULT_GAS_RANGE_COLOR = 0xa8e6ff;
const GAS_COLOR_TAG_PREFIX = "gas_color:";
const FLUID_COLOR_TAG_PREFIX = "fluid_color:";
const LIQUID_COLOR_TAG_PREFIX = "liquid_color:";

export function createGasDiffusionRangeDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const simulation = ctx.renderHost.workspace.simulation;
      if (simulation === null || simulation === undefined) {
        return;
      }

      const visibleGridRect = visibleWorldRectToGridRect(
        resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds, 0),
      );
      const itemDefinitions = ctx.renderHost.workspace.registry.itemDefinitions ?? [];
      const itemById = new Map(itemDefinitions.map((item) => [item.id, item]));
      const strokeWidth =
        resolveWorldAuxiliaryStrokeWidth(ctx.viewportState.gridCellPixelSize)
        * GAS_RANGE_STROKE_WIDTH_SCALE;

      for (const range of simulation.queries.getActiveGasDiffusionRanges()) {
        if (!areGridRectsIntersecting(range.gridRect, visibleGridRect)) {
          continue;
        }

        const layout = resolveMarqueeGridRectLayout({
          gridRect: range.gridRect,
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          displayRotation: ctx.viewportState.displayRotation,
        });

        if (layout === null) {
          continue;
        }

        const color = resolveGasRangeColor(itemById.get(range.gasItemId) ?? null);
        graphics
          .rect(layout.x, layout.y, layout.width, layout.height)
          .fill({
            color,
            alpha: GAS_RANGE_FILL_ALPHA,
          })
          .stroke({
            width: strokeWidth,
            color,
            alpha: GAS_RANGE_STROKE_ALPHA,
          });
      }
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

function resolveGasRangeColor(item: ItemDefinition | null): number {
  const colorTag = item?.tags.find((tag) =>
    tag.startsWith(GAS_COLOR_TAG_PREFIX)
    || tag.startsWith(FLUID_COLOR_TAG_PREFIX)
    || tag.startsWith(LIQUID_COLOR_TAG_PREFIX)
  );
  if (colorTag === undefined) {
    return DEFAULT_GAS_RANGE_COLOR;
  }

  const prefix = resolveColorTagPrefix(colorTag);
  if (prefix === null) {
    return DEFAULT_GAS_RANGE_COLOR;
  }

  const normalizedHex = colorTag
    .slice(prefix.length)
    .trim()
    .replace(/^#/, "");

  if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
    return DEFAULT_GAS_RANGE_COLOR;
  }

  return Number.parseInt(normalizedHex, 16);
}

function resolveColorTagPrefix(tag: string): string | null {
  if (tag.startsWith(GAS_COLOR_TAG_PREFIX)) {
    return GAS_COLOR_TAG_PREFIX;
  }
  if (tag.startsWith(FLUID_COLOR_TAG_PREFIX)) {
    return FLUID_COLOR_TAG_PREFIX;
  }
  if (tag.startsWith(LIQUID_COLOR_TAG_PREFIX)) {
    return LIQUID_COLOR_TAG_PREFIX;
  }
  return null;
}

function visibleWorldRectToGridRect(visibleWorldRect: VisibleWorldRect): GridRect {
  return {
    x: visibleWorldRect.left,
    y: visibleWorldRect.top,
    width: visibleWorldRect.right - visibleWorldRect.left,
    height: visibleWorldRect.bottom - visibleWorldRect.top,
  };
}
