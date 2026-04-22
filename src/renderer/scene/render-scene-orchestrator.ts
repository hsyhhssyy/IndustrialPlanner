import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/entity/world-document"
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
import type { RenderHost } from "../renderer-host"

import { BeltStraightSprite } from "../sprites/belt-straight-sprite"
import {
  RenderLayerMap,
  RenderSprite,
  RenderSpriteId,
  type RenderSpriteLayout,
} from "../sprites/render-sprite"

const VIEWPORT_FRAME_MARGIN = 10
const VIEWPORT_FRAME_STROKE_WIDTH = 5
const VIEWPORT_FRAME_COLOR = 0xffffff
interface RenderViewportState {
  width: number;
  height: number;
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
  const viewportFrame = new Graphics()
  const entityDefinitionMap = createEntityDefinitionMap(renderHost)
  const entitySprites = new Map<string, RenderSprite>()
  let hasDrawnInitialFrame = false
  let lastViewportState = readViewportState(renderHost)
  let lastDocumentSnapshot = readWorldDocumentSnapshot(renderHost)

  const flushViewport = (): void => {
    const nextViewportState = readViewportState(renderHost)
    const nextDocumentSnapshot = readWorldDocumentSnapshot(renderHost)

    if (
      hasDrawnInitialFrame
      && nextViewportState.width === lastViewportState.width
      && nextViewportState.height === lastViewportState.height
      && nextViewportState.centerX === lastViewportState.centerX
      && nextViewportState.centerY === lastViewportState.centerY
      && nextViewportState.gridSize === lastViewportState.gridSize
      && nextDocumentSnapshot === lastDocumentSnapshot
    ) {
      return
    }

    hasDrawnInitialFrame = true
    lastViewportState = nextViewportState
    lastDocumentSnapshot = nextDocumentSnapshot
    applyViewportSize(app, nextViewportState)

    const bounds = resolveViewportFrameBounds(app)

    viewportFrame
      .clear()
      .rect(bounds.left, bounds.top, bounds.width, bounds.height)
      .stroke({
        width: VIEWPORT_FRAME_STROKE_WIDTH,
        color: VIEWPORT_FRAME_COLOR,
      })

    syncWorldEntitySprites({
      document: nextDocumentSnapshot,
      entityDefinitionMap,
      entitySprites,
      layers,
      viewportState: nextViewportState,
      viewportBounds: bounds,
    })
  }

  app.stage.addChild(layers.background, layers.entity, layers.overlay)
  layers.overlay.addChild(viewportFrame)
  app.ticker.add(flushViewport, undefined, UPDATE_PRIORITY.HIGH)

  const host: RenderSceneOrchestrator = {
    destroy: () => {
      app.ticker.remove(flushViewport)

      for (const sprite of entitySprites.values()) {
        sprite.destroy()
      }

      entitySprites.clear()
      viewportFrame.destroy()
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

function createSpriteById(spriteId: RenderSpriteId): RenderSprite {
  switch (spriteId) {
    case "belt_straight_1x1":
    default:
      return new BeltStraightSprite()
  }
}

function applyViewportSize(
  app: RenderHost["app"],
  viewportSize: {
    width: number;
    height: number;
  },
): void {
  if (
    app.renderer.width === viewportSize.width
    && app.renderer.height === viewportSize.height
  ) {
    return
  }

  app.renderer.resize(viewportSize.width, viewportSize.height)
}

function readViewportState(renderHost: RenderHost): RenderViewportState {
  const editor = renderHost.workspace.editor
  if (editor === null) {
    return {
      width: renderHost.app.renderer.width,
      height: renderHost.app.renderer.height,
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

function resolveViewportFrameBounds(app: RenderHost["app"]): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const halfStrokeWidth = VIEWPORT_FRAME_STROKE_WIDTH / 2
  const frameInset = VIEWPORT_FRAME_MARGIN + halfStrokeWidth

  return {
    left: frameInset,
    top: frameInset,
    width: Math.max(0, app.renderer.width - frameInset * 2),
    height: Math.max(0, app.renderer.height - frameInset * 2),
  }
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
}): void {
  const nextEntityIds = new Set<string>()

  if (options.document !== null) {
    for (const entityId of options.document.entityOrder) {
      const entity = options.document.entities[entityId]
      if (!entity) {
        continue
      }

      const spriteId = resolveRenderSpriteId(entity.definitionId)
      if (spriteId === null) {
        continue
      }

      const definition = options.entityDefinitionMap.get(entity.definitionId)
      if (!definition) {
        continue
      }

      let sprite = options.entitySprites.get(entity.id)
      if (!sprite) {
        sprite = createSpriteById(spriteId)
        sprite.attach(options.layers)
        options.entitySprites.set(entity.id, sprite)
      }

      sprite.syncLayout(resolveWorldEntitySpriteLayout({
        entity,
        footprint: definition.footprint,
        viewportBounds: options.viewportBounds,
        viewportCenter: {
          x: options.viewportState.centerX,
          y: options.viewportState.centerY,
        },
        gridSize: options.viewportState.gridSize,
      }))
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

function resolveRenderSpriteId(
  definitionId: WorldEntity["definitionId"],
): RenderSpriteId | null {
  switch (definitionId) {
    case "belt_straight_1x1":
      return "belt_straight_1x1"
    default:
      return null
  }
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
  }
}