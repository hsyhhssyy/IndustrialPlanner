import type {
  GridFloatPoint,
  GridPoint,
  GridRotation,
} from "@/domain/types/grid"
import type { WorldEntity } from "@/domain/entity/world-document"
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/query/simulation-query"
import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"

const ITEM_ICON_TEXTURE_PREFIX = "item-icon-"
const BOX_SIZE_RATIO = 0.6
const BOX_ICON_SIZE_RATIO = 0.72
const BOX_STROKE_WIDTH_PX = 1

interface BeltCargoRenderEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly itemId: string;
}

type BeltCargoShape = "straight" | "turn-cw" | "turn-ccw"

interface BeltCargoEntry {
  readonly beltShape: BeltCargoShape;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly itemId: string;
  readonly progress: number;
}

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

      const beltCargoEntries = resolveBeltCargoEntries(ctx)
      if (beltCargoEntries.length === 0) {
        hideAll()
        return
      }

      const itemIconMap = ensureItemIconMap(ctx)
      const boxSize = ctx.viewportState.gridCellPixelSize * BOX_SIZE_RATIO
      const boxHalfSize = boxSize / 2
      const entries: BeltCargoRenderEntry[] = []

      for (const beltCargoEntry of beltCargoEntries) {
        const center = resolveBeltCargoViewportCenter({
          entry: beltCargoEntry,
          viewportBounds: ctx.viewportBounds,
          viewportState: ctx.viewportState,
        })
        if (!isPointVisible(center, ctx.viewportBounds, boxHalfSize)) {
          continue
        }

        ensureTexture(ctx, resolveItemIconTextureKey(beltCargoEntry.itemId, itemIconMap))
        entries.push({
          centerX: center.x,
          centerY: center.y,
          itemId: beltCargoEntry.itemId,
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

function resolveBeltCargoEntries(ctx: DecorationSyncContext): BeltCargoEntry[] {
  const simulation = ctx.workspace.simulation
  const editor = ctx.workspace.editor
  if (simulation === null || editor === null || simulation.state.runningState === "stop") {
    return []
  }

  const entries: BeltCargoEntry[] = []
  for (const entity of editor.queries.listEntities()) {
    const beltShape = resolveBeltCargoShape(entity)
    if (beltShape === null) {
      continue
    }

    const runtimeStatus = simulation.queries.getDeviceRuntimeStatus(entity.id)
    const itemId = resolveRuntimeCargoItemId(runtimeStatus)
    const progress = resolveRuntimeProgress(runtimeStatus)
    if (itemId === null || progress === null) {
      continue
    }

    entries.push({
      beltShape,
      position: entity.position,
      rotation: entity.rotation,
      itemId,
      progress,
    })
  }

  return entries
}

function resolveBeltCargoShape(entity: WorldEntity): BeltCargoShape | null {
  switch (entity.definitionId) {
    case "belt_straight_1x1":
      return "straight"
    case "belt_turn_cw_1x1":
      return "turn-cw"
    case "belt_turn_ccw_1x1":
      return "turn-ccw"
    default:
      return null
  }
}

function resolveRuntimeCargoItemId(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): string | null {
  if (runtimeStatus === null || runtimeStatus.recipeId === null) {
    return null
  }

  const reservedSlot = runtimeStatus.slotItems.find((slotItem) =>
    slotItem.itemType !== null && slotItem.reserved > 0,
  )
  if (reservedSlot?.itemType !== undefined && reservedSlot.itemType !== null) {
    return reservedSlot.itemType
  }

  return runtimeStatus.slotItems.find((slotItem) =>
    slotItem.itemType !== null && slotItem.count > 0,
  )?.itemType ?? null
}

function resolveRuntimeProgress(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): number | null {
  if (
    runtimeStatus === null
    || runtimeStatus.progressSeconds === null
    || runtimeStatus.desiredSeconds === null
  ) {
    return null
  }

  if (runtimeStatus.desiredSeconds <= 0) {
    return null
  }

  const progress = runtimeStatus.progressSeconds / runtimeStatus.desiredSeconds
  if (!Number.isFinite(progress)) {
    return null
  }

  return Math.max(0, Math.min(1, progress))
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
        width: BOX_STROKE_WIDTH_PX,
        color: 0x000000,
        pixelLine: true,
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
  entry: BeltCargoEntry;
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
    resolveBeltCargoLocalPoint(options.entry.beltShape, options.entry.progress),
    options.entry.rotation,
  )
  const gridCellSize = options.viewportState.gridCellPixelSize
  const cellLeft =
    options.viewportBounds.left
    + options.viewportBounds.width / 2
    + (options.entry.position.x - options.viewportState.centerX) * gridCellSize
  const cellTop =
    options.viewportBounds.top
    + options.viewportBounds.height / 2
    + (options.entry.position.y - options.viewportState.centerY) * gridCellSize

  return {
    x: cellLeft + localPoint.x * gridCellSize,
    y: cellTop + localPoint.y * gridCellSize,
  }
}

function resolveBeltCargoLocalPoint(
  beltShape: BeltCargoShape,
  progress: number,
): GridFloatPoint {
  if (beltShape === "straight") {
    return {
      x: progress,
      y: 0.5,
    }
  }

  const turnCenter = beltShape === "turn-cw"
    ? { x: 0, y: 1 }
    : { x: 0, y: 0 }
  const angle = beltShape === "turn-cw"
    ? lerp(-Math.PI / 2, 0, progress)
    : lerp(Math.PI / 2, 0, progress)

  return {
    x: turnCenter.x + Math.cos(angle) * 0.5,
    y: turnCenter.y + Math.sin(angle) * 0.5,
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

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}