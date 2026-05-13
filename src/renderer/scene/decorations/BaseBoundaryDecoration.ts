import { Graphics } from "pixi.js";

import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { GridRect } from "@/domain/shared/grid";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  resolveMarqueeGridRectLayout,
  resolveWorldAuxiliaryStrokeWidth,
} from "./MarqueeRectDecoration";

const BASE_BOUNDARY_STROKE_COLOR = 0xf2c94c;
const BASE_BOUNDARY_STROKE_ALPHA = 0.95;
const BASE_BOUNDARY_STROKE_WIDTH_SCALE = 1.15;
export const BASE_OUTER_WARNING_PADDING_CELLS = 2;

function isValidGridRect(gridRect: GridRect): boolean {
  return Number.isFinite(gridRect.x)
    && Number.isFinite(gridRect.y)
    && Number.isFinite(gridRect.width)
    && Number.isFinite(gridRect.height)
    && gridRect.width > 0
    && gridRect.height > 0;
}

export function resolveCurrentBaseDefinition(
  ctx: Pick<DecorationSyncContext, "renderHost">,
): BaseDefinition | null {
  const editor = ctx.renderHost.workspace.editor;
  if (editor === null) {
    return null;
  }

  const baseId = editor.document.getSnapshot().baseId;

  return ctx.renderHost.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === baseId,
  ) ?? null;
}

export function resolveBaseBoundaryGridRect(
  baseDefinition: BaseDefinition,
): GridRect | null {
  const gridRect: GridRect = {
    x: 0,
    y: 0,
    width: baseDefinition.placeableArea.width,
    height: baseDefinition.placeableArea.height,
  };

  return isValidGridRect(gridRect) ? gridRect : null;
}

export function resolveBaseOuterGridRect(
  baseDefinition: BaseDefinition,
): GridRect | null {
  const gridRect: GridRect = {
    x: -baseDefinition.outerRing.left,
    y: -baseDefinition.outerRing.top,
    width:
      baseDefinition.outerRing.left
      + baseDefinition.placeableArea.width
      + baseDefinition.outerRing.right,
    height:
      baseDefinition.outerRing.top
      + baseDefinition.placeableArea.height
      + baseDefinition.outerRing.bottom,
  };

  return isValidGridRect(gridRect) ? gridRect : null;
}

export function resolveExpandedGridRect(
  gridRect: GridRect,
  paddingCells: number,
): GridRect | null {
  const expandedGridRect: GridRect = {
    x: gridRect.x - paddingCells,
    y: gridRect.y - paddingCells,
    width: gridRect.width + paddingCells * 2,
    height: gridRect.height + paddingCells * 2,
  };

  return isValidGridRect(expandedGridRect) ? expandedGridRect : null;
}

export function resolveBaseBoundaryStrokeWidth(
  gridCellPixelSize: number,
): number {
  return resolveWorldAuxiliaryStrokeWidth(gridCellPixelSize)
    * BASE_BOUNDARY_STROKE_WIDTH_SCALE;
}

export function createBaseBoundaryDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const baseDefinition = resolveCurrentBaseDefinition(ctx);
      if (baseDefinition === null) {
        return;
      }

      const gridRect = resolveBaseBoundaryGridRect(baseDefinition);
      if (gridRect === null) {
        return;
      }

      const layout = resolveMarqueeGridRectLayout({
        gridRect,
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
          width: resolveBaseBoundaryStrokeWidth(ctx.viewportState.gridCellPixelSize),
          color: BASE_BOUNDARY_STROKE_COLOR,
          alpha: BASE_BOUNDARY_STROKE_ALPHA,
        });
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}
