import { Graphics } from "pixi.js";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createDecorationRedrawGuard } from "./DecorationRedrawGuard";

/**
 * 设备/单元格 hover 四角 L 形特效。
 *
 * 显示条件由 gesture 层控制：满足条件时调用 setHoverPoint，不满足时 clearHoverPoint。
 * 本 decoration 仅读取 EditorState.hoverTarget 并渲染四个角的黄色 L 形。
 */

const CORNER_COLOR = 0xffc830;
const CORNER_ALPHA = 0.92;
/** L 形臂长相对于格子的比例 */
const CORNER_ARM_RATIO = 1 / 4;
/** L 形线宽（像素） */
const CORNER_LINE_WIDTH = 3;
/** 四角离边界的缩进（像素） */
const CORNER_INSET = 2;

export function createHoverCornersDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });
  const shouldSync = createDecorationRedrawGuard();

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const editor = ctx.renderHost.workspace.editor;
      const hoverTarget = editor?.state.hoverTarget;
      const visible = hoverTarget != null
        && (hoverTarget.entity !== null || ctx.renderHost.workspace.app?.state.activeTool === "logistics-placement");
      const footprintGridRect = visible
        ? hoverTarget.entity !== null
          ? getEntityFootprintGridRect(ctx, hoverTarget.entity, hoverTarget.gridPoint)
          : { x: hoverTarget.gridPoint.x, y: hoverTarget.gridPoint.y, width: 1, height: 1 }
        : null;
      const redraw = shouldSync(footprintGridRect === null ? [] : [
        footprintGridRect.x, footprintGridRect.y, footprintGridRect.width, footprintGridRect.height,
        ctx.viewportBounds.left, ctx.viewportBounds.top, ctx.viewportBounds.width, ctx.viewportBounds.height,
        ctx.viewportState.centerX, ctx.viewportState.centerY,
        ctx.viewportState.gridCellPixelSize, ctx.viewportState.displayRotation,
      ]);
      ctx.profiler?.count("hoverCorners.redraws", redraw ? 1 : 0);
      if (!redraw) return;
      graphics.clear();

      // 空地且非物流布设模式 → 不绘制四角特效，仅物流 idle 保留。
      // 物流手势 idle 阶段设 hoverTarget，非 idle 清空 hoverTarget，
      // 故此处只要 activeTool === "logistics-placement" 即为 idle。
      // AI-CORRECTION 2026-09-13: 可见性已在上方与绘制输入一起判断；不可见时只清理一次。
      if (footprintGridRect === null) {
        return;
      }

      // 计算足印旋转后的网格矩形（仅旋转 footprint，不含 spriteOffset）
      // AI-CORRECTION 2026-09-13: 足印计算已前移，使用其值快照判断静止悬停是否需要重绘。

      // 网格坐标 → viewport 像素坐标
      const viewportRect = resolveViewportRectFromWorldGridRect({
        gridRect: footprintGridRect,
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
        displayRotation: ctx.viewportState.displayRotation,
      });

      if (viewportRect === null) return;

      const { left, top, width, height } = viewportRect;

      // 臂长 = 格子像素尺寸 × 比例
      const armLength = ctx.viewportState.gridCellPixelSize * CORNER_ARM_RATIO;
      const inset = CORNER_INSET;

      // 绘制四个角的 L 形
      graphics.setStrokeStyle({
        color: CORNER_COLOR,
        alpha: CORNER_ALPHA,
        width: CORNER_LINE_WIDTH,
      });

      // 左上角 ┌
      drawCorner(graphics, left + inset, top + inset,
        left + inset + armLength, top + inset,
        left + inset, top + inset + armLength);

      // 右上角 ┐
      drawCorner(graphics, left + width - inset, top + inset,
        left + width - inset - armLength, top + inset,
        left + width - inset, top + inset + armLength);

      // 左下角 └
      drawCorner(graphics, left + inset, top + height - inset,
        left + inset + armLength, top + height - inset,
        left + inset, top + height - inset - armLength);

      // 右下角 ┘
      drawCorner(graphics, left + width - inset, top + height - inset,
        left + width - inset - armLength, top + height - inset,
        left + width - inset, top + height - inset - armLength);
    },

    destroy() {
      graphics.destroy();
    },
  };
}

function drawCorner(
  g: Graphics,
  cornerX: number,
  cornerY: number,
  armX: number,
  armY: number,
  legX: number,
  legY: number,
): void {
  g.moveTo(cornerX, cornerY);
  g.lineTo(armX, armY);
  g.moveTo(cornerX, cornerY);
  g.lineTo(legX, legY);
  g.stroke();
}

/**
 * 获取实体足印旋转后的网格矩形。
 * 仅根据 rotation 旋转 definition.footprint，不考虑 spriteOffset。
 */
function getEntityFootprintGridRect(
  ctx: DecorationSyncContext,
  entity: { readonly id: string; readonly definitionId: string; readonly rotation: 0 | 90 | 180 | 270 },
  gridPoint: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  const def = ctx.renderHost.workspace.registry.entityDefinitions
    .find((d) => d.id === entity.definitionId);
  if (!def?.footprint) {
    return { x: gridPoint.x, y: gridPoint.y, width: 1, height: 1 };
  }

  const rotated = getRotatedGridFootprint(def.footprint, entity.rotation);
  return {
    x: gridPoint.x,
    y: gridPoint.y,
    width: rotated.width,
    height: rotated.height,
  };
}
