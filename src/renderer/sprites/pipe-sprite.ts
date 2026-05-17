import { Sprite, Texture } from "pixi.js"

import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { RegistryContract } from "@/domain/registry/registry-contract"
import type { RenderHost } from "@/renderer/renderer-host"

import { DedicatedLogisticSprite } from "./dedicated-logistic-sprite"
import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180
const LIQUID_COLOR_TAG_PREFIX = "liquid_color:"
const DEFAULT_PIPE_BEAD_COLOR = 0xffffff
const LIQUID_TEXTURE_KEY_PREFIX = "texture-"

export class PipeSprite extends DedicatedLogisticSprite {
  private readonly bead: Sprite
  private readonly pipeSpriteId: string
  private readonly renderHost: RenderHost
  private lastFluidItemId: string | null = null
  private beadColor = DEFAULT_PIPE_BEAD_COLOR
  private liquidTexture: Texture | null = null
  private liquidTextureLoaded = false
  private disposed = false

  public constructor(
    entityId: string,
    definition: EntityDefinition,
    renderHost: RenderHost,
  ) {
    super(entityId, definition, renderHost)

    this.pipeSpriteId = definition.spriteId
    this.renderHost = renderHost
    this.bead = new Sprite(Texture.WHITE)
    this.bead.anchor.set(0.5)
    this.bead.roundPixels = true
    this.bead.visible = false
    this.getRootOfLayer("entity").addChild(this.bead)

    this.loadLiquidTexture()
  }

  private loadLiquidTexture(): void {
    const textureKey = `${LIQUID_TEXTURE_KEY_PREFIX}${this.pipeSpriteId}_liquid`
    void this.renderHost.textureManager.getTexture(textureKey)
      .then((texture) => {
        if (this.disposed) {
          return
        }

        this.liquidTexture = texture
        this.liquidTextureLoaded = true
        this.bead.texture = texture
      })
      .catch(() => {
        // 贴图加载失败时保持 Texture.WHITE 作为降级
      })
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    super.syncSpriteLayout(layout, context)
    this.syncFluidBead(layout, context)
  }

  protected afterDeviceTextureReady(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.syncFluidBead(layout, context)
  }

  protected onDestroy(): void {
    super.onDestroy()
    this.disposed = true
  }

  private syncFluidBead(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    if (!this.isDeviceTextureReady()) {
      this.bead.visible = false
      return
    }

    const fluidItemId = context.workspace.simulation?.queries.getPipeFluidItemId(this.entityId) ?? null
    if (fluidItemId === null) {
      this.bead.visible = false
      return
    }

    if (fluidItemId !== this.lastFluidItemId) {
      this.lastFluidItemId = fluidItemId
      this.beadColor = resolveLiquidColor(fluidItemId, context.workspace.registry)
    }

    this.positionBead(layout)
    this.bead.tint = this.beadColor
    this.bead.visible = true
  }

  /**
   * 将 bead 定位到格子中心，宽高覆盖整个格子。
   * 液体贴图自带 Alpha 通道限定内腔形状，无需手算比例。
   * 贴图尺寸为 128×128，与格子精灵尺寸一致，旋转跟随管道朝向。
   */
  private positionBead(layout: RenderSpriteLayout): void {
    const isQuarterTurn = layout.rotation === 90 || layout.rotation === 270
    this.bead.x = layout.x + layout.width / 2
    this.bead.y = layout.y + layout.height / 2
    this.bead.width = isQuarterTurn ? layout.height : layout.width
    this.bead.height = isQuarterTurn ? layout.width : layout.height
    this.bead.rotation = layout.rotation * DEGREE_TO_RADIAN
  }
}

function resolveLiquidColor(
  itemId: string,
  registry: RegistryContract,
): number {
  const itemDefinition = registry.itemDefinitions.find((item) => item.id === itemId)
  const colorTag = itemDefinition?.tags.find((tag) => tag.startsWith(LIQUID_COLOR_TAG_PREFIX))
  if (colorTag === undefined) {
    return DEFAULT_PIPE_BEAD_COLOR
  }

  const normalizedHex = colorTag
    .slice(LIQUID_COLOR_TAG_PREFIX.length)
    .trim()
    .replace(/^#/, "")

  if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
    return DEFAULT_PIPE_BEAD_COLOR
  }

  return Number.parseInt(normalizedHex, 16)
}
