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
const GAS_COLOR_TAG_PREFIX = "gas_color:"
const FLUID_COLOR_TAG_PREFIX = "fluid_color:"
const LIQUID_COLOR_TAG_PREFIX = "liquid_color:"
const DEFAULT_PIPE_BEAD_COLOR = 0xffffff
const LIQUID_TEXTURE_KEY_PREFIX = "texture-"

/**
 * 首润模式开关：true 时管道只在液体第 1 次流过才开始显示填充贴图，
 * 之后只要连通段未排空就保持显示；false 时退回到旧行为（连通段有液体即全量渲染）。
 * 设置为 false 可消除每帧额外的 isPipeDeviceSlotOccupied 查询开销。
 * AI-CORRECTION 2026-07-10: 气体加入后该逻辑适用于 fluid（液体或气体）；气体复用管道内腔填充贴图。
 */
const PIPE_FIRST_WET_ENABLED = true

export class PipeSprite extends DedicatedLogisticSprite {
  private readonly bead: Sprite
  private readonly pipeSpriteId: string
  private lastFluidItemId: string | null = null
  private beadColor = DEFAULT_PIPE_BEAD_COLOR
  private liquidTexture: Texture | null = null
  private liquidTextureLoaded = false
  /** 首润模式：记录已经在该连通段会话中被 fluid 润湿过的设备 ID。连通段排空时清空。 */
  private static wetDevices = new Set<string>()

  public constructor(
    entityId: string,
    definition: EntityDefinition,
    renderHost: RenderHost,
  ) {
    super(entityId, definition, renderHost)

    this.pipeSpriteId = definition.spriteId
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

  public syncRuntime(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
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
    if (this.isLogisticsSuppressed(context)) {
      this.bead.visible = false
      return
    }

    if (!this.isDeviceTextureReady()) {
      this.bead.visible = false
      return
    }

    const queries = context.workspace.simulation?.queries
    const fluidItemId = queries?.getPipeFluidItemId(this.entityId) ?? null
    if (fluidItemId === null) {
      // 连通段完全排空 → 重置润湿状态
      PipeSprite.wetDevices.delete(this.entityId)
      this.bead.visible = false
      return
    }

    const exactFluidMode = context.workspace.app?.state?.settings?.gameShowPipeExactFluidPosition === true
    if (exactFluidMode) {
      // 精确模式：只有该节管道当前 slot 有液体才显示
      if (!(queries?.isPipeDeviceSlotOccupied(this.entityId) ?? false)) {
        this.bead.visible = false
        return
      }
    } else if (PIPE_FIRST_WET_ENABLED) {
      // 首润模式：只有该节管道曾被液体润湿过才显示
      if (!PipeSprite.wetDevices.has(this.entityId)) {
        // 检查当前 tick 该节管道 slot 是否有液体
        if (queries?.isPipeDeviceSlotOccupied(this.entityId)) {
          PipeSprite.wetDevices.add(this.entityId)
        }
      }

      if (!PipeSprite.wetDevices.has(this.entityId)) {
        this.bead.visible = false
        return
      }
    }

    if (fluidItemId !== this.lastFluidItemId) {
      this.lastFluidItemId = fluidItemId
      this.beadColor = resolveFluidColor(fluidItemId, context.workspace.registry)
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

function resolveFluidColor(
  itemId: string,
  registry: RegistryContract,
): number {
  const itemDefinition = registry.itemDefinitions.find((item) => item.id === itemId)
  const colorTag = itemDefinition?.tags.find((tag) =>
    tag.startsWith(GAS_COLOR_TAG_PREFIX)
    || tag.startsWith(FLUID_COLOR_TAG_PREFIX)
    || tag.startsWith(LIQUID_COLOR_TAG_PREFIX)
  )
  if (colorTag === undefined) {
    return DEFAULT_PIPE_BEAD_COLOR
  }

  const prefix = resolveFluidColorTagPrefix(colorTag)
  if (prefix === null) {
    return DEFAULT_PIPE_BEAD_COLOR
  }

  const normalizedHex = colorTag
    .slice(prefix.length)
    .trim()
    .replace(/^#/, "")

  if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
    return DEFAULT_PIPE_BEAD_COLOR
  }

  return Number.parseInt(normalizedHex, 16)
}

function resolveFluidColorTagPrefix(tag: string): string | null {
  if (tag.startsWith(GAS_COLOR_TAG_PREFIX)) {
    return GAS_COLOR_TAG_PREFIX
  }
  if (tag.startsWith(FLUID_COLOR_TAG_PREFIX)) {
    return FLUID_COLOR_TAG_PREFIX
  }
  if (tag.startsWith(LIQUID_COLOR_TAG_PREFIX)) {
    return LIQUID_COLOR_TAG_PREFIX
  }
  return null
}
