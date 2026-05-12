import type { BlueprintDocument } from "@/domain/document/blueprint-document"
import type { WorldEntity } from "@/domain/document/world-document"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import type {
  BlueprintPreviewHandle,
  BlueprintPreviewViewport,
  MountNeighborhoodPreviewOptions,
  RenderAction,
  RenderQuery,
} from "@/domain/renderer"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import {
  getGridBoundingBox,
  getGridBoundsCenterCells,
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
  type GridBounds,
} from "@/shared/geometry/grid"

import { Application, Assets, Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js"

import { resolveRenderResolutionFromApp } from "../render-resolution"
import {
  resolveWorldGridMajorStrokeStyle,
  resolveWorldGridRenderState,
  resolveWorldGridStrokeStyle,
} from "../scene/decorations/GridLineDecoration"
import { createTextureActions } from "../texture/texture-manager"

const DEFAULT_BLUEPRINT_PREVIEW_WIDTH = 640
const DEFAULT_BLUEPRINT_PREVIEW_HEIGHT = 360
const DEFAULT_BLUEPRINT_PREVIEW_ZOOM = 1
const MIN_BLUEPRINT_PREVIEW_ZOOM = 0.1
const MAX_BLUEPRINT_PREVIEW_ZOOM = 8
const BLUEPRINT_PREVIEW_PADDING_CELLS = 1
const BLUEPRINT_PREVIEW_GRID_LINE_ALPHA = 0.30
// Keep preview grid uniform: every cell boundary uses the same pixel-line stroke.
const BLUEPRINT_PREVIEW_MAJOR_GRID_INTERVAL = 1
const DEGREE_TO_RADIAN = Math.PI / 180
const SCANLINE_TEXTURE_PATH = "/textures/scanline-45deg-50opacity.png"
const SCANLINE_TINT = 0x4dabf7
const SCANLINE_ALPHA = 0.55

interface PreviewState {
  readonly app: Application
  readonly blueprint: BlueprintDocument
  readonly canvas: HTMLCanvasElement
  readonly entityDefinitionMap: Map<string, EntityDefinition>
  readonly gridGraphics: Graphics
  readonly spriteMap: Map<string, Sprite>
  readonly textureManager: ReturnType<typeof createTextureActions>
  readonly viewportContainer: Container
  readonly workspace: WorkspaceContract
  bounds: GridBounds | null
  disposed: boolean
  handle: BlueprintPreviewHandle
  height: number
  viewport: BlueprintPreviewViewport
  width: number
  /** Neighborhood mode: fixed viewport bounds (grid cells), clip mask, scanline highlight */
  readonly viewportBounds: GridBounds | null
  readonly highlightedEntityId: string | null
  readonly clipMask: Graphics | null
  readonly highlightContainer: Container | null
  readonly scanlineTiling: TilingSprite | null
  readonly scanlineMask: Sprite | null
}

interface BlueprintPreviewManager {
  readonly actions: RenderAction
  readonly queries: RenderQuery
  destroy(): void
}

interface RoundPixelsStageLike {
  roundPixels: boolean
}

export function createBlueprintPreviewManager(options: {
  workspace: WorkspaceContract
}): BlueprintPreviewManager {
  const previewStates = new Map<BlueprintPreviewHandle, PreviewState>()
  let previewHandleSequence = 0

  const actions: RenderAction = {
    mountBlueprintPreview: async (mountOptions) => {
      const handle = createBlueprintPreviewHandle(++previewHandleSequence)
      const width = normalizeBlueprintPreviewAxisSize(
        mountOptions.width,
        DEFAULT_BLUEPRINT_PREVIEW_WIDTH,
      )
      const height = normalizeBlueprintPreviewAxisSize(
        mountOptions.height,
        DEFAULT_BLUEPRINT_PREVIEW_HEIGHT,
      )
      const app = new Application()
      const resolution = resolveRenderResolutionFromApp(options.workspace.app)

      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution,
        preference: "webgl",
      })

      ;(app.stage as unknown as RoundPixelsStageLike).roundPixels = true

      const viewportContainer = new Container()
      const gridGraphics = new Graphics({ roundPixels: true })
      const textureManager = createTextureActions({
        renderer: app.renderer,
        app: null,
      })
      const entityDefinitionMap = createEntityDefinitionMap(options.workspace)
      const state: PreviewState = {
        app,
        blueprint: mountOptions.blueprint,
        canvas: app.canvas,
        entityDefinitionMap,
        gridGraphics,
        spriteMap: new Map(),
        textureManager,
        viewportContainer,
        workspace: options.workspace,
        bounds: null,
        disposed: false,
        handle,
        height,
        viewport: normalizeBlueprintPreviewViewport(mountOptions.viewport),
        width,
        viewportBounds: null,
        highlightedEntityId: null,
        clipMask: null,
        highlightContainer: null,
        scanlineTiling: null,
        scanlineMask: null,
      }

      viewportContainer.addChild(gridGraphics)
      app.stage.addChild(viewportContainer)
      previewStates.set(handle, state)

      syncBlueprintPreviewSprites(state)
      applyBlueprintPreviewViewport(state)

      return handle
    },
    mountNeighborhoodPreview: async (mountOptions: MountNeighborhoodPreviewOptions) => {
      const handle = createBlueprintPreviewHandle(++previewHandleSequence)
      const viewportBounds = mountOptions.viewportBounds
      const regionAspectRatio = viewportBounds.width / viewportBounds.height
      const availableWidth = Math.max(1, Math.floor(mountOptions.width))
      const availableHeight = Math.max(1, Math.floor(mountOptions.height))

      let width: number
      let height: number

      if (availableWidth / availableHeight >= regionAspectRatio) {
        height = availableHeight
        width = Math.max(1, Math.round(availableHeight * regionAspectRatio))
      } else {
        width = availableWidth
        height = Math.max(1, Math.round(availableWidth / regionAspectRatio))
      }

      const app = new Application()
      const resolution = resolveRenderResolutionFromApp(options.workspace.app)

      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution,
        preference: "webgl",
      })

      ;(app.stage as unknown as RoundPixelsStageLike).roundPixels = true

      const viewportContainer = new Container()
      const gridGraphics = new Graphics({ roundPixels: true })
      const textureManager = createTextureActions({
        renderer: app.renderer,
        app: null,
      })
      const entityDefinitionMap = createEntityDefinitionMap(options.workspace)

      // 裁切 mask：确保只显示 viewportBounds 范围内的内容
      const clipMask = new Graphics({ roundPixels: true })
      clipMask.renderable = false

      // 高亮层
      const highlightContainer = new Container()
      highlightContainer.visible = false
      const scanlineTiling = new TilingSprite({ texture: Texture.EMPTY, width: 0, height: 0 })
      scanlineTiling.anchor.set(0.5)
      scanlineTiling.roundPixels = true
      scanlineTiling.tint = SCANLINE_TINT
      scanlineTiling.alpha = SCANLINE_ALPHA
      const scanlineMask = new Sprite(Texture.EMPTY)
      scanlineMask.anchor.set(0.5)
      scanlineMask.roundPixels = true
      scanlineMask.renderable = false
      scanlineTiling.mask = scanlineMask
      highlightContainer.addChild(scanlineTiling)
      highlightContainer.addChild(scanlineMask)

      const state: PreviewState = {
        app,
        blueprint: mountOptions.blueprint,
        canvas: app.canvas,
        entityDefinitionMap,
        gridGraphics,
        spriteMap: new Map(),
        textureManager,
        viewportContainer,
        workspace: options.workspace,
        bounds: viewportBounds,
        disposed: false,
        handle,
        height,
        viewport: {
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        },
        width,
        viewportBounds,
        highlightedEntityId: mountOptions.highlightedEntityId,
        clipMask,
        highlightContainer,
        scanlineTiling,
        scanlineMask,
      }

      viewportContainer.addChild(gridGraphics)
      viewportContainer.addChild(highlightContainer)
      // clipMask 必须直接挂在 stage 上，不能作为 viewportContainer 子节点（否则会被 viewportContainer 的 scale 二次变换）
      viewportContainer.mask = clipMask
      app.stage.addChild(clipMask)
      app.stage.addChild(viewportContainer)
      previewStates.set(handle, state)

      syncBlueprintPreviewSprites(state)
      applyNeighborhoodHighlight(state)
      applyNeighborhoodClipMask(state)
      applyBlueprintPreviewViewport(state)

      // 加载扫描线纹理
      void Assets.load<Texture>(SCANLINE_TEXTURE_PATH).then((texture) => {
        if (state.disposed || state.scanlineTiling === null) {
          return
        }

        state.scanlineTiling.texture = texture
        applyNeighborhoodHighlight(state)
      }).catch(() => {
        // 扫描线纹理加载失败，无伤大雅
      })

      return handle
    },
    updateBlueprintPreviewViewport: (handle, viewport) => {
      const state = previewStates.get(handle)

      if (!state || state.disposed) {
        return
      }

      state.viewport = normalizeBlueprintPreviewViewport({
        ...state.viewport,
        ...viewport,
      })
      applyBlueprintPreviewViewport(state)
    },
    resizeBlueprintPreview: (handle, width, height) => {
      const state = previewStates.get(handle)

      if (!state || state.disposed) {
        return
      }

      // Neighborhood mode: recalculate canvas dimensions to maintain aspect ratio
      if (state.viewportBounds !== null) {
        const bounds = state.viewportBounds
        const regionAspectRatio = bounds.width / bounds.height
        const availableWidth = Math.max(1, Math.floor(width))
        const availableHeight = Math.max(1, Math.floor(height))

        let nextWidth: number
        let nextHeight: number

        if (availableWidth / availableHeight >= regionAspectRatio) {
          nextHeight = availableHeight
          nextWidth = Math.max(1, Math.round(availableHeight * regionAspectRatio))
        } else {
          nextWidth = availableWidth
          nextHeight = Math.max(1, Math.round(availableWidth / regionAspectRatio))
        }

        const nextResolution = resolveRenderResolutionFromApp(options.workspace.app)

        if (
          nextWidth === state.width
          && nextHeight === state.height
          && state.app.renderer.resolution === nextResolution
        ) {
          return
        }

        state.width = nextWidth
        state.height = nextHeight
        state.app.renderer.resize(nextWidth, nextHeight, nextResolution)
        applyBlueprintPreviewViewport(state)
        applyNeighborhoodClipMask(state)
        return
      }

      const nextWidth = normalizeBlueprintPreviewAxisSize(
        width,
        state.width,
      )
      const nextHeight = normalizeBlueprintPreviewAxisSize(
        height,
        state.height,
      )
      const nextResolution = resolveRenderResolutionFromApp(options.workspace.app)

      if (
        nextWidth === state.width
        && nextHeight === state.height
        && state.app.renderer.resolution === nextResolution
      ) {
        return
      }

      state.width = nextWidth
      state.height = nextHeight
      state.app.renderer.resize(nextWidth, nextHeight, nextResolution)
      applyBlueprintPreviewViewport(state)
    },
    disposeBlueprintPreview: (handle) => {
      disposeBlueprintPreviewState(previewStates.get(handle) ?? null)
      previewStates.delete(handle)
    },
  }

  const queries: RenderQuery = {
    getBlueprintPreviewCanvas: (handle) => previewStates.get(handle)?.canvas ?? null,
  }

  return {
    actions,
    queries,
    destroy: () => {
      for (const state of previewStates.values()) {
        disposeBlueprintPreviewState(state)
      }

      previewStates.clear()
    },
  }

  function disposeBlueprintPreviewState(state: PreviewState | null): void {
    if (state === null || state.disposed) {
      return
    }

    state.disposed = true
    state.spriteMap.clear()
    state.textureManager.destroy()
    state.app.destroy(
      { removeView: false },
      {
        children: true,
        context: true,
      },
    )
  }
}

function createBlueprintPreviewHandle(sequence: number): BlueprintPreviewHandle {
  return `blueprint-preview-${sequence}`
}

function normalizeBlueprintPreviewAxisSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.max(1, Math.round(value))
}

function normalizeBlueprintPreviewViewport(
  viewport: Partial<BlueprintPreviewViewport> | undefined,
): BlueprintPreviewViewport {
  const zoom = viewport?.zoom
  const offsetX = viewport?.offsetX
  const offsetY = viewport?.offsetY

  return {
    zoom:
      typeof zoom === "number" && Number.isFinite(zoom)
        ? Math.max(MIN_BLUEPRINT_PREVIEW_ZOOM, Math.min(MAX_BLUEPRINT_PREVIEW_ZOOM, zoom))
        : DEFAULT_BLUEPRINT_PREVIEW_ZOOM,
    offsetX: typeof offsetX === "number" && Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: typeof offsetY === "number" && Number.isFinite(offsetY) ? offsetY : 0,
  }
}

function createEntityDefinitionMap(
  workspace: WorkspaceContract,
): Map<string, EntityDefinition> {
  return new Map(
    workspace.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  )
}

function syncBlueprintPreviewSprites(state: PreviewState): void {
  const orderedEntities = state.blueprint.entityOrder
    .map((entityId) => state.blueprint.entities[entityId])
    .filter((entity): entity is WorldEntity => entity !== undefined)
  const nextEntityIds = new Set<string>()
  const areas = orderedEntities.flatMap((entity) => {
    const definition = state.entityDefinitionMap.get(entity.definitionId)

    if (!definition) {
      return []
    }

    return [{
      position: entity.position,
      footprint: getRotatedGridFootprint(definition.footprint, entity.rotation),
    }]
  })

  state.bounds = getGridBoundingBox(areas)

  for (const entity of orderedEntities) {
    const definition = state.entityDefinitionMap.get(entity.definitionId)

    if (!definition) {
      continue
    }

    const sprite = state.spriteMap.get(entity.id) ?? createBlueprintPreviewSprite(state, entity, definition)

    if (!state.spriteMap.has(entity.id)) {
      state.spriteMap.set(entity.id, sprite)
      state.viewportContainer.addChild(sprite)
      loadBlueprintPreviewSpriteTexture(state, sprite, definition)
    }

    applyBlueprintPreviewSpriteLayout(state, sprite, entity, definition)
    nextEntityIds.add(entity.id)
  }

  for (const [entityId, sprite] of state.spriteMap) {
    if (nextEntityIds.has(entityId)) {
      continue
    }

    sprite.destroy()
    state.spriteMap.delete(entityId)
  }
}

function createBlueprintPreviewSprite(
  state: PreviewState,
  entity: WorldEntity,
  definition: EntityDefinition,
): Sprite {
  void state
  void entity
  void definition

  const sprite = new Sprite(Texture.EMPTY)

  sprite.anchor.set(0.5)
  sprite.roundPixels = true
  sprite.visible = false

  return sprite
}

function loadBlueprintPreviewSpriteTexture(
  state: PreviewState,
  sprite: Sprite,
  definition: EntityDefinition,
): void {
  void state.textureManager.getTexture(`blueprint-sprite-${definition.spriteId}`).then((texture) => {
    if (state.disposed || sprite.destroyed) {
      return
    }

    sprite.texture = texture
    sprite.visible = true
  })
}

function applyBlueprintPreviewSpriteLayout(
  state: PreviewState,
  sprite: Sprite,
  entity: WorldEntity,
  definition: EntityDefinition,
): void {
  const rotatedFootprint = getRotatedGridFootprint(definition.footprint, entity.rotation)
  const boundsCenterCells = state.bounds === null
    ? { x: 0, y: 0 }
    : getGridBoundsCenterCells(state.bounds)
  const entityCenterCells = getGridFootprintCenterCells(
    entity.position,
    rotatedFootprint,
  )
  const isQuarterTurn = entity.rotation === 90 || entity.rotation === 270

  sprite.x = entityCenterCells.x - boundsCenterCells.x
  sprite.y = entityCenterCells.y - boundsCenterCells.y
  sprite.width = isQuarterTurn ? rotatedFootprint.height : rotatedFootprint.width
  sprite.height = isQuarterTurn ? rotatedFootprint.width : rotatedFootprint.height
  sprite.rotation = entity.rotation * DEGREE_TO_RADIAN
}

function applyBlueprintPreviewViewport(state: PreviewState): void {
  const fitScale = resolveBlueprintPreviewFitScale(state)
  const effectiveGridCellPixelSize = fitScale * state.viewport.zoom

  state.viewportContainer.position.set(
    state.width / 2 + state.viewport.offsetX,
    state.height / 2 + state.viewport.offsetY,
  )
  state.viewportContainer.scale.set(effectiveGridCellPixelSize)
  syncBlueprintPreviewGrid(state, effectiveGridCellPixelSize)
}

function resolveBlueprintPreviewFitScale(state: PreviewState): number {
  if (state.bounds === null) {
    return Math.min(state.width, state.height) / 4
  }

  // Neighborhood mode: exact fit, no padding
  if (state.viewportBounds !== null) {
    const effectiveWidth = Math.max(1, state.bounds.width)
    const effectiveHeight = Math.max(1, state.bounds.height)
    const widthScale = state.width / effectiveWidth
    const heightScale = state.height / effectiveHeight
    return Math.min(widthScale, heightScale)
  }

  const paddedWidth = Math.max(1, state.bounds.width + BLUEPRINT_PREVIEW_PADDING_CELLS * 2)
  const paddedHeight = Math.max(1, state.bounds.height + BLUEPRINT_PREVIEW_PADDING_CELLS * 2)
  const widthScale = state.width / paddedWidth
  const heightScale = state.height / paddedHeight

  return Math.max(0.5, Math.min(widthScale, heightScale))
}

function syncBlueprintPreviewGrid(
  state: PreviewState,
  effectiveGridCellPixelSize: number,
): void {
  const { gridGraphics } = state

  gridGraphics.clear()

  if (state.bounds === null || state.workspace.app === null) {
    return
  }

  const theme = state.workspace.app.state.theme
  const renderState = resolveWorldGridRenderState(effectiveGridCellPixelSize)

  if (!renderState.fineVisible && !renderState.majorVisible) {
    return
  }

  const boundsCenterCells = getGridBoundsCenterCells(state.bounds)
  const isNeighborhood = state.viewportBounds !== null
  const drawBounds = resolveBlueprintPreviewGridBounds(state.bounds, isNeighborhood)
  const left = drawBounds.left - boundsCenterCells.x
  const right = drawBounds.right - boundsCenterCells.x
  const top = drawBounds.top - boundsCenterCells.y
  const bottom = drawBounds.bottom - boundsCenterCells.y
  const fineLines = {
    vertical: [] as number[],
    horizontal: [] as number[],
  }
  const majorLines = {
    vertical: [] as number[],
    horizontal: [] as number[],
  }

  for (let cellX = drawBounds.left; cellX <= drawBounds.right; cellX += 1) {
    const target = cellX % BLUEPRINT_PREVIEW_MAJOR_GRID_INTERVAL === 0
      ? majorLines.vertical
      : fineLines.vertical

    target.push(cellX - boundsCenterCells.x)
  }

  for (let cellY = drawBounds.top; cellY <= drawBounds.bottom; cellY += 1) {
    const target = cellY % BLUEPRINT_PREVIEW_MAJOR_GRID_INTERVAL === 0
      ? majorLines.horizontal
      : fineLines.horizontal

    target.push(cellY - boundsCenterCells.y)
  }

  if (renderState.fineVisible) {
    drawBlueprintPreviewGridLines({
      graphics: gridGraphics,
      vertical: fineLines.vertical,
      horizontal: fineLines.horizontal,
      left,
      right,
      top,
      bottom,
    })
    gridGraphics.stroke(resolveWorldGridStrokeStyle(theme, {
      width: renderState.fineWidth,
      alpha: BLUEPRINT_PREVIEW_GRID_LINE_ALPHA * renderState.fineAlpha,
      pixelLine: renderState.finePixelLine,
    }))
  }

  if (renderState.majorVisible) {
    drawBlueprintPreviewGridLines({
      graphics: gridGraphics,
      vertical: majorLines.vertical,
      horizontal: majorLines.horizontal,
      left,
      right,
      top,
      bottom,
    })
    gridGraphics.stroke(resolveWorldGridMajorStrokeStyle(theme, {
      width: 1,
      alpha: BLUEPRINT_PREVIEW_GRID_LINE_ALPHA * renderState.majorAlpha,
      pixelLine: true,
    }))
  }
}

function resolveBlueprintPreviewGridBounds(bounds: GridBounds, isNeighborhood: boolean): {
  left: number
  top: number
  right: number
  bottom: number
} {
  // Neighborhood mode: draw grid lines exactly within bounds, no extra padding
  if (isNeighborhood) {
    return {
      left: Math.floor(bounds.left),
      top: Math.floor(bounds.top),
      right: Math.ceil(bounds.left + bounds.width) - 1,
      bottom: Math.ceil(bounds.top + bounds.height) - 1,
    }
  }

  return {
    left: Math.floor(bounds.left) - BLUEPRINT_PREVIEW_PADDING_CELLS,
    top: Math.floor(bounds.top) - BLUEPRINT_PREVIEW_PADDING_CELLS,
    right: Math.ceil(bounds.left + bounds.width) + BLUEPRINT_PREVIEW_PADDING_CELLS,
    bottom: Math.ceil(bounds.top + bounds.height) + BLUEPRINT_PREVIEW_PADDING_CELLS,
  }
}

function drawBlueprintPreviewGridLines(options: {
  graphics: Graphics
  vertical: number[]
  horizontal: number[]
  left: number
  right: number
  top: number
  bottom: number
}): void {
  for (const x of options.vertical) {
    options.graphics.moveTo(x, options.top).lineTo(x, options.bottom)
  }

  for (const y of options.horizontal) {
    options.graphics.moveTo(options.left, y).lineTo(options.right, y)
  }
}

function applyNeighborhoodClipMask(state: PreviewState): void {
  if (state.viewportBounds === null || state.clipMask === null) {
    return
  }

  const fitScale = resolveBlueprintPreviewFitScale(state)
  const bounds = state.viewportBounds
  const centerX = bounds.left + bounds.width / 2
  const centerY = bounds.top + bounds.height / 2
  const halfWidth = bounds.width / 2
  const halfHeight = bounds.height / 2

  const x = -halfWidth * fitScale
  const y = -halfHeight * fitScale
  const w = bounds.width * fitScale
  const h = bounds.height * fitScale

  state.clipMask.clear()
  state.clipMask.rect(x, y, w, h)
  state.clipMask.position.set(
    state.width / 2,
    state.height / 2,
  )
}

function applyNeighborhoodHighlight(state: PreviewState): void {
  if (
    state.highlightedEntityId === null
    || state.highlightContainer === null
    || state.scanlineTiling === null
    || state.scanlineMask === null
    || state.bounds === null
  ) {
    return
  }

  const highlightedEntity = state.blueprint.entities[state.highlightedEntityId]

  if (highlightedEntity === undefined) {
    state.highlightContainer.visible = false
    return
  }

  const definition = state.entityDefinitionMap.get(highlightedEntity.definitionId)

  if (!definition) {
    state.highlightContainer.visible = false
    return
  }

  // highlightContainer 是 viewportContainer 的子节点，viewportContainer 已被 fitScale 缩放。
  // 因此这里使用网格单位坐标，与 sprites 布局方式一致。
  const rotatedFootprint = getRotatedGridFootprint(definition.footprint, highlightedEntity.rotation)
  const entityCenterCells = getGridFootprintCenterCells(
    highlightedEntity.position,
    rotatedFootprint,
  )
  const boundsCenterCells = getGridBoundsCenterCells(state.bounds)
  const isQuarterTurn = highlightedEntity.rotation === 90 || highlightedEntity.rotation === 270

  const cx = entityCenterCells.x - boundsCenterCells.x
  const cy = entityCenterCells.y - boundsCenterCells.y
  const sw = isQuarterTurn ? rotatedFootprint.height : rotatedFootprint.width
  const sh = isQuarterTurn ? rotatedFootprint.width : rotatedFootprint.height

  state.scanlineTiling.x = cx
  state.scanlineTiling.y = cy
  // TilingSprite 需要足够大以覆盖整个设备 footprint，多余部分由 mask 裁切
  state.scanlineTiling.width = sw * 2
  state.scanlineTiling.height = sh * 2
  state.scanlineTiling.visible = true

  state.scanlineMask.x = cx
  state.scanlineMask.y = cy
  state.scanlineMask.width = sw
  state.scanlineMask.height = sh
  state.scanlineMask.rotation = highlightedEntity.rotation * DEGREE_TO_RADIAN

  // 加载设备 mask 纹理
  const maskKey = resolveDeviceMaskTextureKey(definition.spriteId)
  void state.textureManager.getTexture(maskKey).then((texture) => {
    if (state.disposed || state.scanlineMask === null) {
      return
    }

    state.scanlineMask.texture = texture
    state.scanlineMask.visible = true
  }).catch(() => {
    // mask 加载失败，无伤大雅
  })

  state.highlightContainer.visible = true
}

/**
 * 根据 spriteId 返回邻域预览使用的设备 mask 纹理 key。
 * 与 texture-manager 的 PREFIX_BLUEPRINT_MASKS 规则一致，
 * 解析到 /blueprint-view/sprite-masks/{id}.png。
 */
function resolveDeviceMaskTextureKey(spriteId: string): string {
  return `blueprint-masks-${spriteId}`
}
