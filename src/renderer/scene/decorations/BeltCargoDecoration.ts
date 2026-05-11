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
  resolveBeltPortExtensionEntries,
  resolveBeltPathSample,
  resolveViewportPoint,
  type BeltPortExtensionEntry,
} from "./BeltVisualGeometry"

const ITEM_ICON_TEXTURE_PREFIX = "item-icon-"
const BOX_ICON_SIZE_RATIO = 0.72
const BOX_STROKE_WIDTH_PX = 1
const BOX_TURN_CLEARANCE_PX = 2
const CLIP_MASK_PADDING_CELLS = 2

interface BeltCargoRenderEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
  readonly itemId: string;
  readonly clipRect: BeltCargoClipRect | null;
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

interface BeltCargoView {
  readonly root: Container;
  readonly mask: Graphics;
  readonly boxGraphics: Graphics;
  readonly icon: Sprite;
}

interface BeltCargoClipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function createBeltCargoDecoration(): DecorationLayer {
  const container = new Container()
  const cargoLayer = new Container()
  const cargoViews: BeltCargoView[] = []
  const resolvedTextures = new Map<string, Texture>()
  const pendingTextures = new Map<string, Promise<Texture>>()
  container.addChild(cargoLayer)

  let destroyed = false
  let itemIconIdByItemId: Map<string, string> | null = null

  const hideAll = (): void => {
    container.visible = false

    for (const view of cargoViews) {
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

  const ensureCargoView = (index: number): BeltCargoView => {
    let view = cargoViews[index]
    if (view !== undefined) {
      return view
    }

    const root = new Container()
    const mask = new Graphics({ roundPixels: true })
    const box = new Graphics({ roundPixels: true })
    const icon = new Sprite(Texture.EMPTY)
    icon.anchor.set(0.5)
    icon.roundPixels = true

    root.addChild(mask)
    root.addChild(box)
    root.addChild(icon)
    cargoLayer.addChild(root)

    view = {
      root,
      mask,
      boxGraphics: box,
      icon,
    }
    cargoViews.push(view)
    return view
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return
      }

      if (ctx.workspace.simulation?.state.runningState === "stop") {
        hideAll()
        return
      }

      const beltCargoEntries = resolveBeltCargoEntries(ctx)
      if (beltCargoEntries.length === 0) {
        hideAll()
        return
      }

      const itemIconMap = ensureItemIconMap(ctx)
      const boxSize = resolveBeltCargoBoxSize(ctx.viewportState.gridCellPixelSize)
      const boxHalfSize = boxSize / 2
      const portExtensionEntries = resolveBeltPortExtensionEntries(ctx)
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
          clipRect: resolveBeltCargoClipRect({
            ctx,
            entry: beltCargoEntry,
            center,
            angleRadians: beltCargoEntry.angleRadians,
            portExtensionEntries,
          }),
        })
      }

      if (entries.length === 0) {
        hideAll()
        return
      }

      container.visible = true
      syncBeltCargoViews({
        entries,
        boxSize,
        ensureCargoView,
        cargoViews,
        itemIconMap,
        resolvedTextures,
      })
    },

    destroy(): void {
      destroyed = true
      pendingTextures.clear()
      resolvedTextures.clear()

      for (const view of cargoViews) {
        view.root.destroy({ children: true })
      }

      cargoViews.length = 0
      cargoLayer.destroy({ children: true })
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

export function resolveBeltCargoBoxSize(gridCellSize: number): number {
  const maxTurnSafeSize = gridCellSize / Math.SQRT2

  return Math.max(1, Math.floor(maxTurnSafeSize - BOX_TURN_CLEARANCE_PX))
}

function resolveBeltCargoClipRect(options: {
  ctx: DecorationSyncContext;
  entry: BeltCargoEntry;
  center: GridFloatPoint;
  angleRadians: number;
  portExtensionEntries: readonly BeltPortExtensionEntry[];
}): BeltCargoClipRect | null {
  const extensions = options.portExtensionEntries.filter((extension) =>
    extension.beltEntityId === options.entry.entityId,
  )
  if (extensions.length === 0) {
    return null
  }

  const gridCellSize = options.ctx.viewportState.gridCellPixelSize
  const insertionLength = gridCellSize * BELT_INSERTION_DEPTH_CELLS
  const maskPadding = gridCellSize * CLIP_MASK_PADDING_CELLS
  let minX = -maskPadding
  let maxX = maskPadding

  for (const extension of extensions) {
    const boundary = resolveViewportPoint({
      point: extension.boundary,
      viewportBounds: options.ctx.viewportBounds,
      viewportState: options.ctx.viewportState,
    })
    const boundaryLocalX = resolveLocalX({
      point: boundary,
      origin: options.center,
      angleRadians: options.angleRadians,
    })

    if (extension.kind === "device-output-to-belt") {
      minX = Math.max(minX, boundaryLocalX - insertionLength)
    } else {
      maxX = Math.min(maxX, boundaryLocalX + insertionLength)
    }
  }

  if (maxX <= minX) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  }

  return {
    x: minX,
    y: -maskPadding,
    width: maxX - minX,
    height: maskPadding * 2,
  }
}

function syncBeltCargoViews(options: {
  entries: readonly BeltCargoRenderEntry[];
  boxSize: number;
  ensureCargoView: (index: number) => BeltCargoView;
  cargoViews: readonly BeltCargoView[];
  itemIconMap: ReadonlyMap<string, string>;
  resolvedTextures: ReadonlyMap<string, Texture>;
}): void {
  const iconSize = options.boxSize * BOX_ICON_SIZE_RATIO
  let visibleCount = 0

  for (const entry of options.entries) {
    const view = options.ensureCargoView(visibleCount)
    const texture = options.resolvedTextures.get(
      resolveItemIconTextureKey(entry.itemId, options.itemIconMap),
    )

    view.root.visible = true
    view.root.x = entry.centerX
    view.root.y = entry.centerY
    view.root.rotation = entry.angleRadians

    if (entry.clipRect === null) {
      view.root.mask = null
      view.mask.visible = false
      view.mask.clear()
    } else {
      view.root.mask = view.mask
      view.mask.visible = true
      view.mask
        .clear()
        .rect(
          entry.clipRect.x,
          entry.clipRect.y,
          entry.clipRect.width,
          entry.clipRect.height,
        )
        .fill(0xffffff)
    }

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

    view.icon.visible = texture !== undefined
    view.icon.texture = texture ?? Texture.EMPTY
    view.icon.width = iconSize
    view.icon.height = iconSize
    view.icon.x = 0
    view.icon.y = 0
    view.icon.rotation = 0

    visibleCount += 1
  }

  for (let index = visibleCount; index < options.cargoViews.length; index += 1) {
    const view = options.cargoViews[index]
    if (view !== undefined) {
      view.root.visible = false
      view.root.mask = null
      view.mask.clear()
    }
  }
}

function resolveLocalX(options: {
  point: GridFloatPoint;
  origin: GridFloatPoint;
  angleRadians: number;
}): number {
  const dx = options.point.x - options.origin.x
  const dy = options.point.y - options.origin.y

  return dx * Math.cos(options.angleRadians) + dy * Math.sin(options.angleRadians)
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
