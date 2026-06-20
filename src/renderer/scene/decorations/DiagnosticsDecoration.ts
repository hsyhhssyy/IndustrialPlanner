import { Text, TextStyle } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

const FPS_TEXT_STYLE = new TextStyle({
  fontSize: 20,
  fill: 0x006600,
  fontFamily: "monospace",
  fontWeight: "bold",
  stroke: { color: 0x000000, width: 2, alpha: 0.42 },
  dropShadow: {
    color: 0x000000,
    alpha: 0.16,
    blur: 2,
    distance: 1,
    angle: Math.PI / 2,
  },
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
        ctx.renderHost.workspace.app!.state.settings.debugShowFps;

      if (!showFps) {
        text.visible = false;
        return;
      }

      text.visible = true;

      const strokeColor = resolveAppThemeColorNumber(
        ctx.theme,
        "text-0",
      );
      text.style.stroke = {
        color: strokeColor,
        width: 2,
        alpha: 0.42,
      };
      if (text.style.dropShadow) {
        text.style.dropShadow.color = strokeColor;
      }

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

      const stats = ctx.renderHost.workspace.simulation?.state.statistics;
      const currentTps = stats?.tickPerSecond ?? 0;
      const currentTargetTps = stats?.targetTickPerSecond ?? 0;
      const bufferSize = ctx.renderHost.workspace.simulation?.state.bufferSize ?? 0;
      text.text = `FPS:${currentFps} TPS:${currentTps.toFixed(1)} dTPS:${currentTargetTps} BUF:${bufferSize}`;

      // Position at the top-right corner of the viewport
      text.x = ctx.viewportBounds.left + ctx.viewportBounds.width - text.width - 4;
      text.y = ctx.viewportBounds.top + 4;
    },

    destroy(): void {
      text.destroy({ children: true });
    },
  };
}
