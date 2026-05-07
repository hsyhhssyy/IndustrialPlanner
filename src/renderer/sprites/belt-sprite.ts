import { Sprite, Texture } from "pixi.js"

import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RenderHost } from "@/renderer/renderer-host"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import { BaseRenderSprite } from "./base-render-sprite"
import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180

export class BeltSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private currentLayout: RenderSpriteLayout | null = null
  private currentSyncContext: RenderSpriteSyncContext | null = null
  private disposed = false
  private isTextureReady = false

  public constructor(
    entityId: string,
    private readonly definition: EntityDefinition,
    private readonly renderHost: RenderHost,
  ) {
    super(entityId)

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    void this.renderHost.textureManager.getTexture(`device-sprite-${this.definition.spriteId}`)
      .then((bodyTexture) => {
        if (this.disposed) {
          return
        }

        this.body.texture = bodyTexture
        this.isTextureReady = true
        this.body.visible = true

        if (this.currentLayout !== null) {
          this.applyLayout(this.currentLayout)

          if (this.currentSyncContext !== null) {
            this.body.tint = resolveBeltTintColor({
              entityId: this.entityId,
              context: this.currentSyncContext,
            })
          }
        }
      })
      .catch(() => {
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
    this.currentLayout = layout
    this.currentSyncContext = context

    if (!this.isTextureReady) {
      return
    }

    this.applyLayout(layout)
    this.body.tint = resolveBeltTintColor({
      entityId: this.entityId,
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
}

function resolveBeltTintColor(options: {
  entityId: string;
  context: RenderSpriteSyncContext;
}): number {
  const { entityId, context } = options
  const collections = context.workspace.editor?.state.collections
  const ordinaryColor = resolveAppThemeColorNumber(
    context.theme,
    context.theme.renderer.beltTileStrokeColorKey,
  )

  if (!collections) {
    return ordinaryColor
  }

  const previewCollection = collections[EntityCollectionType.preview]
  const logisticsHeadCollection = collections[EntityCollectionType.logisticsHead]
  const selectionCollection = collections[EntityCollectionType.selection]
  const isPreview = previewCollection?.contains(entityId) ?? false
  const isPlacementHead = logisticsHeadCollection?.contains(entityId) ?? false
  const isSelected = selectionCollection?.contains(entityId) ?? false

  if (isPreview || isPlacementHead || (isSelected && selectionCollection.length === 1)) {
    return context.theme.colorScheme === "dark"
      ? 0xffffff
      : resolveAppThemeColorNumber(context.theme, "text-2")
  }

  if (isSelected && selectionCollection.length > 1) {
    return resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.worldPreviewRectFillColorKey,
    )
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