import type { TextStyleOptions } from "pixi.js";
import { Text } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

/** 框选模式标签固定蓝色 */
/** AI-CORRECTION 2026-06-13: 参考游戏 HUD 后，框选模式标签改为白色主标题，避免和浅蓝画布背景抢色。 */
const MARQUEE_LABEL_COLOR = 0xF8FBFF;

/** 左上角模式标签样式（不含 dropShadow.color，由 sync 动态设置） */
const MODE_LABEL_TEXT_STYLE = {
  fontSize: 31,
  fontFamily: "sans-serif",
  fontWeight: "900",
  stroke: {
    color: 0x111827,
    width: 5,
    alpha: 0.62,
  },
  dropShadow: {
    angle: Math.PI / 4,
    alpha: 0.72,
    blur: 3,
    distance: 2,
  },
} satisfies TextStyleOptions;

/**
 * MarqueeCanvasDecoration
 *
 * 当 editor 当前 activeTool 为 "marquee" 时，
 * 在整个 viewport 边缘渲染一个向内发光特效，
 * 提示用户当前处于框选模式。
 */
// AI-MODIFIED 2026-05-21:
// 原 Pixi BlurFilter 全视口发光层已迁移到 renderer DOM overlay。
// 本 decoration 只保留左上角模式标签，避免 BlurFilter 触发离屏 render texture。
export function createMarqueeCanvasDecoration(): DecorationLayer {
  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE });

  return {
    container: modeLabel,

    sync(ctx: DecorationSyncContext): void {
      const activeTool = ctx.renderHost.workspace.app!.state.activeTool;

      if (activeTool !== "marquee") {
        modeLabel.visible = false;
        return;
      }

      modeLabel.visible = true;

      const isReverse =
        ctx.renderHost.workspace.app!.state.toolInfo.marqueeType === EntityCollectionType.reverseMarquee;
      modeLabel.text = isReverse ? "//批量反选模式" : "//批量选择模式";
      modeLabel.x = 14;
      modeLabel.y = 8;

      modeLabel.style.fill = MARQUEE_LABEL_COLOR;
      if (modeLabel.style.dropShadow) {
        modeLabel.style.dropShadow.color = resolveAppThemeColorNumber(
          ctx.theme,
          "renderer-mode-label-shadow",
        );
      }
    },

    destroy(): void {
      modeLabel.destroy({ children: true });
    },
  };
}
