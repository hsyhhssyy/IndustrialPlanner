import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
  TilingSprite,
} from "pixi.js"

import type { RenderHost } from "@/renderer/renderer-host"
import { CustomTextureKey } from "@/renderer/texture/create-custom-texture"
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform"
import {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"
import { BaseRenderSprite } from "./base-render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180
const PREVIEW_SCAN_LINE_ALPHA = 0.5
const PREVIEW_SCAN_LINE_PIXELS_PER_SECOND = 4
const PREVIEW_SCAN_LINE_ROTATION = Math.PI / 4
const textureLoadCache = new Map<string, Promise<Texture>>()

export class GenericDeviceSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private readonly previewEffectRoot: Container
  private readonly previewScanLineOverlay: TilingSprite
  private readonly previewMask: Graphics
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
    this.previewScanLineOverlay = new TilingSprite({
      texture: this.resolvePreviewTexture(),
      width: 1,
      height: 1,
      anchor: 0.5,
      roundPixels: true,
    })
    this.previewScanLineOverlay.alpha = PREVIEW_SCAN_LINE_ALPHA
    this.previewScanLineOverlay.applyAnchorToTexture = true
    this.previewScanLineOverlay.tileRotation = PREVIEW_SCAN_LINE_ROTATION
    // 使用几何遮罩而不是设备贴图本身，避免 Pixi alpha mask 再乘一遍底图颜色，导致扫描线几乎不可见。
    this.previewMask = new Graphics({ roundPixels: true })
    this.previewScanLineOverlay.mask = this.previewMask
    this.previewEffectRoot.addChild(this.previewScanLineOverlay)
    this.previewEffectRoot.addChild(this.previewMask)
    this.getRootOfLayer("overlay").addChild(this.previewEffectRoot)

    void loadTexture(texturePath).then((texture) => {
      if (this.disposed) {
        return
      }

      this.body.texture = texture
      this.renderHost.textureManager.registerBitmapTexture(this.body.texture)
      this.isTextureReady = true
      this.body.visible = true

      if (this.currentLayout !== null) {
        this.applyLayout(this.currentLayout)
        this.applyPreviewAnimation()
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

    this.syncPreviewTexture()
    this.applyLayout(layout)
    this.applyPreviewAnimation()
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
    this.applyPreviewAnimation()
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
    const previewOverlaySpan = resolvePreviewScanLineOverlaySpan(normalizedLayout)

    applyCenteredSpriteLayout(this.body, normalizedLayout)
    applyCenteredRectMaskLayout(this.previewMask, normalizedLayout)
    applyCenteredSpriteLayout(this.previewScanLineOverlay, {
      ...normalizedLayout,
      width: previewOverlaySpan,
      height: previewOverlaySpan,
    })
  }

  private resolvePreviewTexture(): Texture {
    return this.renderHost.textureManager.getCustomTexture(CustomTextureKey.whiteScanLines)
      ?? Texture.EMPTY
  }

  private syncPreviewTexture(): void {
    const nextTexture = this.resolvePreviewTexture()

    if (this.previewScanLineOverlay.texture === nextTexture) {
      return
    }

    this.previewScanLineOverlay.texture = nextTexture
  }

  private applyPreviewAnimation(): void {
    this.previewScanLineOverlay.tilePosition.x = 0
    this.previewScanLineOverlay.tilePosition.y = resolvePreviewScanLineTileOffset(
      this.renderHost.app.ticker.lastTime,
    )
  }

}

export function resolvePreviewScanLineTileOffset(lastTimeMs: number): number {
  if (!Number.isFinite(lastTimeMs) || lastTimeMs <= 0) {
    return 0
  }

  return ((lastTimeMs / 1000) * PREVIEW_SCAN_LINE_PIXELS_PER_SECOND)
    % WORLD_GRID_CELL_PIXEL_SIZE
}

export function resolvePreviewScanLineOverlaySpan(layout: {
  width: number;
  height: number;
}): number {
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) {
    return WORLD_GRID_CELL_PIXEL_SIZE
  }

  return Math.max(
    WORLD_GRID_CELL_PIXEL_SIZE,
    Math.ceil(Math.hypot(layout.width, layout.height)),
  )
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

function applyCenteredRectMaskLayout(
  target: Graphics,
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  },
): void {
  target.x = layout.x
  target.y = layout.y
  target.rotation = layout.rotation
  target.clear()
  target
    .rect(
      -layout.width / 2,
      -layout.height / 2,
      layout.width,
      layout.height,
    )
    .fill({
      color: 0xffffff,
    })
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
