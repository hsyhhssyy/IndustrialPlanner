import type { BlueprintDocument } from "@/domain/document/blueprint-document"
import type { WorldEntity } from "@/domain/document/world-document"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import type {
  BlueprintPreviewHandle,
  BlueprintPreviewViewport,
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

import { Application, Container, Graphics, Sprite, Texture } from "pixi.js"

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
      }

      viewportContainer.addChild(gridGraphics)
      app.stage.addChild(viewportContainer)
      previewStates.set(handle, state)

      syncBlueprintPreviewSprites(state)
      applyBlueprintPreviewViewport(state)

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
  const drawBounds = resolveBlueprintPreviewGridBounds(state.bounds)
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

function resolveBlueprintPreviewGridBounds(bounds: GridBounds): {
  left: number
  top: number
  right: number
  bottom: number
} {
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
