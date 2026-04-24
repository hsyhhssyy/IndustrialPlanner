import {
  Assets,
  Sprite,
  Texture,
} from "pixi.js"

import {
  RenderLayerMap,
  RenderSprite,
  RenderSpriteLayout,
} from "./render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180
const textureLoadCache = new Map<string, Promise<Texture>>()

export class GenericDeviceSprite implements RenderSprite {
  private readonly body: Sprite
  private currentLayerMap: RenderLayerMap | null = null
  private currentLayout: RenderSpriteLayout | null = null
  private destroyed = false
  private isTextureReady = false

  public constructor(texturePath: string) {
    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    void loadTexture(texturePath).then((texture) => {
      if (this.destroyed) {
        return
      }

      this.body.texture = texture
      this.isTextureReady = true
      this.body.visible = true

      if (this.currentLayout !== null) {
        this.applyLayout(this.currentLayout)
      }
    }).catch(() => {
      this.body.visible = false
    })
  }

  public attach(layers: RenderLayerMap): void {
    if (this.currentLayerMap === layers) {
      return
    }

    this.detach()
    this.currentLayerMap = layers
    layers.entity.addChild(this.body)
  }

  public syncLayout(layout: RenderSpriteLayout): void {
    this.currentLayout = layout

    if (!this.isTextureReady) {
      return
    }

    this.applyLayout(layout)
  }

  public destroy(): void {
    this.destroyed = true
    this.detach()
    this.body.destroy()
  }

  private applyLayout(layout: RenderSpriteLayout): void {
    const isQuarterTurn = layout.rotation === 90 || layout.rotation === 270

    this.body.x = layout.x + layout.width / 2
    this.body.y = layout.y + layout.height / 2
    this.body.width = isQuarterTurn ? layout.height : layout.width
    this.body.height = isQuarterTurn ? layout.width : layout.height
    this.body.rotation = layout.rotation * DEGREE_TO_RADIAN
  }

  private detach(): void {
    if (this.body.parent !== null) {
      this.body.parent.removeChild(this.body)
    }

    this.currentLayerMap = null
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
