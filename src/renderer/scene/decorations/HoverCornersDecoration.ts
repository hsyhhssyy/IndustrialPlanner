import { Graphics } from "pixi.js";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

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

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const editor = ctx.renderHost.workspace.editor;
      if (editor === null) return;

      const hoverTarget = editor.state.hoverTarget;
      if (!hoverTarget) return;

      const { gridPoint, entity } = hoverTarget;

      // 计算 footprint 尺寸（实体取定义尺寸，空单元格取 1×1）
      const footprint = entity !== null
        ? getEntityFootprint(ctx, entity.definitionId)
        : { width: 1, height: 1 };

      // 网格坐标 → viewport 像素坐标
      const viewportRect = resolveViewportRectFromWorldGridRect({
        gridRect: {
          x: gridPoint.x,
          y: gridPoint.y,
          width: footprint.width,
          height: footprint.height,
        },
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
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

function getEntityFootprint(
  ctx: DecorationSyncContext,
  definitionId: string,
): { width: number; height: number } {
  const def = ctx.renderHost.workspace.registry.entityDefinitions
    .find((d) => d.id === definitionId);
  if (!def?.footprint) return { width: 1, height: 1 };
  return { width: def.footprint.width, height: def.footprint.height };
}
