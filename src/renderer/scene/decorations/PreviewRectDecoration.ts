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
      measureDecorationStep(ctx, "previewRect.clear", () => {
        graphics.clear();
      });

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
      ctx.profiler?.count("previewRect.collectionSize", previewCollection.length);

      const gridRect = measureDecorationStep(ctx, "previewRect.findCollectionGridRect", () =>
        editor.queries.findEntityCollectionGridRect(EntityCollectionType.preview),
      );
      if (gridRect === null) {
        return;
      }

      const layout = measureDecorationStep(ctx, "previewRect.resolveLayout", () =>
        resolveMarqueeGridRectLayout({
          gridRect,
          viewportBounds: ctx.viewportBounds,
          viewportCenter: {
            x: ctx.viewportState.centerX,
            y: ctx.viewportState.centerY,
          },
          gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
          displayRotation: ctx.viewportState.displayRotation,
        }),
      );

      if (layout === null) {
        return;
      }

      const theme = ctx.theme;
      const fillColor = resolveAppThemeColorNumber(
        theme,
        theme.renderer.worldPreviewRectFillColorKey,
      );

      measureDecorationStep(ctx, "previewRect.draw", () => {
        graphics
          .rect(layout.x, layout.y, layout.width, layout.height)
          .fill({
            color: fillColor,
            alpha: PREVIEW_RECT_FILL_ALPHA,
          });
      });
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

function measureDecorationStep<T>(
  ctx: DecorationSyncContext,
  stage: string,
  callback: () => T,
): T {
  if (ctx.profiler === undefined) {
    return callback();
  }

  return ctx.profiler.measure(stage, callback);
}
