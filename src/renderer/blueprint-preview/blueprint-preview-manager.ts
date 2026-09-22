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
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry"
import {
  getGridBoundingBox,
  getGridBoundsCenterCells,
  type GridBounds,
} from "@/shared/geometry/grid"
// AI-REMOVED 2026-09-11:
// Reason: 蓝图实体的 definition 查找与旋转占地计算已由共享实体几何函数负责。
// Trigger: 修复蓝图属性面板尺寸并统一编辑器、渲染器和面板的包围盒算法。
// Evidence: resolveEntityGridGeometry 返回的 gridArea 与原逐实体 getRotatedGridFootprint 结果一致。
// Replacement: src/shared/geometry/entity-grid-geometry.ts resolveEntityGridGeometry
// Risk: Low
// Human Review: Required
//
// Original code:
// import {
//   getGridBoundingBox,
//   getGridBoundsCenterCells,
//   getGridFootprintCenterCells,
//   getRotatedGridFootprint,
//   resolveSpriteGridRect,
//   type GridBounds,
// } from "@/shared/geometry/grid"
// AI-CORRECTION 2026-09-21: getGridFootprintCenterCells 与 resolveSpriteGridRect 在 2026-09-11 后仍被旧 preview 自绘路径使用；本次迁移到共享 EntitySpriteScene 后才退出活动代码。
// AI-REMOVED 2026-09-21:
// Reason: 蓝图 preview 的区域、网格、实体与扫描线自绘路径已由共享 Sprite / Decoration 场景能力取代，专用依赖不再进入活动 bundle。
// Trigger: ST2-RQ-037 第一阶段要求小画布复用主场景实现，不保留平行 renderer。
// Evidence: createEntitySpriteScene、GridLineDecoration 与 RegionAnnotationDecoration 已覆盖原消费者；旧函数主体在本文件后部归档。
// Replacement: ../scene + ./blueprint-preview-surface-context
// Risk: Low；真实浏览器三档已验证共享场景绘制。
// Human Review: Required
//
// Original code:
// import {
//   createRegionOutlineSegments,
//   normalizeRegionRects,
// } from "@/shared/geometry/region-rects"
//
// import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js"
//
// import {
//   resolveWorldGridMajorStrokeStyle,
//   resolveWorldGridRenderState,
//   resolveWorldGridStrokeStyle,
// } from "../scene/decorations/GridLineDecoration"
import { resolveEffectiveCanvasTheme } from "@/shared/theme/canvas-theme"
import { Application } from "pixi.js"

import { resolveRenderResolutionFromApp } from "../render-resolution"
import {
  createEntitySpriteScene,
  createGridLineDecoration,
  createRegionAnnotationBackgroundDecoration,
  createRegionAnnotationOverlayDecoration,
  type DecorationSyncContext,
  type EntitySpriteScene,
  type RenderViewportState,
} from "../scene"
import type { RenderSurfaceContext } from "../render-surface-context"
import { createTextureActions } from "../texture/texture-manager"
import {
  createRenderSurface,
  type RenderFrameTime,
  type RenderSurfaceRegistry,
} from "../surface"
import {
  createBlueprintPreviewSurfaceProjection,
  type BlueprintPreviewSurfaceProjection,
} from "./blueprint-preview-surface-context"

const DEFAULT_BLUEPRINT_PREVIEW_WIDTH = 640
const DEFAULT_BLUEPRINT_PREVIEW_HEIGHT = 360
const DEFAULT_BLUEPRINT_PREVIEW_ZOOM = 1
const MIN_BLUEPRINT_PREVIEW_ZOOM = 0.1
const MAX_BLUEPRINT_PREVIEW_ZOOM = 8
const BLUEPRINT_PREVIEW_LIGHT_CANVAS_BACKGROUND_COLOR = 0xeef3f8
const BLUEPRINT_PREVIEW_PADDING_CELLS = 1
// AI-REMOVED 2026-09-21:
// Reason: Preview 专用网格与扫描线常量随平行绘制算法退出活动路径。
// Trigger: ST2-RQ-037 第一阶段统一 Grid / Region / selection Decoration。
// Evidence: Preview 使用共享 Decoration；旧自绘函数主体已在本文件后部归档。
// Replacement: createGridLineDecoration + GenericDeviceSprite selection overlay
// Risk: Low
// Human Review: Required
//
// Original code:
// const BLUEPRINT_PREVIEW_LIGHT_GRID_LINE_COLOR = 0x5c6773
// const BLUEPRINT_PREVIEW_GRID_LINE_ALPHA = 0.30
// // Keep preview grid uniform: every cell boundary uses the same pixel-line stroke.
// const BLUEPRINT_PREVIEW_MAJOR_GRID_INTERVAL = 1
// const BLUEPRINT_PREVIEW_SCANLINE_INTERVAL_MS = 400000
// const BLUEPRINT_PREVIEW_SCANLINE_PADDING_TILES = 2
// const BLUEPRINT_PREVIEW_SCANLINE_TINT = 0x8fd8ff
// const DEGREE_TO_RADIAN = Math.PI / 180
const EMPTY_LOGISTICS_MATERIALS = {
  entities: new Map(),
  beltSeconds: 0,
  animationEnabled: false,
} as const

interface PreviewState {
  readonly app: Application
  readonly blueprint: BlueprintDocument
  readonly canvas: HTMLCanvasElement
  readonly entityScene: EntitySpriteScene
  readonly entityDefinitionMap: Map<string, EntityDefinition>
  readonly gridDecoration: ReturnType<typeof createGridLineDecoration>
  readonly regionBackgroundDecoration: ReturnType<typeof createRegionAnnotationBackgroundDecoration>
  readonly regionOverlayDecoration: ReturnType<typeof createRegionAnnotationOverlayDecoration>
  readonly projection: BlueprintPreviewSurfaceProjection
  readonly renderContext: RenderSurfaceContext
  readonly textureManager: ReturnType<typeof createTextureActions>
  readonly workspace: WorkspaceContract
  readonly viewportBounds: GridBounds | null
  readonly highlightedEntityId: string | null
  // AI-REMOVED 2026-09-21:
  // Reason: PreviewState 改为持有共享 EntitySpriteScene / Decoration / Surface projection，不再拥有平行 Pixi 显示对象集合。
  // Trigger: ST2-RQ-037 第一阶段统一小画布 Scene 与生命周期。
  // Evidence: entityScene、gridDecoration、regionBackgroundDecoration、regionOverlayDecoration 与 projection 成为活动状态。
  // Replacement: PreviewState.entityScene / gridDecoration / regionBackgroundDecoration / regionOverlayDecoration / projection
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // readonly gridGraphics: Graphics
  // readonly regionGraphics: Graphics
  // readonly regionLabels: Container
  // readonly spriteMap: Map<string, Sprite>
  // readonly viewportContainer: Container
  // /** AI-CORRECTION 2026-05-12: scanline overlay children added for inspector neighborhood highlight; destroyed together with the preview app on dispose. */
  // scanlineTiling: TilingSprite | null
  // scanlineMaskGraphics: Graphics | null
  bounds: GridBounds | null
  presentationSignature: string | null
  presentationVersion: number
  disposed: boolean
  handle: BlueprintPreviewHandle
  height: number
  viewport: BlueprintPreviewViewport
  viewportVersion: number
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
  surfaceRegistry: RenderSurfaceRegistry
}): BlueprintPreviewManager {
  const previewStates = new Map<BlueprintPreviewHandle, PreviewState>()
  let previewHandleSequence = 0
  let destroyed = false

  const actions: RenderAction = {
    mountBlueprintPreview: async (mountOptions) => {
      if (destroyed) {
        throw new Error("Cannot mount a blueprint preview after manager destruction.")
      }
      const handle = createBlueprintPreviewHandle(++previewHandleSequence)
      options.surfaceRegistry.beginInitializing(handle)
      const width = normalizeBlueprintPreviewAxisSize(
        mountOptions.width,
        DEFAULT_BLUEPRINT_PREVIEW_WIDTH,
      )
      const height = normalizeBlueprintPreviewAxisSize(
        mountOptions.height,
        DEFAULT_BLUEPRINT_PREVIEW_HEIGHT,
      )
      const viewport = normalizeBlueprintPreviewViewport(mountOptions.viewport)
      const viewportBounds = mountOptions.viewportBounds ?? null
      const app = new Application()
      const resolution = resolveRenderResolutionFromApp(options.workspace.app)
      let pendingTextureManager: ReturnType<typeof createTextureActions> | null = null
      let pendingState: PreviewState | null = null
      let surfaceOwnsResources = false

      try {
        await app.init({
          width,
          height,
          backgroundAlpha: 1,
          backgroundColor: BLUEPRINT_PREVIEW_LIGHT_CANVAS_BACKGROUND_COLOR,
          antialias: true,
          autoDensity: true,
          autoStart: false,
          resolution,
          preference: "webgl",
        })

        ;(app.stage as unknown as RoundPixelsStageLike).roundPixels = true

        const internalState: RenderSurfaceContext["internalState"] = {
          textureConfig: null,
        }
        const textureManager = createTextureActions({
          renderer: app.renderer,
          app: null,
          syncTextureConfigState: (textureConfig) => {
            internalState.textureConfig = textureConfig
          },
        })
        pendingTextureManager = textureManager
        const entityDefinitionMap = createEntityDefinitionMap(options.workspace)
        const bounds = resolveBlueprintPreviewBounds({
          blueprint: mountOptions.blueprint,
          entityDefinitionMap,
          viewportBounds,
        })
        const projection = createBlueprintPreviewSurfaceProjection({
          workspace: options.workspace,
          blueprint: mountOptions.blueprint,
          bounds,
          highlightedEntityId: mountOptions.highlightedEntityId ?? null,
          adaptiveDeviceLabels: viewportBounds === null,
          initialUserZoom: viewport.zoom,
          renderContext: {
            app,
            textureManager,
            internalState,
          },
        })
        const entityScene = createEntitySpriteScene(projection.renderContext)
        const gridDecoration = createGridLineDecoration()
        const regionBackgroundDecoration = createRegionAnnotationBackgroundDecoration()
        const regionOverlayDecoration = createRegionAnnotationOverlayDecoration()
        const state: PreviewState = {
          app,
          blueprint: mountOptions.blueprint,
          canvas: app.canvas,
          entityScene,
          entityDefinitionMap,
          gridDecoration,
          regionBackgroundDecoration,
          regionOverlayDecoration,
          projection,
          renderContext: projection.renderContext,
          textureManager,
          workspace: projection.workspace,
          viewportBounds,
          highlightedEntityId: mountOptions.highlightedEntityId ?? null,
          bounds,
          presentationSignature: null,
          presentationVersion: 0,
          disposed: false,
          handle,
          height,
          viewport,
          viewportVersion: 0,
          width,
        }
        pendingState = state

        entityScene.layers.background.addChild(
          regionBackgroundDecoration.container,
          gridDecoration.container,
        )
        entityScene.layers.overlay.addChild(regionOverlayDecoration.container)
        entityScene.attach(app.stage)
        previewStates.set(handle, state)

        applyBlueprintPreviewViewport(state)

        const surface = createRenderSurface({
          id: handle,
          app,
          scene: {
            sync: (frameTime) => syncBlueprintPreviewFrame(state, frameTime),
            destroy: () => destroyBlueprintPreviewScene(state),
          },
          destroyResources: () => {
            state.textureManager.destroy()
            state.app.destroy(
              { removeView: false },
              {
                children: true,
                context: true,
              },
            )
          },
        })
        surfaceOwnsResources = true
        const activated = options.surfaceRegistry.activate(surface)
        if (!activated || destroyed) {
          if (activated) {
            options.surfaceRegistry.dispose(handle)
          }
          previewStates.delete(handle)
          throw new Error(`Blueprint preview surface was disposed during initialization: ${handle}`)
        }

        return handle
      } catch (error) {
        previewStates.delete(handle)
        options.surfaceRegistry.dispose(handle)
        if (!surfaceOwnsResources) {
          if (pendingState !== null) {
            destroyBlueprintPreviewScene(pendingState)
          }
          pendingTextureManager?.destroy()
          const initializedApp = app as Application & { renderer: Application["renderer"] | null }
          if (initializedApp.renderer !== null && initializedApp.renderer !== undefined) {
            app.destroy(
              { removeView: false },
              { children: true, context: true },
            )
          }
        }
        throw error
      }
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
    },
  }

  const queries: RenderQuery = {
    getBlueprintPreviewCanvas: (handle) => options.surfaceRegistry.get(handle)?.canvas ?? null,
  }

  return {
    actions,
    queries,
    destroy: () => {
      destroyed = true
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
    previewStates.delete(state.handle)
    options.surfaceRegistry.dispose(state.handle)
  }

  function destroyBlueprintPreviewScene(state: PreviewState): void {
    state.disposed = true
    state.entityScene.layers.background.removeChild(state.gridDecoration.container)
    state.entityScene.layers.background.removeChild(state.regionBackgroundDecoration.container)
    state.entityScene.layers.overlay.removeChild(state.regionOverlayDecoration.container)
    state.gridDecoration.destroy()
    state.regionBackgroundDecoration.destroy()
    state.regionOverlayDecoration.destroy()
    state.entityScene.destroy()
  }
}

function syncBlueprintPreviewFrame(
  state: PreviewState,
  frameTime: RenderFrameTime,
): void {
  if (state.disposed) {
    return
  }

  const viewportState = readBlueprintPreviewViewportState(state)
  const workspaceApp = state.workspace.app
  if (workspaceApp === null) {
    return
  }
  const presentationSignature = [
    workspaceApp.state.settings.locale,
    workspaceApp.state.settings.showRegionAnnotations,
    workspaceApp.state.settings.gameShowDeviceIcons,
    workspaceApp.state.settings.gameShowDeviceNames,
    workspaceApp.state.theme.id,
  ].join("|")
  if (presentationSignature !== state.presentationSignature) {
    state.presentationSignature = presentationSignature
    state.presentationVersion += 1
  }
  const effectiveCanvasTheme = resolveEffectiveCanvasTheme(
    workspaceApp.state.theme,
    true,
    false,
  )
  const versions = {
    document: 0,
    viewport: state.viewportVersion,
    collections: 0,
    presentation: state.presentationVersion,
    simulation: 0,
  }
  const decorationContext: DecorationSyncContext = {
    viewportState,
    viewportBounds: {
      left: 0,
      top: 0,
      width: state.width,
      height: state.height,
    },
    renderHost: state.renderContext,
    theme: effectiveCanvasTheme,
    nowMs: frameTime.nowMs,
    versions,
  }

  state.gridDecoration.sync(decorationContext)
  state.regionBackgroundDecoration.sync(decorationContext)
  state.regionOverlayDecoration.sync(decorationContext)
  state.entityScene.sync({
    entities: state.projection.entities,
    viewportState,
    viewportBounds: decorationContext.viewportBounds,
    theme: effectiveCanvasTheme,
    frameTime,
    logisticsMaterials: EMPTY_LOGISTICS_MATERIALS,
    versions,
    committedDocumentVersion: 0,
  })
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

// AI-REMOVED 2026-09-21:
// Reason: 蓝图预览实体、区域与标签已迁入共享 EntitySpriteScene 和 RegionAnnotation Decoration，原始 Sprite/Graphics 平行实现退出活动路径。
// Trigger: ST2-RQ-037 第一阶段要求主画布与小画布复用同一 Sprite / Decoration 实现。
// Evidence: createEntitySpriteScene、createRegionAnnotationBackgroundDecoration、createRegionAnnotationOverlayDecoration 现由 PreviewState 持有并同步。
// Replacement: createBlueprintPreviewSurfaceProjection + syncBlueprintPreviewFrame
// Risk: 共享场景布局必须通过三档真实浏览器验证。
// Human Review: Required
//
// Original code:
/*
function syncBlueprintPreviewSprites(state: PreviewState): void {
  const orderedEntities = state.blueprint.entityOrder
    .map((entityId) => state.blueprint.entities[entityId])
    .filter((entity): entity is WorldEntity => entity !== undefined)
  const nextEntityIds = new Set<string>()
  const entityGeometry = resolveEntityGridGeometry({
    entities: orderedEntities,
    entityDefinitionMap: state.entityDefinitionMap,
  })
  const areas = entityGeometry?.entries.map(({ gridArea }) => gridArea) ?? []
  areas.push(...state.blueprint.regions.flatMap((region) => region.rects.map((rect) => ({
    position: { x: rect.x, y: rect.y },
    footprint: { width: rect.width, height: rect.height },
  }))))

  if (state.viewportBounds !== null) {
    state.bounds = state.viewportBounds
  } else {
    state.bounds = getGridBoundingBox(areas)
  }

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

  if (state.blueprint.regions.length > 0) {
    state.viewportContainer.addChild(state.regionLabels)
  }
}

function syncBlueprintPreviewRegions(state: PreviewState): void {
  state.regionGraphics.clear()
  if (state.blueprint.regions.length === 0) {
    syncBlueprintPreviewRegionVisibility(state)
    return
  }
  state.viewportContainer.addChildAt(state.regionGraphics, 1)
  for (const child of state.regionLabels.removeChildren()) {
    child.destroy({ children: true })
  }

  const visible = state.workspace.app?.state?.settings?.showRegionAnnotations === true
  state.regionGraphics.visible = visible
  state.regionLabels.visible = visible
  if (state.bounds === null) {
    return
  }

  const boundsCenter = getGridBoundsCenterCells(state.bounds)
  for (const region of state.blueprint.regions) {
    const color = Number.parseInt(region.color.slice(1), 16)
    for (const rect of region.rects) {
      state.regionGraphics
        .rect(
          rect.x - boundsCenter.x,
          rect.y - boundsCenter.y,
          rect.width,
          rect.height,
        )
        .fill({ color, alpha: 0.16 })
    }
    for (const segment of createRegionOutlineSegments(region.rects)) {
      state.regionGraphics
        .moveTo(segment.x1 - boundsCenter.x, segment.y1 - boundsCenter.y)
        .lineTo(segment.x2 - boundsCenter.x, segment.y2 - boundsCenter.y)
    }
    state.regionGraphics.stroke({ color, alpha: 0.9, width: 0.08 })

    const labelRect = normalizeRegionRects(region.rects)
      .sort((left, right) => right.width * right.height - left.width * left.height)[0]
    if (labelRect === undefined) {
      continue
    }
    const label = new Text({
      text: region.name,
      style: {
        align: "center",
        fill: color,
        fontFamily: "system-ui, sans-serif",
        fontSize: 0.46,
        fontWeight: "700",
        stroke: { color: 0x101419, width: 0.1, alpha: 0.8 },
      },
    })
    label.anchor.set(0.5)
    label.x = labelRect.x + labelRect.width / 2 - boundsCenter.x
    label.y = labelRect.y + labelRect.height / 2 - boundsCenter.y
    state.regionLabels.addChild(label)
  }
}

function syncBlueprintPreviewRegionVisibility(state: PreviewState): void {
  const visible = state.workspace.app?.state?.settings?.showRegionAnnotations === true
  state.regionGraphics.visible = visible
  state.regionLabels.visible = visible
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
  const bpOffset = definition.spriteOffset?.blueprint ?? null
  const spriteRect = resolveSpriteGridRect(
    entity.position,
    definition.footprint,
    bpOffset,
    entity.rotation,
  )

  const boundsCenterCells = state.bounds === null
    ? { x: 0, y: 0 }
    : getGridBoundsCenterCells(state.bounds)
  const spriteCenterCells = getGridFootprintCenterCells(
    entity.position,
    { width: spriteRect.width, height: spriteRect.height },
  )
  const isQuarterTurn = entity.rotation === 90 || entity.rotation === 270

  sprite.x = spriteCenterCells.x - boundsCenterCells.x
  sprite.y = spriteCenterCells.y - boundsCenterCells.y
  sprite.width = isQuarterTurn ? spriteRect.height : spriteRect.width
  sprite.height = isQuarterTurn ? spriteRect.width : spriteRect.height
  sprite.rotation = entity.rotation * DEGREE_TO_RADIAN
}

*/

function resolveBlueprintPreviewBounds(options: {
  readonly blueprint: BlueprintDocument
  readonly entityDefinitionMap: Map<string, EntityDefinition>
  readonly viewportBounds: GridBounds | null
}): GridBounds | null {
  if (options.viewportBounds !== null) {
    return options.viewportBounds
  }

  const orderedEntities = options.blueprint.entityOrder
    .map((entityId) => options.blueprint.entities[entityId])
    .filter((entity): entity is WorldEntity => entity !== undefined)
  const entityGeometry = resolveEntityGridGeometry({
    entities: orderedEntities,
    entityDefinitionMap: options.entityDefinitionMap,
  })
  const areas = entityGeometry?.entries.map(({ gridArea }) => gridArea) ?? []
  areas.push(...options.blueprint.regions.flatMap((region) => region.rects.map((rect) => ({
    position: { x: rect.x, y: rect.y },
    footprint: { width: rect.width, height: rect.height },
  }))))
  return getGridBoundingBox(areas)
}

function applyBlueprintPreviewViewport(state: PreviewState): void {
  const fitScale = resolveBlueprintPreviewFitScale(state)
  const effectiveGridCellPixelSize = fitScale * state.viewport.zoom
  const boundsCenter = state.bounds === null
    ? { x: 0, y: 0 }
    : getGridBoundsCenterCells(state.bounds)
  const viewport = state.projection.viewport
  state.projection.setUserZoom(state.viewport.zoom)
  viewport.center.x = boundsCenter.x - state.viewport.offsetX / effectiveGridCellPixelSize
  viewport.center.y = boundsCenter.y - state.viewport.offsetY / effectiveGridCellPixelSize
  viewport.clientRect.left = 0
  viewport.clientRect.top = 0
  viewport.clientRect.width = state.width
  viewport.clientRect.height = state.height
  viewport.gridCellPixelSize = effectiveGridCellPixelSize
  viewport.gridSize = state.viewport.zoom
  state.viewportVersion += 1
}

function readBlueprintPreviewViewportState(state: PreviewState): RenderViewportState {
  const viewport = state.projection.viewport
  return {
    width: state.width,
    height: state.height,
    resolution: state.app.renderer.resolution,
    centerX: viewport.center.x,
    centerY: viewport.center.y,
    gridCellPixelSize: viewport.gridCellPixelSize,
    displayRotation: viewport.displayRotation,
  }
}

function resolveBlueprintPreviewFitScale(state: PreviewState): number {
  if (state.bounds === null) {
    return Math.min(state.width, state.height) / 4
  }

  const paddingCells = state.viewportBounds !== null ? 0 : BLUEPRINT_PREVIEW_PADDING_CELLS
  const paddedWidth = Math.max(1, state.bounds.width + paddingCells * 2)
  const paddedHeight = Math.max(1, state.bounds.height + paddingCells * 2)
  const widthScale = state.width / paddedWidth
  const heightScale = state.height / paddedHeight

  return Math.max(0.5, Math.min(widthScale, heightScale))
}

// AI-REMOVED 2026-09-21:
// Reason: 小画布网格改由主场景同一个 GridLineDecoration 根据 Surface viewport 绘制。
// Trigger: ST2-RQ-037 第一阶段要求适用 Decoration 共用，不保留预览专用绘制算法。
// Evidence: PreviewState.gridDecoration 在 syncBlueprintPreviewFrame 中接收标准 DecorationSyncContext。
// Replacement: createGridLineDecoration
// Risk: 共享网格的缩放级别和基地边界需真实浏览器验证。
// Human Review: Required
//
// Original code:
/*
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
  const drawBounds = resolveBlueprintPreviewGridBounds(state)
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
      forceColor: BLUEPRINT_PREVIEW_LIGHT_GRID_LINE_COLOR,
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
      forceColor: BLUEPRINT_PREVIEW_LIGHT_GRID_LINE_COLOR,
    }))
  }
}

function resolveBlueprintPreviewGridBounds(state: PreviewState): {
  left: number
  top: number
  right: number
  bottom: number
} {
  const bounds = state.bounds!

  if (state.viewportBounds !== null) {
    return {
      left: Math.floor(bounds.left),
      top: Math.floor(bounds.top),
      right: Math.ceil(bounds.left + bounds.width),
      bottom: Math.ceil(bounds.top + bounds.height),
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

*/

// AI-REMOVED 2026-09-21:
// Reason: Inspector 目标高亮改由共享 Sprite collection overlay 绘制，不再维护预览专用扫描线对象和动画 listener。
// Trigger: ST2-RQ-037 第一阶段要求 GenericDeviceSprite / DedicatedLogisticSprite 在小画布直接复用。
// Evidence: createBlueprintPreviewSurfaceProjection 将 highlightedEntityId 投影到 selection collection，EntitySpriteScene 统一同步 overlay。
// Replacement: blueprint-preview-surface-context.ts createPreviewCollections
// Risk: 高亮样式由共享 Sprite 决定，需验证 Inspector 可读性。
// Human Review: Required
//
// Original code:
/*
function mountBlueprintPreviewHighlight(state: PreviewState): void {
  if (state.highlightedEntityId === null) {
    return
  }

  const highlightedEntity = state.blueprint.entities[state.highlightedEntityId]

  if (highlightedEntity === undefined) {
    return
  }

  const definition = state.entityDefinitionMap.get(highlightedEntity.definitionId)

  if (definition === undefined) {
    return
  }

  const scanlineTiling = new TilingSprite({
    texture: Texture.EMPTY,
    width: 0,
    height: 0,
  })
  const maskGraphics = new Graphics({ roundPixels: true })

  scanlineTiling.anchor.set(0.5)
  scanlineTiling.roundPixels = true
  scanlineTiling.tint = BLUEPRINT_PREVIEW_SCANLINE_TINT
  scanlineTiling.visible = false

  state.scanlineTiling = scanlineTiling
  state.scanlineMaskGraphics = maskGraphics
  state.viewportContainer.addChild(scanlineTiling)
  state.viewportContainer.addChild(maskGraphics)

  void state.textureManager.getTexture("texture-scanline-45deg-50opacity").then((scanlineTexture) => {
    if (state.disposed || scanlineTiling.destroyed) {
      return
    }

    const bpOffset = definition.spriteOffset?.blueprint ?? null
    const spriteRect = resolveSpriteGridRect(
      highlightedEntity.position,
      definition.footprint,
      bpOffset,
      highlightedEntity.rotation,
    )
    const spriteCenterCells = getGridFootprintCenterCells(
      highlightedEntity.position,
      { width: spriteRect.width, height: spriteRect.height },
    )
    const boundsCenterCells = state.bounds === null
      ? { x: 0, y: 0 }
      : getGridBoundsCenterCells(state.bounds)
    const isQuarterTurn = highlightedEntity.rotation === 90 || highlightedEntity.rotation === 270

    const layoutWidth = spriteRect.width
    const layoutHeight = spriteRect.height
    const spriteWidth = isQuarterTurn ? layoutHeight : layoutWidth
    const spriteHeight = isQuarterTurn ? layoutWidth : layoutHeight

    const tilePixelWidth = scanlineTexture.width || 64
    const tilePixelHeight = scanlineTexture.height || tilePixelWidth

    const maskLeft = spriteCenterCells.x - boundsCenterCells.x - layoutWidth / 2
    const maskTop = spriteCenterCells.y - boundsCenterCells.y - layoutHeight / 2

    maskGraphics
      .rect(maskLeft, maskTop, layoutWidth, layoutHeight)
      .fill(0xffffff)

    scanlineTiling.mask = maskGraphics
    scanlineTiling.texture = scanlineTexture
    scanlineTiling.tileScale.set(
      1 / tilePixelWidth,
      1 / tilePixelHeight,
    )
    scanlineTiling.x = spriteCenterCells.x - boundsCenterCells.x
    scanlineTiling.y = spriteCenterCells.y - boundsCenterCells.y
    scanlineTiling.rotation = 0
    scanlineTiling.width = spriteWidth + BLUEPRINT_PREVIEW_SCANLINE_PADDING_TILES * 2
    scanlineTiling.height = spriteHeight + BLUEPRINT_PREVIEW_SCANLINE_PADDING_TILES * 2
    scanlineTiling.visible = true
    state.scanlineTilePixelWidth = tilePixelWidth

    // AI-REMOVED 2026-09-21:
    // Reason: Inspector 扫描线动画与其他预览同步都由 Host scheduler 的统一 frame time 推进。
    // Trigger: ST2-RQ-037 第一阶段多画布统一调度。
    // Evidence: syncBlueprintPreviewFrame 使用同一 nowMs 更新 tilePosition。
    // Replacement: syncBlueprintPreviewFrame
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // state.app.ticker.add(() => {
    //   if (state.disposed || scanlineTiling.destroyed) {
    //     return
    //   }
    //
    //   const phase = (Date.now() % BLUEPRINT_PREVIEW_SCANLINE_INTERVAL_MS)
    //     / BLUEPRINT_PREVIEW_SCANLINE_INTERVAL_MS
    //   scanlineTiling.tilePosition.x = phase * tilePixelWidth
    // })
  })
}
*/
