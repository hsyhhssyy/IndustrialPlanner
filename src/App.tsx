import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { BASE_BY_ID, BASES, DEVICE_TYPE_BY_ID, ITEMS, PLACEABLE_TYPES, RECIPES } from './domain/registry'
import { getDeviceSpritePath } from './domain/deviceSprites'
import { applyLogisticsPath, deleteConnectedBelts, longestValidLogisticsPrefix, nextId, pathFromTrace } from './domain/logistics'
import {
  buildOccupancyMap,
  cellToDeviceId,
  EDGE_ANGLE,
  getDeviceById,
  getFootprintCells,
  getRotatedPorts,
  includesCell,
  isWithinLot,
  linksFromLayout,
  OPPOSITE_EDGE,
} from './domain/geometry'
import { validatePlacementConstraints } from './domain/placement'
import type {
  BaseId,
  DeviceInstance,
  DeviceRuntime,
  DeviceTypeId,
  Edge,
  EditMode,
  ItemId,
  LayoutState,
  PreloadInputConfigEntry,
  Rotation,
  SimState,
  SlotData,
} from './domain/types'
import { usePersistentState } from './hooks/usePersistentState'
import { createTranslator, getDeviceLabel, getItemLabel, getModeLabel, LANGUAGE_OPTIONS, type Language } from './i18n'
import { dialogAlertNonBlocking, dialogConfirm, dialogPrompt } from './ui/dialog'
import { showToast } from './ui/toast'
import { WikiPanel } from './ui/wikiPanel.tsx'
import {
  createInitialSimState,
  initialStorageConfig,
  runtimeLabel,
  startSimulation,
  stopSimulation,
  tickSimulation,
} from './sim/engine'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getInternalStatusText(
  selectedDevice: DeviceInstance,
  runtime: DeviceRuntime | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!runtime) return t('detail.internal.noRuntime')

  if (!selectedDevice.typeId.startsWith('belt_') || !('slot' in runtime)) {
    return getRuntimeStatusText(runtime, t)
  }

  const slot = runtime.slot
  if (!slot) return t('detail.internal.canAccept')
  if (slot.progress01 < 0.5) return t('detail.internal.occupiedHalf', { progress: slot.progress01.toFixed(2) })
  if (slot.progress01 < 1) return t('detail.internal.canTry', { progress: slot.progress01.toFixed(2) })
  return t('detail.internal.readyCommit', { progress: slot.progress01.toFixed(2) })
}

function getRuntimeStatusText(
  runtime: DeviceRuntime | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const status = runtimeLabel(runtime)
  const keyByStatus: Record<string, string> = {
    idle: 'detail.status.idle',
    running: 'detail.status.running',
    starved: 'detail.status.starved',
    no_power: 'detail.status.noPower',
    overlap: 'detail.status.overlap',
    output_buffer_full: 'detail.status.outputBlocked',
    downstream_blocked: 'detail.status.outputBlocked',
    config_error: 'detail.status.configError',
  }
  const key = keyByStatus[status]
  if (key) return t(key)
  return status
}

function shouldShowRuntimeStallOverlay(device: DeviceInstance, runtime: DeviceRuntime | undefined) {
  const status = runtimeLabel(runtime)
  if (status === 'running' || status === 'idle') return false
  if (!runtime) return false
  if (
    device.typeId.startsWith('belt_') &&
    (runtime.stallReason === 'DOWNSTREAM_BLOCKED' || runtime.stallReason === 'OUTPUT_BUFFER_FULL')
  ) {
    return false
  }
  if (runtime.stallReason === 'DOWNSTREAM_BLOCKED' && ('outputBuffer' in runtime || 'inventory' in runtime)) {
    return false
  }
  return true
}

function formatInventoryAmounts(
  language: Language,
  amounts: Partial<Record<ItemId, number>>,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const entries = ITEMS.map((item) => ({ itemId: item.id, amount: Math.max(0, amounts[item.id] ?? 0) })).filter(
    (entry) => entry.amount > 0,
  )
  if (entries.length === 0) return t('detail.empty')
  return entries.map((entry) => `${getItemLabel(language, entry.itemId)}: ${entry.amount}`).join(', ')
}

function processorBufferSpec(typeId: DeviceTypeId) {
  const deviceType = DEVICE_TYPE_BY_ID[typeId]
  const inputSlotCapacitiesRaw = (deviceType.inputBufferSlotCapacities ?? []).map((value) => Math.max(1, Math.floor(value)))
  const outputSlotCapacitiesRaw = (deviceType.outputBufferSlotCapacities ?? []).map((value) => Math.max(1, Math.floor(value)))
  const fallbackInputCapacity = Math.max(1, Math.floor(deviceType.inputBufferCapacity ?? 50))
  const fallbackOutputCapacity = Math.max(1, Math.floor(deviceType.outputBufferCapacity ?? 50))
  const inputSlots = Math.max(1, Math.floor(deviceType.inputBufferSlots ?? 1), inputSlotCapacitiesRaw.length)
  const outputSlots = Math.max(1, Math.floor(deviceType.outputBufferSlots ?? 1), outputSlotCapacitiesRaw.length)
  const inputSlotCapacities = Array.from({ length: inputSlots }, (_, index) => inputSlotCapacitiesRaw[index] ?? fallbackInputCapacity)
  const outputSlotCapacities = Array.from({ length: outputSlots }, (_, index) => outputSlotCapacitiesRaw[index] ?? fallbackOutputCapacity)
  return {
    inputSlots,
    outputSlots,
    inputSlotCapacities,
    outputSlotCapacities,
    inputTotalCapacity: inputSlotCapacities.reduce((sum, cap) => sum + cap, 0),
    outputTotalCapacity: outputSlotCapacities.reduce((sum, cap) => sum + cap, 0),
  }
}

type ProcessorPreloadSlot = { itemId: ItemId | null; amount: number }

type ItemPickerState =
  | { kind: 'pickup'; deviceInstanceId: string }
  | { kind: 'preload'; deviceInstanceId: string; slotIndex: number }

type BlueprintDeviceSnapshot = {
  typeId: DeviceTypeId
  rotation: Rotation
  origin: { x: number; y: number }
  config: DeviceInstance['config']
}

type BlueprintSnapshot = {
  id: string
  name: string
  createdAt: string
  baseId: BaseId
  devices: BlueprintDeviceSnapshot[]
}

type BlueprintPlacementPreview = {
  devices: DeviceInstance[]
  isValid: boolean
  invalidMessageKey: string | null
}

type BlueprintLocalRect = {
  typeId: DeviceTypeId
  rotation: Rotation
  config: DeviceInstance['config']
  x: number
  y: number
  width: number
  height: number
}

function buildProcessorPreloadSlots(device: DeviceInstance, slotCapacities: number[]): ProcessorPreloadSlot[] {
  const slotCount = slotCapacities.length
  const slots = Array.from({ length: slotCount }, () => ({ itemId: null, amount: 0 }) as ProcessorPreloadSlot)
  const preloadInputs = device.config.preloadInputs
  if (Array.isArray(preloadInputs) && preloadInputs.length > 0) {
    for (const entry of preloadInputs) {
      if (!entry || typeof entry.slotIndex !== 'number') continue
      const slotIndex = Math.floor(entry.slotIndex)
      if (slotIndex < 0 || slotIndex >= slots.length) continue
      slots[slotIndex] = {
        itemId: entry.itemId,
        amount: clamp(Math.floor(entry.amount ?? 0), 0, slotCapacities[slotIndex] ?? 50),
      }
    }
    return slots
  }

  if (device.config.preloadInputItemId) {
    slots[0] = {
      itemId: device.config.preloadInputItemId,
      amount: clamp(Math.floor(device.config.preloadInputAmount ?? 0), 0, slotCapacities[0] ?? 50),
    }
  }
  return slots
}

function serializeProcessorPreloadSlots(slots: ProcessorPreloadSlot[]): PreloadInputConfigEntry[] {
  return slots.flatMap((slot, slotIndex) =>
    slot.itemId
      ? [
          {
            slotIndex,
            itemId: slot.itemId,
            amount: Math.max(0, Math.floor(slot.amount)),
          },
        ]
      : [],
  )
}

function cloneDeviceConfig(config: DeviceInstance['config']): DeviceInstance['config'] {
  return JSON.parse(JSON.stringify(config ?? {})) as DeviceInstance['config']
}

function rotateBlueprintRects(rects: BlueprintLocalRect[], rotation: Rotation) {
  if (rects.length === 0) return rects

  const bounds = rects.reduce(
    (acc, rect) => ({
      minX: Math.min(acc.minX, rect.x),
      minY: Math.min(acc.minY, rect.y),
      maxX: Math.max(acc.maxX, rect.x + rect.width),
      maxY: Math.max(acc.maxY, rect.y + rect.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )

  const normalized = rects.map((rect) => ({
    ...rect,
    x: rect.x - bounds.minX,
    y: rect.y - bounds.minY,
  }))

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  if (rotation === 0) return normalized

  if (rotation === 90) {
    return normalized.map((rect) => ({
      ...rect,
      x: height - (rect.y + rect.height),
      y: rect.x,
      width: rect.height,
      height: rect.width,
      rotation: ((rect.rotation + 90) % 360) as Rotation,
    }))
  }

  if (rotation === 180) {
    return normalized.map((rect) => ({
      ...rect,
      x: width - (rect.x + rect.width),
      y: height - (rect.y + rect.height),
      rotation: ((rect.rotation + 180) % 360) as Rotation,
    }))
  }

  return normalized.map((rect) => ({
    ...rect,
    x: rect.y,
    y: width - (rect.x + rect.width),
    width: rect.height,
    height: rect.width,
    rotation: ((rect.rotation + 270) % 360) as Rotation,
  }))
}

function formatInputBufferAmounts(
  language: Language,
  amounts: Partial<Record<ItemId, number>>,
  slots: number,
  capacity: number,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const entries: Array<{ itemId: ItemId; amount: number }> = []
  let total = 0
  for (const item of ITEMS) {
    const amount = Math.max(0, amounts[item.id] ?? 0)
    if (amount <= 0) continue
    total += amount
    entries.push({ itemId: item.id, amount })
  }
  if (entries.length === 0) return `${t('detail.empty')} (0/${slots}, 0/${capacity})`
  const detail = entries.map((entry) => `${getItemLabel(language, entry.itemId)}: ${entry.amount}`).join(', ')
  return `${detail} (${entries.length}/${slots}, ${total}/${capacity})`
}

function formatOutputBufferAmounts(
  language: Language,
  amounts: Partial<Record<ItemId, number>>,
  slots: number,
  capacity: number,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const entries: Array<{ itemId: ItemId; amount: number }> = []
  let total = 0
  for (const item of ITEMS) {
    const amount = Math.max(0, amounts[item.id] ?? 0)
    if (amount <= 0) continue
    total += amount
    entries.push({ itemId: item.id, amount })
  }
  if (entries.length === 0) return `${t('detail.empty')} (0/${slots}, 0/${capacity})`
  const detail = entries.map((entry) => `${getItemLabel(language, entry.itemId)}: ${entry.amount}`).join(', ')
  return `${detail} (${entries.length}/${slots}, ${total}/${capacity})`
}

function getItemIconPath(itemId: ItemId) {
  return `/itemicon/${itemId}.png`
}

function getDeviceMenuIconPath(typeId: DeviceTypeId) {
  if (typeId === 'item_log_splitter') return '/device-icons/item_log_splitter.png'
  if (typeId === 'item_log_converger') return '/device-icons/item_log_converger.png'
  if (typeId === 'item_log_connector') return '/device-icons/item_log_connector.png'
  return `/device-icons/${typeId}.png`
}

function formatSlotValue(
  slot: SlotData | null,
  language: Language,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!slot) return t('detail.empty')
  return `${getItemLabel(language, slot.itemId)} @ ${slot.progress01.toFixed(2)}`
}

function recipeForDevice(typeId: DeviceTypeId) {
  return RECIPES.find((recipe) => recipe.machineType === typeId)
}

function formatRecipeSummary(typeId: DeviceTypeId, language: Language) {
  const recipe = recipeForDevice(typeId)
  if (!recipe) return '-'
  const input = recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  const output = recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  return `${input} -> ${output}`
}

function getZoomStep(cellSize: number) {
  if (cellSize < 48) return 1
  if (cellSize < 120) return 3
  if (cellSize < 200) return 8
  if (cellSize < 260) return 16
  return 30
}

type PlaceGroupKey =
  | 'logistics'
  | 'resource'
  | 'storage'
  | 'basic_production'
  | 'advanced_manufacturing'
  | 'power'
  | 'functional'
  | 'combat_support'

const PLACE_GROUP_ORDER: PlaceGroupKey[] = [
  'logistics',
  'resource',
  'storage',
  'basic_production',
  'advanced_manufacturing',
  'power',
  'functional',
  'combat_support',
]

const PLACE_GROUP_LABEL_KEY: Record<PlaceGroupKey, string> = {
  logistics: 'left.group.logistics',
  resource: 'left.group.resource',
  storage: 'left.group.storage',
  basic_production: 'left.group.basicProduction',
  advanced_manufacturing: 'left.group.advancedManufacturing',
  power: 'left.group.power',
  functional: 'left.group.functional',
  combat_support: 'left.group.combatSupport',
}

function getPlaceGroup(typeId: DeviceTypeId): PlaceGroupKey {
  if (typeId === 'item_log_splitter' || typeId === 'item_log_converger' || typeId === 'item_log_connector') return 'logistics'
  if (typeId === 'item_port_unloader_1') return 'resource'
  if (
    typeId === 'item_port_storager_1' ||
    typeId === 'item_port_log_hongs_bus_source' ||
    typeId === 'item_port_log_hongs_bus' ||
    typeId === 'item_port_liquid_storager_1'
  )
    return 'storage'
  if (
    typeId === 'item_port_grinder_1' ||
    typeId === 'item_port_furnance_1' ||
    typeId === 'item_port_cmpt_mc_1' ||
    typeId === 'item_port_shaper_1' ||
    typeId === 'item_port_seedcol_1' ||
    typeId === 'item_port_planter_1'
  )
    return 'basic_production'
  if (
    typeId === 'item_port_winder_1' ||
    typeId === 'item_port_filling_pd_mc_1' ||
    typeId === 'item_port_tools_asm_mc_1' ||
    typeId === 'item_port_thickener_1' ||
    typeId === 'item_port_mix_pool_1' ||
    typeId === 'item_port_xiranite_oven_1' ||
    typeId === 'item_port_dismantler_1'
  )
    return 'advanced_manufacturing'
  if (typeId === 'item_port_power_diffuser_1' || typeId === 'item_port_power_sta_1') return 'power'
  return 'functional'
}

function cycleTicksFromSeconds(cycleSeconds: number, tickRateHz: number) {
  return Math.max(1, Math.round(cycleSeconds * tickRateHz))
}

const BASE_CELL_SIZE = 64
const BELT_VIEWBOX_SIZE = 64

const HIDDEN_DEVICE_LABEL_TYPES = new Set<DeviceTypeId>(['item_log_splitter', 'item_log_converger', 'item_log_connector'])
const HIDDEN_CHEVRON_DEVICE_TYPES = new Set<DeviceTypeId>(['item_log_splitter', 'item_log_converger', 'item_log_connector'])
const OUT_OF_LOT_TOAST_KEY = 'toast.outOfLot'
const FALLBACK_PLACEMENT_TOAST_KEY = 'toast.invalidPlacementFallback'
const MANUAL_LOGISTICS_JUNCTION_TYPES = new Set<DeviceTypeId>(['item_log_splitter', 'item_log_converger', 'item_log_connector'])
function isKnownDeviceTypeId(typeId: unknown): typeId is DeviceTypeId {
  return typeof typeId === 'string' && typeId in DEVICE_TYPE_BY_ID
}

function isKnownBaseId(baseId: unknown): baseId is BaseId {
  return typeof baseId === 'string' && baseId in BASE_BY_ID
}

function createLayoutForBase(baseId: BaseId): LayoutState {
  const base = BASE_BY_ID[baseId]
  return {
    baseId: base.id,
    lotSize: base.placeableSize,
    devices: base.foundationBuildings.map((building) => ({
      ...building,
      config: building.config ?? initialStorageConfig(building.typeId),
    })),
  }
}

function resolveBaseFromLayout(layout: LayoutState | (Partial<LayoutState> & { lotSize?: number })): BaseId {
  if (isKnownBaseId(layout.baseId)) return layout.baseId
  if (layout.lotSize === 40) return 'valley4_rebuilt_command'
  if (layout.lotSize === 60) return 'valley4_protocol_core'
  return 'valley4_protocol_core'
}

function normalizeLayoutForBase(rawLayout: LayoutState | undefined, baseId: BaseId): LayoutState {
  const base = BASE_BY_ID[baseId]
  const fallback = createLayoutForBase(baseId)
  if (!rawLayout) return fallback

  const foundationById = new Map(base.foundationBuildings.map((device) => [device.instanceId, device]))
  const cleanedDevices = rawLayout.devices.filter((device) => isKnownDeviceTypeId(device.typeId) && isWithinLot(device, base.placeableSize))
  const cleanedWithoutFoundation = cleanedDevices.filter((device) => !foundationById.has(device.instanceId))
  const foundationDevices = base.foundationBuildings.map((building) => {
    const existing = cleanedDevices.find((device) => device.instanceId === building.instanceId)
    if (existing) return existing
    return {
      ...building,
      config: building.config ?? initialStorageConfig(building.typeId),
    }
  })

  return {
    baseId,
    lotSize: base.placeableSize,
    devices: [...foundationDevices, ...cleanedWithoutFoundation],
  }
}

const EDGE_ANCHOR: Record<Edge, { x: number; y: number }> = {
  N: { x: 32, y: 0 },
  S: { x: 32, y: 64 },
  W: { x: 0, y: 32 },
  E: { x: 64, y: 32 },
}

function buildBeltTrackPath(inEdge: Edge, outEdge: Edge) {
  const start = EDGE_ANCHOR[inEdge]
  const end = EDGE_ANCHOR[outEdge]
  if (OPPOSITE_EDGE[inEdge] === outEdge) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} L 32 32 L ${end.x} ${end.y}`
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function getBeltItemPosition(inEdge: Edge, outEdge: Edge, progress01: number) {
  const t = clamp(progress01, 0, 1)
  const start = EDGE_ANCHOR[inEdge]
  const end = EDGE_ANCHOR[outEdge]
  if (OPPOSITE_EDGE[inEdge] === outEdge) {
    return {
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
    }
  }

  if (t < 0.5) {
    const local = t / 0.5
    return {
      x: lerp(start.x, 32, local),
      y: lerp(start.y, 32, local),
    }
  }

  const local = (t - 0.5) / 0.5
  return {
    x: lerp(32, end.x, local),
    y: lerp(32, end.y, local),
  }
}

function junctionArrowPoints(edge: Edge) {
  if (edge === 'E') return '68,44 80,50 68,56'
  if (edge === 'W') return '32,44 20,50 32,56'
  if (edge === 'N') return '44,32 50,20 56,32'
  return '44,68 50,80 56,68'
}

function rotatedFootprintSize(size: { width: number; height: number }, rotation: Rotation) {
  if (rotation === 90 || rotation === 270) {
    return { width: size.height, height: size.width }
  }
  return size
}

function getMaxCellSizeForViewport(viewport: HTMLDivElement | null) {
  if (!viewport) return 300
  return Math.max(12, Math.ceil(Math.max(viewport.clientWidth, viewport.clientHeight) / 12))
}

function clampViewportOffset(
  offset: { x: number; y: number },
  viewportSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
) {
  const x =
    canvasSize.width <= viewportSize.width
      ? (viewportSize.width - canvasSize.width) / 2
      : clamp(offset.x, viewportSize.width - canvasSize.width, 0)
  const y =
    canvasSize.height <= viewportSize.height
      ? (viewportSize.height - canvasSize.height) / 2
      : clamp(offset.y, viewportSize.height - canvasSize.height, 0)
  return { x: Math.round(x), y: Math.round(y) }
}

type StaticDeviceLayerProps = {
  devices: DeviceInstance[]
  selectionSet: ReadonlySet<string>
  invalidSelectionSet: ReadonlySet<string>
  previewOriginsById: ReadonlyMap<string, { x: number; y: number }>
  language: Language
  extraClassName?: string
  showRuntimeItemIcons?: boolean
  runtimeById?: Readonly<Record<string, DeviceRuntime>>
}

const StaticDeviceLayer = memo(
  ({
    devices,
    selectionSet,
    invalidSelectionSet,
    previewOriginsById,
    language,
    extraClassName,
    showRuntimeItemIcons = false,
    runtimeById = {},
  }: StaticDeviceLayerProps) => {
  function getRuntimeIconItemId(device: DeviceInstance): ItemId | undefined {
    if (!showRuntimeItemIcons) return undefined
    const type = DEVICE_TYPE_BY_ID[device.typeId]
    if (!type || type.runtimeKind !== 'processor') return undefined
    const runtime = runtimeById[device.instanceId]
    if (!runtime || !('outputBuffer' in runtime) || !('inputBuffer' in runtime)) return undefined

    for (const item of ITEMS) {
      if ((runtime.outputBuffer[item.id] ?? 0) > 0) return item.id
    }

    if (runtime.cycleProgressTicks > 0 && runtime.activeRecipeId) {
      const recipe = RECIPES.find((entry) => entry.id === runtime.activeRecipeId)
      if (recipe && recipe.outputs.length > 0) return recipe.outputs[0].itemId
    }

    return undefined
  }

  return (
    <>
      {devices.map((device) => {
        const previewOrigin = previewOriginsById.get(device.instanceId)
        const renderDevice = previewOrigin ? { ...device, origin: previewOrigin } : device
        const type = DEVICE_TYPE_BY_ID[device.typeId]
        if (!type) return null
        const footprintSize = rotatedFootprintSize(type.size, renderDevice.rotation)
        const surfaceContentWidthPx = footprintSize.width * BASE_CELL_SIZE - 6
        const surfaceContentHeightPx = footprintSize.height * BASE_CELL_SIZE - 6
        const isQuarterTurn = renderDevice.rotation === 90 || renderDevice.rotation === 270
        const textureWidthPx = isQuarterTurn ? surfaceContentHeightPx : surfaceContentWidthPx
        const textureHeightPx = isQuarterTurn ? surfaceContentWidthPx : surfaceContentHeightPx
        const isPickupPort = renderDevice.typeId === 'item_port_unloader_1'
        const isGrinder = renderDevice.typeId === 'item_port_grinder_1'
        const textureSrc = getDeviceSpritePath(renderDevice.typeId)
        const isTexturedDevice = textureSrc !== null
        const pickupItemId = isPickupPort ? renderDevice.config.pickupItemId : undefined
        const runtimeIconItemId = getRuntimeIconItemId(renderDevice)
        const displayItemIconId = pickupItemId ?? runtimeIconItemId
        const isBelt = renderDevice.typeId.startsWith('belt_')
        const isSplitter = renderDevice.typeId === 'item_log_splitter'
        const isMerger = renderDevice.typeId === 'item_log_converger'
        const beltPorts = isBelt ? getRotatedPorts(renderDevice) : []
        const beltInEdge = isBelt ? beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W' : 'W'
        const beltOutEdge = isBelt ? beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E' : 'E'
        const beltPath = buildBeltTrackPath(beltInEdge, beltOutEdge)
        const splitterOutputEdges = isSplitter
          ? getRotatedPorts(renderDevice)
              .filter((port) => port.direction === 'Output')
              .map((port) => port.edge)
          : []
        const mergerOutputEdges = isMerger ? [getRotatedPorts(renderDevice).find((port) => port.direction === 'Output')?.edge ?? 'W'] : []
        const junctionArrowEdges = isSplitter ? splitterOutputEdges : mergerOutputEdges
        return (
          <div
            key={device.instanceId}
            className={`device ${isBelt ? 'belt-device' : ''} ${selectionSet.has(device.instanceId) ? 'selected' : ''} ${invalidSelectionSet.has(device.instanceId) ? 'drag-invalid' : ''} ${extraClassName ?? ''}`.trim()}
            style={{
              left: renderDevice.origin.x * BASE_CELL_SIZE,
              top: renderDevice.origin.y * BASE_CELL_SIZE,
              width: footprintSize.width * BASE_CELL_SIZE,
              height: footprintSize.height * BASE_CELL_SIZE,
            }}
            title={renderDevice.typeId}
          >
            {isBelt ? (
              <div className="belt-track-wrap">
                <svg className="belt-track-svg" viewBox={`0 0 ${BELT_VIEWBOX_SIZE} ${BELT_VIEWBOX_SIZE}`} preserveAspectRatio="none" aria-hidden="true">
                  {(() => {
                    const beltEdgeMaskId = `belt-edge-mask-${device.instanceId}`
                    return (
                      <>
                        <defs>
                          <mask id={beltEdgeMaskId} maskUnits="userSpaceOnUse">
                            <rect x="0" y="0" width={BELT_VIEWBOX_SIZE} height={BELT_VIEWBOX_SIZE} fill="black" />
                            <path d={beltPath} className="belt-edge-mask-outer" />
                            <path d={beltPath} className="belt-edge-mask-inner" />
                          </mask>
                        </defs>
                        <path d={beltPath} className="belt-track-fill" />
                        <path d={beltPath} className="belt-track-edge" mask={`url(#${beltEdgeMaskId})`} />
                      </>
                    )
                  })()}
                </svg>
                <span className="belt-arrow" style={{ transform: `translate(-50%, -50%) rotate(${EDGE_ANGLE[beltOutEdge]}deg)` }} />
              </div>
            ) : (
              <div
                className={`device-surface ${isPickupPort ? 'pickup-port-surface' : ''} ${isGrinder ? 'grinder-surface' : ''} ${isTexturedDevice ? 'textured-surface' : ''}`}
              >
                {textureSrc && (
                  <img
                    className="device-texture"
                    src={textureSrc}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    style={{
                      width: `${textureWidthPx}px`,
                      height: `${textureHeightPx}px`,
                      transform: `translate(-50%, -50%) rotate(${renderDevice.rotation}deg)`,
                    }}
                  />
                )}
                {(isSplitter || isMerger) && !isTexturedDevice && (
                  <div className="junction-icon" aria-hidden="true">
                    <svg className="junction-icon-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <line className="junction-cross-line" x1="20" y1="50" x2="80" y2="50" />
                      <line className="junction-cross-line" x1="50" y1="20" x2="50" y2="80" />
                      {junctionArrowEdges.map((edge) => (
                        <polyline key={`${renderDevice.instanceId}-${edge}`} className="junction-arrow-line" points={junctionArrowPoints(edge)} />
                      ))}
                    </svg>
                  </div>
                )}
                {displayItemIconId && (
                  <img className="device-item-icon" src={getItemIconPath(displayItemIconId)} alt="" aria-hidden="true" draggable={false} />
                )}
                {!displayItemIconId && !HIDDEN_DEVICE_LABEL_TYPES.has(renderDevice.typeId) && (
                  <span className={`device-label ${isPickupPort ? 'pickup-label' : ''} ${isPickupPort && isQuarterTurn ? 'pickup-label-vertical' : ''}`}>
                    {getDeviceLabel(language, renderDevice.typeId)}
                  </span>
                )}
                {isPickupPort && !pickupItemId && <em>?</em>}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
})

function App() {
  const [activeBaseId, setActiveBaseId] = usePersistentState<BaseId>('stage1-active-base', 'valley4_protocol_core')
  const [layoutsByBase, setLayoutsByBase] = usePersistentState<Partial<Record<BaseId, LayoutState>>>('stage1-layouts-by-base', {})
  const [language, setLanguage] = usePersistentState<Language>('stage1-language', 'zh-CN')
  const [mode, setMode] = usePersistentState<EditMode>('stage1-mode', 'select')
  const [placeType, setPlaceType] = usePersistentState<DeviceTypeId | ''>('stage1-place-type', '')
  const [placeRotation, setPlaceRotation] = usePersistentState<Rotation>('stage1-place-rotation', 0)
  const [deleteTool, setDeleteTool] = usePersistentState<'single' | 'wholeBelt' | 'box'>('stage1-delete-tool', 'single')
  const [leftPanelWidth, setLeftPanelWidth] = usePersistentState<number>('stage1-left-panel-width', 340)
  const [rightPanelWidth, setRightPanelWidth] = usePersistentState<number>('stage1-right-panel-width', 340)
  const [cellSize, setCellSize] = usePersistentState<number>('stage1-cell-size', 64)
  const [blueprints, setBlueprints] = usePersistentState<BlueprintSnapshot[]>('stage1-blueprints', [])
  const [selection, setSelection] = useState<string[]>([])
  const [sim, setSim] = useState<SimState>(() => createInitialSimState())
  const [logStart, setLogStart] = useState<{ x: number; y: number } | null>(null)
  const [logCurrent, setLogCurrent] = useState<{ x: number; y: number } | null>(null)
  const [logTrace, setLogTrace] = useState<Array<{ x: number; y: number }>>([])
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null)
  const [dragBasePositions, setDragBasePositions] = useState<Record<string, { x: number; y: number }> | null>(null)
  const [dragPreviewPositions, setDragPreviewPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [dragPreviewValid, setDragPreviewValid] = useState(true)
  const [dragInvalidMessage, setDragInvalidMessage] = useState<string | null>(null)
  const [dragInvalidSelection, setDragInvalidSelection] = useState<Set<string>>(new Set())
  const [dragStartCell, setDragStartCell] = useState<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null)
  const [placeOperation, setPlaceOperation] = useState<'default' | 'belt'>('default')
  const [viewOffset, setViewOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null)
  const [measuredTickRate, setMeasuredTickRate] = useState(0)
  const [itemPickerState, setItemPickerState] = useState<ItemPickerState | null>(null)
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null)
  const [clipboardBlueprint, setClipboardBlueprint] = useState<BlueprintSnapshot | null>(null)
  const [blueprintPlacementRotation, setBlueprintPlacementRotation] = useState<Rotation>(0)
  const [isWikiOpen, setIsWikiOpen] = useState(false)

  const layout = useMemo(() => normalizeLayoutForBase(layoutsByBase[activeBaseId], activeBaseId), [layoutsByBase, activeBaseId])
  const setLayout = useCallback(
    (updater: LayoutState | ((current: LayoutState) => LayoutState)) => {
      setLayoutsByBase((currentAll) => {
        const currentLayout = normalizeLayoutForBase(currentAll[activeBaseId], activeBaseId)
        const nextLayout = typeof updater === 'function' ? (updater as (current: LayoutState) => LayoutState)(currentLayout) : updater
        const normalizedNext = normalizeLayoutForBase(nextLayout, activeBaseId)
        return {
          ...currentAll,
          [activeBaseId]: normalizedNext,
        }
      })
    },
    [activeBaseId, setLayoutsByBase],
  )

  const currentBaseId = activeBaseId
  const currentBase = BASE_BY_ID[currentBaseId]
  const foundationDevices = currentBase.foundationBuildings
  const foundationIdSet = new Set(foundationDevices.map((device) => device.instanceId))
  const baseGroups = [
    { key: 'valley4', titleKey: 'right.baseGroup.valley4', tag: '四号谷地' },
    { key: 'wuling', titleKey: 'right.baseGroup.wuling', tag: '武陵' },
  ] as const
  const zoomScale = cellSize / BASE_CELL_SIZE
  const canvasWidthCells = layout.lotSize + currentBase.outerRing.left + currentBase.outerRing.right
  const canvasHeightCells = layout.lotSize + currentBase.outerRing.top + currentBase.outerRing.bottom
  const canvasOffsetXPx = currentBase.outerRing.left * BASE_CELL_SIZE
  const canvasOffsetYPx = currentBase.outerRing.top * BASE_CELL_SIZE
  const canvasWidthPx = canvasWidthCells * BASE_CELL_SIZE
  const canvasHeightPx = canvasHeightCells * BASE_CELL_SIZE

  const gridRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef(layout)
  const simStateRef = useRef(sim)
  const simRafRef = useRef<number | null>(null)
  const simAccumulatorMsRef = useRef(0)
  const simLastFrameMsRef = useRef(0)
  const simUiLastCommitMsRef = useRef(0)
  const tickRateSampleRef = useRef<{ tick: number; ms: number } | null>(null)
  const simTickRef = useRef(0)
  const unknownDevicePromptKeyRef = useRef<string>('')
  const legacyLayoutMigratedRef = useRef(false)
  const deleteBoxConfirmingRef = useRef(false)
  const resizeStateRef = useRef<null | { side: 'left' | 'right'; startX: number; startWidth: number }>(null)

  const occupancyMap = useMemo(() => buildOccupancyMap(layout), [layout])
  const cellDeviceMap = useMemo(() => cellToDeviceId(layout), [layout])
  const t = useMemo(() => createTranslator(language), [language])

  const updateSim = useCallback((updater: (current: SimState) => SimState) => {
    const next = updater(simStateRef.current)
    simStateRef.current = next
    simTickRef.current = next.tick
    setSim(next)
    return next
  }, [])

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  const saveSelectionAsBlueprint = useCallback(async () => {
    const selectedIdSet = new Set(selection)
    const selectedDevices = layout.devices.filter(
      (device) => selectedIdSet.has(device.instanceId) && !foundationIdSet.has(device.instanceId),
    )

    if (selectedDevices.length === 0) {
      showToast(t('toast.blueprintNoSelection'), { variant: 'warning' })
      return
    }

    const minX = Math.min(...selectedDevices.map((device) => device.origin.x))
    const minY = Math.min(...selectedDevices.map((device) => device.origin.y))
    const createdAt = new Date().toISOString()
    const defaultName = `BP-${createdAt.slice(0, 19).replace('T', ' ')}`
    const inputName = await dialogPrompt(t('dialog.blueprintNamePrompt'), defaultName, {
      title: t('left.blueprintSubMode'),
      confirmText: t('dialog.ok'),
      cancelText: t('dialog.cancel'),
      variant: 'info',
    })
    if (inputName === null) return
    const name = inputName.trim()
    if (!name) {
      showToast(t('toast.blueprintNameRequired'), { variant: 'warning' })
      return
    }
    const snapshot: BlueprintSnapshot = {
      id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt,
      baseId: activeBaseId,
      devices: selectedDevices.map((device) => ({
        typeId: device.typeId,
        rotation: device.rotation,
        origin: { x: device.origin.x - minX, y: device.origin.y - minY },
        config: cloneDeviceConfig(device.config),
      })),
    }

    try {
      setBlueprints((current) => [snapshot, ...current].slice(0, 100))
      showToast(t('toast.blueprintSaved', { name, count: snapshot.devices.length }))
    } catch {
      showToast(t('toast.blueprintSaveFailed'), { variant: 'error' })
    }
  }, [activeBaseId, foundationIdSet, layout.devices, selection, setBlueprints, t])

  const selectedBlueprint = useMemo(() => {
    if (!selectedBlueprintId) return null
    return blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null
  }, [blueprints, selectedBlueprintId])

  const activePlacementBlueprint = useMemo(() => {
    if (clipboardBlueprint) return clipboardBlueprint
    if (mode === 'blueprint') return selectedBlueprint
    return null
  }, [clipboardBlueprint, mode, selectedBlueprint])

  const buildBlueprintPlacementPreview = useCallback(
    (
      snapshot: BlueprintSnapshot | null,
      anchorCell: { x: number; y: number },
      placementRotation: Rotation,
    ): BlueprintPlacementPreview | null => {
      if (!snapshot || snapshot.devices.length === 0) return null

      const baseRects: BlueprintLocalRect[] = snapshot.devices.map((entry) => {
        const size = rotatedFootprintSize(DEVICE_TYPE_BY_ID[entry.typeId].size, entry.rotation)
        return {
          typeId: entry.typeId,
          rotation: entry.rotation,
          config: entry.config,
          x: entry.origin.x,
          y: entry.origin.y,
          width: size.width,
          height: size.height,
        }
      })

      const rotatedRects = rotateBlueprintRects(baseRects, placementRotation)
      const rotatedBounds = rotatedRects.reduce(
        (acc, rect) => ({
          minX: Math.min(acc.minX, rect.x),
          minY: Math.min(acc.minY, rect.y),
          maxX: Math.max(acc.maxX, rect.x + rect.width),
          maxY: Math.max(acc.maxY, rect.y + rect.height),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
      const blueprintWidth = rotatedBounds.maxX - rotatedBounds.minX
      const blueprintHeight = rotatedBounds.maxY - rotatedBounds.minY
      const topLeftX = Math.round(anchorCell.x + 0.5 - blueprintWidth / 2)
      const topLeftY = Math.round(anchorCell.y + 0.5 - blueprintHeight / 2)

      const previewDevices: DeviceInstance[] = rotatedRects.map((entry, index) => ({
        instanceId: `blueprint-preview-${index}`,
        typeId: entry.typeId,
        origin: {
          x: topLeftX + entry.x,
          y: topLeftY + entry.y,
        },
        rotation: entry.rotation,
        config: cloneDeviceConfig(entry.config),
      }))

      const invalidOutOfLot = previewDevices.some((device) => !isWithinLot(device, layout.lotSize))
      if (invalidOutOfLot) {
        return {
          devices: previewDevices,
          isValid: false,
          invalidMessageKey: OUT_OF_LOT_TOAST_KEY,
        }
      }

      const previewLayout: LayoutState = {
        ...layout,
        devices: [...layout.devices, ...previewDevices],
      }
      const invalidConstraint = previewDevices
        .map((device) => validatePlacementConstraints(previewLayout, device))
        .find((result) => !result.isValid)

      if (invalidConstraint && !invalidConstraint.isValid) {
        return {
          devices: previewDevices,
          isValid: false,
          invalidMessageKey: invalidConstraint.messageKey ?? FALLBACK_PLACEMENT_TOAST_KEY,
        }
      }

      return {
        devices: previewDevices,
        isValid: true,
        invalidMessageKey: null,
      }
    },
    [layout],
  )

  useEffect(() => {
    if (blueprints.length === 0) {
      setSelectedBlueprintId(null)
      return
    }
    if (!selectedBlueprintId) return
    if (blueprints.some((blueprint) => blueprint.id === selectedBlueprintId)) return
    setSelectedBlueprintId(null)
  }, [blueprints, selectedBlueprintId])

  const unknownDevices = useMemo(
    () => layout.devices.filter((device) => !isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
    [layout.devices],
  )

  useEffect(() => {
    if (legacyLayoutMigratedRef.current) return
    legacyLayoutMigratedRef.current = true

    const legacyRaw = window.localStorage.getItem('stage1-layout')
    if (!legacyRaw) return

    try {
      const parsed = JSON.parse(legacyRaw) as Partial<LayoutState>
      const legacyBaseId = resolveBaseFromLayout(parsed)
      const hasTarget = Boolean(layoutsByBase[legacyBaseId])
      if (!hasTarget) {
        const migratedLayout = normalizeLayoutForBase(
          {
            baseId: legacyBaseId,
            lotSize: BASE_BY_ID[legacyBaseId].placeableSize,
            devices: Array.isArray(parsed.devices) ? parsed.devices as DeviceInstance[] : [],
          },
          legacyBaseId,
        )
        setLayoutsByBase((current) => ({ ...current, [legacyBaseId]: migratedLayout }))
      }
      if (!isKnownBaseId(activeBaseId)) {
        setActiveBaseId(legacyBaseId)
      }
    } catch {
      return
    }
  }, [activeBaseId, layoutsByBase, setActiveBaseId, setLayoutsByBase])

  useEffect(() => {
    if (isKnownBaseId(activeBaseId)) return
    setActiveBaseId('valley4_protocol_core')
  }, [activeBaseId, setActiveBaseId])

  useEffect(() => {
    const hasLegacyStorageId = layout.devices.some(
      (device) => String((device as DeviceInstance & { typeId: unknown }).typeId) === 'storage_box_3x3',
    )
    const hasLegacyPowerPoleId = layout.devices.some(
      (device) => String((device as DeviceInstance & { typeId: unknown }).typeId) === 'power_pole_2x2',
    )
    const hasLegacyJunctionId = layout.devices.some((device) => {
      const typeId = String((device as DeviceInstance & { typeId: unknown }).typeId)
      return typeId === 'splitter_1x1' || typeId === 'merger_1x1' || typeId === 'bridge_1x1'
    })
    if (!hasLegacyStorageId && !hasLegacyPowerPoleId && !hasLegacyJunctionId) return

    setLayout((current) => ({
      ...current,
      devices: current.devices.map((device) =>
        String((device as DeviceInstance & { typeId: unknown }).typeId) === 'storage_box_3x3'
          ? { ...device, typeId: 'item_port_storager_1' }
          : String((device as DeviceInstance & { typeId: unknown }).typeId) === 'power_pole_2x2'
            ? { ...device, typeId: 'item_port_power_diffuser_1' }
              : String((device as DeviceInstance & { typeId: unknown }).typeId) === 'splitter_1x1'
                ? { ...device, typeId: 'item_log_splitter' }
                : String((device as DeviceInstance & { typeId: unknown }).typeId) === 'merger_1x1'
                  ? { ...device, typeId: 'item_log_converger' }
                  : String((device as DeviceInstance & { typeId: unknown }).typeId) === 'bridge_1x1'
                    ? { ...device, typeId: 'item_log_connector' }
            : device,
      ),
    }))
  }, [layout.devices, setLayout])

  useEffect(() => {
    if (placeType !== '' && !isKnownDeviceTypeId(placeType)) {
      setPlaceType('')
    }
  }, [placeType, setPlaceType])

  useEffect(() => {
    setLeftPanelWidth((current) => clamp(Number.isFinite(current) ? current : 340, 260, 560))
  }, [setLeftPanelWidth])

  useEffect(() => {
    setRightPanelWidth((current) => clamp(Number.isFinite(current) ? current : 340, 260, 560))
  }, [setRightPanelWidth])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) return

      if (state.side === 'left') {
        const nextWidth = clamp(state.startWidth + (event.clientX - state.startX), 260, 560)
        setLeftPanelWidth(nextWidth)
        return
      }

      const nextWidth = clamp(state.startWidth - (event.clientX - state.startX), 260, 560)
      setRightPanelWidth(nextWidth)
    }

    const onMouseUp = () => {
      resizeStateRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [setLeftPanelWidth, setRightPanelWidth])

  useEffect(() => {
    if (sim.isRunning) {
      if (mode !== 'select') {
        setMode('select')
      }
      return
    }
    if (mode === 'select') {
      setMode('place')
      setPlaceType('')
    }
  }, [mode, setMode, setPlaceType, sim.isRunning])

  useEffect(() => {
    if (unknownDevices.length === 0) {
      unknownDevicePromptKeyRef.current = ''
      return
    }

    const promptKey = unknownDevices
      .map((device) => `${device.instanceId}:${String((device as DeviceInstance & { typeId: unknown }).typeId)}`)
      .join('|')
    if (promptKey === unknownDevicePromptKeyRef.current) return
    unknownDevicePromptKeyRef.current = promptKey

    const unknownTypeIds = Array.from(
      new Set(unknownDevices.map((device) => String((device as DeviceInstance & { typeId: unknown }).typeId))),
    )
    let cancelled = false

    void (async () => {
      const confirmed = await dialogConfirm(
        t('dialog.legacyUnknownTypesConfirm', { types: unknownTypeIds.join(', ') }),
        {
          title: t('dialog.title.confirm'),
          confirmText: t('dialog.ok'),
          cancelText: t('dialog.cancel'),
          variant: 'warning',
        },
      )
      if (!confirmed || cancelled) return

      const removedIds = new Set(unknownDevices.map((device) => device.instanceId))
      setLayout((current) => ({
        ...current,
        devices: current.devices.filter((device) => isKnownDeviceTypeId((device as DeviceInstance & { typeId: unknown }).typeId)),
      }))
      setSelection((current) => current.filter((id) => !removedIds.has(id)))
    })()

    return () => {
      cancelled = true
    }
  }, [unknownDevices, setLayout, t])

  useEffect(() => {
    if (simRafRef.current !== null) {
      window.cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }

    simAccumulatorMsRef.current = 0
    simLastFrameMsRef.current = 0
    simUiLastCommitMsRef.current = 0
    if (!sim.isRunning) return

    const maxTicksPerFrame = 8
    const stepMs = 1000 / (sim.tickRateHz * sim.speed)
    const uiCommitIntervalMs = 120

    const onFrame = (nowMs: number) => {
      if (simLastFrameMsRef.current === 0) {
        simLastFrameMsRef.current = nowMs
      }

      const deltaMs = nowMs - simLastFrameMsRef.current
      simLastFrameMsRef.current = nowMs
      simAccumulatorMsRef.current += Math.max(0, deltaMs)

      const dueTicks = Math.floor(simAccumulatorMsRef.current / stepMs)
      const ticksToRun = Math.min(maxTicksPerFrame, dueTicks)

      if (ticksToRun > 0) {
        simAccumulatorMsRef.current -= ticksToRun * stepMs
        let next = simStateRef.current
        for (let i = 0; i < ticksToRun; i += 1) {
          next = tickSimulation(layoutRef.current, next)
        }
        simStateRef.current = next
        simTickRef.current = next.tick

        if (simUiLastCommitMsRef.current === 0 || nowMs - simUiLastCommitMsRef.current >= uiCommitIntervalMs) {
          simUiLastCommitMsRef.current = nowMs
          setSim(next)
        }
      }

      simRafRef.current = window.requestAnimationFrame(onFrame)
    }

    simRafRef.current = window.requestAnimationFrame(onFrame)

    return () => {
      if (simRafRef.current !== null) {
        window.cancelAnimationFrame(simRafRef.current)
        simRafRef.current = null
      }
      simAccumulatorMsRef.current = 0
      simLastFrameMsRef.current = 0
      simUiLastCommitMsRef.current = 0
    }
  }, [sim.isRunning, sim.speed, sim.tickRateHz])

  useEffect(() => {
    if (!sim.isRunning) {
      setMeasuredTickRate(0)
      tickRateSampleRef.current = null
      return
    }

    tickRateSampleRef.current = { tick: simTickRef.current, ms: performance.now() }
    const timer = window.setInterval(() => {
      const prev = tickRateSampleRef.current
      if (!prev) {
        tickRateSampleRef.current = { tick: simTickRef.current, ms: performance.now() }
        return
      }
      const nowMs = performance.now()
      const currentTick = simTickRef.current
      const deltaTick = currentTick - prev.tick
      const deltaSec = (nowMs - prev.ms) / 1000
      if (deltaSec > 0) setMeasuredTickRate(deltaTick / deltaSec)
      tickRateSampleRef.current = { tick: currentTick, ms: nowMs }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [sim.isRunning])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (sim.isRunning) return
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)
      if (isTypingTarget) return

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
        if (selection.length < 2) {
          showToast(t('toast.blueprintCopyNeedsMultiSelect'), { variant: 'warning' })
          return
        }
        event.preventDefault()
        const selectedIdSet = new Set(selection)
        const selectedDevices = layout.devices.filter(
          (device) => selectedIdSet.has(device.instanceId) && !foundationIdSet.has(device.instanceId),
        )
        if (selectedDevices.length < 2) {
          showToast(t('toast.blueprintCopyNeedsMultiSelect'), { variant: 'warning' })
          return
        }

        const minX = Math.min(...selectedDevices.map((device) => device.origin.x))
        const minY = Math.min(...selectedDevices.map((device) => device.origin.y))
        const createdAt = new Date().toISOString()
        const tempSnapshot: BlueprintSnapshot = {
          id: `clipboard_${Date.now()}`,
          name: 'clipboard',
          createdAt,
          baseId: activeBaseId,
          devices: selectedDevices.map((device) => ({
            typeId: device.typeId,
            rotation: device.rotation,
            origin: { x: device.origin.x - minX, y: device.origin.y - minY },
            config: cloneDeviceConfig(device.config),
          })),
        }
        setClipboardBlueprint(tempSnapshot)
        setBlueprintPlacementRotation(0)
        showToast(t('toast.blueprintClipboardReady', { count: tempSnapshot.devices.length }))
        return
      }

      if (event.key.toLowerCase() !== 'r') return
      event.preventDefault()
      if (activePlacementBlueprint) {
        setBlueprintPlacementRotation((current) => ((current + 90) % 360) as Rotation)
        return
      }
      if (mode === 'place' && placeType) {
        setPlaceRotation((current) => ((current + 90) % 360) as Rotation)
        return
      }
      if (selection.length === 0) return

      const selectedRotatable = layout.devices.filter(
        (device) => selection.includes(device.instanceId) && !foundationIdSet.has(device.instanceId),
      )
      if (selectedRotatable.length === 0) return

      const selectedBounds = selectedRotatable.reduce(
        (acc, device) => {
          const type = DEVICE_TYPE_BY_ID[device.typeId]
          const size = rotatedFootprintSize(type.size, device.rotation)
          const right = device.origin.x + size.width
          const bottom = device.origin.y + size.height
          return {
            minX: Math.min(acc.minX, device.origin.x),
            minY: Math.min(acc.minY, device.origin.y),
            maxX: Math.max(acc.maxX, right),
            maxY: Math.max(acc.maxY, bottom),
          }
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )

      const centerX = (selectedBounds.minX + selectedBounds.maxX) / 2
      const centerY = (selectedBounds.minY + selectedBounds.maxY) / 2

      const rotatedById = new Map<string, DeviceInstance>()
      for (const device of selectedRotatable) {
        const currentSize = rotatedFootprintSize(DEVICE_TYPE_BY_ID[device.typeId].size, device.rotation)
        const currentCenterX = device.origin.x + currentSize.width / 2
        const currentCenterY = device.origin.y + currentSize.height / 2
        const nextCenterX = centerX - (currentCenterY - centerY)
        const nextCenterY = centerY + (currentCenterX - centerX)
        const nextRotation = ((device.rotation + 90) % 360) as Rotation
        const nextSize = rotatedFootprintSize(DEVICE_TYPE_BY_ID[device.typeId].size, nextRotation)
        const nextOrigin = {
          x: Math.round(nextCenterX - nextSize.width / 2),
          y: Math.round(nextCenterY - nextSize.height / 2),
        }
        rotatedById.set(device.instanceId, {
          ...device,
          rotation: nextRotation,
          origin: nextOrigin,
        })
      }

      const nextLayout: LayoutState = {
        ...layout,
        devices: layout.devices.map((device) => rotatedById.get(device.instanceId) ?? device),
      }

      const outOfLotDevice = Array.from(rotatedById.values()).find((device) => !isWithinLot(device, nextLayout.lotSize))
      if (outOfLotDevice) {
        showToast(t(OUT_OF_LOT_TOAST_KEY), { variant: 'warning' })
        return
      }

      const constraintFailure = Array.from(rotatedById.values())
        .map((device) => validatePlacementConstraints(nextLayout, device))
        .find((result) => !result.isValid)
      if (constraintFailure && !constraintFailure.isValid) {
        showToast(t(constraintFailure.messageKey ?? FALLBACK_PLACEMENT_TOAST_KEY), { variant: 'warning' })
        return
      }

      setLayout(nextLayout)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeBaseId,
    activePlacementBlueprint,
    blueprintPlacementRotation,
    foundationIdSet,
    mode,
    layout,
    selection,
    setLayout,
    setBlueprintPlacementRotation,
    setClipboardBlueprint,
    sim.isRunning,
    setPlaceRotation,
    placeType,
    t,
  ])

  useEffect(() => {
    if (!isWikiOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsWikiOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isWikiOpen])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const canvasWidth = canvasWidthPx * zoomScale
    const canvasHeight = canvasHeightPx * zoomScale
    setViewOffset((current) =>
      clampViewportOffset(
        current,
        { width: viewport.clientWidth, height: viewport.clientHeight },
        { width: canvasWidth, height: canvasHeight },
      ),
    )
  }, [canvasHeightPx, canvasWidthPx, zoomScale])

  const toRawCell = (clientX: number, clientY: number) => {
    const viewportRect = viewportRef.current?.getBoundingClientRect()
    if (!viewportRect) return null
    const scaledCellSize = BASE_CELL_SIZE * zoomScale
    const rawX = Math.floor((clientX - viewportRect.left - viewOffset.x) / scaledCellSize)
    const rawY = Math.floor((clientY - viewportRect.top - viewOffset.y) / scaledCellSize)
    const x = rawX - currentBase.outerRing.left
    const y = rawY - currentBase.outerRing.top
    return { x, y }
  }

  const toCell = (clientX: number, clientY: number) => {
    const rawCell = toRawCell(clientX, clientY)
    if (!rawCell) return null
    if (rawCell.x < 0 || rawCell.y < 0 || rawCell.x >= layout.lotSize || rawCell.y >= layout.lotSize) return null
    return rawCell
  }

  const toPlaceOrigin = (cell: { x: number; y: number }, typeId: DeviceTypeId, rotation: Rotation) => {
    const type = DEVICE_TYPE_BY_ID[typeId]
    const footprint = rotatedFootprintSize(type.size, rotation)
    return {
      x: Math.floor(cell.x + 0.5 - footprint.width / 2),
      y: Math.floor(cell.y + 0.5 - footprint.height / 2),
    }
  }

  const placeDevice = (cell: { x: number; y: number }) => {
    if (!placeType) return false
    const origin = toPlaceOrigin(cell, placeType, placeRotation)
    const instance: DeviceInstance = {
      instanceId: nextId(placeType),
      typeId: placeType,
      origin,
      rotation: placeRotation,
      config: initialStorageConfig(placeType),
    }
    if (!isWithinLot(instance, layout.lotSize)) {
      showToast(t(OUT_OF_LOT_TOAST_KEY), { variant: 'warning' })
      return false
    }
    const validation = validatePlacementConstraints(layout, instance)
    if (!validation.isValid) {
      showToast(t(validation.messageKey ?? FALLBACK_PLACEMENT_TOAST_KEY), { variant: 'warning' })
      return false
    }
    setLayout((current) => {
      if (!MANUAL_LOGISTICS_JUNCTION_TYPES.has(instance.typeId)) {
        return { ...current, devices: [...current.devices, instance] }
      }

      const footprint = getFootprintCells(instance)
      if (footprint.length === 0) {
        return { ...current, devices: [...current.devices, instance] }
      }

      const replacedBeltIds = new Set<string>()
      for (const device of current.devices) {
        if (!device.typeId.startsWith('belt_')) continue
        if (footprint.some((cellPos) => includesCell(device, cellPos.x, cellPos.y))) {
          replacedBeltIds.add(device.instanceId)
        }
      }

      return {
        ...current,
        devices: [...current.devices.filter((device) => !replacedBeltIds.has(device.instanceId)), instance],
      }
    })
    return true
  }

  const onCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault()
      if (mode === 'place' && placeOperation === 'belt') {
        setLogStart(null)
        setLogCurrent(null)
        setLogTrace([])
      }
      setIsPanning(true)
      setPanStart({ clientX: event.clientX, clientY: event.clientY, offsetX: viewOffset.x, offsetY: viewOffset.y })
      return
    }

    if (event.button === 2) {
      event.preventDefault()
      if (!sim.isRunning && clipboardBlueprint) {
        setClipboardBlueprint(null)
        setBlueprintPlacementRotation(0)
        showToast(t('toast.blueprintClipboardCancelled'))
        return
      }
      if (!sim.isRunning && mode === 'place') {
        setPlaceOperation('default')
        setLogStart(null)
        setLogCurrent(null)
        setLogTrace([])
        setPlaceType('')
      }
      if (!sim.isRunning && mode === 'blueprint') {
        setSelectedBlueprintId(null)
        setBlueprintPlacementRotation(0)
      }
      return
    }

    if (event.button !== 0) return

    const cell = toCell(event.clientX, event.clientY)
    if (!cell) return

    if (mode === 'place' && placeOperation === 'belt') {
      if (sim.isRunning) return
      setLogStart(cell)
      setLogCurrent(cell)
      setLogTrace([cell])
      return
    }

    if (mode === 'place' && placeType) {
      if (sim.isRunning) return
      const placed = placeDevice(cell)
      if (placed) {
        setPlaceType('')
      }
      return
    }

    if (activePlacementBlueprint) {
      if (sim.isRunning) return
      const preview = buildBlueprintPlacementPreview(activePlacementBlueprint, cell, blueprintPlacementRotation)
      if (!preview) {
        showToast(t('toast.blueprintNoSelection'), { variant: 'warning' })
        return
      }
      if (!preview.isValid) {
        showToast(t(preview.invalidMessageKey ?? FALLBACK_PLACEMENT_TOAST_KEY), { variant: 'warning' })
        return
      }

      setLayout((current) => ({
        ...current,
        devices: [
          ...current.devices,
          ...preview.devices.map((device) => ({
            ...device,
            instanceId: nextId(device.typeId),
          })),
        ],
      }))
      showToast(t('toast.blueprintPlaced', { name: activePlacementBlueprint.name, count: preview.devices.length }))
      return
    }

    if (mode === 'delete') {
      if (sim.isRunning) return
      if (deleteTool === 'box') {
        setSelection([])
        setDragStartCell(null)
        setDragBasePositions(null)
        setDragPreviewPositions({})
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())
        setDragOrigin(cell)
        setDragRect({ x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y })
        return
      }
      const id = cellDeviceMap.get(`${cell.x},${cell.y}`)
      if (!id) return
      if (foundationIdSet.has(id)) return
      if (deleteTool === 'wholeBelt') {
        setLayout((current) => deleteConnectedBelts(current, cell.x, cell.y))
      } else {
        setLayout((current) => ({ ...current, devices: current.devices.filter((device) => device.instanceId !== id) }))
      }
      setSelection([])
      return
    }

    const clickedId = cellDeviceMap.get(`${cell.x},${cell.y}`)
    if (clickedId) {
      const activeSelection = (selection.includes(clickedId) ? selection : [clickedId]).filter((id) => !foundationIdSet.has(id))
      if (!selection.includes(clickedId)) setSelection(activeSelection)
      if (activeSelection.length === 0) {
        setDragBasePositions(null)
        setDragPreviewPositions({})
        setDragPreviewValid(true)
        setDragInvalidMessage(null)
        setDragInvalidSelection(new Set())
        setDragStartCell(null)
        setDragOrigin(null)
        setDragRect(null)
        return
      }
      const base: Record<string, { x: number; y: number }> = {}
      for (const id of activeSelection) {
        const device = getDeviceById(layout, id)
        if (device) base[id] = { ...device.origin }
      }
      setDragBasePositions(base)
      setDragPreviewPositions(base)
      setDragPreviewValid(true)
      setDragInvalidMessage(null)
      setDragInvalidSelection(new Set())
      setDragStartCell(cell)
      setDragOrigin(cell)
      setDragRect(null)
      return
    }

    setSelection([])
    setDragBasePositions(null)
    setDragPreviewPositions({})
    setDragPreviewValid(true)
    setDragInvalidMessage(null)
    setDragInvalidSelection(new Set())
    setDragOrigin(cell)
    setDragRect({ x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y })
  }

  const onCanvasMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning && panStart) {
      const viewport = viewportRef.current
      if (!viewport) return
      const canvasWidth = canvasWidthPx * zoomScale
      const canvasHeight = canvasHeightPx * zoomScale
      const nextOffset = {
        x: panStart.offsetX + (event.clientX - panStart.clientX),
        y: panStart.offsetY + (event.clientY - panStart.clientY),
      }
      setViewOffset(
        clampViewportOffset(
          nextOffset,
          { width: viewport.clientWidth, height: viewport.clientHeight },
          { width: canvasWidth, height: canvasHeight },
        ),
      )
      return
    }

    const rawCell = toRawCell(event.clientX, event.clientY)
    if (!rawCell) {
      setHoverCell(null)
      return
    }
    const cell = rawCell.x >= 0 && rawCell.y >= 0 && rawCell.x < layout.lotSize && rawCell.y < layout.lotSize ? rawCell : null
    setHoverCell(cell)

    if (mode === 'place' && placeOperation === 'belt' && logStart) {
      if (!cell) return
      const last = logTrace[logTrace.length - 1]
      if (last && last.x === cell.x && last.y === cell.y) return
      setLogTrace((current) => [...current, cell])
      setLogCurrent(cell)
      return
    }

    if ((mode === 'select' || (mode === 'place' && !placeType)) && dragBasePositions && dragOrigin && selection.length > 0 && !sim.isRunning) {
      const dx = rawCell.x - dragOrigin.x
      const dy = rawCell.y - dragOrigin.y
      const previewPositions: Record<string, { x: number; y: number }> = {}
      for (const id of selection) {
        const base = dragBasePositions[id]
        if (!base) continue
        previewPositions[id] = { x: base.x + dx, y: base.y + dy }
      }
      setDragPreviewPositions(previewPositions)

      const previewLayout: LayoutState = {
        ...layout,
        devices: layout.devices.map((device) => {
          const preview = previewPositions[device.instanceId]
          if (!preview) return device
          return {
            ...device,
            origin: preview,
          }
        }),
      }
      const movedSelection = previewLayout.devices.filter((device) => selection.includes(device.instanceId))
      const outOfLotDevice = movedSelection.find((device) => !isWithinLot(device, layout.lotSize))
      let invalidMessageKey: string | null = null
      if (outOfLotDevice) {
        invalidMessageKey = OUT_OF_LOT_TOAST_KEY
      } else {
        const constraintFailure = movedSelection
          .map((device) => validatePlacementConstraints(previewLayout, device))
          .find((result) => !result.isValid)
        if (constraintFailure && !constraintFailure.isValid) {
          invalidMessageKey = constraintFailure.messageKey ?? FALLBACK_PLACEMENT_TOAST_KEY
        }
      }
      const isValidPlacement = invalidMessageKey === null
      setDragPreviewValid(isValidPlacement)
      setDragInvalidMessage(invalidMessageKey)
      setDragInvalidSelection(isValidPlacement ? new Set() : new Set(selection))
      setDragStartCell(rawCell)
      return
    }

    if (!cell) return

    if (mode === 'delete' && deleteTool === 'box' && dragOrigin && dragRect) {
      setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
      return
    }

    if ((mode === 'select' || (mode === 'place' && !placeType)) && dragOrigin && dragRect) {
      setDragRect({ ...dragRect, x2: cell.x, y2: cell.y })
      return
    }

    if ((mode === 'select' || (mode === 'place' && !placeType)) && dragStartCell) {
      setDragStartCell(cell)
    }
  }

  const onCanvasMouseUp = async () => {
    if (isPanning) {
      setIsPanning(false)
      setPanStart(null)
      return
    }

    if (mode === 'place' && placeOperation === 'belt' && logStart && logCurrent && !sim.isRunning) {
      const path = logisticsPreview
      if (path && path.length >= 2) {
        setLayout((current) => applyLogisticsPath(current, path))
      }
      setLogStart(null)
      setLogCurrent(null)
      setLogTrace([])
      return
    }

    if (mode === 'delete' && deleteTool === 'box' && dragRect && dragOrigin && !sim.isRunning) {
      if (deleteBoxConfirmingRef.current) return
      deleteBoxConfirmingRef.current = true

      const xMin = Math.min(dragRect.x1, dragRect.x2)
      const xMax = Math.max(dragRect.x1, dragRect.x2)
      const yMin = Math.min(dragRect.y1, dragRect.y2)
      const yMax = Math.max(dragRect.y1, dragRect.y2)
      const idsInRect = new Set<string>()

      setDragStartCell(null)
      setDragOrigin(null)
      setDragRect(null)
      setDragBasePositions(null)
      setDragPreviewPositions({})
      setDragPreviewValid(true)
      setDragInvalidMessage(null)
      setDragInvalidSelection(new Set())

      for (const [key, entries] of occupancyMap.entries()) {
        const [x, y] = key.split(',').map(Number)
        if (x < xMin || x > xMax || y < yMin || y > yMax) continue
        for (const entry of entries) {
          if (foundationIdSet.has(entry.instanceId)) continue
          idsInRect.add(entry.instanceId)
        }
      }

      try {
        if (idsInRect.size > 0) {
          const confirmed = await dialogConfirm(t('left.deleteBoxConfirm', { count: idsInRect.size }), {
            title: t('dialog.title.confirm'),
            confirmText: t('dialog.ok'),
            cancelText: t('dialog.cancel'),
            variant: 'warning',
          })
          if (confirmed) {
            setLayout((current) => ({
              ...current,
              devices: current.devices.filter((device) => !idsInRect.has(device.instanceId)),
            }))
            setSelection((current) => current.filter((id) => !idsInRect.has(id)))
          }
        }
      } finally {
        deleteBoxConfirmingRef.current = false
      }
      return
    }

    if ((mode === 'select' || (mode === 'place' && !placeType)) && dragRect && dragOrigin) {
      const xMin = Math.min(dragRect.x1, dragRect.x2)
      const xMax = Math.max(dragRect.x1, dragRect.x2)
      const yMin = Math.min(dragRect.y1, dragRect.y2)
      const yMax = Math.max(dragRect.y1, dragRect.y2)
      const ids = layout.devices
        .filter((device) =>
          DEVICE_TYPE_BY_ID[device.typeId]
            ? DEVICE_TYPE_BY_ID[device.typeId] &&
              [...occupancyMap.entries()].some(([key, value]) => {
                const [x, y] = key.split(',').map(Number)
                return x >= xMin && x <= xMax && y >= yMin && y <= yMax && value.some((entry) => entry.instanceId === device.instanceId)
              })
            : false,
        )
        .filter((device) => !foundationIdSet.has(device.instanceId))
        .map((device) => device.instanceId)
      setSelection(ids)
      setDragRect(null)
      setDragOrigin(null)
      setDragBasePositions(null)
      setDragPreviewPositions({})
      setDragPreviewValid(true)
      setDragInvalidMessage(null)
      setDragInvalidSelection(new Set())
      return
    }

    if ((mode === 'select' || (mode === 'place' && !placeType)) && dragStartCell && dragOrigin && dragBasePositions && selection.length > 0 && !sim.isRunning) {
      if (dragPreviewValid) {
        setLayout((current) => ({
          ...current,
          devices: current.devices.map((device) => {
            if (!selection.includes(device.instanceId)) return device
            const preview = dragPreviewPositions[device.instanceId]
            if (!preview) return device
            return {
              ...device,
              origin: { ...preview },
            }
          }),
        }))
      } else if (dragInvalidMessage) {
        showToast(t(dragInvalidMessage), { variant: 'warning' })
      }
      setDragPreviewPositions({})
      setDragPreviewValid(true)
      setDragInvalidMessage(null)
      setDragInvalidSelection(new Set())
      setDragStartCell(null)
      setDragOrigin(null)
      setDragBasePositions(null)
      return
    }

    setDragStartCell(null)
    setDragOrigin(null)
    setDragRect(null)
    setDragBasePositions(null)
    setDragPreviewPositions({})
    setDragPreviewValid(true)
    setDragInvalidMessage(null)
    setDragInvalidSelection(new Set())
  }

  const onCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    const maxCellSize = getMaxCellSizeForViewport(viewport)
    const baseStep = getZoomStep(cellSize)
    const deltaStrength = clamp(Math.round(Math.abs(event.deltaY) / 100), 1, 3)
    const step = baseStep * deltaStrength
    const next = clamp(cellSize + (event.deltaY < 0 ? step : -step), 12, maxCellSize)
    if (next === cellSize) return

    const viewportRect = viewport.getBoundingClientRect()
    const anchorX = event.clientX - viewportRect.left
    const anchorY = event.clientY - viewportRect.top
    const scaledCellSize = BASE_CELL_SIZE * zoomScale
    const worldX = (anchorX - viewOffset.x) / scaledCellSize
    const worldY = (anchorY - viewOffset.y) / scaledCellSize
    const nextOffset = {
      x: anchorX - worldX * BASE_CELL_SIZE * (next / BASE_CELL_SIZE),
      y: anchorY - worldY * BASE_CELL_SIZE * (next / BASE_CELL_SIZE),
    }
    const clampedOffset = clampViewportOffset(
      nextOffset,
      { width: viewport.clientWidth, height: viewport.clientHeight },
      { width: canvasWidthPx * (next / BASE_CELL_SIZE), height: canvasHeightPx * (next / BASE_CELL_SIZE) },
    )
    setViewOffset(clampedOffset)
    setCellSize(next)
  }

  const selectedDevice = useMemo(() => {
    if (selection.length !== 1) return null
    return getDeviceById(layout, selection[0])
  }, [layout, selection])

  const selectedRuntime = useMemo(() => {
    if (!selectedDevice) return undefined
    return sim.runtimeById[selectedDevice.instanceId]
  }, [selectedDevice, sim.runtimeById])

  const selectedPickupItemId =
    selectedDevice?.typeId === 'item_port_unloader_1' ? selectedDevice.config.pickupItemId : undefined
  const selectedProcessorBufferSpec =
    selectedDevice && DEVICE_TYPE_BY_ID[selectedDevice.typeId].runtimeKind === 'processor'
      ? processorBufferSpec(selectedDevice.typeId)
      : null
  const selectedPreloadSlots = useMemo(() => {
    if (!selectedDevice || DEVICE_TYPE_BY_ID[selectedDevice.typeId].runtimeKind !== 'processor' || !selectedProcessorBufferSpec) return []
    return buildProcessorPreloadSlots(selectedDevice, selectedProcessorBufferSpec.inputSlotCapacities)
  }, [selectedDevice, selectedProcessorBufferSpec])
  const selectedPreloadTotal = useMemo(
    () => selectedPreloadSlots.reduce((sum, slot) => sum + Math.max(0, slot.amount), 0),
    [selectedPreloadSlots],
  )

  const pickerTargetDevice = useMemo(() => {
    if (!itemPickerState) return null
    return getDeviceById(layout, itemPickerState.deviceInstanceId)
  }, [itemPickerState, layout])

  const pickerPreloadSlots = useMemo(() => {
    if (!itemPickerState || itemPickerState.kind !== 'preload' || !pickerTargetDevice) return []
    const spec = processorBufferSpec(pickerTargetDevice.typeId)
    return buildProcessorPreloadSlots(pickerTargetDevice, spec.inputSlotCapacities)
  }, [itemPickerState, pickerTargetDevice])

  const pickerSelectedItemId = useMemo(() => {
    if (!itemPickerState || !pickerTargetDevice) return undefined
    if (itemPickerState.kind === 'pickup') return pickerTargetDevice.config.pickupItemId
    return pickerPreloadSlots[itemPickerState.slotIndex]?.itemId ?? undefined
  }, [itemPickerState, pickerPreloadSlots, pickerTargetDevice])

  const pickerDisabledItemIds = useMemo(() => {
    if (!itemPickerState || itemPickerState.kind !== 'preload') return new Set<ItemId>()
    return new Set(
      pickerPreloadSlots
        .filter((slot, slotIndex) => slotIndex !== itemPickerState.slotIndex && Boolean(slot.itemId))
        .map((slot) => slot.itemId as ItemId),
    )
  }, [itemPickerState, pickerPreloadSlots])

  useEffect(() => {
    if (sim.isRunning) {
      setItemPickerState(null)
      return
    }
    if (!itemPickerState) return
    const target = getDeviceById(layout, itemPickerState.deviceInstanceId)
    if (!target) {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'pickup' && target.typeId !== 'item_port_unloader_1') {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'preload' && DEVICE_TYPE_BY_ID[target.typeId].runtimeKind !== 'processor') {
      setItemPickerState(null)
    }
  }, [itemPickerState, layout, sim.isRunning])

  useEffect(() => {
    if (!itemPickerState) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setItemPickerState(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [itemPickerState])

  const updatePickupItem = useCallback(
    (deviceInstanceId: string, pickupItemId: ItemId | undefined) => {
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) =>
          device.instanceId === deviceInstanceId
            ? { ...device, config: { ...device.config, pickupItemId } }
            : device,
        ),
      }))
    },
    [setLayout],
  )

  const updateProcessorPreloadSlot = useCallback(
    (deviceInstanceId: string, slotIndex: number, patch: { itemId?: ItemId | null; amount?: number }) => {
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (device.instanceId !== deviceInstanceId) return device
          if (DEVICE_TYPE_BY_ID[device.typeId].runtimeKind !== 'processor') return device

          const spec = processorBufferSpec(device.typeId)
          const slots = buildProcessorPreloadSlots(device, spec.inputSlotCapacities)
          if (slotIndex < 0 || slotIndex >= slots.length) return device

          const currentSlot = slots[slotIndex]
          const nextItemId = patch.itemId !== undefined ? patch.itemId : currentSlot.itemId
          const requestedAmount = patch.amount !== undefined ? patch.amount : currentSlot.amount
          const slotCap = spec.inputSlotCapacities[slotIndex] ?? 50
          const normalizedAmount = nextItemId
            ? clamp(Math.floor(Number.isFinite(requestedAmount) ? requestedAmount : 0), 0, slotCap)
            : 0

          slots[slotIndex] = {
            itemId: nextItemId ?? null,
            amount: normalizedAmount,
          }

          const nextConfig = { ...device.config }
          const serialized = serializeProcessorPreloadSlots(slots)
          if (serialized.length > 0) nextConfig.preloadInputs = serialized
          else delete nextConfig.preloadInputs
          delete nextConfig.preloadInputItemId
          delete nextConfig.preloadInputAmount
          return { ...device, config: nextConfig }
        }),
      }))
    },
    [setLayout],
  )

  const logisticsPreview = useMemo(() => {
    if (!logStart || !logCurrent || logTrace.length === 0) return null
    const candidatePath = pathFromTrace(logTrace)
    if (!candidatePath) return null
    return longestValidLogisticsPrefix(layout, candidatePath)
  }, [layout, logStart, logCurrent, logTrace])

  const logisticsPreviewDevices = useMemo(() => {
    if (mode !== 'place' || placeOperation !== 'belt' || !logisticsPreview || logisticsPreview.length < 1) return []
    const projectedLayout = applyLogisticsPath(layout, logisticsPreview)
    if (projectedLayout === layout) return []
    const projectedCellMap = cellToDeviceId(projectedLayout)
    const seenProjectedIds = new Set<string>()
    const result: DeviceInstance[] = []

    for (const cell of logisticsPreview) {
      const projectedId = projectedCellMap.get(`${cell.x},${cell.y}`)
      if (!projectedId || seenProjectedIds.has(projectedId)) continue
      seenProjectedIds.add(projectedId)
      const projectedDevice = getDeviceById(projectedLayout, projectedId)
      if (!projectedDevice) continue
      if (!projectedDevice.typeId.startsWith('belt_') && !HIDDEN_DEVICE_LABEL_TYPES.has(projectedDevice.typeId)) continue
      result.push({
        ...projectedDevice,
        instanceId: `preview-${projectedDevice.instanceId}`,
      })
    }

    return result
  }, [layout, logisticsPreview, mode, placeOperation])

  const inTransitItems = useMemo(() => {
    return layout.devices.flatMap((device) => {
      if (!device.typeId.startsWith('belt_')) return []
      const runtime = sim.runtimeById[device.instanceId]
      if (!runtime || !('slot' in runtime) || !runtime.slot) return []

      const beltPorts = getRotatedPorts(device)
      const beltInEdge = beltPorts.find((port) => port.direction === 'Input')?.edge ?? 'W'
      const beltOutEdge = beltPorts.find((port) => port.direction === 'Output')?.edge ?? 'E'
      const position = getBeltItemPosition(beltInEdge, beltOutEdge, runtime.slot.progress01)

      return [
        {
          key: `${device.instanceId}:${runtime.slot.enteredTick}:${runtime.slot.itemId}`,
          itemId: runtime.slot.itemId,
          progress01: runtime.slot.progress01,
          x: (device.origin.x + position.x / BELT_VIEWBOX_SIZE) * BASE_CELL_SIZE,
          y: (device.origin.y + position.y / BELT_VIEWBOX_SIZE) * BASE_CELL_SIZE,
        },
      ]
    })
  }, [layout.devices, sim.runtimeById])

  const selectionSet = useMemo(() => new Set(selection), [selection])
  const dragPreviewOriginsById = useMemo(() => new Map(Object.entries(dragPreviewPositions)), [dragPreviewPositions])

  const runtimeStallOverlays = useMemo(() => {
    return layout.devices.flatMap((device) => {
      const runtime = sim.runtimeById[device.instanceId]
      if (!shouldShowRuntimeStallOverlay(device, runtime)) return []
      const type = DEVICE_TYPE_BY_ID[device.typeId]
      if (!type) return []
      const footprintSize = rotatedFootprintSize(type.size, device.rotation)
      return [
        {
          key: `stall-${device.instanceId}`,
          left: device.origin.x * BASE_CELL_SIZE,
          top: device.origin.y * BASE_CELL_SIZE,
          width: footprintSize.width * BASE_CELL_SIZE,
          height: footprintSize.height * BASE_CELL_SIZE,
          isBelt: device.typeId.startsWith('belt_'),
        },
      ]
    })
  }, [layout.devices, sim.runtimeById])

  const powerRangeOutlines = useMemo(() => {
    return layout.devices
      .filter((device) => device.typeId === 'item_port_power_diffuser_1')
      .map((device) => ({
        key: `power-range-${device.instanceId}`,
        left: (device.origin.x - 5) * BASE_CELL_SIZE,
        top: (device.origin.y - 5) * BASE_CELL_SIZE,
        width: 12 * BASE_CELL_SIZE,
        height: 12 * BASE_CELL_SIZE,
      }))
  }, [layout.devices])

  const portChevrons = useMemo(() => {
    if (mode !== 'select' && !(mode === 'place' && (placeOperation === 'belt' || !placeType))) return []
    const links = linksFromLayout(layout)
    const connectedPortKeys = new Set<string>()
    const keyOf = (port: { instanceId: string; portId: string; x: number; y: number; edge: string }) =>
      `${port.instanceId}:${port.portId}:${port.x}:${port.y}:${port.edge}`

    for (const link of links) {
      connectedPortKeys.add(keyOf(link.from))
      connectedPortKeys.add(keyOf(link.to))
    }

    const result: Array<{ key: string; x: number; y: number; angle: number; width: number; height: number }> = []
    const chevronLength = BASE_CELL_SIZE * (1 / 6)
    const chevronThickness = BASE_CELL_SIZE * (2 / 5)
    const chevronGap = BASE_CELL_SIZE * (1 / 12)
    const outsideOffset = chevronLength / 2 + chevronGap
    for (const device of layout.devices) {
      const previewOrigin = dragPreviewPositions[device.instanceId]
      const renderDevice =
        mode === 'select' && previewOrigin
          ? {
              ...device,
              origin: previewOrigin,
            }
          : device
      if (device.typeId.startsWith('belt_')) continue
      if (HIDDEN_CHEVRON_DEVICE_TYPES.has(device.typeId)) continue
      if ((mode === 'select' || (mode === 'place' && !placeType)) && !selection.includes(device.instanceId)) continue
      for (const port of getRotatedPorts(renderDevice)) {
        const portKey = keyOf(port)
        if (mode === 'place' && placeOperation === 'belt' && connectedPortKeys.has(portKey)) continue

        const centerX = (port.x + 0.5) * BASE_CELL_SIZE
        const centerY = (port.y + 0.5) * BASE_CELL_SIZE
        let x = centerX
        let y = centerY
        if (port.edge === 'N') y = port.y * BASE_CELL_SIZE - outsideOffset
        if (port.edge === 'S') y = (port.y + 1) * BASE_CELL_SIZE + outsideOffset
        if (port.edge === 'W') x = port.x * BASE_CELL_SIZE - outsideOffset
        if (port.edge === 'E') x = (port.x + 1) * BASE_CELL_SIZE + outsideOffset

        result.push({
          key: portKey,
          x,
          y,
          angle: port.direction === 'Input' ? EDGE_ANGLE[OPPOSITE_EDGE[port.edge]] : EDGE_ANGLE[port.edge],
          width: chevronLength,
          height: chevronThickness,
        })
      }
    }

    return result
  }, [layout, dragPreviewPositions, mode, selection, placeType, placeOperation])

  const placePreview = useMemo(() => {
    if (mode !== 'place' || !placeType || !hoverCell || sim.isRunning) return null
    const origin = toPlaceOrigin(hoverCell, placeType, placeRotation)
    const instance: DeviceInstance = {
      instanceId: 'preview',
      typeId: placeType,
      origin,
      rotation: placeRotation,
      config: {},
    }
    const type = DEVICE_TYPE_BY_ID[placeType]
    const footprintSize = rotatedFootprintSize(type.size, placeRotation)
    const textureSrc = getDeviceSpritePath(placeType)
    const surfaceContentWidthPx = footprintSize.width * BASE_CELL_SIZE - 6
    const surfaceContentHeightPx = footprintSize.height * BASE_CELL_SIZE - 6
    const isQuarterTurn = placeRotation === 90 || placeRotation === 270
    const textureWidthPx = isQuarterTurn ? surfaceContentHeightPx : surfaceContentWidthPx
    const textureHeightPx = isQuarterTurn ? surfaceContentWidthPx : surfaceContentHeightPx
    const chevronLength = BASE_CELL_SIZE * (1 / 6)
    const chevronThickness = BASE_CELL_SIZE * (2 / 5)
    const chevronGap = BASE_CELL_SIZE * (1 / 12)
    const outsideOffset = chevronLength / 2 + chevronGap
    const chevrons = getRotatedPorts(instance).map((port) => {
      const localCenterX = (port.x - origin.x + 0.5) * BASE_CELL_SIZE
      const localCenterY = (port.y - origin.y + 0.5) * BASE_CELL_SIZE
      let x = localCenterX
      let y = localCenterY
      if (port.edge === 'N') y = (port.y - origin.y) * BASE_CELL_SIZE - outsideOffset
      if (port.edge === 'S') y = (port.y - origin.y + 1) * BASE_CELL_SIZE + outsideOffset
      if (port.edge === 'W') x = (port.x - origin.x) * BASE_CELL_SIZE - outsideOffset
      if (port.edge === 'E') x = (port.x - origin.x + 1) * BASE_CELL_SIZE + outsideOffset
      return {
        key: `preview-${port.instanceId}-${port.portId}-${port.x}-${port.y}-${port.edge}-${port.direction}`,
        x,
        y,
        angle: port.direction === 'Input' ? EDGE_ANGLE[OPPOSITE_EDGE[port.edge]] : EDGE_ANGLE[port.edge],
        width: chevronLength,
        height: chevronThickness,
      }
    })
    return {
      origin,
      type,
      rotation: placeRotation,
      textureSrc,
      textureWidthPx,
      textureHeightPx,
      footprintSize,
      chevrons,
      isValid: isWithinLot(instance, layout.lotSize) && validatePlacementConstraints(layout, instance).isValid,
    }
  }, [hoverCell, layout, mode, placeRotation, placeType, sim.isRunning])

  const blueprintPlacementPreview = useMemo(() => {
    if (!activePlacementBlueprint || sim.isRunning || !hoverCell) return null
    return buildBlueprintPlacementPreview(activePlacementBlueprint, hoverCell, blueprintPlacementRotation)
  }, [activePlacementBlueprint, blueprintPlacementRotation, buildBlueprintPlacementPreview, hoverCell, sim.isRunning])

  const uiHint = sim.isRunning
    ? t('top.runningHint')
    : mode === 'blueprint'
      ? t('top.blueprintHint')
      : mode === 'delete'
        ? t('top.deleteHint')
        : t('top.editHint')

  const beginPanelResize = (side: 'left' | 'right', startX: number) => {
    resizeStateRef.current = {
      side,
      startX,
      startWidth: side === 'left' ? leftPanelWidth : rightPanelWidth,
    }
  }

  const statsAndDebugSection = (
    <>
      <h3>{t('right.stats')}</h3>
      <table className="stats-table">
        <thead>
          <tr>
            <th>{t('table.itemName')}</th>
            <th>{t('table.producedPerMinute')}</th>
            <th>{t('table.consumedPerMinute')}</th>
            <th>{t('table.currentStock')}</th>
          </tr>
        </thead>
        <tbody>
          {ITEMS.map((item) => (
            <tr key={item.id}>
              <td>{getItemLabel(language, item.id)}</td>
              <td>{sim.stats.producedPerMinute[item.id].toFixed(2)}</td>
              <td>{sim.stats.consumedPerMinute[item.id].toFixed(2)}</td>
              <td>{Number.isFinite(sim.warehouse[item.id]) ? sim.warehouse[item.id] : '∞'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('right.simDebug')}</h3>
      <div className="kv"><span>{t('debug.measuredTps')}</span><span>{measuredTickRate.toFixed(2)}</span></div>
      <div className="kv"><span>{t('debug.simTick')}</span><span>{sim.tick}</span></div>
      <div className="kv"><span>{t('debug.simSeconds')}</span><span>{sim.stats.simSeconds.toFixed(2)}</span></div>
    </>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-title">{t('app.title')}</div>
          <label className="language-switch">
            <span>{t('app.language')}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setIsWikiOpen(true)}>{t('top.wiki')}</button>
        </div>
        <div className="topbar-controls">
          <span className="hint hint-dynamic">{uiHint}</span>
          <span className="hint">{t('top.zoomHint', { size: cellSize })}</span>
          {!sim.isRunning ? (
            <button
              onClick={async () => {
                if (unknownDevices.length > 0) {
                  dialogAlertNonBlocking(t('dialog.legacyUnknownTypesStartBlocked'), {
                    title: t('dialog.title.warning'),
                    closeText: t('dialog.ok'),
                    variant: 'warning',
                  })
                  return
                }
                updateSim((current) => startSimulation(layout, current))
              }}
            >
              {t('top.start')}
            </button>
          ) : (
            <button onClick={() => updateSim((current) => stopSimulation(current))}>{t('top.stop')}</button>
          )}
          {[0, 0.25, 1, 2, 4, 16].map((speed) => (
            <button
              key={speed}
              className={sim.speed === speed ? 'active' : ''}
              onClick={() => updateSim((current) => ({ ...current, speed: speed as 0 | 0.25 | 1 | 2 | 4 | 16 }))}
            >
              {speed === 0 ? t('top.pauseSpeed') : `${speed}x`}
            </button>
          ))}
        </div>
      </header>

      <main
        className="main-grid"
        style={{
          ['--left-panel-width' as string]: `${leftPanelWidth}px`,
          ['--right-panel-width' as string]: `${rightPanelWidth}px`,
        }}
      >
        <aside className="panel left-panel">
          {!sim.isRunning && (
            <>
              <h3>{t('left.mode')}</h3>
              {(['place', 'blueprint', 'delete'] as const).map((entry) => (
                <button
                  key={entry}
                  className={mode === entry ? 'active' : ''}
                  onClick={() => {
                    if (sim.isRunning && entry === 'place') return
                    if (entry === 'place') {
                      setPlaceOperation('default')
                      setLogStart(null)
                      setLogCurrent(null)
                      setLogTrace([])
                      setPlaceType('')
                    }
                    setMode(entry)
                  }}
                >
                  {getModeLabel(language, entry)}
                </button>
              ))}
            </>
          )}

          {!sim.isRunning && mode === 'place' && (
            <>
              <h3>{t('left.operation')}</h3>
              <div className="place-device-grid">
                <button
                  className={`place-device-button ${placeOperation === 'default' && !placeType ? 'active' : ''}`}
                  onClick={() => {
                    setPlaceOperation('default')
                    setPlaceType('')
                    setLogStart(null)
                    setLogCurrent(null)
                    setLogTrace([])
                  }}
                >
                  <span className="operation-pointer-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path d="M5 3L5 18L9.5 13.5L13 21L16.2 19.6L12.8 12.1L18.8 12.1L5 3Z" />
                    </svg>
                  </span>
                  <span className="place-device-label">{t('left.operationSelect')}</span>
                </button>

                <button
                  className={`place-device-button ${placeOperation === 'belt' ? 'active' : ''}`}
                  onClick={() => {
                    setPlaceOperation('belt')
                    setPlaceType('')
                    setLogStart(null)
                    setLogCurrent(null)
                    setLogTrace([])
                  }}
                >
                  <img className="place-device-icon" src="/device-icons/item_log_belt_01.png" alt="" aria-hidden="true" draggable={false} />
                  <span className="place-device-label">{t('left.placeBelt')}</span>
                </button>

                <button className="place-device-button" onClick={saveSelectionAsBlueprint}>
                  <span className="operation-pointer-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path d="M6 3H16L20 7V21H6V3ZM8 5V19H18V8H15V5H8ZM10 13H16V17H10V13Z" />
                    </svg>
                  </span>
                  <span className="place-device-label">{t('left.saveBlueprint')}</span>
                </button>
              </div>

              <h3>{t('left.device')}</h3>
              <div className="place-groups-scroll">
                {PLACE_GROUP_ORDER.map((groupKey) => {
                  const devices = PLACEABLE_TYPES.filter((deviceType) => getPlaceGroup(deviceType.id) === groupKey)
                  return (
                    <section key={groupKey} className="place-group-section">
                      <h4 className="place-group-title">{t(PLACE_GROUP_LABEL_KEY[groupKey])}</h4>
                      {devices.length > 0 ? (
                        <div className="place-device-grid">
                          {devices.map((deviceType) => (
                            <button
                              key={deviceType.id}
                              className={`place-device-button ${placeType === deviceType.id ? 'active' : ''}`}
                              onClick={() => {
                                setPlaceOperation('default')
                                setPlaceType(deviceType.id)
                              }}
                            >
                              <img
                                className="place-device-icon"
                                src={getDeviceMenuIconPath(deviceType.id)}
                                alt=""
                                aria-hidden="true"
                                draggable={false}
                              />
                              <span className="place-device-label">{getDeviceLabel(language, deviceType.id)}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="place-group-empty">{t('left.group.empty')}</div>
                      )}
                    </section>
                  )
                })}
              </div>
            </>
          )}

          {!sim.isRunning && mode === 'delete' && (
            <>
              <h3>{t('left.deleteSubMode')}</h3>
              <button className={deleteTool === 'single' ? 'active' : ''} onClick={() => setDeleteTool('single')}>
                {t('left.deleteSingle')}
              </button>
              <button className={deleteTool === 'wholeBelt' ? 'active' : ''} onClick={() => setDeleteTool('wholeBelt')}>
                {t('left.deleteWholeBelt')}
              </button>
              <button className={deleteTool === 'box' ? 'active' : ''} onClick={() => setDeleteTool('box')}>
                {t('left.deleteBox')}
              </button>
              <button
                onClick={async () => {
                  if (sim.isRunning) return
                  const confirmed = await dialogConfirm(t('left.deleteAllConfirm'), {
                    title: t('dialog.title.confirm'),
                    confirmText: t('dialog.ok'),
                    cancelText: t('dialog.cancel'),
                    variant: 'warning',
                  })
                  if (!confirmed) return
                  setLayout((current) => ({
                    ...current,
                    devices: current.devices.filter((device) => foundationIdSet.has(device.instanceId)),
                  }))
                  setSelection([])
                }}
              >
                {t('left.deleteAll')}
              </button>
            </>
          )}

          {!sim.isRunning && mode === 'blueprint' && (
            <>
              <h3>{t('left.blueprintSubMode')}</h3>
              {blueprints.length === 0 ? (
                <div className="place-group-empty">{t('left.blueprintEmpty')}</div>
              ) : (
                <div className="place-groups-scroll">
                  <section className="place-group-section">
                    <div className="place-device-grid">
                      {blueprints.map((blueprint) => (
                        <button
                          key={blueprint.id}
                          className={`place-device-button ${selectedBlueprintId === blueprint.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedBlueprintId(blueprint.id)
                            showToast(t('toast.blueprintSelected', { name: blueprint.name }))
                          }}
                        >
                          <span className="place-device-label">{blueprint.name}</span>
                          <span className="place-device-label place-device-label-subtle">
                            {t('left.blueprintCount', { count: blueprint.devices.length })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </>
          )}

          {sim.isRunning && statsAndDebugSection}
        </aside>

        <div
          className="panel-resizer panel-resizer-left"
          onMouseDown={(event) => {
            event.preventDefault()
            beginPanelResize('left', event.clientX)
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left panel"
        />

        <section className="canvas-panel panel">
          <div
            ref={viewportRef}
            className={`canvas-viewport${isPanning ? ' panning' : ''}`}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
            onWheel={onCanvasWheel}
            onContextMenu={(event) => event.preventDefault()}
            onAuxClick={(event) => event.preventDefault()}
          >
            <div
              ref={gridRef}
              className={`grid-canvas mode-${mode}`}
              style={{
                width: canvasWidthPx,
                height: canvasHeightPx,
                backgroundSize: `${BASE_CELL_SIZE}px ${BASE_CELL_SIZE}px`,
                transformOrigin: 'top left',
                transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoomScale})`,
              }}
            >
              <div
                className="world-layer"
                style={{
                  left: canvasOffsetXPx,
                  top: canvasOffsetYPx,
                  width: layout.lotSize * BASE_CELL_SIZE,
                  height: layout.lotSize * BASE_CELL_SIZE,
                }}
              >
                <div className="lot-border" />

                {powerRangeOutlines.map((outline) => (
                  <div
                    key={outline.key}
                    className="power-range-outline"
                    style={{
                      left: outline.left,
                      top: outline.top,
                      width: outline.width,
                      height: outline.height,
                    }}
                  />
                ))}

                <StaticDeviceLayer
                  devices={layout.devices}
                  selectionSet={selectionSet}
                  invalidSelectionSet={dragInvalidSelection}
                  previewOriginsById={dragPreviewOriginsById}
                  language={language}
                  showRuntimeItemIcons={false}
                />

                {mode === 'place' && placeOperation === 'belt' && logisticsPreviewDevices.length > 0 && (
                  <StaticDeviceLayer
                    devices={logisticsPreviewDevices}
                    selectionSet={new Set()}
                    invalidSelectionSet={new Set()}
                    previewOriginsById={new Map()}
                    language={language}
                    extraClassName="logistics-preview-device"
                    showRuntimeItemIcons={false}
                  />
                )}

                {blueprintPlacementPreview && blueprintPlacementPreview.devices.length > 0 && (
                  <StaticDeviceLayer
                    devices={blueprintPlacementPreview.devices}
                    selectionSet={new Set()}
                    invalidSelectionSet={new Set()}
                    previewOriginsById={new Map()}
                    language={language}
                    extraClassName={`blueprint-preview-device ${blueprintPlacementPreview.isValid ? 'valid' : 'invalid'}`}
                    showRuntimeItemIcons={false}
                  />
                )}

                {runtimeStallOverlays.map((overlay) => (
                  <div
                    key={overlay.key}
                    className={`device-runtime-overlay ${overlay.isBelt ? 'is-belt' : 'is-device'}`}
                    style={{
                      left: overlay.left,
                      top: overlay.top,
                      width: overlay.width,
                      height: overlay.height,
                    }}
                  />
                ))}

                <div className="in-transit-overlay" aria-hidden="true">
                  {inTransitItems.map((item) => (
                    <span
                      key={item.key}
                      className={`belt-item-box item-${item.itemId}`}
                      style={{
                        left: item.x,
                        top: item.y,
                        width: `${BASE_CELL_SIZE * 0.5}px`,
                        height: `${BASE_CELL_SIZE * 0.5}px`,
                      }}
                      title={`${getItemLabel(language, item.itemId)} @ ${item.progress01.toFixed(2)}`}
                    >
                      <img className="belt-item-cover" src={getItemIconPath(item.itemId)} alt="" draggable={false} />
                    </span>
                  ))}
                </div>

                {portChevrons.map((chevron) => (
                  <div
                    key={chevron.key}
                    className="port-chevron"
                    style={{
                      left: chevron.x,
                      top: chevron.y,
                      width: chevron.width,
                      height: chevron.height,
                      transform: `translate(-50%, -50%) rotate(${chevron.angle}deg)`,
                    }}
                  >
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <polyline className="port-chevron-outline" points="0,12 100,50 0,88" />
                      <polyline className="port-chevron-inner" points="0,22 84,50 0,78" />
                    </svg>
                  </div>
                ))}

                {placePreview && (
                  <div
                    className={`place-ghost ${placePreview.isValid ? 'valid' : 'invalid'}`}
                    style={{
                      left: placePreview.origin.x * BASE_CELL_SIZE,
                      top: placePreview.origin.y * BASE_CELL_SIZE,
                      width: placePreview.footprintSize.width * BASE_CELL_SIZE,
                      height: placePreview.footprintSize.height * BASE_CELL_SIZE,
                    }}
                  >
                    <div className="place-ghost-surface">
                      {placePreview.textureSrc && (
                        <img
                          className="place-ghost-texture"
                          src={placePreview.textureSrc}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                          style={{
                            width: `${placePreview.textureWidthPx}px`,
                            height: `${placePreview.textureHeightPx}px`,
                            transform: `translate(-50%, -50%) rotate(${placePreview.rotation}deg)`,
                          }}
                        />
                      )}
                    </div>
                    {placePreview.chevrons.map((chevron) => (
                      <div
                        key={chevron.key}
                        className="port-chevron place-ghost-chevron"
                        style={{
                          left: chevron.x,
                          top: chevron.y,
                          width: chevron.width,
                          height: chevron.height,
                          transform: `translate(-50%, -50%) rotate(${chevron.angle}deg)`,
                        }}
                      >
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          <polyline className="port-chevron-outline" points="0,12 100,50 0,88" />
                          <polyline className="port-chevron-inner" points="0,22 84,50 0,78" />
                        </svg>
                      </div>
                    ))}
                  </div>
                )}

                {dragRect && (
                  <div
                    className="selection-rect"
                    style={{
                      left: Math.min(dragRect.x1, dragRect.x2) * BASE_CELL_SIZE,
                      top: Math.min(dragRect.y1, dragRect.y2) * BASE_CELL_SIZE,
                      width: (Math.abs(dragRect.x2 - dragRect.x1) + 1) * BASE_CELL_SIZE,
                      height: (Math.abs(dragRect.y2 - dragRect.y1) + 1) * BASE_CELL_SIZE,
                    }}
                  />
                )}

              </div>
            </div>
          </div>
        </section>

        <div
          className="panel-resizer panel-resizer-right"
          onMouseDown={(event) => {
            event.preventDefault()
            beginPanelResize('right', event.clientX)
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
        />

        <aside className="panel right-panel">
          <h3>{t('right.lot')}</h3>
          {baseGroups.map((group) => {
            const groupedBases = BASES.filter((base) => base.tags.includes(group.tag))
            return (
              <section key={group.key} className="base-group-section">
                <h4 className="base-group-title">{t(group.titleKey)}</h4>
                <div className="row">
                  {groupedBases.length > 0 ? (
                    groupedBases.map((base) => (
                      <button
                        key={base.id}
                        className={currentBaseId === base.id ? 'active' : ''}
                        onClick={() => {
                          setActiveBaseId(base.id)
                          setSelection([])
                        }}
                      >
                        {base.name}
                      </button>
                    ))
                  ) : (
                    <p className="base-group-empty">{t('right.baseGroup.empty')}</p>
                  )}
                </div>
              </section>
            )
          })}
          <div className="kv"><span>{t('right.basePlaceableSize')}</span><span>{currentBase.placeableSize}x{currentBase.placeableSize}</span></div>
          <div className="kv">
            <span>{t('right.baseOuterRing')}</span>
            <span>
              T{currentBase.outerRing.top} R{currentBase.outerRing.right} B{currentBase.outerRing.bottom} L{currentBase.outerRing.left}
            </span>
          </div>
          <div className="kv"><span>{t('right.baseTags')}</span><span>{currentBase.tags.join(', ') || '-'}</span></div>

          <h3>{t('right.selected')}</h3>
          {selectedDevice ? (
            <>
              {DEVICE_TYPE_BY_ID[selectedDevice.typeId].tags && DEVICE_TYPE_BY_ID[selectedDevice.typeId].tags!.length > 0 && (
                <div className="kv"><span>{t('detail.tags')}</span><span>{DEVICE_TYPE_BY_ID[selectedDevice.typeId].tags!.join(', ')}</span></div>
              )}
              <div className="kv"><span>{t('detail.instanceId')}</span><span>{selectedDevice.instanceId}</span></div>
              <div className="kv"><span>{t('detail.deviceType')}</span><span>{getDeviceLabel(language, selectedDevice.typeId)}</span></div>
              <div className="kv"><span>{t('detail.rotation')}</span><span>{selectedDevice.rotation}</span></div>
              <div className="kv"><span>{t('detail.position')}</span><span>{selectedDevice.origin.x},{selectedDevice.origin.y}</span></div>
              <div className="kv"><span>{t('detail.currentStatus')}</span><span>{getRuntimeStatusText(selectedRuntime, t)}</span></div>
              <div className="kv">
                <span>{t('detail.internalStatus')}</span>
                <span>{getInternalStatusText(selectedDevice, selectedRuntime, t)}</span>
              </div>
              {selectedDevice.typeId.startsWith('belt_') && selectedRuntime && 'slot' in selectedRuntime && (
                <>
                  <div className="kv">
                    <span>{t('detail.currentItem')}</span>
                    <span>{selectedRuntime.slot ? getItemLabel(language, selectedRuntime.slot.itemId) : t('detail.empty')}</span>
                  </div>
                  <div className="kv">
                    <span>{t('detail.progress01')}</span>
                    <span>{selectedRuntime.slot ? selectedRuntime.slot.progress01.toFixed(2) : '0.00'}</span>
                  </div>
                  <div className="kv">
                    <span>{t('detail.avgTransitTicks')}</span>
                    <span>
                      {'transportSamples' in selectedRuntime && selectedRuntime.transportSamples > 0
                        ? (selectedRuntime.transportTotalTicks / selectedRuntime.transportSamples).toFixed(2)
                        : '-'}
                    </span>
                  </div>
                </>
              )}
              {selectedRuntime && (
                <>
                  {'inputBuffer' in selectedRuntime && 'outputBuffer' in selectedRuntime && (
                    (() => {
                      const recipe = recipeForDevice(selectedDevice.typeId)
                      const recipeCycleTicks = recipe ? cycleTicksFromSeconds(recipe.cycleSeconds, sim.tickRateHz) : 0
                      const progress = recipe
                        ? `${(selectedRuntime.progress01 * 100).toFixed(1)}% (${selectedRuntime.cycleProgressTicks}/${recipeCycleTicks})`
                        : `${(selectedRuntime.progress01 * 100).toFixed(1)}%`
                      const lastCompletedCycleTicks = selectedRuntime.lastCompletedCycleTicks
                      const lastCompletionIntervalTicks = selectedRuntime.lastCompletionIntervalTicks

                      return (
                        <>
                          <div className="kv">
                            <span>{t('detail.currentRecipe')}</span>
                            <span>{formatRecipeSummary(selectedDevice.typeId, language)}</span>
                          </div>
                          <div className="kv">
                            <span>{t('detail.productionProgress')}</span>
                            <span>{progress}</span>
                          </div>
                          <div className="kv">
                            <span>{t('detail.lastCompletedCycleTicks')}</span>
                            <span>{lastCompletedCycleTicks > 0 ? `${lastCompletedCycleTicks} Ticks` : '-'}</span>
                          </div>
                          <div className="kv">
                            <span>{t('detail.lastCompletionIntervalTicks')}</span>
                            <span>{lastCompletionIntervalTicks > 0 ? `${lastCompletionIntervalTicks} Ticks` : '-'}</span>
                          </div>
                        </>
                      )
                    })()
                  )}
                  {'inputBuffer' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheInputBuffer')}</span>
                      <span>
                        {formatInputBufferAmounts(
                          language,
                          selectedRuntime.inputBuffer,
                          selectedProcessorBufferSpec?.inputSlots ?? 1,
                          selectedProcessorBufferSpec?.inputTotalCapacity ?? 50,
                          t,
                        )}
                      </span>
                    </div>
                  )}
                  {'outputBuffer' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheOutputBuffer')}</span>
                      <span>
                        {formatOutputBufferAmounts(
                          language,
                          selectedRuntime.outputBuffer,
                          selectedProcessorBufferSpec?.outputSlots ?? 1,
                          selectedProcessorBufferSpec?.outputTotalCapacity ?? 50,
                          t,
                        )}
                      </span>
                    </div>
                  )}
                  {'inventory' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheInventory')}</span>
                      <span>{formatInventoryAmounts(language, selectedRuntime.inventory, t)}</span>
                    </div>
                  )}
                  {'slot' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheSlot')}</span>
                      <span>{formatSlotValue(selectedRuntime.slot, language, t)}</span>
                    </div>
                  )}
                  {'nsSlot' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheNsSlot')}</span>
                      <span>{formatSlotValue(selectedRuntime.nsSlot, language, t)}</span>
                    </div>
                  )}
                  {'weSlot' in selectedRuntime && (
                    <div className="kv">
                      <span>{t('detail.cacheWeSlot')}</span>
                      <span>{formatSlotValue(selectedRuntime.weSlot, language, t)}</span>
                    </div>
                  )}
                </>
              )}
              {selectedDevice.typeId === 'item_port_unloader_1' && (
                <div className="picker">
                  <label>{t('detail.pickupItem')}</label>
                  <button
                    type="button"
                    className="picker-open-btn"
                    disabled={sim.isRunning}
                    onClick={() => setItemPickerState({ kind: 'pickup', deviceInstanceId: selectedDevice.instanceId })}
                  >
                    <span className="pickup-picker-current">
                      {selectedPickupItemId ? (
                        <img
                          className="pickup-picker-current-icon"
                          src={getItemIconPath(selectedPickupItemId)}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                      ) : (
                        <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                      )}
                      <span>
                        {selectedPickupItemId
                          ? getItemLabel(language, selectedPickupItemId)
                          : t('detail.unselected')}
                      </span>
                    </span>
                  </button>
                </div>
              )}
              {selectedDevice.typeId === 'item_port_storager_1' && (
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={selectedDevice.config.submitToWarehouse ?? true}
                    disabled={sim.isRunning}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setLayout((current) => ({
                        ...current,
                        devices: current.devices.map((device) =>
                          device.instanceId === selectedDevice.instanceId
                            ? { ...device, config: { ...device.config, submitToWarehouse: checked } }
                            : device,
                        ),
                      }))
                    }}
                  />
                  {t('detail.submitWarehouse')}
                </label>
              )}
              {DEVICE_TYPE_BY_ID[selectedDevice.typeId].runtimeKind === 'processor' && !sim.isRunning && (
                <div className="picker">
                  <label>{t('detail.preloadInput')}</label>
                  <div className="preload-slot-list">
                    {selectedPreloadSlots.map((slot, slotIndex) => (
                      <div key={`${selectedDevice.instanceId}-preload-${slotIndex}`} className="preload-slot-row">
                        <span className="preload-slot-label">{t('detail.preloadSlot', { index: slotIndex + 1 })}</span>
                        <button
                          type="button"
                          className="picker-open-btn"
                          disabled={sim.isRunning}
                          onClick={() =>
                            setItemPickerState({
                              kind: 'preload',
                              deviceInstanceId: selectedDevice.instanceId,
                              slotIndex,
                            })
                          }
                        >
                          <span className="pickup-picker-current">
                            {slot.itemId ? (
                              <img
                                className="pickup-picker-current-icon"
                                src={getItemIconPath(slot.itemId)}
                                alt=""
                                aria-hidden="true"
                                draggable={false}
                              />
                            ) : (
                              <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                            )}
                            <span>{slot.itemId ? getItemLabel(language, slot.itemId) : t('detail.unselected')}</span>
                          </span>
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={selectedProcessorBufferSpec?.inputSlotCapacities[slotIndex] ?? 50}
                          step={1}
                          disabled={sim.isRunning || !slot.itemId}
                          value={slot.amount}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10)
                            const nextAmount = Number.isFinite(parsed) ? parsed : 0
                            updateProcessorPreloadSlot(selectedDevice.instanceId, slotIndex, { amount: nextAmount })
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <small>
                    {t('detail.preloadInputHint', {
                      cap: selectedProcessorBufferSpec?.inputTotalCapacity ?? 50,
                      slots: selectedProcessorBufferSpec?.inputSlots ?? 1,
                    })}
                  </small>
                  <small>
                    {t('detail.preloadInputTotal', {
                      total: selectedPreloadTotal,
                      cap: selectedProcessorBufferSpec?.inputTotalCapacity ?? 50,
                    })}
                  </small>
                </div>
              )}
            </>
          ) : (
            <p>{t('right.noneSelected')}</p>
          )}
        </aside>
      </main>

      {itemPickerState && pickerTargetDevice && (
        <div
          className="global-dialog-backdrop"
          role="presentation"
          onClick={() => setItemPickerState(null)}
        >
          <div
            className="global-dialog pickup-item-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('detail.itemPickerTitle')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="global-dialog-title">
              {itemPickerState.kind === 'pickup'
                ? t('detail.pickupDialogTitle')
                : t('detail.preloadDialogTitle', { index: itemPickerState.slotIndex + 1 })}
            </div>
            <div className="pickup-item-list">
              <button
                type="button"
                className={`pickup-item-option ${!pickerSelectedItemId ? 'active' : ''}`}
                onClick={() => {
                  if (itemPickerState.kind === 'pickup') {
                    updatePickupItem(pickerTargetDevice.instanceId, undefined)
                  } else {
                    updateProcessorPreloadSlot(pickerTargetDevice.instanceId, itemPickerState.slotIndex, { itemId: null })
                  }
                  setItemPickerState(null)
                }}
              >
                <span className="pickup-item-option-icon pickup-item-option-icon--empty">?</span>
                <span>{t('detail.unselected')}</span>
              </button>
              {ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`pickup-item-option ${pickerSelectedItemId === item.id ? 'active' : ''}`}
                  disabled={itemPickerState.kind === 'preload' && pickerDisabledItemIds.has(item.id)}
                  onClick={() => {
                    if (itemPickerState.kind === 'pickup') {
                      updatePickupItem(pickerTargetDevice.instanceId, item.id)
                    } else {
                      updateProcessorPreloadSlot(pickerTargetDevice.instanceId, itemPickerState.slotIndex, { itemId: item.id })
                    }
                    setItemPickerState(null)
                  }}
                >
                  <img
                    className="pickup-item-option-icon"
                    src={getItemIconPath(item.id)}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                  <span>{getItemLabel(language, item.id)}</span>
                </button>
              ))}
            </div>
            <div className="global-dialog-actions">
              <button className="global-dialog-btn" onClick={() => setItemPickerState(null)}>
                {t('dialog.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isWikiOpen && <WikiPanel language={language} t={t} onClose={() => setIsWikiOpen(false)} />}
    </div>
  )
}

export default App
