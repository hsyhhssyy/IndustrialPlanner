import {
  Graphics,
} from "pixi.js"

import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

const BELT_TILE_STROKE_WIDTH = 2

export class BeltStraightSprite extends BaseRenderSprite {
  private readonly body = new Graphics({ roundPixels: true })

  public constructor(entityId: string) {
    super(entityId)
    this.getRootOfLayer("entity").addChild(this.body)
  }

  protected syncSpriteLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void {
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
      .fill({
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltTileFillColorKey,
        ),
      })
      .stroke({
        width: BELT_TILE_STROKE_WIDTH,
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltTileStrokeColorKey,
        ),
      })

    this.body
      .roundRect(
        layout.x + trackInset,
        trackTop,
        Math.max(4, layout.width - trackInset * 2),
        trackHeight,
        Math.max(2, trackHeight * 0.45),
      )
      .fill({
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltTrackColorKey,
        ),
      })

    this.body
      .roundRect(
        layout.x + laneInset,
        laneTop,
        Math.max(2, layout.width - laneInset * 2),
        laneWidth,
        Math.max(1, laneWidth * 0.45),
      )
      .fill({
        color: resolveAppThemeColorNumber(
          context.theme,
          context.theme.renderer.beltLaneColorKey,
        ),
      })
  }
}
