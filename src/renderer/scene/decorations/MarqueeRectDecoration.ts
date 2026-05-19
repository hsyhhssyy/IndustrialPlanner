import { BlurFilter, Graphics } from "pixi.js";
import type { GridRect } from "@/domain/shared/grid";
import type { AppTheme } from "@/domain/app/types/theme";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;
/** 线宽倍率，在原有计算基础上放大 */
const MARQUEE_STROKE_WIDTH_SCALE = 1.5;
/** 内发光模糊半径 = 线宽 × 该系数 */
const MARQUEE_GLOW_BLUR_RATIO = 5;
/** 内发光动画周期（毫秒） */
const MARQUEE_GLOW_ANIMATION_PERIOD_MS = 1500;
/** 内发光最小不透明度 */
const MARQUEE_GLOW_ALPHA_MIN = 0.08;
/** 内发光最大不透明度 */
const MARQUEE_GLOW_ALPHA_MAX = 0.28;

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
  theme: AppTheme,
): {
  width: number;
  color: number;
} {
  return {
    width:
      resolveWorldAuxiliaryStrokeWidth(gridCellPixelSize)
      * MARQUEE_STROKE_WIDTH_SCALE,
    color: resolveAppThemeColorNumber(
      theme,
      theme.renderer.worldMarqueeStrokeColorKey,
    ),
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

function resolveGlowAlpha(nowMs: number): number {
  const phase =
    ((nowMs % MARQUEE_GLOW_ANIMATION_PERIOD_MS)
      / MARQUEE_GLOW_ANIMATION_PERIOD_MS)
    * Math.PI * 2;

  // 使用正弦波在 min/max 之间平滑过渡
  const t = (Math.sin(phase) + 1) / 2; // 0..1
  return MARQUEE_GLOW_ALPHA_MIN
    + t * (MARQUEE_GLOW_ALPHA_MAX - MARQUEE_GLOW_ALPHA_MIN);
}

export function createMarqueeRectDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });
  // 内发光描边层：只描边不填充，模糊后仅边缘向内辐射光晕
  const glowStroke = new Graphics({ roundPixels: true });
  const glowMask = new Graphics({ roundPixels: true });
  const glowFilter = new BlurFilter({ quality: 4 });

  glowStroke.filters = [glowFilter];
  glowStroke.mask = glowMask;
  graphics.addChild(glowMask);
  graphics.addChild(glowStroke);

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const marqueeGridRect =
        ctx.renderHost.workspace.editor!.state.marqueeGridRect;

      graphics.clear();
      glowStroke.clear();
      glowMask.clear();

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

      const theme = ctx.theme;
      const strokeStyle = resolveMarqueeGridRectStrokeStyle(
        ctx.viewportState.gridCellPixelSize,
        theme,
      );

      // 遮罩：与选框等大的填充矩形，限制内发光只在选框内部显示
      glowMask
        .rect(layout.x, layout.y, layout.width, layout.height)
        .fill(0xffffff);

      // 内发光：仅描边（不填充），模糊后颜色从边缘向内衰减
      // 模糊半径 = 线宽 × ratio，大约 ratio 倍线宽外完全透明 → 中心区域不受影响
      glowFilter.strength = strokeStyle.width * MARQUEE_GLOW_BLUR_RATIO;
      const glowAlpha = resolveGlowAlpha(ctx.nowMs);
      glowStroke
        .rect(layout.x, layout.y, layout.width, layout.height)
        .stroke({
          width: strokeStyle.width * MARQUEE_GLOW_BLUR_RATIO,
          color: strokeStyle.color,
          alpha: glowAlpha,
        });

      // 绘制选框描边
      graphics
        .rect(layout.x, layout.y, layout.width, layout.height)
        .stroke({
          width: strokeStyle.width,
          color: strokeStyle.color,
        });
    },

    destroy(): void {
      glowFilter.destroy();
      glowMask.destroy({ children: true });
      glowStroke.destroy({ children: true });
      graphics.destroy({ children: true });
    },
  };
}
