import { Graphics } from "pixi.js";

import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { GridRect } from "@/domain/shared/grid";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createDecorationRedrawGuard } from "./DecorationRedrawGuard";
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

export function resolveBaseBoundaryGridRects(baseDefinition: BaseDefinition): GridRect[] {
  return resolveBaseAreas(baseDefinition).map((area) =>
    area.placeableRect.width > 0 && area.placeableRect.height > 0
      ? area.placeableRect
      : area.outerRect
  ).filter(isValidGridRect);
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

export function resolveBaseOuterGridRects(baseDefinition: BaseDefinition): GridRect[] {
  return resolveBaseAreas(baseDefinition).map((area) => area.outerRect).filter(isValidGridRect);
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
  const shouldRedraw = createDecorationRedrawGuard();

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const baseDefinition = resolveCurrentBaseDefinition(ctx);
      const gridRects = baseDefinition === null ? [] : resolveBaseBoundaryGridRects(baseDefinition);
      const redraw = shouldRedraw([
        ...gridRects.flatMap((rect) => [rect.x, rect.y, rect.width, rect.height]),
        ctx.viewportBounds.left, ctx.viewportBounds.top,
        ctx.viewportBounds.width, ctx.viewportBounds.height,
        ctx.viewportState.centerX, ctx.viewportState.centerY,
        ctx.viewportState.gridCellPixelSize, ctx.viewportState.displayRotation,
      ]);
      ctx.profiler?.count("baseBoundary.redraws", redraw ? 1 : 0);
      if (!redraw) return;
      graphics.clear();

      if (baseDefinition === null) {
        return;
      }

      // AI-REMOVED 2026-09-26:
      // Reason: 单条边界只能绘制主区域，0×0 分区还需要绘制自身外边界。
      // Trigger: 草稿箱新增不连续分区。
      // Evidence: resolveBaseBoundaryGridRects 返回主核心与零核心分区的可见轮廓。
      // Replacement: 下方遍历全部轮廓。
      // Risk: Low。
      // Human Review: Required
      // Original code:
      // const gridRect = resolveBaseBoundaryGridRect(baseDefinition);
      // if (gridRect === null) {
      //   return;
      // }
      // const layout = resolveMarqueeGridRectLayout({
      //   gridRect,
      //   viewportBounds: ctx.viewportBounds,
      //   viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
      //   gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      //   displayRotation: ctx.viewportState.displayRotation,
      // });
      // if (layout === null) {
      //   return;
      // }
      // graphics.rect(layout.x, layout.y, layout.width, layout.height).stroke({
      //   width: resolveBaseBoundaryStrokeWidth(ctx.viewportState.gridCellPixelSize),
      //   color: BASE_BOUNDARY_STROKE_COLOR,
      //   alpha: BASE_BOUNDARY_STROKE_ALPHA,
      // });
      for (const gridRect of gridRects) {
        const layout = resolveMarqueeGridRectLayout({
          gridRect,
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          displayRotation: ctx.viewportState.displayRotation,
        });
        if (layout === null) continue;
        graphics.rect(layout.x, layout.y, layout.width, layout.height).stroke({
          width: resolveBaseBoundaryStrokeWidth(ctx.viewportState.gridCellPixelSize),
          color: BASE_BOUNDARY_STROKE_COLOR,
          alpha: BASE_BOUNDARY_STROKE_ALPHA,
        });
      }
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}
