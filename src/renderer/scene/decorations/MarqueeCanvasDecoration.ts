import { BlurFilter, Graphics } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

/** 边缘发光动画周期（毫秒） */
const CANVAS_GLOW_ANIMATION_PERIOD_MS = 2000;
/** 边缘发光最小不透明度 */
const CANVAS_GLOW_ALPHA_MIN = 0.5;
/** 边缘发光最大不透明度 */
const CANVAS_GLOW_ALPHA_MAX = 1;

// --- 三层叠加：核心锐线 + 近边高亮 + 远距扩散 ---

/** 核心锐线描边宽度（不模糊） */
const CORE_STROKE_WIDTH = 0;

/** 近边层描边宽度 */
const NEAR_STROKE_WIDTH = 10;
/** 近边层模糊强度 */
const NEAR_BLUR_STRENGTH = 10;

/** 远距层描边宽度 */
const FAR_STROKE_WIDTH = 8;
/** 远距层模糊强度 ≈ 30px 延伸 */
const FAR_BLUR_STRENGTH = 30;

function resolveGlowAlpha(nowMs: number): number {
  const phase =
    ((nowMs % CANVAS_GLOW_ANIMATION_PERIOD_MS)
      / CANVAS_GLOW_ANIMATION_PERIOD_MS)
    * Math.PI * 2;
  const t = (Math.sin(phase) + 1) / 2; // 0..1
  return CANVAS_GLOW_ALPHA_MIN
    + t * (CANVAS_GLOW_ALPHA_MAX - CANVAS_GLOW_ALPHA_MIN);
}

/**
 * MarqueeCanvasDecoration
 *
 * 当 editor 当前 activeTool 为 "marquee" 时，
 * 在整个 viewport 边缘渲染一个向内发光特效，
 * 提示用户当前处于框选模式。
 */
export function createMarqueeCanvasDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  // 核心锐线：零模糊 + 纯色 → 边缘最深
  const coreEdge = new Graphics({ roundPixels: true });

  // 近边高亮层：小模糊 + 较宽描边 → 边缘附近持续明亮
  const nearGlow = new Graphics({ roundPixels: true });
  const nearBlur = new BlurFilter({ quality: 4 });
  nearGlow.filters = [nearBlur];

  // 远距扩散层：大模糊 + 低饱和 → ~30px 柔和向内延伸
  const farGlow = new Graphics({ roundPixels: true });
  const farBlur = new BlurFilter({ quality: 4 });
  farGlow.filters = [farBlur];

  // 三层共用一个遮罩，裁剪视口外溢出
  const glowMask = new Graphics({ roundPixels: true });
  coreEdge.mask = glowMask;
  nearGlow.mask = glowMask;
  farGlow.mask = glowMask;

  // 从后到前：遮罩 → 远距 → 近边 → 核心
  graphics.addChild(glowMask);
  graphics.addChild(farGlow);
  graphics.addChild(nearGlow);
  graphics.addChild(coreEdge);

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const activeTool = ctx.workspace.app!.state.activeTool;

      if (activeTool !== "marquee") {
        graphics.visible = false;
        return;
      }

      graphics.visible = true;

      const { width, height } = ctx.viewportBounds;

      graphics.clear();
      coreEdge.clear();
      nearGlow.clear();
      farGlow.clear();
      glowMask.clear();

      // 共用遮罩：与视口等大，裁剪向外溢出，只保留向内发光
      glowMask
        .rect(0, 0, width, height)
        .fill(0xffffff);

      const color = resolveAppThemeColorNumber(
        ctx.workspace.app!.state.theme,
        "accent",
      );
      const alpha = resolveGlowAlpha(ctx.nowMs);

      // 远距扩散层：大模糊 + 低饱和 → ~30px 向内延伸
      farBlur.strength = FAR_BLUR_STRENGTH;
      farGlow
        .rect(0, 0, width, height)
        .stroke({
          width: FAR_STROKE_WIDTH,
          color,
          alpha: alpha * 0.35,
        });

      // 近边高亮层：小模糊 + 较宽描边 → 边缘附近持续明亮
      nearBlur.strength = NEAR_BLUR_STRENGTH;
      nearGlow
        .rect(0, 0, width, height)
        .stroke({
          width: NEAR_STROKE_WIDTH,
          color,
          alpha: alpha * 0.7,
        });

      // 核心锐线：零模糊 + 纯色 → 边缘最深，压出体积感
      coreEdge
        .rect(0, 0, width, height)
        .stroke({
          width: CORE_STROKE_WIDTH,
          color,
          alpha,
        });
    },

    destroy(): void {
      nearBlur.destroy();
      farBlur.destroy();
      glowMask.destroy({ children: true });
      coreEdge.destroy({ children: true });
      nearGlow.destroy({ children: true });
      farGlow.destroy({ children: true });
      graphics.destroy({ children: true });
    },
  };
}
