import {
  Assets,
  Sprite,
  Texture,
} from "pixi.js"

import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180
const textureLoadCache = new Map<string, Promise<Texture>>()

export class GenericDeviceSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private currentLayout: RenderSpriteLayout | null = null
  private disposed = false
  private isTextureReady = false

  public constructor(entityId: string, texturePath: string) {
    super(entityId)

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    void loadTexture(texturePath).then((texture) => {
      if (this.disposed) {
        return
      }

      this.body.texture = texture
      this.isTextureReady = true
      this.body.visible = true

      if (this.currentLayout !== null) {
        this.applyLayout(this.currentLayout)
      }
    }).catch(() => {
      if (this.disposed) {
        return
      }

      this.body.visible = false
    })
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void context

    this.currentLayout = layout

    if (!this.isTextureReady) {
      return
    }

    this.applyLayout(layout)
  }

  protected onDestroy(): void {
    this.disposed = true
  }

  private applyLayout(layout: RenderSpriteLayout): void {
    const isQuarterTurn = layout.rotation === 90 || layout.rotation === 270

    this.body.x = layout.x + layout.width / 2
    this.body.y = layout.y + layout.height / 2
    this.body.width = isQuarterTurn ? layout.height : layout.width
    this.body.height = isQuarterTurn ? layout.width : layout.height
    this.body.rotation = layout.rotation * DEGREE_TO_RADIAN
  }

}

function loadTexture(texturePath: string): Promise<Texture> {
  const existingLoad = textureLoadCache.get(texturePath)
  if (existingLoad) {
    return existingLoad
  }

  const nextLoad = Assets.load<Texture>(texturePath).catch((error) => {
    textureLoadCache.delete(texturePath)
    throw error
  })

  textureLoadCache.set(texturePath, nextLoad)
  return nextLoad
}
