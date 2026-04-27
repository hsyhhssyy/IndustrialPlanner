import {
  Assets,
  Container,
  Sprite,
  Texture,
} from "pixi.js"

import type { RenderHost } from "@/renderer/renderer-host"
import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180
const textureLoadCache = new Map<string, Promise<Texture>>()

export class GenericDeviceSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private readonly previewEffectRoot: Container
  private readonly previewOverlay: Sprite
  private readonly previewMask: Sprite
  private currentLayout: RenderSpriteLayout | null = null
  private disposed = false
  private isTextureReady = false

  public constructor(
    entityId: string,
    texturePath: string,
    private readonly renderHost: RenderHost,
  ) {
    super(entityId)

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    this.previewEffectRoot = new Container()
    this.previewEffectRoot.visible = false
    this.previewOverlay = new Sprite(Texture.WHITE)
    this.previewOverlay.anchor.set(0.5)
    this.previewOverlay.roundPixels = true
    this.previewMask = new Sprite(Texture.EMPTY)
    this.previewMask.anchor.set(0.5)
    this.previewMask.roundPixels = true
    this.previewOverlay.mask = this.previewMask
    this.previewEffectRoot.addChild(this.previewOverlay)
    this.previewEffectRoot.addChild(this.previewMask)
    this.getRootOfLayer("overlay").addChild(this.previewEffectRoot)

    const bodyTextureLoad = loadTexture(texturePath)
    const previewMaskTexturePath = resolvePreviewMaskTexturePath(texturePath)
    const previewMaskTextureLoad = previewMaskTexturePath === texturePath
      ? Promise.resolve<Texture | null>(null)
      : loadTexture(previewMaskTexturePath).catch(() => null)

    void Promise.all([bodyTextureLoad, previewMaskTextureLoad]).then(([
      bodyTexture,
      previewMaskTexture,
    ]) => {
      if (this.disposed) {
        return
      }

      this.body.texture = bodyTexture
  this.previewMask.texture = previewMaskTexture ?? bodyTexture
      this.renderHost.textureManager.registerBitmapTexture(this.body.texture)
      this.renderHost.textureManager.registerBitmapTexture(this.previewMask.texture)
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
      this.previewEffectRoot.visible = false
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

  protected resetCollectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    super.resetCollectionOverlay(layout, context)

    this.previewEffectRoot.visible = false
  }

  protected drawDefaultPreviewOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context

    if (!this.isTextureReady) {
      return
    }

    this.previewEffectRoot.visible = true
  }

  protected onDestroy(): void {
    this.disposed = true
  }

  private applyLayout(layout: RenderSpriteLayout): void {
    const isQuarterTurn = layout.rotation === 90 || layout.rotation === 270
    const normalizedLayout = {
      x: layout.x + layout.width / 2,
      y: layout.y + layout.height / 2,
      width: isQuarterTurn ? layout.height : layout.width,
      height: isQuarterTurn ? layout.width : layout.height,
      rotation: layout.rotation * DEGREE_TO_RADIAN,
    }

    applyCenteredSpriteLayout(this.body, normalizedLayout)
    applyCenteredSpriteLayout(this.previewOverlay, normalizedLayout)
    applyCenteredSpriteLayout(this.previewMask, normalizedLayout)
  }

}

function applyCenteredSpriteLayout(target: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}, layout: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): void {
  target.x = layout.x
  target.y = layout.y
  target.width = layout.width
  target.height = layout.height
  target.rotation = layout.rotation
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

function resolvePreviewMaskTexturePath(texturePath: string): string {
  if (!texturePath.startsWith("/sprites/")) {
    return texturePath
  }

  return `/sprite-masks/${texturePath.slice("/sprites/".length)}`
}
