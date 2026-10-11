import { Graphics, Text } from "pixi.js";

import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { GridRect } from "@/domain/shared/grid";
import { resolveBaseAreas, type BaseAreaGeometry } from "@/shared/geometry/base-areas";

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
const BASE_NAMEPLATE_PADDING_X = 10;
const BASE_NAMEPLATE_PADDING_Y = 6;
const BASE_NAMEPLATE_MARGIN = 6;
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
  const nameplates = new Map<string, Text>();
  const shouldRedraw = createDecorationRedrawGuard();

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const baseDefinition = resolveCurrentBaseDefinition(ctx);
      const gridRects = baseDefinition === null ? [] : resolveBaseBoundaryGridRects(baseDefinition);
      const namedAreas = baseDefinition === null ? [] : resolveBaseAreas(baseDefinition)
        .filter((area) => area.nameplate !== undefined && area.nameplate.trim().length > 0);
      const redraw = shouldRedraw([
        baseDefinition?.id,
        ...gridRects.flatMap((rect) => [rect.x, rect.y, rect.width, rect.height]),
        ...namedAreas.flatMap((area) => [
          area.id, area.nameplate,
          area.outerRect.x, area.outerRect.y, area.outerRect.width, area.outerRect.height,
        ]),
        ctx.viewportBounds.left, ctx.viewportBounds.top,
        ctx.viewportBounds.width, ctx.viewportBounds.height,
        ctx.viewportState.centerX, ctx.viewportState.centerY,
        ctx.viewportState.gridCellPixelSize, ctx.viewportState.displayRotation,
        ctx.viewportState.resolution,
      ]);
      ctx.profiler?.count("baseBoundary.redraws", redraw ? 1 : 0);
      if (!redraw) return;
      graphics.clear();
      for (const text of nameplates.values()) text.visible = false;

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
      syncBaseNameplates(ctx, graphics, nameplates, namedAreas);
    },

    destroy(): void {
      nameplates.clear();
      graphics.destroy({ children: true });
    },
  };
}

function syncBaseNameplates(
  ctx: DecorationSyncContext,
  graphics: Graphics,
  nameplates: Map<string, Text>,
  areas: readonly BaseAreaGeometry[],
): void {
  for (const area of areas) {
    const layout = resolveMarqueeGridRectLayout({
      gridRect: area.outerRect,
      viewportBounds: ctx.viewportBounds,
      viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
      gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      displayRotation: ctx.viewportState.displayRotation,
    });
    if (layout === null) continue;

    let text = nameplates.get(area.id);
    if (text === undefined) {
      text = new Text({
        text: area.nameplate!.trim(),
        style: {
          fill: BASE_BOUNDARY_STROKE_COLOR,
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fontWeight: "600",
        },
      });
      text.roundPixels = true;
      text.eventMode = "none";
      graphics.addChild(text);
      nameplates.set(area.id, text);
    }
    text.text = area.nameplate!.trim();
    text.resolution = ctx.viewportState.resolution;
    const width = text.width + BASE_NAMEPLATE_PADDING_X * 2;
    const height = text.height + BASE_NAMEPLATE_PADDING_Y * 2;
    // 名牌位于外围及其 2 格警告环之外；文字保持水平，随视口平移和旋转更新位置。
    const x = layout.x;
    const y = layout.y - BASE_OUTER_WARNING_PADDING_CELLS * ctx.viewportState.gridCellPixelSize
      - BASE_NAMEPLATE_MARGIN - height;
    graphics.roundRect(x, y, width, height, 4)
      .fill({ color: 0x101419, alpha: 0.9 })
      .stroke({ color: BASE_BOUNDARY_STROKE_COLOR, alpha: 0.75, width: 1 });
    text.position.set(x + BASE_NAMEPLATE_PADDING_X, y + BASE_NAMEPLATE_PADDING_Y);
    text.visible = true;
  }
}
