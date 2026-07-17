import { Graphics } from "pixi.js";

import type { GridRect } from "@/domain/shared/grid";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { SimulationGasDiffusionRangeReadModel } from "@/domain/simulation/types/simulation-types";
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
  let cachedItemDefinitions: readonly ItemDefinition[] | null = null;
  let cachedItemById: ReadonlyMap<string, ItemDefinition> = new Map();
  let cachedGasDiffusions: readonly SimulationGasDiffusionRangeReadModel[] | null = null;
  let cachedViewportLayoutState: GasDiffusionViewportLayoutState | null = null;
  let graphicsHasContent = false;

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const simulation = ctx.renderHost.workspace.simulation;
      if (simulation === null || simulation === undefined) {
        if (graphicsHasContent) {
          graphics.clear();
          graphicsHasContent = false;
        }
        cachedGasDiffusions = null;
        cachedViewportLayoutState = null;
        return;
      }

      const gasDiffusions = simulation.queries.getActiveGasDiffusionRanges();
      if (gasDiffusions.length === 0) {
        if (graphicsHasContent) {
          graphics.clear();
          graphicsHasContent = false;
        }
        cachedGasDiffusions = gasDiffusions;
        cachedViewportLayoutState = null;
        return;
      }

      const itemDefinitions = ctx.renderHost.workspace.registry.itemDefinitions ?? [];
      const itemDefinitionsChanged = cachedItemDefinitions !== itemDefinitions;
      const gasDiffusionsChanged = !haveSameGasDiffusionRanges(
        cachedGasDiffusions,
        gasDiffusions,
      );
      const viewportChanged = !hasSameGasDiffusionViewportLayout(
        cachedViewportLayoutState,
        ctx,
      );
      if (!itemDefinitionsChanged && !gasDiffusionsChanged && !viewportChanged) {
        return;
      }

      // AI-CORRECTION 2026-07-17：物品定义在会话内稳定，仅在引用变化时重建颜色查询索引。
      if (itemDefinitionsChanged) {
        cachedItemDefinitions = itemDefinitions;
        cachedItemById = new Map(itemDefinitions.map((item) => [item.id, item]));
      }

      if (graphicsHasContent) {
        graphics.clear();
        graphicsHasContent = false;
      }

      const visibleGridRect = visibleWorldRectToGridRect(
        resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds, 0),
      );
      const strokeWidth =
        resolveWorldAuxiliaryStrokeWidth(ctx.viewportState.gridCellPixelSize)
        * GAS_RANGE_STROKE_WIDTH_SCALE;

      for (const range of gasDiffusions) {
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

        const color = resolveGasRangeColor(cachedItemById.get(range.gasItemId) ?? null);
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
        graphicsHasContent = true;
      }

      cachedGasDiffusions = gasDiffusions;
      cachedViewportLayoutState = captureGasDiffusionViewportLayoutState(ctx);
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

interface GasDiffusionViewportLayoutState {
  readonly centerX: number;
  readonly centerY: number;
  readonly gridCellPixelSize: number;
  readonly displayRotation: DecorationSyncContext["viewportState"]["displayRotation"];
  readonly viewportLeft: number;
  readonly viewportTop: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export function haveSameGasDiffusionRanges(
  left: readonly SimulationGasDiffusionRangeReadModel[] | null,
  right: readonly SimulationGasDiffusionRangeReadModel[],
): boolean {
  if (left === null || left.length !== right.length) {
    return false;
  }

  return left.every((leftRange, index) => {
    const rightRange = right[index];
    return rightRange !== undefined
      && leftRange.sourceDeviceId === rightRange.sourceDeviceId
      && leftRange.gasItemId === rightRange.gasItemId
      && leftRange.gridRect.x === rightRange.gridRect.x
      && leftRange.gridRect.y === rightRange.gridRect.y
      && leftRange.gridRect.width === rightRange.gridRect.width
      && leftRange.gridRect.height === rightRange.gridRect.height;
  });
}

function hasSameGasDiffusionViewportLayout(
  cached: GasDiffusionViewportLayoutState | null,
  ctx: DecorationSyncContext,
): boolean {
  return cached !== null
    && cached.centerX === ctx.viewportState.centerX
    && cached.centerY === ctx.viewportState.centerY
    && cached.gridCellPixelSize === ctx.viewportState.gridCellPixelSize
    && cached.displayRotation === ctx.viewportState.displayRotation
    && cached.viewportLeft === ctx.viewportBounds.left
    && cached.viewportTop === ctx.viewportBounds.top
    && cached.viewportWidth === ctx.viewportBounds.width
    && cached.viewportHeight === ctx.viewportBounds.height;
}

function captureGasDiffusionViewportLayoutState(
  ctx: DecorationSyncContext,
): GasDiffusionViewportLayoutState {
  return {
    centerX: ctx.viewportState.centerX,
    centerY: ctx.viewportState.centerY,
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
    viewportLeft: ctx.viewportBounds.left,
    viewportTop: ctx.viewportBounds.top,
    viewportWidth: ctx.viewportBounds.width,
    viewportHeight: ctx.viewportBounds.height,
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
