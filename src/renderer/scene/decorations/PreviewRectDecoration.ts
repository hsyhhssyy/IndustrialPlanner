import { Graphics } from "pixi.js";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveMarqueeGridRectLayout } from "./MarqueeRectDecoration";

const PREVIEW_RECT_FILL_ALPHA = 0.18;

export function createPreviewRectDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const app = ctx.renderHost.workspace.app;
      if (!app) {
        return;
      }

      // 仅在 move 模式下显示
      if (app.state.activeTool !== "move") {
        return;
      }

      const editor = ctx.renderHost.workspace.editor;
      if (!editor) {
        return;
      }

      const previewCollection = editor.state.collections[EntityCollectionType.preview];

      // 仅当 preview 中有多个元素时才显示包围盒背景
      if (!previewCollection || previewCollection.length <= 1) {
        return;
      }

      const gridRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview);
      if (gridRect === null) {
        return;
      }

      const layout = resolveMarqueeGridRectLayout({
        gridRect,
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

      const theme = app.state.theme;
      const fillColor = resolveAppThemeColorNumber(
        theme,
        theme.renderer.worldPreviewRectFillColorKey,
      );

      graphics
        .rect(layout.x, layout.y, layout.width, layout.height)
        .fill({
          color: fillColor,
          alpha: PREVIEW_RECT_FILL_ALPHA,
        });
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}
