import { BlurFilter, Graphics, Text, TextStyle } from "pixi.js";
import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

const CANVAS_GLOW_ANIMATION_PERIOD_MS = 2000;
const CANVAS_GLOW_ALPHA_MIN = 0.5;
const CANVAS_GLOW_ALPHA_MAX = 1;

const CORE_STROKE_WIDTH = 0;
const NEAR_STROKE_WIDTH = 10;
const NEAR_BLUR_STRENGTH = 10;
const FAR_STROKE_WIDTH = 8;
const FAR_BLUR_STRENGTH = 30;

const LOGISTICS_PLACEMENT_GLOW_COLOR = 0xFFD54A;

const MODE_LABEL_TEXT_STYLE = new TextStyle({
  fontSize: 14,
  fontFamily: "sans-serif",
  fontWeight: "bold",
  fill: LOGISTICS_PLACEMENT_GLOW_COLOR,
  dropShadow: {
    color: 0x000000,
    alpha: 0.6,
    blur: 4,
    distance: 1,
  },
});

const LOGISTICS_PLACEMENT_LABELS = {
  belt: "布设传送带",
  pipe: "布设管道",
} as const;

interface AppWithLogisticsPlacementRuntime {
  internalState: {
    runtime: {
      logisticsPlacement: {
        kind: keyof typeof LOGISTICS_PLACEMENT_LABELS | null;
      };
    };
  };
}

function resolveGlowAlpha(nowMs: number): number {
  const phase =
    ((nowMs % CANVAS_GLOW_ANIMATION_PERIOD_MS)
      / CANVAS_GLOW_ANIMATION_PERIOD_MS)
    * Math.PI * 2;
  const t = (Math.sin(phase) + 1) / 2;
  return CANVAS_GLOW_ALPHA_MIN
    + t * (CANVAS_GLOW_ALPHA_MAX - CANVAS_GLOW_ALPHA_MIN);
}

function resolveLogisticsPlacementKind(
  ctx: DecorationSyncContext,
): keyof typeof LOGISTICS_PLACEMENT_LABELS | null {
  const app = ctx.renderHost.workspace.app;

  if (app === null || !("internalState" in app)) {
    return null;
  }

  return (app as AppWithLogisticsPlacementRuntime)
    .internalState.runtime.logisticsPlacement.kind;
}

export function createLogisticsPlacementCanvasDecoration(): DecorationLayer {
  const graphics = new Graphics({ roundPixels: true });
  const coreEdge = new Graphics({ roundPixels: true });
  const nearGlow = new Graphics({ roundPixels: true });
  const nearBlur = new BlurFilter({ quality: 4 });
  nearGlow.filters = [nearBlur];

  const farGlow = new Graphics({ roundPixels: true });
  const farBlur = new BlurFilter({ quality: 4 });
  farGlow.filters = [farBlur];

  const glowMask = new Graphics({ roundPixels: true });
  coreEdge.mask = glowMask;
  nearGlow.mask = glowMask;
  farGlow.mask = glowMask;

  const modeLabel = new Text({ text: "", style: MODE_LABEL_TEXT_STYLE });

  graphics.addChild(glowMask);
  graphics.addChild(farGlow);
  graphics.addChild(nearGlow);
  graphics.addChild(coreEdge);
  graphics.addChild(modeLabel);

  return {
    container: graphics,

    sync(ctx: DecorationSyncContext): void {
      const appState = ctx.renderHost.workspace.app!.state;
      const logisticsKind = resolveLogisticsPlacementKind(ctx);
      const isLogisticsPlacement = appState.activeTool === "logistics-placement" && logisticsKind !== null;
      const isSinglePlacement = appState.activeTool === "single-placement";

      if (!isLogisticsPlacement && !isSinglePlacement) {
        graphics.visible = false;
        return;
      }

      graphics.visible = true;

      const { width, height } = ctx.viewportBounds;
      const alpha = resolveGlowAlpha(ctx.nowMs);

      graphics.clear();
      coreEdge.clear();
      nearGlow.clear();
      farGlow.clear();
      glowMask.clear();

      glowMask
        .rect(0, 0, width, height)
        .fill(0xffffff);

      farBlur.strength = FAR_BLUR_STRENGTH;
      farGlow
        .rect(0, 0, width, height)
        .stroke({
          width: FAR_STROKE_WIDTH,
          color: LOGISTICS_PLACEMENT_GLOW_COLOR,
          alpha: alpha * 0.35,
        });

      nearBlur.strength = NEAR_BLUR_STRENGTH;
      nearGlow
        .rect(0, 0, width, height)
        .stroke({
          width: NEAR_STROKE_WIDTH,
          color: LOGISTICS_PLACEMENT_GLOW_COLOR,
          alpha: alpha * 0.7,
        });

      coreEdge
        .rect(0, 0, width, height)
        .stroke({
          width: CORE_STROKE_WIDTH,
          color: LOGISTICS_PLACEMENT_GLOW_COLOR,
          alpha,
        });

      modeLabel.text = isSinglePlacement
        ? "放置设备"
        : logisticsKind === null
          ? ""
          : LOGISTICS_PLACEMENT_LABELS[logisticsKind];
      modeLabel.x = 12;
      modeLabel.y = 12;
    },

    destroy(): void {
      nearBlur.destroy();
      farBlur.destroy();
      modeLabel.destroy({ children: true });
      glowMask.destroy({ children: true });
      coreEdge.destroy({ children: true });
      nearGlow.destroy({ children: true });
      farGlow.destroy({ children: true });
      graphics.destroy({ children: true });
    },
  };
}