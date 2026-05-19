import type {
  WorldEntity,
} from "@/domain/document/world-document"
import type { AppTheme } from "@/domain/app/types/theme"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid"
import type { GridRectSize } from "@/domain/shared/grid"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"
import { resolveEffectiveCanvasTheme } from "@/shared/theme/canvas-theme"
import {
  Container,
  UPDATE_PRIORITY,
} from "pixi.js"
import { resolveRenderResolutionFromApp } from "../render-resolution"
import type { RenderHost } from "../renderer-host"

import { BeltSprite } from "../sprites/belt-sprite"
import { GenericDeviceSprite } from "../sprites/generic-device-sprite"
import { PipeSprite } from "../sprites/pipe-sprite"
import {
  RenderLayerMap,
  RenderSprite,
  type RenderSpriteLayout,
} from "../sprites/render-sprite"
import {
  DecorationSyncContext,
  type RenderViewportState,
} from "./decorations/DecorationSyncContext"
import {
  resolveVisibleWorldRect,
  isWorldEntityVisible,
} from "./decorations/BeltVisualGeometry"
import { createGridLineDecoration } from "./decorations/GridLineDecoration"
import { createBaseBoundaryDecoration } from "./decorations/BaseBoundaryDecoration"
import { createDiagnosticsDecoration } from "./decorations/DiagnosticsDecoration"
import { createLogisticsPlacementCanvasDecoration } from "./decorations/LogisticsPlacementCanvasDecoration"
import { createMarqueeRectDecoration } from "./decorations/MarqueeRectDecoration"
import { createMarqueeCanvasDecoration } from "./decorations/MarqueeCanvasDecoration"
import { createPreviewRectDecoration } from "./decorations/PreviewRectDecoration"
import { createInvalidPlacementDecoration } from "./decorations/InvalidPlacementDecoration"
import { createGrassBackgroundDecoration } from "./decorations/GrassBackgroundDecoration"
import { createBeltCargoDecoration } from "./decorations/BeltCargoDecoration"
import { createBeltPortInsertionDecoration } from "./decorations/BeltPortInsertionDecoration"
import { createBeltFlowDecoration } from "./decorations/BeltFlowDecoration"
import { createPipeFlowDecoration } from "./decorations/PipeFlowDecoration"
import { createPowerRangeDecoration } from "./decorations/PowerRangeDecoration"

const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4

interface RenderFrameTimeState {
  nowMs: number;
  deltaMs: number;
}

export interface RenderSceneOrchestrator {
  destroy(): void;
}

export function createRenderSceneOrchestrator(
  renderHost: RenderHost,
): RenderSceneOrchestrator {
  const app = renderHost.app
  const layers = createRenderLayers()
  const gridDecoration = createGridLineDecoration()
  const baseBoundaryDecoration = createBaseBoundaryDecoration()
  const powerRangeDecoration = createPowerRangeDecoration()
  const previewRectDecoration = createPreviewRectDecoration()
  const invalidPlacementDecoration = createInvalidPlacementDecoration()
  const marqueeDecoration = createMarqueeRectDecoration()
  const diagnosticsDecoration = createDiagnosticsDecoration()
  const marqueeCanvasDecoration = createMarqueeCanvasDecoration()
  const logisticsPlacementCanvasDecoration = createLogisticsPlacementCanvasDecoration()
  const beltFlowDecoration = createBeltFlowDecoration()
  const pipeFlowDecoration = createPipeFlowDecoration()
  const beltPortInsertionDecoration = createBeltPortInsertionDecoration()
  const beltCargoDecoration = createBeltCargoDecoration()
  const beltFlowLayer = new Container()
  const pipeFlowLayer = new Container()
  const beltInsertionLayer = new Container()
  const beltCargoOverlayLayer = new Container()
  const invalidPlacementOverlayLayer = new Container()
  const marqueeOverlayLayer = new Container()
  const entityDefinitionMap = createEntityDefinitionMap(renderHost)
  const entitySprites = new Map<string, RenderSprite>()
  const grassBackgroundDecoration = createGrassBackgroundDecoration(renderHost)

  const flushViewport = (): void => {
    const viewportState = readViewportState(renderHost)
    const frameTime: RenderFrameTimeState = {
      nowMs: renderHost.app.ticker.lastTime,
      deltaMs: renderHost.app.ticker.deltaMS,
    }
    const workspaceApp = renderHost.workspace.app!
    const effectiveCanvasTheme = resolveEffectiveCanvasTheme(
      workspaceApp.state.theme,
      workspaceApp.state.settings.gameUseSimplifiedDeviceIcons,
    )

    applyViewportSize(app, viewportState)
    void renderHost.workspace.simulation?.actions.advancePlaybackByDeltaMs(frameTime.deltaMs)

    const ctx: DecorationSyncContext = {
      viewportState,
      viewportBounds: {
        left: 0,
        top: 0,
        width: app.renderer.width,
        height: app.renderer.height,
      },
      renderHost,
      theme: effectiveCanvasTheme,
      nowMs: frameTime.nowMs,
    }

    gridDecoration.sync(ctx)

    baseBoundaryDecoration.sync(ctx)

    powerRangeDecoration.sync(ctx)

    previewRectDecoration.sync(ctx)

    syncWorldEntitySprites({
      renderHost,
      workspace: renderHost.workspace,
      entities: renderHost.workspace.editor!.queries.listEntities(),
      entityDefinitionMap,
      entitySprites,
      layers,
      viewportState,
      frameTime,
      viewportBounds: ctx.viewportBounds,
      theme: effectiveCanvasTheme,
    })

    invalidPlacementDecoration.sync(ctx)

    marqueeDecoration.sync(ctx)

    marqueeCanvasDecoration.sync(ctx)

    logisticsPlacementCanvasDecoration.sync(ctx)

    diagnosticsDecoration.sync(ctx)

    beltFlowDecoration.sync(ctx)

    pipeFlowDecoration.sync(ctx)

    beltPortInsertionDecoration.sync(ctx)

    beltCargoDecoration.sync(ctx)

    grassBackgroundDecoration.sync(ctx)
  }

  app.stage.addChild(
    layers.background,
    layers.entity,
    beltFlowLayer,
    pipeFlowLayer,
    beltInsertionLayer,
    beltCargoOverlayLayer,
    layers.overlay,
    invalidPlacementOverlayLayer,
    marqueeOverlayLayer,
  )
  app.stage.addChildAt(grassBackgroundDecoration.container, 0)
  layers.background.addChild(gridDecoration.container)
  layers.background.addChild(baseBoundaryDecoration.container)
  layers.background.addChild(powerRangeDecoration.container)
  layers.background.addChild(previewRectDecoration.container)
  invalidPlacementOverlayLayer.addChild(invalidPlacementDecoration.container)
  beltFlowLayer.addChild(beltFlowDecoration.container)
  pipeFlowLayer.addChild(pipeFlowDecoration.container)
  beltInsertionLayer.addChild(beltPortInsertionDecoration.container)
  beltCargoOverlayLayer.addChild(beltCargoDecoration.container)
  marqueeOverlayLayer.addChild(marqueeCanvasDecoration.container)
  marqueeOverlayLayer.addChild(logisticsPlacementCanvasDecoration.container)
  marqueeOverlayLayer.addChild(marqueeDecoration.container)
  layers.overlay.addChild(diagnosticsDecoration.container)
  app.ticker.add(flushViewport, undefined, UPDATE_PRIORITY.HIGH)

  const host: RenderSceneOrchestrator = {
    destroy: () => {
      app.ticker.remove(flushViewport)

      for (const sprite of entitySprites.values()) {
        sprite.destroy()
      }

      entitySprites.clear()
      gridDecoration.destroy()
      baseBoundaryDecoration.destroy()
      powerRangeDecoration.destroy()
      previewRectDecoration.destroy()
      invalidPlacementDecoration.destroy()
      marqueeDecoration.destroy()
      marqueeCanvasDecoration.destroy()
      logisticsPlacementCanvasDecoration.destroy()
      diagnosticsDecoration.destroy()
      beltFlowDecoration.destroy()
      pipeFlowDecoration.destroy()
      beltPortInsertionDecoration.destroy()
      beltCargoDecoration.destroy()
      layers.background.destroy({ children: true })
      layers.entity.destroy({ children: true })
      beltFlowLayer.destroy({ children: true })
      pipeFlowLayer.destroy({ children: true })
      beltInsertionLayer.destroy({ children: true })
      beltCargoOverlayLayer.destroy({ children: true })
      invalidPlacementOverlayLayer.destroy({ children: true })
      layers.overlay.destroy({ children: true })
      marqueeOverlayLayer.destroy({ children: true })
      grassBackgroundDecoration.destroy()
    },
  }

  return host
}

function createRenderLayers(): RenderLayerMap {
  return {
    background: new Container(),
    entity: new Container(),
    overlay: new Container(),
  }
}

function createSpriteForDefinition(
  renderHost: RenderHost,
  entityId: string,
  definition: EntityDefinition,
): RenderSprite | null {
  if (renderHost.workspace.registry.queries.isDedicatedLogisticsDevice(definition.id)) {
    const dedicatedLogisticsKind = renderHost.workspace.registry.queries.resolveDedicatedLogisticsKind(definition.id)

    if (dedicatedLogisticsKind === "belt") {
      return new BeltSprite(entityId, definition, renderHost)
    }

    return new PipeSprite(entityId, definition, renderHost)
  }

  return new GenericDeviceSprite(entityId, definition, renderHost)
}

export function applyViewportSize(
  app: RenderHost["app"],
  viewportSize: {
    width: number;
    height: number;
    resolution: number;
  },
): void {
  if (
    app.renderer.width === viewportSize.width
    && app.renderer.height === viewportSize.height
    && app.renderer.resolution === viewportSize.resolution
  ) {
    return
  }

  app.renderer.resize(
    viewportSize.width,
    viewportSize.height,
    viewportSize.resolution,
  )
}

function readViewportState(renderHost: RenderHost): RenderViewportState {
  const editor = renderHost.workspace.editor!

  return {
    width: resolveViewportAxisSize(
      editor.state.viewport.clientRect.width,
      renderHost.app.renderer.width,
    ),
    height: resolveViewportAxisSize(
      editor.state.viewport.clientRect.height,
      renderHost.app.renderer.height,
    ),
    resolution: resolveRenderResolutionFromApp(
      renderHost.workspace.app,
      renderHost.app.renderer.resolution,
    ),
    centerX: resolveViewportCoordinate(editor.state.viewport.center.x),
    centerY: resolveViewportCoordinate(editor.state.viewport.center.y),
    gridCellPixelSize: requireViewportGridCellPixelSize(
      editor.state.viewport.gridCellPixelSize,
    ),
  }
}

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback
  }

  return Math.floor(value)
}

function resolveViewportCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return value
}

function requireViewportGridCellPixelSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Renderer requires a positive viewport gridCellPixelSize.")
  }

  return value
}

function createEntityDefinitionMap(
  renderHost: RenderHost,
): Map<string, EntityDefinition> {
  return new Map(
    renderHost.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  )
}

function syncWorldEntitySprites(options: {
  renderHost: RenderHost;
  workspace: RenderHost["workspace"];
  entities: readonly WorldEntity[];
  entityDefinitionMap: Map<string, EntityDefinition>;
  entitySprites: Map<string, RenderSprite>;
  layers: RenderLayerMap;
  viewportState: RenderViewportState;
  frameTime: RenderFrameTimeState;
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  theme: AppTheme;
}): void {
  const nextEntityIds = new Set<string>()
  const visibleRect = resolveVisibleWorldRect(options.viewportState, options.viewportBounds)

  for (const entity of options.entities) {
    const definition = options.entityDefinitionMap.get(entity.definitionId)
    if (!definition) {
      continue
    }

    const isVisible = isWorldEntityVisible(entity, definition.footprint, visibleRect)

    if (!isVisible) {
      // 离屏实体的 sprite 保留但隐藏，避免反复创建/销毁
      const existingSprite = options.entitySprites.get(entity.id) ?? null
      if (existingSprite !== null) {
        existingSprite.setVisible(false)
      }
      nextEntityIds.add(entity.id)
      continue
    }

    let sprite: RenderSprite | null = options.entitySprites.get(entity.id) ?? null
    if (!sprite) {
      sprite = createSpriteForDefinition(options.renderHost, entity.id, definition)
      if (sprite === null) {
        continue
      }

      sprite.attach(options.layers)
      options.entitySprites.set(entity.id, sprite)
    }

    sprite.setVisible(true)
    sprite.syncLayout(
      resolveWorldEntitySpriteLayout({
        entity,
        footprint: definition.footprint,
        viewportBounds: options.viewportBounds,
        viewportCenter: {
          x: options.viewportState.centerX,
          y: options.viewportState.centerY,
        },
        gridCellPixelSize: options.viewportState.gridCellPixelSize,
      }),
      {
        theme: options.theme,
        workspace: options.workspace,
        time: options.frameTime,
      },
    )
    nextEntityIds.add(entity.id)
  }

  for (const [entityId, sprite] of options.entitySprites) {
    if (nextEntityIds.has(entityId)) {
      continue
    }

    sprite.destroy()
    options.entitySprites.delete(entityId)
  }
}

export function resolveWorldEntitySelectionStrokeWidth(
  gridCellPixelSize: number,
): number {
  const width = gridCellPixelSize / 8

  return Math.max(
    WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH,
    Math.min(WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH, width),
  )
}

export function resolveWorldEntitySelectionStrokeStyle(options: {
  theme: AppTheme;
  gridCellPixelSize: number;
}): {
  width: number;
  color: number;
} {
  return {
    width: resolveWorldEntitySelectionStrokeWidth(options.gridCellPixelSize),
    color: resolveAppThemeColorNumber(
      options.theme,
      options.theme.renderer.worldEntitySelectionStrokeColorKey,
    ),
  }
}

export function resolveWorldEntitySelectionOverlayLayouts(options: {
  entities: readonly WorldEntity[];
  entityDefinitionMap: Map<string, EntityDefinition>;
  selectedEntityIds: readonly string[];
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}[] {
  const selectedIds = new Set(options.selectedEntityIds)
  const layouts: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }[] = []

  for (const entity of options.entities) {
    if (!selectedIds.has(entity.id)) {
      continue
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId)
    if (!definition) {
      continue
    }

    const layout = resolveWorldEntitySpriteLayout({
      entity,
      footprint: definition.footprint,
      viewportBounds: options.viewportBounds,
      viewportCenter: options.viewportCenter,
      gridCellPixelSize: options.gridCellPixelSize,
    })

    layouts.push({
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      rotation: layout.rotation,
    })
  }

  return layouts
}

export function resolveWorldEntitySpriteLayout(options: {
  entity: WorldEntity;
  footprint: GridRectSize;
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportCenter: {
    x: number;
    y: number;
  };
  gridCellPixelSize: number;
}): RenderSpriteLayout {
  const rotatedFootprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  )
  const entityCenterCells = getGridFootprintCenterCells(
    options.entity.position,
    rotatedFootprint,
  )
  const gridCellSize = options.gridCellPixelSize
  const width = rotatedFootprint.width * gridCellSize
  const height = rotatedFootprint.height * gridCellSize

  return {
    x:
      options.viewportBounds.left
      + options.viewportBounds.width / 2
      + (entityCenterCells.x - options.viewportCenter.x) * gridCellSize
      - width / 2,
    y:
      options.viewportBounds.top
      + options.viewportBounds.height / 2
      + (entityCenterCells.y - options.viewportCenter.y) * gridCellSize
      - height / 2,
    width,
    height,
    rotation: options.entity.rotation,
  }
}
