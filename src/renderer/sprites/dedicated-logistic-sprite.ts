import { Sprite, Texture } from "pixi.js"

import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"
import { resolveDeviceBodyTextureKey } from "@/renderer/sprites/device-texture-key"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import { BaseRenderSprite } from "./base-render-sprite"
import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180

export class DedicatedLogisticSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private readonly spriteId: string
  private currentLayout: RenderSpriteLayout | null = null
  private currentSyncContext: RenderSpriteSyncContext | null = null
  private disposed = false
  private isTextureReady = false
  private currentBodyTextureKey: string | null = null
  private textureLoadVersion = 0

  public constructor(
    entityId: string,
    definition: EntityDefinition,
    private readonly renderHost: RenderHost,
  ) {
    super(entityId)
    this.spriteId = definition.spriteId

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    this.syncDeviceTexture()
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.currentLayout = layout
    this.currentSyncContext = context
    this.syncDeviceTexture()

    if (!this.isTextureReady) {
      return
    }

    this.applyLayout(layout)
    this.body.tint = resolveDedicatedLogisticTintColor({
      entityId: this.entityId,
      spriteId: this.spriteId,
      context,
    })
  }

  protected resetCollectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context
  }

  protected drawGhostOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context
  }

  protected drawPreviewOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context
  }

  protected drawSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context
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
  }

  private syncDeviceTexture(): void {
    const bodyTextureKey = resolveDeviceBodyTextureKey(
      this.spriteId,
      this.renderHost.workspace.app,
    )

    if (this.currentBodyTextureKey === bodyTextureKey) {
      return
    }

    this.currentBodyTextureKey = bodyTextureKey
    this.textureLoadVersion += 1
    const activeLoadVersion = this.textureLoadVersion
    this.isTextureReady = false
    this.body.visible = false

    void this.renderHost.textureManager.getTexture(bodyTextureKey)
      .then((bodyTexture) => {
        if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
          return
        }

        this.body.texture = bodyTexture
        this.isTextureReady = true
        this.body.visible = true

        if (this.currentLayout !== null) {
          this.applyLayout(this.currentLayout)

          if (this.currentSyncContext !== null) {
            this.body.tint = resolveDedicatedLogisticTintColor({
              entityId: this.entityId,
              spriteId: this.spriteId,
              context: this.currentSyncContext,
            })
          }
        }
      })
      .catch(() => {
        if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
          return
        }

        this.body.visible = false
      })
  }
}

function resolveDedicatedLogisticTintColor(options: {
  entityId: string;
  spriteId: string;
  context: RenderSpriteSyncContext;
}): number {
  const { entityId, spriteId, context } = options
  const collections = context.workspace.editor?.state.collections
  const ordinaryColor = spriteId.startsWith("pipe_")
    ? resolveAppThemeColorNumber(
      context.theme,
      context.theme.colorScheme === "dark" ? "accent" : "accent-strong",
    )
    : resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.beltTileStrokeColorKey,
    )
  const selectionTintColor = resolveAppThemeColorNumber(
    context.theme,
    context.theme.renderer.worldPreviewRectFillColorKey,
  )

  if (!collections) {
    return ordinaryColor
  }

  const previewCollection = collections[EntityCollectionType.preview]
  const marqueeCollection = collections[EntityCollectionType.marquee]
  const reverseMarqueeCollection = collections[EntityCollectionType.reverseMarquee]
  const logisticsHeadCollection = collections[EntityCollectionType.logisticsHead]
  const selectionCollection = collections[EntityCollectionType.selection]
  const isPreview = previewCollection?.contains(entityId) ?? false
  const isPreviewGroup = isPreview && (previewCollection?.length ?? 0) > 1
  const isMarquee = marqueeCollection?.contains(entityId) ?? false
  const isReverseMarquee = reverseMarqueeCollection?.contains(entityId) ?? false
  const isPlacementHead = logisticsHeadCollection?.contains(entityId) ?? false
  const isSelected = selectionCollection?.contains(entityId) ?? false

  if (
    isPreviewGroup
    || isMarquee
    || (isSelected && (selectionCollection?.length ?? 0) > 1 && !isReverseMarquee)
  ) {
    return selectionTintColor
  }

  if (
    isPreview
    || isPlacementHead
    || (isSelected && (selectionCollection?.length ?? 0) === 1 && !isReverseMarquee)
  ) {
    return context.theme.colorScheme === "dark"
      ? 0xffffff
      : resolveAppThemeColorNumber(context.theme, "text-2")
  }

  return ordinaryColor
}

function applyCenteredSpriteLayout(
  sprite: Pick<Sprite, "x" | "y" | "width" | "height" | "rotation">,
  layout: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  },
): void {
  sprite.x = layout.x
  sprite.y = layout.y
  sprite.width = layout.width
  sprite.height = layout.height
  sprite.rotation = layout.rotation
}
