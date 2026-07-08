import { Graphics } from "pixi.js";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveMarqueeGridRectLayout } from "./MarqueeRectDecoration";

const PREVIEW_RECT_FILL_ALPHA = 0.5;
const PREVIEW_RECT_FILL_COLOR = 0x0f2f66;

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
      // 2026-07-06 订正：多设备 preview 包围盒背景也用于 blueprint-placement，方便移动端拖动包围盒空白区域。
      if (!shouldShowPreviewRectForActiveTool(app.state.activeTool)) {
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

      measureDecorationStep(ctx, "previewRect.draw", () => {
        graphics
          .rect(layout.x, layout.y, layout.width, layout.height)
          .fill({
            color: PREVIEW_RECT_FILL_COLOR,
            alpha: PREVIEW_RECT_FILL_ALPHA,
          });
      });
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}

function shouldShowPreviewRectForActiveTool(activeTool: string): boolean {
  return (
    activeTool === "move"
    || activeTool === "blueprint-placement"
    || activeTool === "single-placement"
  );
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
