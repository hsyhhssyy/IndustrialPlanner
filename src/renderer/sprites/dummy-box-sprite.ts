import {
  Graphics,
} from "pixi.js";

import {
  RenderLayerMap,
  RenderSprite,
  RenderSpriteLayout,
} from "./render-sprite";

const BOX_FILL_COLOR = 0x1f2937;
const BOX_STROKE_COLOR = 0xf59e0b;
const BOX_STROKE_WIDTH = 4;

export class DummyBoxSprite implements RenderSprite {
  private readonly body = new Graphics();
  private currentLayerMap: RenderLayerMap | null = null;

  public attach(layers: RenderLayerMap): void {
    if (this.currentLayerMap === layers) {
      return;
    }

    this.detach();
    this.currentLayerMap = layers;
    layers.entity.addChild(this.body);
  }

  public syncLayout(layout: RenderSpriteLayout): void {
    const cornerRadius = Math.min(layout.width, layout.height) * 0.12;

    this.body
      .clear()
      .roundRect(layout.x, layout.y, layout.width, layout.height, cornerRadius)
      .fill({ color: BOX_FILL_COLOR })
      .stroke({
        width: BOX_STROKE_WIDTH,
        color: BOX_STROKE_COLOR,
      });
  }

  public destroy(): void {
    this.detach();
    this.body.destroy();
  }

  private detach(): void {
    if (this.body.parent !== null) {
      this.body.parent.removeChild(this.body);
    }

    this.currentLayerMap = null;
  }
}