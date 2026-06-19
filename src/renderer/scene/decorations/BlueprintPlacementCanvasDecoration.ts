import type { TextStyleOptions } from "pixi.js";
import { Text } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

/** 蓝图放置模式标签蓝色 */
const BLUEPRINT_PLACEMENT_GLOW_COLOR = 0x42A5F5;

/** 左上角模式标签样式（不含 dropShadow.color，由 sync 动态设置） */
const MODE_LABEL_TEXT_STYLE = {
  fontSize: 28,
  fontFamily: "sans-serif",
  fontWeight: "bold",
  fill: BLUEPRINT_PLACEMENT_GLOW_COLOR,
  stroke: {
    color: 0x20242a,
    width: 4,
    alpha: 0.42,
  },
  dropShadow: {
    angle: Math.PI / 4,
    alpha: 0.6,
    blur: 4,
    distance: 1,
  },
} satisfies TextStyleOptions;

/**
 * BlueprintPlacementCanvasDecoration
 *
 * 当 activeTool 为 "blueprint-placement" 时，
 * 在视口左上角渲染蓝色模式标签 "//蓝图放置"。
 */
export function createBlueprintPlacementCanvasDecoration(): DecorationLayer {
  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE as TextStyleOptions });

  return {
    container: modeLabel,

    sync(ctx: DecorationSyncContext): void {
      const activeTool = ctx.renderHost.workspace.app!.state.activeTool;

      if (activeTool !== "blueprint-placement") {
        modeLabel.visible = false;
        return;
      }

      modeLabel.visible = true;
      modeLabel.text = "//蓝图放置";
      modeLabel.x = 14;
      modeLabel.y = 8;

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
