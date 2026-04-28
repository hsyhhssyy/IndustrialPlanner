import { Text, TextStyle } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const FPS_TEXT_STYLE = new TextStyle({
  fontSize: 10,
  fill: 0x006600,
  fontFamily: "monospace",
});

const FPS_UPDATE_INTERVAL_MS = 1000;

export function createDiagnosticsDecoration(): DecorationLayer {
  const text = new Text({ text: "", style: FPS_TEXT_STYLE });

  let frameCount = 0;
  let lastFpsUpdateTime = 0;
  let currentFps = 0;

  return {
    container: text,

    sync(ctx: DecorationSyncContext): void {
      const showFps =
        ctx.workspace.app!.state.settings.debugShowFps;

      if (!showFps) {
        text.visible = false;
        return;
      }

      text.visible = true;

      frameCount += 1;

      if (lastFpsUpdateTime === 0) {
        lastFpsUpdateTime = ctx.nowMs;
      }

      const elapsed = ctx.nowMs - lastFpsUpdateTime;

      if (elapsed >= FPS_UPDATE_INTERVAL_MS) {
        currentFps = Math.round(
          (frameCount / elapsed) * FPS_UPDATE_INTERVAL_MS,
        );
        frameCount = 0;
        lastFpsUpdateTime = ctx.nowMs;
      }

      text.text = `FPS:${currentFps}`;

      // Position at the top-right corner of the viewport
      text.x = ctx.viewportBounds.left + ctx.viewportBounds.width - text.width - 4;
      text.y = ctx.viewportBounds.top + 4;
    },

    destroy(): void {
      text.destroy({ children: true });
    },
  };
}
