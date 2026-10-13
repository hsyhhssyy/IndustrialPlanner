import { Container, Graphics } from "pixi.js";
import { resolveRangeOutlineLayouts } from "./range-layout";
import { RangeAnimation } from "./range-animation";
import type { RangeFrameContext, RangePresentation } from "./types";

/** 范围框共用 Graphics；每种资源只创建一个播放器，实例以稳定 key 管理。 */
export class RangeLayer {
  readonly container = new Container();
  private readonly graphics = new Graphics({ roundPixels: true });
  private readonly animations = new Map<string, RangeAnimation>();
  private lastDrawing = "";

  constructor() {
    this.container.label = "device-ranges";
    this.container.addChild(this.graphics);
  }

  isAnimationReady(assetRoot: string): boolean { return this.animations.get(assetRoot)?.isReady === true; }

  sync(ctx: RangeFrameContext, presentation: RangePresentation): void {
    for (const instance of presentation.animations) {
      if (!this.animations.has(instance.assetRoot)) {
        const animation = new RangeAnimation(instance.assetRoot);
        this.animations.set(instance.assetRoot, animation);
        this.container.addChild(animation.container);
      }
    }
    for (const [assetRoot, animation] of this.animations) {
      animation.sync(ctx, presentation.animations.filter((instance) => instance.assetRoot === assetRoot));
    }
    const layouts = resolveRangeOutlineLayouts(ctx, presentation.outlines);
    const stamp = JSON.stringify(layouts);
    if (stamp === this.lastDrawing) return;
    this.lastDrawing = stamp;
    this.graphics.clear();
    for (const { rect, color, strokeAlpha, fillAlpha, width } of layouts) {
      this.graphics.rect(rect.left, rect.top, rect.width, rect.height);
      if (fillAlpha > 0) this.graphics.fill({ color, alpha: fillAlpha });
      this.graphics.stroke({ color, alpha: strokeAlpha, width });
    }
  }

  destroy(): void {
    for (const animation of this.animations.values()) animation.destroy();
    this.animations.clear();
    this.graphics.destroy();
    this.container.destroy();
  }
}
