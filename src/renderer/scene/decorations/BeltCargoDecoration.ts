import type {
  GridFloatPoint,
  GridPoint,
} from "@/domain/shared/grid"
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types"
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  createEntityDefinitionMap,
  isStrictBeltDefinitionId,
  resolveBeltPortExtensionEntries,
  resolveBeltPathSample,
  resolveViewportPoint,
  resolveVisibleWorldRect,
  isWorldEntityVisible,
  type BeltPortExtensionEntry,
} from "./BeltVisualGeometry"

const ITEM_ICON_TEXTURE_PREFIX = "item-icon-"
const BOX_ICON_SIZE_RATIO = 0.72
const ITEM_ICON_TEXTURE_INSET_PX = 2
const BOX_CORNER_RADIUS_RATIO = 0.1
const BOX_STROKE_WIDTH_PX = 1
const BOX_TURN_CLEARANCE_PX = 2

interface BeltCargoRenderEntry {
  readonly centerX: number;
  readonly centerY: number;
  readonly angleRadians: number;
  readonly itemId: string;
  readonly clipMask: BeltCargoClipMask | null;
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
  readonly cargoRoot: Container;
  readonly boxGraphics: Graphics;
  readonly icon: Sprite;
}

interface BeltCargoClipMask {
  readonly beltRects: readonly BeltCargoClipRect[];
  readonly extensions: readonly BeltCargoClipExtensionRect[];
}

interface BeltCargoClipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface BeltCargoClipExtensionRect {
  readonly center: GridFloatPoint;
  readonly angleRadians: number;
  readonly length: number;
  readonly width: number;
}

export function createBeltCargoDecoration(): DecorationLayer {
  const container = new Container()
  const cargoLayer = new Container()
  const cargoViews: BeltCargoView[] = []
  const resolvedTextures = new Map<string, Texture>()
  const insetTextures = new Map<string, Texture>()
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
      ctx.renderHost.workspace.registry.itemDefinitions.map((item) => [item.id, item.iconId]),
    )
    return itemIconIdByItemId
  }

  const ensureTexture = (ctx: DecorationSyncContext, textureKey: string): void => {
    const promise = ctx.renderHost.textureManager.getTexture(textureKey)
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
    const cargoRoot = new Container()
    const box = new Graphics({ roundPixels: true })
    const icon = new Sprite(Texture.EMPTY)
    icon.anchor.set(0.5)
    icon.roundPixels = true

    cargoRoot.addChild(box)
    cargoRoot.addChild(icon)
    root.addChild(mask)
    root.addChild(cargoRoot)
    cargoLayer.addChild(root)

    view = {
      root,
      mask,
      cargoRoot,
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

      if (ctx.renderHost.workspace.simulation?.state.runningState === "stop") {
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
          clipMask: resolveBeltCargoClipMask({
            ctx,
            entry: beltCargoEntry,
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
        insetTextures,
        itemIconMap,
        resolvedTextures,
      })
    },

    destroy(): void {
      destroyed = true
      pendingTextures.clear()
      resolvedTextures.clear()
      for (const texture of insetTextures.values()) {
        texture.destroy()
      }
      insetTextures.clear()

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
  const simulation = ctx.renderHost.workspace.simulation
  const editor = ctx.renderHost.workspace.editor
  if (simulation === null || editor === null || simulation.state.runningState === "stop") {
    return []
  }

  const definitionMap = createEntityDefinitionMap(ctx)
  const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
  const entries: BeltCargoEntry[] = []
  for (const entity of editor.queries.listEntities()) {
    const definition = definitionMap.get(entity.definitionId)
    if (definition === undefined) {
      continue
    }

    // 只收集可见 belt 上的货物
    if (!isWorldEntityVisible(entity, definition.footprint, visibleRect)) {
      continue
    }

    // 非传送带实体不可能有货物动画，跳过昂贵的 getDeviceRuntimeStatus 调用
    if (!isStrictBeltDefinitionId(entity.definitionId)) {
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
    slotItem.viewRole === "input-view"
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
    slotItem.viewRole === "output-view"
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
    progress: fallbackSlot.viewRole === "output-view" ? 1 : 0,
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
  const maxTurnEndpointNonOverlapSize = gridCellSize * 0.5

  return Math.max(1, Math.floor(maxTurnEndpointNonOverlapSize - BOX_TURN_CLEARANCE_PX))
}

function resolveBeltCargoClipMask(options: {
  ctx: DecorationSyncContext;
  entry: BeltCargoEntry;
  portExtensionEntries: readonly BeltPortExtensionEntry[];
}): BeltCargoClipMask | null {
  const extensions = options.portExtensionEntries.filter((extension) =>
    extension.beltEntityId === options.entry.entityId,
  )
  if (extensions.length === 0) {
    return null
  }

  const gridCellSize = options.ctx.viewportState.gridCellPixelSize
  return {
    beltRects: resolveBeltCargoClipBeltRects(options.ctx, gridCellSize),
    extensions: extensions.map((extension) =>
      resolveBeltCargoClipExtensionRect({
        ctx: options.ctx,
        extension,
      }),
    ),
  }
}

function resolveBeltCargoClipBeltRects(
  ctx: DecorationSyncContext,
  gridCellSize: number,
): BeltCargoClipRect[] {
  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return []
  }

  const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
  const definitionMap = createEntityDefinitionMap(ctx)
  return editor.queries.listEntities()
    .filter((entity) => {
      if (!isStrictBeltDefinitionId(entity.definitionId)) {
        return false
      }
      const definition = definitionMap.get(entity.definitionId)
      return definition !== undefined && isWorldEntityVisible(entity, definition.footprint, visibleRect)
    })
    .map((entity) => {
      const cellTopLeft = resolveViewportPoint({
        point: entity.position,
        viewportBounds: ctx.viewportBounds,
        viewportState: ctx.viewportState,
      })

      return {
        x: cellTopLeft.x,
        y: cellTopLeft.y,
        width: gridCellSize,
        height: gridCellSize,
      }
    })
}

function resolveBeltCargoClipExtensionRect(options: {
  ctx: DecorationSyncContext;
  extension: BeltPortExtensionEntry;
}): BeltCargoClipExtensionRect {
  const gridCellSize = options.ctx.viewportState.gridCellPixelSize
  const boundary = resolveViewportPoint({
    point: options.extension.boundary,
    viewportBounds: options.ctx.viewportBounds,
    viewportState: options.ctx.viewportState,
  })
  const midpointCells = (options.extension.localStartCells + options.extension.localEndCells) / 2
  const direction = {
    x: Math.cos(options.extension.angleRadians),
    y: Math.sin(options.extension.angleRadians),
  }

  return {
    center: {
      x: boundary.x + direction.x * midpointCells * gridCellSize,
      y: boundary.y + direction.y * midpointCells * gridCellSize,
    },
    angleRadians: options.extension.angleRadians,
    length: (options.extension.localEndCells - options.extension.localStartCells) * gridCellSize,
    width: gridCellSize,
  }
}

function syncBeltCargoViews(options: {
  entries: readonly BeltCargoRenderEntry[];
  boxSize: number;
  ensureCargoView: (index: number) => BeltCargoView;
  cargoViews: readonly BeltCargoView[];
  insetTextures: Map<string, Texture>;
  itemIconMap: ReadonlyMap<string, string>;
  resolvedTextures: ReadonlyMap<string, Texture>;
}): void {
  const iconSize = options.boxSize * BOX_ICON_SIZE_RATIO
  const boxCornerRadius = options.boxSize * BOX_CORNER_RADIUS_RATIO
  let visibleCount = 0

  for (const entry of options.entries) {
    const view = options.ensureCargoView(visibleCount)
    const textureKey = resolveItemIconTextureKey(entry.itemId, options.itemIconMap)
    const texture = resolveInsetItemIconTexture({
      textureKey,
      resolvedTextures: options.resolvedTextures,
      insetTextures: options.insetTextures,
    })

    view.root.visible = true
    view.root.x = 0
    view.root.y = 0
    view.root.rotation = 0

    if (entry.clipMask === null) {
      view.root.mask = null
      view.mask.visible = false
      view.mask.clear()
    } else {
      view.root.mask = view.mask
      view.mask.visible = true
      drawBeltCargoClipMask(view.mask, entry.clipMask)
    }

    view.cargoRoot.x = entry.centerX
    view.cargoRoot.y = entry.centerY
    view.cargoRoot.rotation = entry.angleRadians

    view.boxGraphics
      .clear()
      .roundRect(
        -options.boxSize / 2,
        -options.boxSize / 2,
        options.boxSize,
        options.boxSize,
        boxCornerRadius,
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

function resolveInsetItemIconTexture(options: {
  textureKey: string;
  resolvedTextures: ReadonlyMap<string, Texture>;
  insetTextures: Map<string, Texture>;
}): Texture | undefined {
  const texture = options.resolvedTextures.get(options.textureKey)
  if (texture === undefined || ITEM_ICON_TEXTURE_INSET_PX <= 0) {
    return texture
  }

  const existing = options.insetTextures.get(options.textureKey)
  if (existing !== undefined) {
    return existing
  }

  const insetTexture = createInsetTexture(texture, ITEM_ICON_TEXTURE_INSET_PX)
  if (insetTexture !== texture) {
    options.insetTextures.set(options.textureKey, insetTexture)
  }

  return insetTexture
}

function createInsetTexture(texture: Texture, insetPx: number): Texture {
  const frame = texture.frame
  if (
    frame === undefined
    || !Number.isFinite(frame.width)
    || !Number.isFinite(frame.height)
  ) {
    return texture
  }

  const maxHorizontalInset = Math.max(0, Math.floor((frame.width - 1) / 2))
  const maxVerticalInset = Math.max(0, Math.floor((frame.height - 1) / 2))
  const safeInset = Math.min(insetPx, maxHorizontalInset, maxVerticalInset)
  if (safeInset <= 0) {
    return texture
  }

  const width = frame.width - safeInset * 2
  const height = frame.height - safeInset * 2

  return new Texture({
    source: texture.source,
    label: texture.label,
    frame: new Rectangle(
      frame.x + safeInset,
      frame.y + safeInset,
      width,
      height,
    ),
    orig: new Rectangle(0, 0, width, height),
    defaultAnchor: texture.defaultAnchor,
    defaultBorders: texture.defaultBorders,
    rotate: texture.rotate,
  })
}

function drawBeltCargoClipMask(graphics: Graphics, mask: BeltCargoClipMask): void {
  graphics.clear()

  for (const beltRect of mask.beltRects) {
    graphics
      .rect(
        beltRect.x,
        beltRect.y,
        beltRect.width,
        beltRect.height,
      )
      .fill(0xffffff)
  }

  for (const extension of mask.extensions) {
    graphics
      .poly(resolveRotatedRectanglePoints({
        center: extension.center,
        angleRadians: extension.angleRadians,
        length: extension.length,
        width: extension.width,
      }), true)
      .fill(0xffffff)
  }
}

function resolveRotatedRectanglePoints(options: {
  center: GridFloatPoint;
  angleRadians: number;
  length: number;
  width: number;
}): number[] {
  const cos = Math.cos(options.angleRadians)
  const sin = Math.sin(options.angleRadians)
  const halfLength = options.length / 2
  const halfWidth = options.width / 2
  const localPoints = [
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth },
  ]
  const points: number[] = []

  for (const point of localPoints) {
    points.push(
      options.center.x + point.x * cos - point.y * sin,
      options.center.y + point.x * sin + point.y * cos,
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
