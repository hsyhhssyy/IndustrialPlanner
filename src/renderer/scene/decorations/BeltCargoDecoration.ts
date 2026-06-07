import type {
  GridFloatPoint,
  GridPoint,
} from "@/domain/shared/grid"
import type { SimulationDeviceRuntimeChannelRecipeStatus, SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types"
import {
  resolveDisplayRotationRadians,
  resolveViewportPointFromWorldPoint,
  resolveViewportRectFromWorldGridRect,
} from "@/shared/geometry/viewport-transform"
import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import {
  createEntityDefinitionMap,
  isStrictBeltDefinitionId,
  resolveBeltPortConnectivityEntries,
  resolveBeltPathSample,
  resolveViewportPoint,
  resolveVisibleWorldRect,
  isWorldEntityVisible,
  type BeltDisconnectedPortEntry,
  type BeltPortExtensionEntry,
} from "./BeltVisualGeometry"

const ITEM_ICON_TEXTURE_PREFIX = "item-icon-"
const BOX_ICON_SIZE_RATIO = 0.72
const ITEM_ICON_TEXTURE_INSET_PX = 2
const BOX_CORNER_RADIUS_RATIO = 0.1
const BOX_STROKE_WIDTH_PX = 1
const BOX_TURN_CLEARANCE_PX = 2
const EMPTY_BELT_PORT_EXTENSION_ENTRIES: readonly BeltPortExtensionEntry[] = []
const EMPTY_BELT_DISCONNECTED_PORT_ENTRIES: readonly BeltDisconnectedPortEntry[] = []

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

  // 缓存：文档稳定数据
  let cachedDocumentSnapshot: unknown = null
  let cachedDefinitionMap: Map<string, EntityDefinition> | null = null
  // 端口连通性 — 文档变更或 gameUseSimplifiedDeviceIcons 变更时失效
  let cachedPortConnectivity: ReturnType<typeof resolveBeltPortConnectivityEntries> | null = null
  let cachedSimplifiedDeviceIcons: boolean | null = null
  // beltRects — 文档变更或视口变更时失效
  let cachedBeltRects: BeltCargoClipRect[] | null = null
  let cachedBeltRectsViewportKey: string | null = null

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
    if (resolvedTextures.has(textureKey) || pendingTextures.has(textureKey)) {
      return
    }

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

      // --- 缓存管理 ---
      const editor = ctx.renderHost.workspace.editor
      const documentSnapshot = editor?.document?.getSnapshot() ?? null
      // 文档版本不变时缓存命中；snapshot 不可用时始终失效（如测试 mock 缺少 document）
      const documentStable = documentSnapshot !== null && cachedDocumentSnapshot === documentSnapshot
      const simplifiedDeviceIcons = ctx.renderHost.workspace.app?.state?.settings?.gameUseSimplifiedDeviceIcons === true

      // 定义映射（会话级稳定，只算一次）
      if (cachedDefinitionMap === null) {
        cachedDefinitionMap = createEntityDefinitionMap(ctx)
      }
      const definitionMap = cachedDefinitionMap

      // 视口签名：用于判断 beltRects 是否需要重算
      const vs = ctx.viewportState
      const vb = ctx.viewportBounds
      const viewportKey = `${vs.centerX},${vs.centerY},${vs.gridCellPixelSize},${vs.displayRotation},${vb.left},${vb.top},${vb.width},${vb.height}`

      // beltRects 缓存：文档或视口变更时重算
      if (cachedBeltRects === null || !documentStable || cachedBeltRectsViewportKey !== viewportKey) {
        cachedBeltRects = resolveBeltCargoClipBeltRects(ctx, vs.gridCellPixelSize, definitionMap)
        cachedBeltRectsViewportKey = viewportKey
      }
      const beltRects = cachedBeltRects

      // 端口连通性缓存：文档或 gameUseSimplifiedDeviceIcons 变更时重算
      if (cachedPortConnectivity === null || !documentStable || cachedSimplifiedDeviceIcons !== simplifiedDeviceIcons) {
        cachedPortConnectivity = resolveBeltPortConnectivityEntries(ctx)
        cachedSimplifiedDeviceIcons = simplifiedDeviceIcons
      }
      const portConnectivityEntries = cachedPortConnectivity

      // 更新文档版本标记（仅当 snapshot 可用时）
      if (documentSnapshot !== null) {
        cachedDocumentSnapshot = documentSnapshot
      }

      // --- 货物条目收集 ---
      const beltCargoEntries = resolveBeltCargoEntries(ctx, definitionMap)
      if (beltCargoEntries.length === 0) {
        hideAll()
        return
      }

      const itemIconMap = ensureItemIconMap(ctx)
      const boxSize = resolveBeltCargoBoxSize(ctx.viewportState.gridCellPixelSize)
      const boxHalfSize = boxSize / 2
      const portExtensionEntriesByBeltId = groupBeltPortEntriesByBeltId(portConnectivityEntries.extensions)
      const disconnectedPortEntriesByBeltId = groupBeltPortEntriesByBeltId(portConnectivityEntries.disconnectedPorts)
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
          angleRadians: beltCargoEntry.angleRadians
            + resolveDisplayRotationRadians(ctx.viewportState.displayRotation),
          itemId: beltCargoEntry.itemId,
          clipMask: resolveBeltCargoClipMask({
            ctx,
            boxHalfSize,
            disconnectedPortEntries: disconnectedPortEntriesByBeltId.get(beltCargoEntry.entityId)
              ?? EMPTY_BELT_DISCONNECTED_PORT_ENTRIES,
            portExtensionEntries: portExtensionEntriesByBeltId.get(beltCargoEntry.entityId)
              ?? EMPTY_BELT_PORT_EXTENSION_ENTRIES,
            beltRects,
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

function resolveBeltCargoEntries(
  ctx: DecorationSyncContext,
  definitionMap: ReadonlyMap<string, EntityDefinition>,
): BeltCargoEntry[] {
  const simulation = ctx.renderHost.workspace.simulation
  const editor = ctx.renderHost.workspace.editor
  if (simulation === null || editor === null || simulation.state.runningState === "stop") {
    return []
  }

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

// AI-CORRECTION 2026-05-30: recipeId/progressSeconds/desiredSeconds 已从 readmodel 删除，
//   改为读取第一个 channel 的状态。没有 channel 时返回 null。
function getFirstChannelStatus(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): SimulationDeviceRuntimeChannelRecipeStatus | null {
  if (runtimeStatus === null) return null;
  const channelRecipes = runtimeStatus.channelRecipes;
  if (channelRecipes === undefined || channelRecipes === null) return null;
  const keys = Object.keys(channelRecipes);
  if (keys.length === 0) return null;
  return channelRecipes[keys[0]!] ?? null;
}

function resolveRunningCargoItemId(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): string | null {
  // AI-CORRECTION 2026-05-30: recipeId 已从 readmodel 删除，改为读取第一个 channel。
  if (runtimeStatus === null) return null;
  const firstChannelStatus = getFirstChannelStatus(runtimeStatus);
  if (firstChannelStatus === null || firstChannelStatus.recipeId === null) {
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
  // AI-CORRECTION 2026-05-30: progressSeconds/desiredSeconds 已从 readmodel 删除，
  //   改为读取第一个 channel。
  const firstChannelStatus = getFirstChannelStatus(runtimeStatus);
  if (
    firstChannelStatus === null
    || firstChannelStatus.progressSeconds === null
    || firstChannelStatus.desiredSeconds === null
  ) {
    return null
  }

  if (firstChannelStatus.desiredSeconds <= 0) {
    return null
  }

  const progress = firstChannelStatus.progressSeconds / firstChannelStatus.desiredSeconds
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
  boxHalfSize: number;
  disconnectedPortEntries: readonly BeltDisconnectedPortEntry[];
  portExtensionEntries: readonly BeltPortExtensionEntry[];
  beltRects: readonly BeltCargoClipRect[];
}): BeltCargoClipMask | null {
  const extensions = options.portExtensionEntries
  const hasAnyPortShape = extensions.length > 0 || options.disconnectedPortEntries.length > 0

  // 无伸出段也无断开端口 → 只有 beltRects 裁剪（传送带→junction 场景）
  if (!hasAnyPortShape) {
    if (options.beltRects.length === 0) return null
    return { beltRects: options.beltRects, extensions: [] }
  }

  const _gridCellSize = options.ctx.viewportState.gridCellPixelSize
  return {
    beltRects: options.beltRects,
    extensions: [
      ...extensions.map((extension) =>
        resolveBeltCargoClipExtensionRect({
          ctx: options.ctx,
          extension,
        }),
      ),
      ...options.disconnectedPortEntries
        .map((port) => resolveBeltCargoClipDisconnectedPortRect({
          ctx: options.ctx,
          port,
          capLength: options.boxHalfSize + BOX_STROKE_WIDTH_PX,
        })),
    ],
  }
}

function groupBeltPortEntriesByBeltId<T extends { readonly beltEntityId: string }>(
  entries: readonly T[],
): Map<string, T[]> {
  const entriesByBeltId = new Map<string, T[]>()
  for (const entry of entries) {
    const existing = entriesByBeltId.get(entry.beltEntityId)
    if (existing === undefined) {
      entriesByBeltId.set(entry.beltEntityId, [entry])
    } else {
      existing.push(entry)
    }
  }

  return entriesByBeltId
}

function resolveBeltCargoClipDisconnectedPortRect(options: {
  ctx: DecorationSyncContext;
  port: BeltDisconnectedPortEntry;
  capLength: number;
}): BeltCargoClipExtensionRect {
  const gridCellSize = options.ctx.viewportState.gridCellPixelSize
  const boundary = resolveViewportPoint({
    point: options.port.boundary,
    viewportBounds: options.ctx.viewportBounds,
    viewportState: options.ctx.viewportState,
  })
  const angleRadians = options.port.angleRadians
    + resolveDisplayRotationRadians(options.ctx.viewportState.displayRotation)
  const direction = {
    x: Math.cos(angleRadians),
    y: Math.sin(angleRadians),
  }
  const midpoint = options.port.kind === "input"
    ? -options.capLength / 2
    : options.capLength / 2

  return {
    center: {
      x: boundary.x + direction.x * midpoint,
      y: boundary.y + direction.y * midpoint,
    },
    angleRadians,
    length: options.capLength,
    width: gridCellSize,
  }
}

function resolveBeltCargoClipBeltRects(
  ctx: DecorationSyncContext,
  gridCellSize: number,
  definitionMap: ReadonlyMap<string, EntityDefinition>,
): BeltCargoClipRect[] {
  const editor = ctx.renderHost.workspace.editor
  if (editor === null) {
    return []
  }

  const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
  return editor.queries.listEntities()
    .filter((entity) => {
      if (!isStrictBeltDefinitionId(entity.definitionId)) {
        return false
      }
      const definition = definitionMap.get(entity.definitionId)
      return definition !== undefined && isWorldEntityVisible(entity, definition.footprint, visibleRect)
    })
    .flatMap((entity) => {
      const viewportRect = resolveViewportRectFromWorldGridRect({
        gridRect: {
          x: entity.position.x,
          y: entity.position.y,
          width: 1,
          height: 1,
        },
        viewportBounds: ctx.viewportBounds,
        viewportCenter: {
          x: ctx.viewportState.centerX,
          y: ctx.viewportState.centerY,
        },
        gridCellPixelSize: gridCellSize,
        displayRotation: ctx.viewportState.displayRotation,
      })

      if (viewportRect === null) {
        return []
      }

      return [{
        x: viewportRect.left,
        y: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      }]
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
  const angleRadians = options.extension.angleRadians
    + resolveDisplayRotationRadians(options.ctx.viewportState.displayRotation)
  const direction = {
    x: Math.cos(angleRadians),
    y: Math.sin(angleRadians),
  }

  return {
    center: {
      x: boundary.x + direction.x * midpointCells * gridCellSize,
      y: boundary.y + direction.y * midpointCells * gridCellSize,
    },
    angleRadians,
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
    displayRotation: DecorationSyncContext["viewportState"]["displayRotation"];
  };
}): GridFloatPoint {
  return resolveViewportPointFromWorldPoint({
    worldPoint: {
      x: options.entry.position.x + options.entry.localPoint.x,
      y: options.entry.position.y + options.entry.localPoint.y,
    },
    viewportBounds: options.viewportBounds,
    viewportCenter: {
      x: options.viewportState.centerX,
      y: options.viewportState.centerY,
    },
    gridCellPixelSize: options.viewportState.gridCellPixelSize,
    displayRotation: options.viewportState.displayRotation,
  })
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
