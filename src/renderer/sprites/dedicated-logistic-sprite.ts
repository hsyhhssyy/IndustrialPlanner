import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
  TilingSprite,
} from "pixi.js"

import type { AppTheme } from "@/domain/app/types/theme"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import {
  LOGISTICS_KIND,
  type LogisticsKind,
} from "@/domain/shared/logistics"
import type { RenderHost } from "@/renderer/renderer-host"
import { shouldUseGroupedPreviewVisuals } from "@/renderer/move-visual-policy"
import { resolveDeviceBodyTextureKey } from "@/renderer/sprites/device-texture-key"
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import { BaseRenderSprite } from "./base-render-sprite"
import type {
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite"

const DEGREE_TO_RADIAN = Math.PI / 180
const SUPPRESSED_BELT_COLOR = 0xFFD54A
const SUPPRESSED_PIPE_COLOR = 0x448AFF
const SUPPRESSED_LINE_WIDTH_RATIO = 1 / 6
const SUPPRESSED_ARROW_LENGTH_RATIO = 1 / 5
const SUPPRESSED_ARROW_WIDTH_RATIO = 1 / 6
const SCANLINE_TEXTURE_PATH = createPublicAssetUrl("textures/scanline-45deg-50opacity.webp")
// AI-REMOVED 2026-05-25:
// Reason: 常量从 generic-device-sprite.ts 复制后从未在本文件中被引用
// Trigger: ESLint @typescript-eslint/no-unused-vars
// Evidence: grep 全文件未找到 SCANLINE_PADDING_TILES 的引用
// Replacement: None
// Risk: Low
// Human Review: Not Required
//
// Original code:
// const SCANLINE_PADDING_TILES = 2
const SCANLINE_SCROLL_INTERVAL_MS = 2000
const PREVIEW_BORDER_WIDTH = 1
const PREVIEW_BORDER_ALPHA = 0.5
const PREVIEW_NORMAL_COLOR = 0xffffff
const PREVIEW_INVALID_SCANLINE_TINT = 0xff0000
const PREVIEW_INVALID_BORDER_COLOR = 0xff3b30
const PIPE_IDLE_BODY_ALPHA = 0.62
const PIPE_ACTIVE_BODY_ALPHA = 1
const PIPE_SELECTION_GLOW_ALPHA = 0.42
const PIPE_SELECTION_GLOW_SCALE = 1.08
const PIPE_SELECTION_GLOW_TINT = 0xd8f7ff

interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

interface SuppressedLogisticsPath {
  readonly points: readonly LocalPoint[];
  readonly arrowCenter: LocalPoint;
  readonly arrowAngleRadians: number;
}

export class DedicatedLogisticSprite extends BaseRenderSprite {
  private readonly body: Sprite
  private suppressionGraphics: Graphics | null = null
  private readonly spriteId: string
  private readonly previewEffectRoot: Container
  private readonly scanlineTiling: TilingSprite
  private readonly scanlineRectMask: Graphics
  private readonly previewBorderGraphics: Graphics
  private readonly selectionGlow: Sprite | null
  private scanlineTexture: Texture | null = null
  private scanlineLoadStarted = false
  private currentLayout: RenderSpriteLayout | null = null
  private currentSyncContext: RenderSpriteSyncContext | null = null
  protected disposed = false
  private isTextureReady = false
  private currentBodyTextureKey: string | null = null
  private textureLoadVersion = 0

  public constructor(
    entityId: string,
    definition: EntityDefinition,
    protected readonly renderHost: RenderHost,
  ) {
    super(entityId)
    this.spriteId = definition.spriteId

    this.body = new Sprite(Texture.EMPTY)
    this.body.anchor.set(0.5)
    this.body.roundPixels = true
    this.body.visible = false
    this.getRootOfLayer("entity").addChild(this.body)

    this.previewEffectRoot = new Container()
    this.previewEffectRoot.visible = false

    this.scanlineTiling = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 })
    this.scanlineTiling.anchor.set(0.5)
    this.scanlineTiling.roundPixels = true
    this.scanlineTiling.visible = false

    this.scanlineRectMask = new Graphics({ roundPixels: true })
    this.scanlineRectMask.renderable = false
    this.scanlineTiling.mask = this.scanlineRectMask

    this.previewBorderGraphics = new Graphics({ roundPixels: true })
    this.previewBorderGraphics.visible = false

    this.selectionGlow = resolveSpriteLogisticsFamily(this.spriteId) === LOGISTICS_KIND.pipe
      ? new Sprite(Texture.EMPTY)
      : null
    if (this.selectionGlow !== null) {
      this.selectionGlow.anchor.set(0.5)
      this.selectionGlow.roundPixels = true
      this.selectionGlow.visible = false
      this.selectionGlow.alpha = PIPE_SELECTION_GLOW_ALPHA
      this.selectionGlow.tint = PIPE_SELECTION_GLOW_TINT
    }

    this.previewEffectRoot.addChild(this.scanlineTiling)
    this.previewEffectRoot.addChild(this.scanlineRectMask)
    this.previewEffectRoot.addChild(this.previewBorderGraphics)
    if (this.selectionGlow !== null) {
      this.previewEffectRoot.addChild(this.selectionGlow)
    }
    this.getRootOfLayer("overlay").addChild(this.previewEffectRoot)

    this.syncDeviceTexture()
  }

  protected syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.currentLayout = layout
    this.currentSyncContext = context

    if (this.isLogisticsSuppressed(context)) {
      this.body.visible = false
      this.syncSuppressionGraphics(layout)
      return
    }

    if (this.suppressionGraphics !== null) {
      this.suppressionGraphics.visible = false
    }
    this.syncDeviceTexture()

    if (!this.isTextureReady) {
      return
    }

    this.body.visible = true
    this.applyLayout(layout)
    this.body.tint = resolveDedicatedLogisticTintColor({
      entityId: this.entityId,
      spriteId: this.spriteId,
      theme: context.theme,
      workspace: context.workspace,
    })
    this.body.alpha = resolveDedicatedLogisticBodyAlpha({
      entityId: this.entityId,
      spriteId: this.spriteId,
      workspace: context.workspace,
    })
  }

  public syncAnimation(context: RenderSpriteSyncContext): void {
    if (!this.scanlineTiling.visible) {
      return
    }

    const tilePixelSize = this.scanlineTexture?.width ?? 64
    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS
    this.scanlineTiling.tilePosition.x = phase * tilePixelSize
  }

  protected resetCollectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context

    this.scanlineTiling.visible = false
    this.previewBorderGraphics.clear()
    this.previewBorderGraphics.visible = false
    if (this.selectionGlow !== null) {
      this.selectionGlow.visible = false
    }
    this.previewEffectRoot.visible = false
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
    this.drawScanlineOverlay(layout, context)
  }

  protected drawSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.drawPipeSelectionGlow(layout, context)
  }

  protected drawRelatedOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.drawScanlineOverlay(layout, context, false)
  }

  protected onDestroy(): void {
    this.disposed = true
  }

  protected isDeviceTextureReady(): boolean {
    return this.isTextureReady
  }

  protected isLogisticsSuppressed(context: RenderSpriteSyncContext): boolean {
    const family = resolveSpriteLogisticsFamily(this.spriteId);
    if (family === LOGISTICS_KIND.belt) return context.suppressBelts;
    if (family === LOGISTICS_KIND.pipe) return context.suppressPipes;
    return false;
  }

  protected afterDeviceTextureReady(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout
    void context
  }

  private drawScanlineOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
    drawBorder = true,
  ): void {
    this.loadScanlineTexture()

    const isInvalid = this.shouldDrawInvalidPreview(context)
    const scanlineTint = isInvalid ? PREVIEW_INVALID_SCANLINE_TINT : PREVIEW_NORMAL_COLOR
    const borderColor = isInvalid ? PREVIEW_INVALID_BORDER_COLOR : PREVIEW_NORMAL_COLOR
    const tilePixelSize = this.scanlineTexture?.width ?? 64

    this.scanlineTiling.visible = true
    this.scanlineTiling.x = layout.x + layout.width / 2
    this.scanlineTiling.y = layout.y + layout.height / 2
    this.scanlineTiling.rotation = 0
    this.scanlineTiling.width = layout.width
    this.scanlineTiling.height = layout.height
    this.scanlineTiling.tint = scanlineTint

    const phase = (context.time.nowMs % SCANLINE_SCROLL_INTERVAL_MS) / SCANLINE_SCROLL_INTERVAL_MS
    this.scanlineTiling.tilePosition.x = phase * tilePixelSize

    this.scanlineRectMask.clear()
    this.scanlineTiling.mask = null

    if (drawBorder) {
      this.previewBorderGraphics.visible = true
      this.previewBorderGraphics
        .rect(layout.x, layout.y, layout.width, layout.height)
        .stroke({
          width: PREVIEW_BORDER_WIDTH,
          color: borderColor,
          alpha: PREVIEW_BORDER_ALPHA,
        })
    }

    this.previewEffectRoot.visible = true
  }

  private drawPipeSelectionGlow(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void context

    if (this.selectionGlow === null || !this.isTextureReady) {
      return
    }

    const centeredLayout = this.resolveCenteredSpriteLayout(layout)
    applyCenteredSpriteLayout(this.selectionGlow, {
      x: centeredLayout.x,
      y: centeredLayout.y,
      width: centeredLayout.width * PIPE_SELECTION_GLOW_SCALE,
      height: centeredLayout.height * PIPE_SELECTION_GLOW_SCALE,
      rotation: centeredLayout.rotation,
    })
    this.selectionGlow.tint = PIPE_SELECTION_GLOW_TINT
    this.selectionGlow.alpha = PIPE_SELECTION_GLOW_ALPHA
    this.selectionGlow.visible = true
    this.previewEffectRoot.visible = true
  }

  private shouldDrawInvalidPreview(context: RenderSpriteSyncContext): boolean {
    const editor = context.workspace.editor
    const collections = editor?.state.collections
    if (collections === undefined) {
      return false
    }

    if (collections[EntityCollectionType.invalidPlacement]?.contains(this.entityId)) {
      return true
    }

    const isPreview = collections[EntityCollectionType.preview]?.contains(this.entityId) ?? false
    if (!isPreview) {
      return false
    }

    return editor?.queries.resolveLogisticsDraftState()?.invalidReason === "outside-base"
  }

  private loadScanlineTexture(): void {
    if (this.scanlineLoadStarted) {
      return
    }

    this.scanlineLoadStarted = true

    void Assets.load<Texture>(SCANLINE_TEXTURE_PATH).then((texture) => {
      if (this.disposed) {
        return
      }

      this.scanlineTexture = texture
      this.scanlineTiling.texture = texture
    }).catch(() => {
      // 扫描线纹理加载失败时保留空纹理，仍显示边框。
    })
  }

  private applyLayout(layout: RenderSpriteLayout): void {
    applyCenteredSpriteLayout(this.body, this.resolveCenteredSpriteLayout(layout))
  }

  private resolveCenteredSpriteLayout(layout: RenderSpriteLayout): {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  } {
    const isQuarterTurn = layout.rotation === 90 || layout.rotation === 270
    return {
      x: layout.x + layout.width / 2,
      y: layout.y + layout.height / 2,
      width: isQuarterTurn ? layout.height : layout.width,
      height: isQuarterTurn ? layout.width : layout.height,
      rotation: layout.rotation * DEGREE_TO_RADIAN,
    }
  }

  private syncSuppressionGraphics(
    layout: RenderSpriteLayout,
  ): void {
    const family = resolveSpriteLogisticsFamily(this.spriteId);
    const centeredLayout = this.resolveCenteredSpriteLayout(layout)
    const suppressionGraphics = this.resolveSuppressionGraphics()
    suppressionGraphics.clear()
    suppressionGraphics.x = centeredLayout.x
    suppressionGraphics.y = centeredLayout.y
    suppressionGraphics.rotation = centeredLayout.rotation
    drawSuppressedLogisticsSprite({
      graphics: suppressionGraphics,
      spriteId: this.spriteId,
      width: centeredLayout.width,
      height: centeredLayout.height,
      color: family === LOGISTICS_KIND.belt
        ? SUPPRESSED_BELT_COLOR
        : SUPPRESSED_PIPE_COLOR,
    })
    suppressionGraphics.visible = true
  }

  private resolveSuppressionGraphics(): Graphics {
    if (this.suppressionGraphics !== null) {
      return this.suppressionGraphics
    }

    const suppressionGraphics = new Graphics({ roundPixels: true })
    suppressionGraphics.visible = false
    this.getRootOfLayer("entity").addChild(suppressionGraphics)
    this.suppressionGraphics = suppressionGraphics
    return suppressionGraphics
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
        if (this.selectionGlow !== null) {
          this.selectionGlow.texture = bodyTexture
        }
        this.isTextureReady = true
        this.invalidateVisualSync()

        if (this.currentLayout !== null && this.currentSyncContext !== null) {
          if (this.isLogisticsSuppressed(this.currentSyncContext)) {
            this.body.visible = false
            this.syncSuppressionGraphics(
              this.currentLayout,
            )
            this.afterDeviceTextureReady(this.currentLayout, this.currentSyncContext)
            return
          }

          this.body.visible = true
          this.applyLayout(this.currentLayout)
          this.body.tint = resolveDedicatedLogisticTintColor({
            entityId: this.entityId,
            spriteId: this.spriteId,
            theme: this.currentSyncContext.theme,
            workspace: this.currentSyncContext.workspace,
          })
          this.body.alpha = resolveDedicatedLogisticBodyAlpha({
            entityId: this.entityId,
            spriteId: this.spriteId,
            workspace: this.currentSyncContext.workspace,
          })
          this.afterDeviceTextureReady(this.currentLayout, this.currentSyncContext)
          return
        }

        this.body.visible = true
      })
      .catch(() => {
        if (this.disposed || activeLoadVersion !== this.textureLoadVersion) {
          return
        }

        this.body.visible = false
        if (this.selectionGlow !== null) {
          this.selectionGlow.visible = false
        }
      })
  }
}

function resolveSpriteLogisticsFamily(spriteId: string): LogisticsKind | null {
  // 这里判断的是专用绘图资源 spriteId，不是 registry definition ID 分类。
  if (spriteId.startsWith("belt_")) return LOGISTICS_KIND.belt
  if (spriteId.startsWith("pipe_")) return LOGISTICS_KIND.pipe
  return null
}

function drawSuppressedLogisticsSprite(options: {
  readonly graphics: Graphics;
  readonly spriteId: string;
  readonly width: number;
  readonly height: number;
  readonly color: number;
}): void {
  const unitSize = Math.min(options.width, options.height)
  if (unitSize <= 0) {
    return
  }

  const lineWidth = Math.max(1, unitSize * SUPPRESSED_LINE_WIDTH_RATIO)
  const horizontalExtent = Math.max(0, options.width / 2 - lineWidth / 2)
  const verticalExtent = Math.max(0, options.height / 2 - lineWidth / 2)
  const path = resolveSuppressedLogisticsPath(options.spriteId, horizontalExtent, verticalExtent)
  if (path === null) {
    return
  }

  const firstPoint = path.points[0]
  if (firstPoint === undefined) {
    return
  }

  options.graphics.moveTo(firstPoint.x, firstPoint.y)
  for (let i = 1; i < path.points.length; i += 1) {
    const point = path.points[i]
    if (point !== undefined) {
      options.graphics.lineTo(point.x, point.y)
    }
  }
  options.graphics.stroke({
    width: lineWidth,
    color: options.color,
    alpha: 0.95,
  })

  const arrowLength = Math.max(lineWidth * 1.3, unitSize * SUPPRESSED_ARROW_LENGTH_RATIO)
  const arrowWidth = Math.max(lineWidth * 1.4, unitSize * SUPPRESSED_ARROW_WIDTH_RATIO)
  options.graphics
    .poly(resolveArrowTrianglePoints(path.arrowCenter, path.arrowAngleRadians, arrowLength, arrowWidth), true)
    .fill({ color: options.color, alpha: 0.95 })
}

function resolveSuppressedLogisticsPath(
  spriteId: string,
  horizontalExtent: number,
  verticalExtent: number,
): SuppressedLogisticsPath | null {
  const northPoint = { x: 0, y: -verticalExtent }
  const eastPoint = { x: horizontalExtent, y: 0 }
  const westPoint = { x: -horizontalExtent, y: 0 }
  const centerPoint = { x: 0, y: 0 }

  if (spriteId.endsWith("straight_1x1")) {
    return {
      points: [westPoint, eastPoint],
      arrowCenter: interpolateLocalPoint(westPoint, eastPoint, 0.62),
      arrowAngleRadians: 0,
    }
  }

  if (spriteId.endsWith("turn_cw_1x1")) {
    return {
      points: [eastPoint, centerPoint, northPoint],
      arrowCenter: interpolateLocalPoint(centerPoint, northPoint, 0.55),
      arrowAngleRadians: -Math.PI / 2,
    }
  }

  if (spriteId.endsWith("turn_ccw_1x1")) {
    return {
      points: [northPoint, centerPoint, eastPoint],
      arrowCenter: interpolateLocalPoint(centerPoint, eastPoint, 0.55),
      arrowAngleRadians: 0,
    }
  }

  return null
}

function interpolateLocalPoint(startPoint: LocalPoint, endPoint: LocalPoint, ratio: number): LocalPoint {
  return {
    x: startPoint.x + (endPoint.x - startPoint.x) * ratio,
    y: startPoint.y + (endPoint.y - startPoint.y) * ratio,
  }
}

function resolveArrowTrianglePoints(
  centerPoint: LocalPoint,
  angleRadians: number,
  length: number,
  width: number,
): number[] {
  const directionX = Math.cos(angleRadians)
  const directionY = Math.sin(angleRadians)
  const normalX = -directionY
  const normalY = directionX
  const tipPoint = {
    x: centerPoint.x + directionX * length / 2,
    y: centerPoint.y + directionY * length / 2,
  }
  const tailCenterPoint = {
    x: centerPoint.x - directionX * length / 2,
    y: centerPoint.y - directionY * length / 2,
  }

  return [
    tipPoint.x,
    tipPoint.y,
    tailCenterPoint.x + normalX * width / 2,
    tailCenterPoint.y + normalY * width / 2,
    tailCenterPoint.x - normalX * width / 2,
    tailCenterPoint.y - normalY * width / 2,
  ]
}

export function resolveDedicatedLogisticTintColor(options: {
  entityId: string;
  spriteId: string;
  theme: AppTheme;
  workspace: WorkspaceContract;
}): number {
  const { entityId, spriteId, theme, workspace } = options
  const collections = workspace.editor?.state?.collections
  const ordinaryColor = spriteId.startsWith("pipe_")
    ? resolveAppThemeColorNumber(
      theme,
      theme.renderer.pipeBodyTintColorKey,
    )
    : resolveAppThemeColorNumber(
      theme,
      theme.renderer.beltTileStrokeColorKey,
    )
  const selectionTintColor = resolveAppThemeColorNumber(
    theme,
    theme.renderer.worldPreviewRectFillColorKey,
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
  const moveKind = workspace.app?.state.moveKind ?? null
  const isPreviewGroup = isPreview && shouldUseGroupedPreviewVisuals(
    moveKind,
    previewCollection?.length ?? 0,
  )
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
    return resolveAppThemeColorNumber(
      theme,
      theme.renderer.dedicatedLogisticFocusTintColorKey,
    )
  }

  return ordinaryColor
}

function resolveDedicatedLogisticBodyAlpha(options: {
  entityId: string;
  spriteId: string;
  workspace: WorkspaceContract;
}): number {
  const { entityId, spriteId, workspace } = options
  if (!spriteId.startsWith("pipe_")) {
    return 1
  }

  const collections = workspace.editor?.state?.collections
  if (!collections) {
    return PIPE_IDLE_BODY_ALPHA
  }

  const previewCollection = collections[EntityCollectionType.preview]
  const marqueeCollection = collections[EntityCollectionType.marquee]
  const reverseMarqueeCollection = collections[EntityCollectionType.reverseMarquee]
  const logisticsHeadCollection = collections[EntityCollectionType.logisticsHead]
  const selectionCollection = collections[EntityCollectionType.selection]
  const isPreview = previewCollection?.contains(entityId) ?? false
  const isMarquee = marqueeCollection?.contains(entityId) ?? false
  const isReverseMarquee = reverseMarqueeCollection?.contains(entityId) ?? false
  const isPlacementHead = logisticsHeadCollection?.contains(entityId) ?? false
  const isSelected = selectionCollection?.contains(entityId) ?? false

  if (isPreview || isMarquee || isPlacementHead || (isSelected && !isReverseMarquee)) {
    return PIPE_ACTIVE_BODY_ALPHA
  }

  return PIPE_IDLE_BODY_ALPHA
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
