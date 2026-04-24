import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/entity/world-document"
import type { AppTheme } from "@/domain/state/theme"
import { resolveAppThemeColorNumber } from "@/domain/state/theme"
import type { EntityDefinition } from "@/domain/types/registry/entity-definition"
import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
  type GridFootprint,
} from "@/shared/geometry/grid"
import {
  resolveViewportGridSize,
  resolveWorldGridCellPixelSize,
} from "@/shared/geometry/viewport-transform"
import {
  Container,
  Graphics,
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

const WORLD_GRID_LINE_ALPHA = 0.12
const WORLD_GRID_LINE_WIDTH = 1

const GENERIC_DEVICE_SPRITE_ASSET_IDS = new Set<string>([
  "item_log_connector",
  "item_log_converger",
  "item_log_splitter",
  "item_pipe_connector",
  "item_pipe_converger",
  "item_pipe_splitter",
  "item_port_filling_pd_mc_1",
  "item_port_grinder_1",
  "item_port_log_hongs_bus",
  "item_port_log_hongs_bus_source",
  "item_port_mix_pool_1",
  "item_port_storager_1",
  "item_port_udpipe_loader_1",
  "item_port_udpipe_unloader_1",
  "item_port_unloader_1",
])

const GENERIC_DEVICE_SPRITE_ALIASES: Record<string, string> = {
  item_port_liquid_filling_pd_mc_1: "item_port_filling_pd_mc_1",
}

interface RenderViewportState {
  width: number;
  height: number;
  resolution: number;
  centerX: number;
  centerY: number;
  gridSize: number;
}

export interface RenderSceneOrchestrator {
  destroy(): void;
}

export function createRenderSceneOrchestrator(
  renderHost: RenderHost,
): RenderSceneOrchestrator {
  const app = renderHost.app
  const layers = createRenderLayers()
  const worldGrid = new Graphics({ roundPixels: true })
  const entityDefinitionMap = createEntityDefinitionMap(renderHost)
  const entitySprites = new Map<string, RenderSprite>()

  const flushViewport = (): void => {
    const viewportState = readViewportState(renderHost)
    const documentSnapshot = readWorldDocumentSnapshot(renderHost)
    const theme = readAppTheme(renderHost)

    applyViewportSize(app, viewportState)

    syncWorldGridBackground({
      background: worldGrid,
      viewportState,
      viewportBounds: {
        left: 0,
        top: 0,
        width: app.renderer.width,
        height: app.renderer.height,
      },
      theme,
    })

    syncWorldEntitySprites({
      document: documentSnapshot,
      entityDefinitionMap,
      entitySprites,
      layers,
      viewportState,
      viewportBounds: {
        left: 0,
        top: 0,
        width: app.renderer.width,
        height: app.renderer.height,
      },
      theme,
    })
  }

  app.stage.addChild(layers.background, layers.entity, layers.overlay)
  layers.background.addChild(worldGrid)
  app.ticker.add(flushViewport, undefined, UPDATE_PRIORITY.HIGH)

  const host: RenderSceneOrchestrator = {
    destroy: () => {
      app.ticker.remove(flushViewport)

      for (const sprite of entitySprites.values()) {
        sprite.destroy()
      }

      entitySprites.clear()
      layers.background.destroy({ children: true })
      layers.entity.destroy({ children: true })
      layers.overlay.destroy({ children: true })
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
  definition: EntityDefinition,
): RenderSprite | null {
  if (definition.spriteId === "belt_straight_1x1") {
    return new BeltStraightSprite()
  }

  const texturePath = resolveGenericDeviceSpriteTexturePath(definition.spriteId)
  if (texturePath === null) {
    return null
  }

  return new GenericDeviceSprite(texturePath)
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
  const editor = renderHost.workspace.editor
  if (editor === null) {
    return {
      width: renderHost.app.renderer.width,
      height: renderHost.app.renderer.height,
      resolution: renderHost.app.renderer.resolution,
      centerX: 0,
      centerY: 0,
      gridSize: 1,
    }
  }

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
    gridSize: resolveViewportGridSize(editor.state.viewport.gridSize),
  }
}

function readWorldDocumentSnapshot(renderHost: RenderHost): WorldDocument | null {
  const editor = renderHost.workspace.editor
  if (editor === null) {
    return null
  }

  return editor.document.getSnapshot()
}

function readAppTheme(renderHost: RenderHost): AppTheme {
  const theme = renderHost.workspace.app?.state.theme

  if (theme === undefined) {
    throw new Error("App host must be initialized before renderer can read theme colors.")
  }

  return theme
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

function syncWorldGridBackground(options: {
  background: Graphics;
  viewportState: RenderViewportState;
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  theme: AppTheme;
}): void {
  const lineAxes = resolveWorldGridLineAxes({
    viewportBounds: options.viewportBounds,
    viewportCenter: {
      x: options.viewportState.centerX,
      y: options.viewportState.centerY,
    },
    gridSize: options.viewportState.gridSize,
  })

  options.background.clear()

  for (const x of lineAxes.vertical) {
    options.background
      .moveTo(x, options.viewportBounds.top)
      .lineTo(x, options.viewportBounds.top + options.viewportBounds.height)
  }

  for (const y of lineAxes.horizontal) {
    options.background
      .moveTo(options.viewportBounds.left, y)
      .lineTo(options.viewportBounds.left + options.viewportBounds.width, y)
  }

  options.background.stroke(resolveWorldGridStrokeStyle(options.theme))
}

export function resolveWorldGridStrokeStyle(theme: AppTheme): {
  width: number;
  color: number;
  alpha: number;
  pixelLine: true;
} {
  return {
    width: WORLD_GRID_LINE_WIDTH,
    color: resolveAppThemeColorNumber(
      theme,
      theme.renderer.worldGridLineColorKey,
    ),
    alpha: WORLD_GRID_LINE_ALPHA,
    pixelLine: true,
  }
}

export function resolveWorldGridLineAxes(options: {
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
  gridSize: number;
}): {
  vertical: number[];
  horizontal: number[];
} {
  const gridCellSize = resolveWorldGridCellPixelSize(options.gridSize)

  return {
    vertical: resolveWorldGridAxisPositions({
      viewportStart: options.viewportBounds.left,
      viewportSpan: options.viewportBounds.width,
      worldCenter: options.viewportCenter.x,
      gridCellSize,
    }),
    horizontal: resolveWorldGridAxisPositions({
      viewportStart: options.viewportBounds.top,
      viewportSpan: options.viewportBounds.height,
      worldCenter: options.viewportCenter.y,
      gridCellSize,
    }),
  }
}

function resolveWorldGridAxisPositions(options: {
  viewportStart: number;
  viewportSpan: number;
  worldCenter: number;
  gridCellSize: number;
}): number[] {
  if (options.viewportSpan <= 0 || options.gridCellSize <= 0) {
    return []
  }

  const axisCenter = options.viewportStart + options.viewportSpan / 2
  const worldOrigin = axisCenter - options.worldCenter * options.gridCellSize
  const firstLineIndex = Math.ceil(
    (options.viewportStart - worldOrigin) / options.gridCellSize,
  )
  const linePositions: number[] = []
  const viewportEnd = options.viewportStart + options.viewportSpan

  for (
    let lineIndex = firstLineIndex;
    worldOrigin + lineIndex * options.gridCellSize <= viewportEnd;
    lineIndex += 1
  ) {
    linePositions.push(worldOrigin + lineIndex * options.gridCellSize)
  }

  return linePositions
}

function syncWorldEntitySprites(options: {
  document: WorldDocument | null;
  entityDefinitionMap: Map<string, EntityDefinition>;
  entitySprites: Map<string, RenderSprite>;
  layers: RenderLayerMap;
  viewportState: RenderViewportState;
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  theme: AppTheme;
}): void {
  const nextEntityIds = new Set<string>()

  if (options.document !== null) {
    for (const entityId of options.document.entityOrder) {
      const entity = options.document.entities[entityId]
      if (!entity) {
        continue
      }

      const definition = options.entityDefinitionMap.get(entity.definitionId)
      if (!definition) {
        continue
      }

      let sprite: RenderSprite | null = options.entitySprites.get(entity.id) ?? null
      if (!sprite) {
        sprite = createSpriteForDefinition(definition)
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
          gridSize: options.viewportState.gridSize,
        }),
        { theme: options.theme },
      )
      nextEntityIds.add(entity.id)
    }
  }

  for (const [entityId, sprite] of options.entitySprites) {
    if (nextEntityIds.has(entityId)) {
      continue
    }

    sprite.destroy()
    options.entitySprites.delete(entityId)
  }
}

export function resolveGenericDeviceSpriteTexturePath(
  spriteId: EntityDefinition["spriteId"],
): string | null {
  const assetId = GENERIC_DEVICE_SPRITE_ALIASES[spriteId] ?? spriteId

  if (!GENERIC_DEVICE_SPRITE_ASSET_IDS.has(assetId)) {
    return null
  }

  return `/sprites/${assetId}.webp`
}

export function resolveWorldEntitySpriteLayout(options: {
  entity: WorldEntity;
  footprint: GridFootprint;
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
  gridSize: number;
}): RenderSpriteLayout {
  const rotatedFootprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  )
  const entityCenterCells = getGridFootprintCenterCells(
    options.entity.position,
    rotatedFootprint,
  )
  const gridCellSize = resolveWorldGridCellPixelSize(options.gridSize)
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
