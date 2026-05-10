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

export function resolveBaseBoundaryGridRect(
  baseDefinition: BaseDefinition,
): GridRect | null {
  const left = baseDefinition.outerRing.left;
  const top = baseDefinition.outerRing.top;
  const width =
    left
    + baseDefinition.placeableArea.width
    + baseDefinition.outerRing.right;
  const height =
    top
    + baseDefinition.placeableArea.height
    + baseDefinition.outerRing.bottom;

  if (
    !Number.isFinite(left)
    || !Number.isFinite(top)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }

  return {
    x: left === 0 ? 0 : -left,
    y: top === 0 ? 0 : -top,
    width,
    height,
  };
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

      const editor = ctx.workspace.editor;
      if (editor === null) {
        return;
      }

      const baseId = editor.document.getSnapshot().baseId;
      const baseDefinition = ctx.workspace.registry.baseDefinitions.find(
        (definition) => definition.id === baseId,
      );

      if (baseDefinition === undefined) {
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
