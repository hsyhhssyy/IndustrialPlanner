import { Graphics, Text } from "pixi.js";

import type { SceneSpace } from "@/domain/shared/scene-space";
import type { GridRect } from "@/domain/shared/grid";
import { resolveBaseAreas, type BaseAreaGeometry } from "@/shared/geometry/base-areas";
import { resolveSceneBoundarySegments, sceneBoundsToFiniteRect } from "@/shared/geometry/scene-space";
import { resolveSceneBoundaryLines } from "./scene-space-layout";

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
): SceneSpace | null {
  // AI-REMOVED 2026-11-12: 几何输入改为会话空间；REQ-048 D1/D5；Replacement: source.snapshot.space；Risk: Low；Human Review: Required
  //   if (ctx.renderHost.showBaseBoundary === false) return null;
  //   const source = ctx.renderHost.input.source;
  //   if (source === null) {
  //     return null;
  //   }
  //
  //   const baseId = source.snapshot.getSnapshot().document.baseId;
  //
  //   return ctx.renderHost.input.source.registry.baseDefinitions.find(
  //     (definition) => definition.id === baseId,
  //   ) ?? null;
  return ctx.renderHost.input.presentation.getSnapshot().showBaseBoundary
    ? ctx.renderHost.input.source.snapshot.getSnapshot().space : null;
}

export function resolveBaseBoundaryGridRect(baseDefinition: SceneSpace): GridRect | null {
  const area = baseDefinition.areas[0];
  return area === undefined ? null : sceneBoundsToFiniteRect(area.bounds);
}

export function resolveBaseBoundaryGridRects(baseDefinition: SceneSpace): GridRect[] {
  return baseDefinition.areas.flatMap((area) => {
    const rect = sceneBoundsToFiniteRect(area.bounds);
    return rect === null ? [] : [rect];
  });
}

export function resolveBaseOuterGridRect(baseDefinition: SceneSpace): GridRect | null {
  const area = resolveBaseAreas(baseDefinition)[0];
  return area === undefined ? null : sceneBoundsToFiniteRect(area.outerBounds);
}

export function resolveBaseOuterGridRects(baseDefinition: SceneSpace): GridRect[] {
  return resolveBaseAreas(baseDefinition).flatMap((area) => {
    const rect = sceneBoundsToFiniteRect(area.outerBounds);
    return rect === null ? [] : [rect];
  });
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
      const segments = baseDefinition === null ? [] : resolveSceneBoundarySegments(baseDefinition.areas);
      const namedAreas = baseDefinition === null ? [] : resolveBaseAreas(baseDefinition)
        .filter((area) => area.nameplate !== undefined && area.nameplate.trim().length > 0);
      const redraw = shouldRedraw([
        ctx.renderHost.input.source.id,
        ...segments.flatMap((segment) => [segment.side, segment.coordinate, segment.start, segment.end]),
        ...namedAreas.flatMap((area) => [
          area.id, area.nameplate,
          area.outerBounds.minX, area.outerBounds.minY, area.outerBounds.maxX, area.outerBounds.maxY,
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
      // AI-REMOVED 2026-11-12:
      // Reason: 完整矩形描边会在无界方向和区域接缝生成假边。
      // Trigger: REQ-048 真实空间外缘。
      // Evidence: resolveSceneBoundarySegments 提供并集外缘，裁剪只截短线段。
      // Replacement: 下方真实边缘逐段绘制。
      // Risk: Low；描边颜色和宽度不变。
      // Human Review: Required
      // Original code:
      //       for (const gridRect of gridRects) {
      //         const layout = resolveMarqueeGridRectLayout({
      //           gridRect,
      //           viewportBounds: ctx.viewportBounds,
      //           viewportCenter: {
      //             x: ctx.viewportState.centerX,
      //             y: ctx.viewportState.centerY,
      //           },
      //           gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
      //           displayRotation: ctx.viewportState.displayRotation,
      //         });
      //         if (layout === null) continue;
      //         graphics.rect(layout.x, layout.y, layout.width, layout.height).stroke({
      //           width: resolveBaseBoundaryStrokeWidth(ctx.viewportState.gridCellPixelSize),
      //           color: BASE_BOUNDARY_STROKE_COLOR,
      //           alpha: BASE_BOUNDARY_STROKE_ALPHA,
      //         });
      //       }
      for (const { from, to } of resolveSceneBoundaryLines(baseDefinition, ctx)) {
        graphics.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({
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
    const anchor = resolveBaseNameplateAnchor(area, ctx);
    if (anchor === null) continue;

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
    const x = anchor.x;
    const y = anchor.y - height;
    graphics.roundRect(x, y, width, height, 4)
      .fill({ color: 0x101419, alpha: 0.9 })
      .stroke({ color: BASE_BOUNDARY_STROKE_COLOR, alpha: 0.75, width: 1 });
    text.position.set(x + BASE_NAMEPLATE_PADDING_X, y + BASE_NAMEPLATE_PADDING_Y);
    text.visible = true;
  }
}

export function resolveBaseNameplateAnchor(
  area: BaseAreaGeometry,
  ctx: Pick<DecorationSyncContext, "viewportBounds" | "viewportState">,
): { x: number; y: number } | null {
  if (area.nameplate === undefined || area.nameplate.trim().length === 0) return null;
  const gridRect = sceneBoundsToFiniteRect(area.outerBounds);
  if (gridRect === null) return null;
  const layout = resolveMarqueeGridRectLayout({
    gridRect,
    viewportBounds: ctx.viewportBounds,
    viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
  });
  return layout === null ? null : {
    x: layout.x,
    y: layout.y - BASE_OUTER_WARNING_PADDING_CELLS * ctx.viewportState.gridCellPixelSize - BASE_NAMEPLATE_MARGIN,
  };
}
