import { Graphics } from "pixi.js";
import { resolveViewportPointFromWorldPoint, resolveWorldPointFromViewportPoint } from "@/shared/geometry/viewport-transform";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const IDLE_CURSOR_SIZE_RATIO = 2 / 3;
const IDLE_CURSOR_COLOR = 0xcc8800;
const IDLE_CURSOR_ALPHA = 0.5;

interface AppWithLogisticsPlacementRuntime {
  internalState: {
    runtime: {
      logisticsPlacement: {
        phase: string;
        pointerMode: "mouse" | "touch" | null;
        lastMousePosition: { x: number; y: number } | null;
      };
    };
  };
}

/**
 * 物流放置模式 idle 阶段鼠标跟随方形虚影（仅 PC 鼠标模式）。
 * 方形吸附于最近的 GridCell，大小为 GridCell 的 2/3。
 */
export function createLogisticsPlacementIdleCursorDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      graphics.clear();

      const app = ctx.renderHost.workspace.app;
      if (app === null || !("internalState" in app)) {
        return;
      }

      const runtime = (app as AppWithLogisticsPlacementRuntime).internalState.runtime.logisticsPlacement;

      // 仅在 idle 阶段 && 鼠标模式下显示
      if (runtime.phase !== "idle" || runtime.pointerMode !== "mouse") {
        return;
      }

      const mousePos = runtime.lastMousePosition;
      if (mousePos === null) {
        return;
      }

      const editor = ctx.renderHost.workspace.editor;
      if (editor === null) {
        return;
      }

      const viewport = editor.state.viewport;
      const gridCellPixelSize = viewport.gridCellPixelSize;

      if (gridCellPixelSize <= 0) {
        return;
      }

      // lastMousePosition 为 DOM client 坐标，需使用 editor 的 clientRect 做坐标转换
      const worldPoint = resolveWorldPointFromViewportPoint({
        viewportPoint: mousePos,
        viewportBounds: viewport.clientRect,
        viewportCenter: viewport.center,
        gridCellPixelSize,
        displayRotation: viewport.displayRotation,
      });

      if (worldPoint === null) {
        return;
      }

      // 吸附到最近的整数格点，并偏移到格点中心
      const snappedGridX = Math.floor(worldPoint.x);
      const snappedGridY = Math.floor(worldPoint.y);
      const cursorCenterX = snappedGridX + 0.5;
      const cursorCenterY = snappedGridY + 0.5;

      // 将吸附后的格点中心转换回 canvas 像素坐标（用于 PixiJS 绘制）
      const canvasPixelCenter = resolveViewportPointFromWorldPoint({
        viewportBounds: ctx.viewportBounds,
        viewportCenter: { x: ctx.viewportState.centerX, y: ctx.viewportState.centerY },
        gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
        displayRotation: ctx.viewportState.displayRotation,
        worldPoint: { x: cursorCenterX, y: cursorCenterY },
      });

      const halfSize = (ctx.viewportState.gridCellPixelSize * IDLE_CURSOR_SIZE_RATIO) / 2;

      graphics
        .rect(
          canvasPixelCenter.x - halfSize,
          canvasPixelCenter.y - halfSize,
          halfSize * 2,
          halfSize * 2,
        )
        .fill({
          color: IDLE_CURSOR_COLOR,
          alpha: IDLE_CURSOR_ALPHA,
        });
    },

    destroy(): void {
      graphics.destroy();
    },
  };
}
