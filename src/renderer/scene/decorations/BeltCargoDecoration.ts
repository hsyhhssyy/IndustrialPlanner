import type {
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "@/domain/types/grid"
import type {
  CompiledSimulationTopology,
  SimulationTickSnapshot,
} from "@/domain/types/simulation"
import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"

const BELT_INPUT_BUFFER_ID = "item_input_buffer"
const ITEM_ICON_TEXTURE_PREFIX = "item-icon-"
const BOX_SIZE_RATIO = 0.6
const BOX_ICON_SIZE_RATIO = 0.72
const BOX_STROKE_WIDTH_RATIO = 0.08

type BeltDefinitionId =
  | "belt_straight_1x1"
  | "belt_turn_cw_1x1"
  | "belt_turn_ccw_1x1"

interface BeltCargoBinding {
  readonly compiledDeviceId: string;
  readonly worldEntityId: string;
  readonly definitionId: BeltDefinitionId;
  readonly inputSlotId: string;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}

interface BeltCargoRenderEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly itemId: string;
}

const BELT_DEFINITION_IDS = new Set<BeltDefinitionId>([
  "belt_straight_1x1",
  "belt_turn_cw_1x1",
  "belt_turn_ccw_1x1",
])

export function createBeltCargoDecoration(): DecorationLayer {
  const container = new Container()
  const boxGraphics = new Graphics({ roundPixels: true })
  const iconLayer = new Container()
  const iconSprites: Sprite[] = []
  const resolvedTextures = new Map<string, Texture>()
  const pendingTextures = new Map<string, Promise<Texture>>()
  container.addChild(boxGraphics)
  container.addChild(iconLayer)

  let destroyed = false
  let cachedTopology: CompiledSimulationTopology | null = null
  let beltBindings: readonly BeltCargoBinding[] = []
  let itemIconIdByItemId: Map<string, string> | null = null

  const hideAll = (): void => {
    container.visible = false
    boxGraphics.clear()

    for (const sprite of iconSprites) {
      sprite.visible = false
    }
  }

  const ensureItemIconMap = (ctx: DecorationSyncContext): Map<string, string> => {
    if (itemIconIdByItemId !== null) {
      return itemIconIdByItemId
    }

    itemIconIdByItemId = new Map(
      ctx.workspace.registry.itemDefinitions.map((item) => [item.id, item.iconId]),
    )
    return itemIconIdByItemId
  }

  const ensureTopologyBindings = (topology: CompiledSimulationTopology): void => {
    if (cachedTopology === topology) {
      return
    }

    cachedTopology = topology
    beltBindings = resolveBeltBindings(topology)
  }

  const ensureTexture = (ctx: DecorationSyncContext, textureKey: string): void => {
    const textureManager = ctx.workspace.render?.textureManager
    if (
      textureManager === undefined
      || resolvedTextures.has(textureKey)
      || pendingTextures.has(textureKey)
    ) {
      return
    }

    const promise = textureManager.getTexture(textureKey)
    pendingTextures.set(textureKey, promise)
    void promise
      .then((texture) => {
        if (destroyed) {
          return
        }

        resolvedTextures.set(textureKey, texture)
      })
      .finally(() => {
        pendingTextures.delete(textureKey)
      })
  }

  const ensureIconSprite = (index: number): Sprite => {
    let sprite = iconSprites[index]
    if (sprite !== undefined) {
      return sprite
    }

    sprite = new Sprite(Texture.EMPTY)
    sprite.roundPixels = true
    iconLayer.addChild(sprite)
    iconSprites.push(sprite)
    return sprite
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return
      }

      const simulation = ctx.workspace.simulation
      const topology = simulation?.topology.getSnapshot() ?? null
      const tickSnapshot = simulation?.queries.getCurrentTickSnapshot() ?? null
      if (simulation === null || topology === null || tickSnapshot === null) {
        hideAll()
        return
      }

      ensureTopologyBindings(topology)
      const itemIconMap = ensureItemIconMap(ctx)
      const boxSize = ctx.viewportState.gridCellPixelSize * BOX_SIZE_RATIO
      const boxHalfSize = boxSize / 2
      const entries: BeltCargoRenderEntry[] = []

      for (const binding of beltBindings) {
        const runtimeStatus = simulation.queries.getDeviceRuntimeStatus(binding.worldEntityId)
        if (
          runtimeStatus === null
          || runtimeStatus.progressTicks === null
          || runtimeStatus.desiredTicks === null
          || runtimeStatus.desiredTicks <= 0
        ) {
          continue
        }

        const recipeRunId = tickSnapshot.devices[binding.compiledDeviceId]?.recipe?.runId ?? null
        if (recipeRunId === null) {
          continue
        }

        const itemId = resolveReservedItemId(tickSnapshot, binding.inputSlotId, recipeRunId)
        if (itemId === null) {
          continue
        }

        const center = resolveBeltCargoViewportCenter({
          binding,
          progress: clamp01(runtimeStatus.progressTicks / runtimeStatus.desiredTicks),
          viewportBounds: ctx.viewportBounds,
          viewportState: ctx.viewportState,
        })
        if (!isPointVisible(center, ctx.viewportBounds, boxHalfSize)) {
          continue
        }

        ensureTexture(ctx, resolveItemIconTextureKey(itemId, itemIconMap))
        entries.push({
          centerX: center.x,
          centerY: center.y,
          itemId,
        })
      }

      if (entries.length === 0) {
        hideAll()
        return
      }

      container.visible = true
      drawBeltCargoBoxes(boxGraphics, entries, boxSize)
      syncBeltCargoIcons({
        entries,
        boxSize,
        ensureIconSprite,
        iconSprites,
        itemIconMap,
        resolvedTextures,
      })
    },

    destroy(): void {
      destroyed = true
      pendingTextures.clear()
      resolvedTextures.clear()

      for (const sprite of iconSprites) {
        sprite.destroy()
      }

      iconSprites.length = 0
      boxGraphics.destroy()
      iconLayer.destroy({ children: true })
      container.destroy({ children: true })
    },
  }
}

function resolveBeltBindings(
  topology: CompiledSimulationTopology,
): readonly BeltCargoBinding[] {
  const bindings: BeltCargoBinding[] = []

  for (const compiledDeviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[compiledDeviceId]
    if (
      device === undefined
      || device.sourceEntityId === null
      || device.position === null
      || device.rotation === null
      || !BELT_DEFINITION_IDS.has(device.definitionId as BeltDefinitionId)
    ) {
      continue
    }

    const inputSlotId = resolveDeviceInputSlotId(topology, device.cacheGroupIds)
    if (inputSlotId === null) {
      continue
    }

    bindings.push({
      compiledDeviceId,
      worldEntityId: device.sourceEntityId,
      definitionId: device.definitionId as BeltDefinitionId,
      inputSlotId,
      position: device.position,
      rotation: device.rotation,
    })
  }

  return bindings
}

function resolveDeviceInputSlotId(
  topology: CompiledSimulationTopology,
  cacheGroupIds: readonly string[],
): string | null {
  for (const cacheGroupId of cacheGroupIds) {
    const cacheGroup = topology.cacheGroups[cacheGroupId]
    if (cacheGroup?.sourceStorageSlotGroupId !== BELT_INPUT_BUFFER_ID) {
      continue
    }

    return cacheGroup.slotIds[0] ?? null
  }

  return null
}

function resolveReservedItemId(
  tickSnapshot: SimulationTickSnapshot,
  inputSlotId: string,
  recipeRunId: string,
): string | null {
  const slotSnapshot = tickSnapshot.slots[inputSlotId]
  const reservation = slotSnapshot?.reserved.find((entry) => entry.recipeRunId === recipeRunId)
  return reservation?.itemType ?? null
}

function resolveItemIconTextureKey(
  itemId: string,
  itemIconMap: ReadonlyMap<string, string>,
): string {
  return `${ITEM_ICON_TEXTURE_PREFIX}${itemIconMap.get(itemId) ?? itemId}`
}

function drawBeltCargoBoxes(
  graphics: Graphics,
  entries: readonly BeltCargoRenderEntry[],
  boxSize: number,
): void {
  const boxHalfSize = boxSize / 2
  const strokeWidth = Math.max(1, boxSize * BOX_STROKE_WIDTH_RATIO)

  graphics.clear()

  for (const entry of entries) {
    graphics
      .rect(
        entry.centerX - boxHalfSize,
        entry.centerY - boxHalfSize,
        boxSize,
        boxSize,
      )
      .fill(0xffffff)
      .stroke({
        width: strokeWidth,
        color: 0x000000,
      })
  }
}

function syncBeltCargoIcons(options: {
  entries: readonly BeltCargoRenderEntry[];
  boxSize: number;
  ensureIconSprite: (index: number) => Sprite;
  iconSprites: readonly Sprite[];
  itemIconMap: ReadonlyMap<string, string>;
  resolvedTextures: ReadonlyMap<string, Texture>;
}): void {
  const iconSize = options.boxSize * BOX_ICON_SIZE_RATIO
  let visibleIconCount = 0

  for (const entry of options.entries) {
    const texture = options.resolvedTextures.get(
      resolveItemIconTextureKey(entry.itemId, options.itemIconMap),
    )
    if (texture === undefined) {
      continue
    }

    const sprite = options.ensureIconSprite(visibleIconCount)
    sprite.visible = true
    sprite.texture = texture
    sprite.width = iconSize
    sprite.height = iconSize
    sprite.x = entry.centerX - iconSize / 2
    sprite.y = entry.centerY - iconSize / 2
    visibleIconCount += 1
  }

  for (let index = visibleIconCount; index < options.iconSprites.length; index += 1) {
    const sprite = options.iconSprites[index]
    if (sprite !== undefined) {
      sprite.visible = false
    }
  }
}

function resolveBeltCargoViewportCenter(options: {
  binding: BeltCargoBinding;
  progress: number;
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  viewportState: {
    centerX: number;
    centerY: number;
    gridCellPixelSize: number;
  };
}): GridFloatPoint {
  const localPoint = rotatePointClockwise(
    resolveBeltCargoLocalPoint(options.binding.definitionId, options.progress),
    options.binding.rotation,
  )
  const gridCellSize = options.viewportState.gridCellPixelSize
  const cellLeft =
    options.viewportBounds.left
    + options.viewportBounds.width / 2
    + (options.binding.position.x - options.viewportState.centerX) * gridCellSize
  const cellTop =
    options.viewportBounds.top
    + options.viewportBounds.height / 2
    + (options.binding.position.y - options.viewportState.centerY) * gridCellSize

  return {
    x: cellLeft + localPoint.x * gridCellSize,
    y: cellTop + localPoint.y * gridCellSize,
  }
}

function resolveBeltCargoLocalPoint(
  definitionId: BeltDefinitionId,
  progress: number,
): GridFloatPoint {
  if (definitionId === "belt_straight_1x1") {
    return {
      x: progress,
      y: 0.5,
    }
  }

  const angle = definitionId === "belt_turn_cw_1x1"
    ? lerp(Math.PI, Math.PI / 2, progress)
    : lerp(Math.PI, Math.PI * 1.5, progress)

  return {
    x: 0.5 + Math.cos(angle) * 0.5,
    y: 0.5 + Math.sin(angle) * 0.5,
  }
}

function rotatePointClockwise(
  point: GridFloatPoint,
  rotation: GridRotation,
): GridFloatPoint {
  switch (rotation) {
    case 90:
      return {
        x: 1 - point.y,
        y: point.x,
      }
    case 180:
      return {
        x: 1 - point.x,
        y: 1 - point.y,
      }
    case 270:
      return {
        x: point.y,
        y: 1 - point.x,
      }
    default:
      return point
  }
}

function isPointVisible(
  point: GridFloatPoint,
  viewportBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
  padding: number,
): boolean {
  return !(
    point.x < viewportBounds.left - padding
    || point.x > viewportBounds.left + viewportBounds.width + padding
    || point.y < viewportBounds.top - padding
    || point.y > viewportBounds.top + viewportBounds.height + padding
  )
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}