import { Graphics } from "pixi.js";

import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import {
  resolveMarqueeGridRectLayout,
  resolveWorldAuxiliaryStrokeWidth,
} from "./MarqueeRectDecoration";

const ATTACHMENT_FOCUS_FILL_ALPHA = 0.12;
const ATTACHMENT_FOCUS_STROKE_ALPHA = 0.9;
const ATTACHMENT_FOCUS_STROKE_SCALE = 1.2;
const ATTACHMENT_FOCUS_CORNER_RADIUS = 3;

/** 附属实体不是可选对象；这里只按查看焦点绘制一次合并区域。 */
export function createAttachmentFocusDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });
  let lastKey = "";

  const clear = (): void => {
    if (lastKey === "") return;
    lastKey = "";
    graphics.clear();
  };

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const focus = ctx.renderHost.input.presentation.getSnapshot().attachmentFocus;
      const document = ctx.renderHost.input.source.snapshot.getSnapshot().document;
      if (focus === null || focus.documentKey !== document.documentKey) {
        clear();
        return;
      }
      const layout = resolveMarqueeGridRectLayout({
        gridRect: focus.gridRect,
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
        displayRotation: ctx.viewportState.displayRotation,
      });
      if (layout === null) {
        clear();
        return;
      }
      const resolution = ctx.renderHost.app.renderer.resolution;
      const color = resolveAppThemeColorNumber(ctx.theme, ctx.theme.renderer.worldMarqueeStrokeColorKey);
      const key = [focus.regionId, layout.x, layout.y, layout.width, layout.height, resolution, color].join(":");
      if (key === lastKey) return;
      lastKey = key;

      graphics.clear();
      graphics
        .roundRect(layout.x, layout.y, layout.width, layout.height, ATTACHMENT_FOCUS_CORNER_RADIUS)
        .fill({ color, alpha: ATTACHMENT_FOCUS_FILL_ALPHA })
        .stroke({
          width: resolveWorldAuxiliaryStrokeWidth(ctx.viewportState.gridCellPixelSize)
            * ATTACHMENT_FOCUS_STROKE_SCALE,
          color,
          alpha: ATTACHMENT_FOCUS_STROKE_ALPHA,
        });
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}
