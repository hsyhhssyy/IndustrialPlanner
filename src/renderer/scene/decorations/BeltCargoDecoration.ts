import type {
  GridFloatPoint,
  GridPoint,
} from "@/domain/shared/grid"
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types"
import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  BELT_INSERTION_DEPTH_CELLS,
  createEntityDefinitionMap,
  resolveBeltInsertionEntries,
  resolveBeltPathSample,
  resolveViewportPoint,
} from "./BeltVisualGeometry"

const ITEM_ICON_TEXTURE_PREFIX = "item-icon-"
const BOX_SIZE_RATIO = 0.6
const BOX_ICON_SIZE_RATIO = 0.72
const BOX_STROKE_WIDTH_PX = 1
const HANDOFF_DURATION_MS = 650
const HANDOFF_SPAWN_PROGRESS_THRESHOLD = 0.85

interface BeltCargoRenderEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
  readonly itemId: string;
}

interface BeltCargoEntry {
  readonly entityId: string;
  readonly position: GridPoint;
  readonly itemId: string;
  readonly progress: number;
  readonly angleRadians: number;
  readonly localPoint: GridFloatPoint;
  readonly isRunning: boolean;
}

interface BeltCargoHandoffState {
  readonly sourceEntityId: string;
  readonly itemId: string;
  readonly startedAtMs: number;
}

interface BeltCargoHandoffRenderEntry {
  readonly sourceEntityId: string;
  readonly itemId: string;
  readonly startedAtMs: number;
  readonly progress: number;
}

interface BeltCargoHandoffView {
  readonly root: Container;
  readonly mask: Graphics;
  readonly cargoRoot: Container;
  readonly boxGraphics: Graphics;
  readonly icon: Sprite;
}

export function createBeltCargoDecoration(): DecorationLayer {
  const container = new Container()
  const boxGraphics = new Graphics({ roundPixels: true })
  const iconLayer = new Container()
  const handoffLayer = new Container()
  const iconSprites: Sprite[] = []
  const handoffViews: BeltCargoHandoffView[] = []
  const resolvedTextures = new Map<string, Texture>()
  const pendingTextures = new Map<string, Promise<Texture>>()
  container.addChild(boxGraphics)
  container.addChild(iconLayer)
  container.addChild(handoffLayer)

  let destroyed = false
  let itemIconIdByItemId: Map<string, string> | null = null
  const previousMovingCargoByEntityId = new Map<string, BeltCargoEntry>()
  const handoffCargoByEntityId = new Map<string, BeltCargoHandoffState>()

  const hideAll = (): void => {
    container.visible = false
    boxGraphics.clear()

    for (const sprite of iconSprites) {
      sprite.visible = false
    }

    for (const view of handoffViews) {
      view.root.visible = false
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
    sprite.anchor.set(0.5)
    sprite.roundPixels = true
    iconLayer.addChild(sprite)
    iconSprites.push(sprite)
    return sprite
  }

  const ensureHandoffView = (index: number): BeltCargoHandoffView => {
    let view = handoffViews[index]
    if (view !== undefined) {
      return view
    }

    const root = new Container()
    const mask = new Graphics({ roundPixels: true })
    const cargoRoot = new Container()
    const box = new Graphics({ roundPixels: true })
    const icon = new Sprite(Texture.EMPTY)
    icon.anchor.set(0.5)
    icon.roundPixels = true

    cargoRoot.addChild(box)
    cargoRoot.addChild(icon)
    root.mask = mask
    root.addChild(mask)
    root.addChild(cargoRoot)
    handoffLayer.addChild(root)

    view = {
      root,
      mask,
      cargoRoot,
      boxGraphics: box,
      icon,
    }
    handoffViews.push(view)
    return view
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return
      }

      if (ctx.workspace.simulation?.state.runningState === "stop") {
        previousMovingCargoByEntityId.clear()
        handoffCargoByEntityId.clear()
        hideAll()
        return
      }

      const beltCargoEntries = resolveBeltCargoEntries(ctx)
      const beltInsertionEntries = resolveBeltInsertionEntries(ctx)
      const handoffEntries = syncBeltCargoHandoffs({
        nowMs: ctx.nowMs,
        beltCargoEntries,
        beltInsertionSourceEntityIds: new Set(
          beltInsertionEntries.map((entry) => entry.sourceEntityId),
        ),
        previousMovingCargoByEntityId,
        handoffCargoByEntityId,
      })

      if (beltCargoEntries.length === 0 && handoffEntries.length === 0) {
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
          angleRadians: beltCargoEntry.angleRadians,
          itemId: beltCargoEntry.itemId,
        })
      }

      for (const handoffEntry of handoffEntries) {
        ensureTexture(ctx, resolveItemIconTextureKey(handoffEntry.itemId, itemIconMap))
      }

      if (entries.length === 0 && handoffEntries.length === 0) {
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
      syncBeltCargoHandoffViews({
        ctx,
        entries: handoffEntries,
        insertionEntries: beltInsertionEntries,
        boxSize,
        ensureHandoffView,
        handoffViews,
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

      for (const view of handoffViews) {
        view.root.destroy({ children: true })
      }

      iconSprites.length = 0
      handoffViews.length = 0
      boxGraphics.destroy()
      iconLayer.destroy({ children: true })
      handoffLayer.destroy({ children: true })
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

  const definitionMap = createEntityDefinitionMap(ctx)
  const entries: BeltCargoEntry[] = []
  for (const entity of editor.queries.listEntities()) {
    const definition = definitionMap.get(entity.definitionId)
    if (definition === undefined) {
      continue
    }

    const runtimeStatus = simulation.queries.getDeviceRuntimeStatus(entity.id)
    const cargoState = resolveRuntimeCargoState(runtimeStatus)
    if (cargoState === null) {
      continue
    }

    const pathSample = resolveBeltPathSample({
      entity,
      definition,
      progress: cargoState.progress,
    })
    if (pathSample === null) {
      continue
    }

    entries.push({
      entityId: entity.id,
      position: entity.position,
      itemId: cargoState.itemId,
      progress: cargoState.progress,
      angleRadians: pathSample.angleRadians,
      localPoint: pathSample.point,
      isRunning: cargoState.isRunning,
    })
  }

  return entries
}

function resolveRuntimeCargoState(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): { readonly itemId: string; readonly progress: number; readonly isRunning: boolean } | null {
  const runningItemId = resolveRunningCargoItemId(runtimeStatus)
  const runningProgress = resolveRuntimeProgress(runtimeStatus)
  if (runningItemId !== null && runningProgress !== null) {
    return {
      itemId: runningItemId,
      progress: runningProgress,
      isRunning: true,
    }
  }

  return resolveStationaryCargoState(runtimeStatus)
}

function resolveRunningCargoItemId(
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

function resolveStationaryCargoState(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): { readonly itemId: string; readonly progress: number; readonly isRunning: boolean } | null {
  if (runtimeStatus === null) {
    return null
  }

  const ingredientSlot = runtimeStatus.slotItems.find((slotItem) =>
    slotItem.slotType === "ingredient"
    && slotItem.itemType !== null
    && slotItem.count > 0,
  )
  if (ingredientSlot?.itemType !== undefined && ingredientSlot.itemType !== null) {
    return {
      itemId: ingredientSlot.itemType,
      progress: 0,
      isRunning: false,
    }
  }

  const productSlot = runtimeStatus.slotItems.find((slotItem) =>
    slotItem.slotType === "product"
    && slotItem.itemType !== null
    && slotItem.count > 0,
  )
  if (productSlot?.itemType !== undefined && productSlot.itemType !== null) {
    return {
      itemId: productSlot.itemType,
      progress: 1,
      isRunning: false,
    }
  }

  const fallbackSlot = runtimeStatus.slotItems.find((slotItem) =>
    slotItem.itemType !== null && slotItem.count > 0,
  )
  if (fallbackSlot?.itemType === undefined || fallbackSlot.itemType === null) {
    return null
  }

  return {
    itemId: fallbackSlot.itemType,
    progress: fallbackSlot.slotType === "product" ? 1 : 0,
    isRunning: false,
  }
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
  graphics.clear()

  for (const entry of entries) {
    graphics
      .poly(resolveRotatedSquarePoints(entry, boxSize), true)
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
    sprite.x = entry.centerX
    sprite.y = entry.centerY
    sprite.rotation = entry.angleRadians
    visibleIconCount += 1
  }

  for (let index = visibleIconCount; index < options.iconSprites.length; index += 1) {
    const sprite = options.iconSprites[index]
    if (sprite !== undefined) {
      sprite.visible = false
    }
  }
}

function syncBeltCargoHandoffs(options: {
  nowMs: number;
  beltCargoEntries: readonly BeltCargoEntry[];
  beltInsertionSourceEntityIds: ReadonlySet<string>;
  previousMovingCargoByEntityId: Map<string, BeltCargoEntry>;
  handoffCargoByEntityId: Map<string, BeltCargoHandoffState>;
}): BeltCargoHandoffRenderEntry[] {
  const currentEntryIds = new Set(options.beltCargoEntries.map((entry) => entry.entityId))

  for (const entry of options.beltCargoEntries) {
    options.handoffCargoByEntityId.delete(entry.entityId)

    if (entry.isRunning) {
      options.previousMovingCargoByEntityId.set(entry.entityId, entry)
    }
  }

  for (const [entityId, previousEntry] of options.previousMovingCargoByEntityId) {
    if (currentEntryIds.has(entityId)) {
      continue
    }

    options.previousMovingCargoByEntityId.delete(entityId)

    if (
      previousEntry.progress < HANDOFF_SPAWN_PROGRESS_THRESHOLD
      || !options.beltInsertionSourceEntityIds.has(entityId)
    ) {
      continue
    }

    options.handoffCargoByEntityId.set(entityId, {
      sourceEntityId: entityId,
      itemId: previousEntry.itemId,
      startedAtMs: options.nowMs,
    })
  }

  const handoffEntries: BeltCargoHandoffRenderEntry[] = []
  for (const [entityId, handoffState] of options.handoffCargoByEntityId) {
    if (!options.beltInsertionSourceEntityIds.has(entityId)) {
      options.handoffCargoByEntityId.delete(entityId)
      continue
    }

    const elapsedMs = Math.max(0, options.nowMs - handoffState.startedAtMs)
    const progress = elapsedMs / HANDOFF_DURATION_MS
    if (!Number.isFinite(progress) || progress > 1) {
      options.handoffCargoByEntityId.delete(entityId)
      continue
    }

    handoffEntries.push({
      ...handoffState,
      progress,
    })
  }

  return handoffEntries
}

function syncBeltCargoHandoffViews(options: {
  ctx: DecorationSyncContext;
  entries: readonly BeltCargoHandoffRenderEntry[];
  insertionEntries: ReturnType<typeof resolveBeltInsertionEntries>;
  boxSize: number;
  ensureHandoffView: (index: number) => BeltCargoHandoffView;
  handoffViews: readonly BeltCargoHandoffView[];
  itemIconMap: ReadonlyMap<string, string>;
  resolvedTextures: ReadonlyMap<string, Texture>;
}): void {
  const insertionEntryBySourceId = new Map(
    options.insertionEntries.map((entry) => [entry.sourceEntityId, entry]),
  )
  const gridCellSize = options.ctx.viewportState.gridCellPixelSize
  const insertionLength = gridCellSize * BELT_INSERTION_DEPTH_CELLS
  const handoffStartX = insertionLength - options.boxSize / 2
  const handoffEndX = insertionLength + options.boxSize / 2
  let visibleCount = 0

  for (const entry of options.entries) {
    const insertionEntry = insertionEntryBySourceId.get(entry.sourceEntityId)
    if (insertionEntry === undefined) {
      continue
    }

    const view = options.ensureHandoffView(visibleCount)
    const boundary = resolveViewportPoint({
      point: insertionEntry.boundary,
      viewportBounds: options.ctx.viewportBounds,
      viewportState: options.ctx.viewportState,
    })
    const iconTexture = options.resolvedTextures.get(
      resolveItemIconTextureKey(entry.itemId, options.itemIconMap),
    )

    view.root.visible = true
    view.root.x = boundary.x
    view.root.y = boundary.y
    view.root.rotation = insertionEntry.angleRadians
    view.mask
      .clear()
      .rect(
        -options.boxSize,
        -gridCellSize / 2,
        options.boxSize + insertionLength,
        gridCellSize,
      )
      .fill(0xffffff)

    view.cargoRoot.x = lerp(handoffStartX, handoffEndX, entry.progress)
    view.cargoRoot.y = 0
    view.cargoRoot.rotation = 0

    view.boxGraphics
      .clear()
      .rect(
        -options.boxSize / 2,
        -options.boxSize / 2,
        options.boxSize,
        options.boxSize,
      )
      .fill(0xffffff)
      .stroke({
        width: BOX_STROKE_WIDTH_PX,
        color: 0x000000,
        pixelLine: true,
      })

    view.icon.visible = iconTexture !== undefined
    view.icon.texture = iconTexture ?? Texture.EMPTY
    view.icon.width = options.boxSize * BOX_ICON_SIZE_RATIO
    view.icon.height = options.boxSize * BOX_ICON_SIZE_RATIO
    view.icon.x = 0
    view.icon.y = 0
    view.icon.rotation = 0

    visibleCount += 1
  }

  for (let index = visibleCount; index < options.handoffViews.length; index += 1) {
    const view = options.handoffViews[index]
    if (view !== undefined) {
      view.root.visible = false
    }
  }
}

function resolveRotatedSquarePoints(
  entry: Pick<BeltCargoRenderEntry, "centerX" | "centerY" | "angleRadians">,
  boxSize: number,
): number[] {
  const halfSize = boxSize / 2
  const cos = Math.cos(entry.angleRadians)
  const sin = Math.sin(entry.angleRadians)
  const corners = [
    { x: -halfSize, y: -halfSize },
    { x: halfSize, y: -halfSize },
    { x: halfSize, y: halfSize },
    { x: -halfSize, y: halfSize },
  ]
  const points: number[] = []

  for (const corner of corners) {
    points.push(
      entry.centerX + corner.x * cos - corner.y * sin,
      entry.centerY + corner.x * sin + corner.y * cos,
    )
  }

  return points
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
    x: cellLeft + options.entry.localPoint.x * gridCellSize,
    y: cellTop + options.entry.localPoint.y * gridCellSize,
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
