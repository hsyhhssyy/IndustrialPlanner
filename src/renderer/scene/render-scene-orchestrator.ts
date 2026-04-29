import type {
  WorldEntity,
} from "@/domain/entity/world-document"
import type { AppTheme } from "@/domain/state/theme"
import type { EntityDefinition } from "@/domain/types/registry/entity-definition"
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid"
import type { GridRectSize } from "@/domain/types/grid"
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"
import {
  Container,
  UPDATE_PRIORITY,
} from "pixi.js"
import { resolveRenderResolutionFromApp } from "../render-resolution"
import type { RenderHost } from "../renderer-host"

import { BeltStraightSprite } from "../sprites/belt-straight-sprite"
import { GenericDeviceSprite } from "../sprites/generic-device-sprite"
import {
  RenderLayerMap,
  RenderSprite,
  type RenderSpriteLayout,
} from "../sprites/render-sprite"
import type { DecorationLayer } from "./decorations/DecorationLayer"
import {
  type DecorationSyncContext,
  type RenderViewportState,
} from "./decorations/DecorationSyncContext"
import { createGridLineDecoration } from "./decorations/GridLineDecoration"
import { createDiagnosticsDecoration } from "./decorations/DiagnosticsDecoration"
import { createMarqueeRectDecoration } from "./decorations/MarqueeRectDecoration"
import { createMarqueeCanvasDecoration } from "./decorations/MarqueeCanvasDecoration"

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
  const marqueeDecoration = createMarqueeRectDecoration()
  const diagnosticsDecoration = createDiagnosticsDecoration()
  const marqueeCanvasDecoration = createMarqueeCanvasDecoration()
  const marqueeOverlayLayer = new Container()
  const entityDefinitionMap = createEntityDefinitionMap(renderHost)
  const entitySprites = new Map<string, RenderSprite>()

  const flushViewport = (): void => {
    const viewportState = readViewportState(renderHost)

    applyViewportSize(app, viewportState)

    const ctx: DecorationSyncContext = {
      viewportState,
      viewportBounds: {
        left: 0,
        top: 0,
        width: app.renderer.width,
        height: app.renderer.height,
      },
      workspace: renderHost.workspace,
      nowMs: renderHost.app.ticker.lastTime,
    }

    gridDecoration.sync(ctx)

    syncWorldEntitySprites({
      renderHost,
      workspace: renderHost.workspace,
      entities: renderHost.workspace.editor!.queries.listEntities(),
      entityDefinitionMap,
      entitySprites,
      layers,
      viewportState,
      frameTime: {
        nowMs: renderHost.app.ticker.lastTime,
        deltaMs: renderHost.app.ticker.deltaMS,
      },
      viewportBounds: ctx.viewportBounds,
      theme: renderHost.workspace.app!.state.theme,
    })

    marqueeDecoration.sync(ctx)

    marqueeCanvasDecoration.sync(ctx)

    diagnosticsDecoration.sync(ctx)
  }

  app.stage.addChild(layers.background, layers.entity, layers.overlay, marqueeOverlayLayer)
  layers.background.addChild(gridDecoration.container)
  marqueeOverlayLayer.addChild(marqueeCanvasDecoration.container)
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
      marqueeDecoration.destroy()
      marqueeCanvasDecoration.destroy()
      diagnosticsDecoration.destroy()
      layers.background.destroy({ children: true })
      layers.entity.destroy({ children: true })
      layers.overlay.destroy({ children: true })
      marqueeOverlayLayer.destroy({ children: true })
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
  if (definition.spriteId === "belt_straight_1x1") {
    return new BeltStraightSprite(entityId)
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

  for (const entity of options.entities) {
    const definition = options.entityDefinitionMap.get(entity.definitionId)
    if (!definition) {
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
