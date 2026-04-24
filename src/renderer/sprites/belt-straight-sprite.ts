import {
  Graphics,
} from "pixi.js"

import {
  RenderLayerMap,
  RenderSprite,
  RenderSpriteLayout,
} from "./render-sprite"

const BELT_TILE_FILL_COLOR = 0x1f2937
const BELT_TILE_STROKE_COLOR = 0xf59e0b
const BELT_TILE_STROKE_WIDTH = 2
const BELT_TRACK_COLOR = 0x7c8da3
const BELT_LANE_COLOR = 0xd9e1ee

export class BeltStraightSprite implements RenderSprite {
  private readonly body = new Graphics({ roundPixels: true })
  private currentLayerMap: RenderLayerMap | null = null

  public attach(layers: RenderLayerMap): void {
    if (this.currentLayerMap === layers) {
      return
    }

    this.detach()
    this.currentLayerMap = layers
    layers.entity.addChild(this.body)
  }

  public syncLayout(layout: RenderSpriteLayout): void {
    const cornerRadius = Math.min(layout.width, layout.height) * 0.28
    const trackInset = Math.min(layout.width, layout.height) * 0.16
    const laneWidth = Math.max(2, Math.min(layout.width, layout.height) * 0.18)
    const laneInset = Math.max(2, trackInset + laneWidth * 0.5)
    const trackHeight = Math.max(4, layout.height - trackInset * 2)
    const trackTop = layout.y + (layout.height - trackHeight) / 2
    const laneTop = layout.y + (layout.height - laneWidth) / 2

    this.body.clear()

    this.body
      .roundRect(layout.x, layout.y, layout.width, layout.height, cornerRadius)
      .fill({ color: BELT_TILE_FILL_COLOR })
      .stroke({
        width: BELT_TILE_STROKE_WIDTH,
        color: BELT_TILE_STROKE_COLOR,
      })

    this.body
      .roundRect(
        layout.x + trackInset,
        trackTop,
        Math.max(4, layout.width - trackInset * 2),
        trackHeight,
        Math.max(2, trackHeight * 0.45),
      )
      .fill({ color: BELT_TRACK_COLOR })

    this.body
      .roundRect(
        layout.x + laneInset,
        laneTop,
        Math.max(2, layout.width - laneInset * 2),
        laneWidth,
        Math.max(1, laneWidth * 0.45),
      )
      .fill({ color: BELT_LANE_COLOR })
  }

  public destroy(): void {
    this.detach()
    this.body.destroy()
  }

  private detach(): void {
    if (this.body.parent !== null) {
      this.body.parent.removeChild(this.body)
    }

    this.currentLayerMap = null
  }
}
