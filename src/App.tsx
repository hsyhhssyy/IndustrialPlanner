import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { BASE_BY_ID, DEVICE_TYPE_BY_ID, ITEMS, PLACEABLE_TYPES, RECIPES } from './domain/registry'
import { getDeviceSpritePath } from './domain/deviceSprites'
import {
  buildOccupancyMap,
  cellToDeviceId,
  EDGE_ANGLE,
  getDeviceById,
  getRotatedPorts,
  isWithinLot,
  OPPOSITE_EDGE,
} from './domain/geometry'
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
  SlotData,
} from './domain/types'
import { usePersistentState } from './hooks/usePersistentState'
import { createTranslator, getDeviceLabel, getItemLabel, type Language } from './i18n'
import { dialogAlertNonBlocking, dialogConfirm } from './ui/dialog'
import { WikiPanel } from './ui/wikiPanel.tsx'
import { PlannerPanel } from './ui/plannerPanel.tsx'
import { LeftPanel } from './ui/panels/LeftPanel'
import { CenterPanel } from './ui/panels/CenterPanel'
import { RightPanel } from './ui/panels/RightPanel'
import { TopBar } from './ui/TopBar'
import { SiteInfoBar } from './ui/SiteInfoBar'
import { ItemPickerDialog } from './ui/dialogs/ItemPickerDialog'
import { WorldContent } from './ui/world/WorldContent'
import { useKnowledgeDomain } from './domains/knowledge/useKnowledgeDomain'
import { useSimulationDomain } from './domains/simulation/useSimulationDomain'
import { useObservabilityDomain } from './domains/observability/useObservabilityDomain'
import { PLACE_GROUP_LABEL_KEY, PLACE_GROUP_ORDER, getPlaceGroup, useBuildDomainActions } from './domains/build/useBuildDomain'
import { useBuildInteractionDomain } from './domains/build/useBuildInteractionDomain'
import { useBuildPreviewDomain } from './domains/build/useBuildPreviewDomain'
import { useBuildConfigDomain } from './domains/build/useBuildConfigDomain'
import { useBuildHotkeysDomain } from './domains/build/useBuildHotkeysDomain'
import { useBlueprintDomain } from './domains/blueprint/useBlueprintDomain'
import { useBlueprintHotkeysDomain } from './domains/blueprint/useBlueprintHotkeysDomain'
import {
  initialStorageConfig,
  runtimeLabel,
  startSimulation,
  stopSimulation,
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

function formatCompactNumber(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 10000) {
    return `${sign}${Math.floor(abs / 1000)}k`
  }

  const integerDigits = Math.floor(abs).toString().length
  if (integerDigits > 2) {
    return `${Math.round(value)}`
  }
  return value.toFixed(2)
}

function formatCompactStock(value: number) {
  if (!Number.isFinite(value)) return '∞'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 10000) {
    return `${sign}${Math.floor(abs / 1000)}k`
  }
  return `${Math.round(value)}`
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

function cycleTicksFromSeconds(cycleSeconds: number, tickRateHz: number) {
  return Math.max(1, Math.round(cycleSeconds * tickRateHz))
}

const BASE_CELL_SIZE = 64
const BELT_VIEWBOX_SIZE = 64
const STATS_TOP_N = 20
const LEFT_PANEL_MIN_WIDTH = 340
const RIGHT_PANEL_MIN_WIDTH = 260
const PANEL_MAX_WIDTH = 560

const HIDDEN_DEVICE_LABEL_TYPES = new Set<DeviceTypeId>(['item_log_splitter', 'item_log_converger', 'item_log_connector'])
const HIDDEN_CHEVRON_DEVICE_TYPES = new Set<DeviceTypeId>(['item_log_splitter', 'item_log_converger', 'item_log_connector'])
const OUT_OF_LOT_TOAST_KEY = 'toast.outOfLot'
const FALLBACK_PLACEMENT_TOAST_KEY = 'toast.invalidPlacementFallback'
const ORE_ITEM_TAG = '矿石'
const ORE_ITEM_ID_SET = new Set<ItemId>(ITEMS.filter((item) => item.tags?.includes(ORE_ITEM_TAG)).map((item) => item.id))

function isOreItemId(itemId: ItemId | undefined) {
  return Boolean(itemId && ORE_ITEM_ID_SET.has(itemId))
}

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
  const currentYear = new Date().getFullYear()
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
  const [selection, setSelection] = useState<string[]>([])
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
  const [itemPickerState, setItemPickerState] = useState<ItemPickerState | null>(null)

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
  const unknownDevicePromptKeyRef = useRef<string>('')
  const legacyLayoutMigratedRef = useRef(false)
  const deleteBoxConfirmingRef = useRef(false)
  const resizeStateRef = useRef<null | { side: 'left' | 'right'; startX: number; startWidth: number }>(null)

  const { isWikiOpen, setIsWikiOpen, isPlannerOpen, setIsPlannerOpen } = useKnowledgeDomain()
  const { sim, updateSim, measuredTickRate } = useSimulationDomain({ layoutRef })

  const occupancyMap = useMemo(() => buildOccupancyMap(layout), [layout])
  const cellDeviceMap = useMemo(() => cellToDeviceId(layout), [layout])
  const t = useMemo(() => createTranslator(language), [language])
  const visiblePlaceableTypes = useMemo(
    () => PLACEABLE_TYPES.filter((deviceType) => !deviceType.tags?.includes('武陵') || currentBase.tags.includes('武陵')),
    [currentBase],
  )
  const { handleDeleteAll, handleDeleteAllBelts, handleClearLot } = useBuildDomainActions({
    simIsRunning: sim.isRunning,
    t,
    foundationIdSet,
    setLayout,
    setSelection,
  })

  useEffect(() => {
    if (!placeType) return
    const stillVisible = visiblePlaceableTypes.some((deviceType) => deviceType.id === placeType)
    if (!stillVisible) {
      setPlaceType('')
    }
  }, [placeType, setPlaceType, visiblePlaceableTypes])

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  const {
    blueprints,
    selectedBlueprintId,
    setSelectedBlueprintId,
    clipboardBlueprint,
    setClipboardBlueprint,
    blueprintPlacementRotation,
    setBlueprintPlacementRotation,
    activePlacementBlueprint,
    saveSelectionAsBlueprint,
    buildBlueprintPlacementPreview,
    cloneDeviceConfig,
  } = useBlueprintDomain({
    activeBaseId,
    mode,
    layout,
    selection,
    foundationIdSet,
    t,
  })

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
    setLeftPanelWidth((current) => clamp(Number.isFinite(current) ? current : 340, LEFT_PANEL_MIN_WIDTH, PANEL_MAX_WIDTH))
  }, [setLeftPanelWidth])

  useEffect(() => {
    setRightPanelWidth((current) => clamp(Number.isFinite(current) ? current : 340, RIGHT_PANEL_MIN_WIDTH, PANEL_MAX_WIDTH))
  }, [setRightPanelWidth])

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) return

      if (state.side === 'left') {
        const nextWidth = clamp(state.startWidth + (event.clientX - state.startX), LEFT_PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
        setLeftPanelWidth(nextWidth)
        return
      }

      const nextWidth = clamp(state.startWidth - (event.clientX - state.startX), RIGHT_PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
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

  useBlueprintHotkeysDomain({
    simIsRunning: sim.isRunning,
    activeBaseId,
    activePlacementBlueprint,
    layout,
    selection,
    foundationIdSet,
    cloneDeviceConfig,
    setClipboardBlueprint,
    setBlueprintPlacementRotation,
    t,
  })

  useBuildHotkeysDomain({
    simIsRunning: sim.isRunning,
    mode,
    placeType,
    setPlaceRotation,
    selection,
    layout,
    foundationIdSet,
    setLayout,
    outOfLotToastKey: OUT_OF_LOT_TOAST_KEY,
    fallbackPlacementToastKey: FALLBACK_PLACEMENT_TOAST_KEY,
    t,
  })

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
  const selectedPickupItemIsOre = isOreItemId(selectedPickupItemId)
  const selectedPickupIgnoreInventory =
    selectedDevice?.typeId === 'item_port_unloader_1' && selectedPickupItemId
      ? selectedPickupItemIsOre || Boolean(selectedDevice.config.pickupIgnoreInventory)
      : false
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

  const { updatePickupItem, updatePickupIgnoreInventory, updateProcessorPreloadSlot } = useBuildConfigDomain({
    setLayout,
    isOreItemId,
    processorBufferSpec,
    buildProcessorPreloadSlots,
    serializeProcessorPreloadSlots,
  })

  const { toPlaceOrigin, logisticsPreview, logisticsPreviewDevices, portChevrons, placePreview } = useBuildPreviewDomain({
    layout,
    mode,
    placeType,
    placeRotation,
    placeOperation,
    selection,
    dragPreviewPositions,
    hoverCell,
    simIsRunning: sim.isRunning,
    logStart,
    logCurrent,
    logTrace,
    baseCellSize: BASE_CELL_SIZE,
    edgeAngle: EDGE_ANGLE,
    hiddenChevronDeviceTypes: HIDDEN_CHEVRON_DEVICE_TYPES,
    hiddenLabelDeviceTypes: HIDDEN_DEVICE_LABEL_TYPES,
  })

  const { isPanning, onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseUp, onCanvasWheel } = useBuildInteractionDomain({
    viewportRef,
    currentBaseOuterRing: currentBase.outerRing,
    zoomScale,
    viewOffset,
    setViewOffset,
    canvasWidthPx,
    canvasHeightPx,
    baseCellSize: BASE_CELL_SIZE,
    cellSize,
    setCellSize,
    getMaxCellSizeForViewport,
    getZoomStep,
    clampViewportOffset,
    layout,
    setLayout,
    mode,
    placeOperation,
    setPlaceOperation,
    placeType,
    setPlaceType,
    placeRotation,
    toPlaceOrigin,
    simIsRunning: sim.isRunning,
    logisticsPreview,
    logStart,
    setLogStart,
    logCurrent,
    setLogCurrent,
    logTrace,
    setLogTrace,
    selection,
    setSelection,
    dragBasePositions,
    setDragBasePositions,
    dragPreviewPositions,
    setDragPreviewPositions,
    dragPreviewValid,
    setDragPreviewValid,
    dragInvalidMessage,
    setDragInvalidMessage,
    setDragInvalidSelection,
    dragStartCell,
    setDragStartCell,
    dragRect,
    setDragRect,
    dragOrigin,
    setDragOrigin,
    setHoverCell,
    cellDeviceMap,
    occupancyMap,
    foundationIdSet,
    deleteTool,
    deleteBoxConfirmingRef,
    activePlacementBlueprint,
    clipboardBlueprint,
    buildBlueprintPlacementPreview,
    blueprintPlacementRotation,
    setBlueprintPlacementRotation,
    setClipboardBlueprint,
    setSelectedBlueprintId,
    t,
    outOfLotToastKey: OUT_OF_LOT_TOAST_KEY,
    fallbackPlacementToastKey: FALLBACK_PLACEMENT_TOAST_KEY,
  })

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

  const ignoredInfiniteItemIds = useMemo(() => {
    const itemIds = new Set<ItemId>()
    for (const device of layout.devices) {
      if (device.typeId !== 'item_port_unloader_1') continue
      const pickupItemId = device.config.pickupItemId
      if (!pickupItemId) continue
      if (isOreItemId(pickupItemId) || device.config.pickupIgnoreInventory) {
        itemIds.add(pickupItemId)
      }
    }
    return itemIds
  }, [layout.devices])

  const { statsAndDebugSection } = useObservabilityDomain({
    sim,
    measuredTickRate,
    ignoredInfiniteItemIds,
    language,
    t,
    formatCompactNumber,
    formatCompactStock,
    statsTopN: STATS_TOP_N,
  })

  const beginPanelResize = (side: 'left' | 'right', startX: number) => {
    resizeStateRef.current = {
      side,
      startX,
      startWidth: side === 'left' ? leftPanelWidth : rightPanelWidth,
    }
  }

  const mainDeviceLayer = (
    <StaticDeviceLayer
      devices={layout.devices}
      selectionSet={selectionSet}
      invalidSelectionSet={dragInvalidSelection}
      previewOriginsById={dragPreviewOriginsById}
      language={language}
      showRuntimeItemIcons={false}
    />
  )

  const logisticsPreviewLayer =
    mode === 'place' && placeOperation === 'belt' && logisticsPreviewDevices.length > 0 ? (
      <StaticDeviceLayer
        devices={logisticsPreviewDevices}
        selectionSet={new Set()}
        invalidSelectionSet={new Set()}
        previewOriginsById={new Map()}
        language={language}
        extraClassName="logistics-preview-device"
        showRuntimeItemIcons={false}
      />
    ) : null

  const blueprintPreviewLayer =
    blueprintPlacementPreview && blueprintPlacementPreview.devices.length > 0 ? (
      <StaticDeviceLayer
        devices={blueprintPlacementPreview.devices}
        selectionSet={new Set()}
        invalidSelectionSet={new Set()}
        previewOriginsById={new Map()}
        language={language}
        extraClassName={`blueprint-preview-device ${blueprintPlacementPreview.isValid ? 'valid' : 'invalid'}`}
        showRuntimeItemIcons={false}
      />
    ) : null

  const worldContent = (
    <WorldContent
      baseCellSize={BASE_CELL_SIZE}
      canvasOffsetXPx={canvasOffsetXPx}
      canvasOffsetYPx={canvasOffsetYPx}
      lotSize={layout.lotSize}
      powerRangeOutlines={powerRangeOutlines}
      mainDeviceLayer={mainDeviceLayer}
      logisticsPreviewLayer={logisticsPreviewLayer}
      blueprintPreviewLayer={blueprintPreviewLayer}
      runtimeStallOverlays={runtimeStallOverlays}
      inTransitItems={inTransitItems}
      getItemLabelText={(itemId) => getItemLabel(language, itemId)}
      getItemIconPath={getItemIconPath}
      portChevrons={portChevrons}
      placePreview={placePreview}
      dragRect={dragRect}
    />
  )

  const handleStartSimulation = useCallback(() => {
    if (unknownDevices.length > 0) {
      dialogAlertNonBlocking(t('dialog.legacyUnknownTypesStartBlocked'), {
        title: t('dialog.title.warning'),
        closeText: t('dialog.ok'),
        variant: 'warning',
      })
      return
    }
    updateSim((current) => startSimulation(layout, current))
  }, [layout, t, unknownDevices.length, updateSim])

  const handleItemPickerSelect = useCallback(
    (itemId: ItemId | null) => {
      if (!itemPickerState || !pickerTargetDevice) return
      if (itemPickerState.kind === 'pickup') {
        updatePickupItem(pickerTargetDevice.instanceId, itemId ?? undefined)
      } else {
        updateProcessorPreloadSlot(pickerTargetDevice.instanceId, itemPickerState.slotIndex, { itemId })
      }
    },
    [itemPickerState, pickerTargetDevice, updatePickupItem, updateProcessorPreloadSlot],
  )

  return (
    <div className="app-shell">
      <TopBar
        language={language}
        setLanguage={setLanguage}
        onOpenWiki={() => setIsWikiOpen(true)}
        onOpenPlanner={() => setIsPlannerOpen(true)}
        uiHint={uiHint}
        isRunning={sim.isRunning}
        speed={sim.speed}
        cellSize={cellSize}
        onStart={handleStartSimulation}
        onStop={() => updateSim((current) => stopSimulation(current))}
        onSetSpeed={(speed) => updateSim((current) => ({ ...current, speed }))}
        t={t}
      />

      <main
        className="main-grid"
        style={{
          ['--left-panel-width' as string]: `${leftPanelWidth}px`,
          ['--right-panel-width' as string]: `${rightPanelWidth}px`,
        }}
      >
        <LeftPanel
          simIsRunning={sim.isRunning}
          mode={mode}
          setMode={setMode}
          language={language}
          t={t}
          placeOperation={placeOperation}
          setPlaceOperation={setPlaceOperation}
          placeType={placeType}
          setPlaceType={setPlaceType}
          setLogStart={setLogStart}
          setLogCurrent={setLogCurrent}
          setLogTrace={setLogTrace}
          visiblePlaceableTypes={visiblePlaceableTypes}
          placeGroupOrder={PLACE_GROUP_ORDER}
          placeGroupLabelKey={PLACE_GROUP_LABEL_KEY}
          getPlaceGroup={getPlaceGroup}
          getDeviceMenuIconPath={getDeviceMenuIconPath}
          saveSelectionAsBlueprint={() => {
            void saveSelectionAsBlueprint()
          }}
          deleteTool={deleteTool}
          setDeleteTool={setDeleteTool}
          onDeleteAll={() => {
            void handleDeleteAll()
          }}
          onDeleteAllBelts={() => {
            void handleDeleteAllBelts()
          }}
          onClearLot={() => {
            void handleClearLot()
          }}
          blueprints={blueprints}
          selectedBlueprintId={selectedBlueprintId}
          setSelectedBlueprintId={setSelectedBlueprintId}
          statsAndDebugSection={statsAndDebugSection}
        />

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

        <CenterPanel
          viewportRef={viewportRef}
          gridRef={gridRef}
          mode={mode}
          isPanning={isPanning}
          canvasWidthPx={canvasWidthPx}
          canvasHeightPx={canvasHeightPx}
          baseCellSize={BASE_CELL_SIZE}
          viewOffset={viewOffset}
          zoomScale={zoomScale}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onWheel={onCanvasWheel}
          worldContent={worldContent}
        />

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

        <RightPanel
          t={t}
          language={language}
          currentBaseId={currentBaseId}
          currentBase={currentBase}
          setActiveBaseId={setActiveBaseId}
          setSelection={setSelection}
          selectedDevice={selectedDevice}
          selectedRuntime={selectedRuntime}
          sim={sim}
          getRuntimeStatusText={getRuntimeStatusText}
          getInternalStatusText={getInternalStatusText}
          formatRecipeSummary={formatRecipeSummary}
          cycleTicksFromSeconds={cycleTicksFromSeconds}
          recipeForDevice={recipeForDevice}
          formatInputBufferAmounts={formatInputBufferAmounts}
          formatOutputBufferAmounts={formatOutputBufferAmounts}
          formatInventoryAmounts={formatInventoryAmounts}
          formatSlotValue={formatSlotValue}
          selectedProcessorBufferSpec={selectedProcessorBufferSpec}
          selectedPreloadSlots={selectedPreloadSlots}
          selectedPreloadTotal={selectedPreloadTotal}
          selectedPickupItemId={selectedPickupItemId}
          selectedPickupItemIsOre={selectedPickupItemIsOre}
          selectedPickupIgnoreInventory={selectedPickupIgnoreInventory}
          getItemIconPath={getItemIconPath}
          setItemPickerState={setItemPickerState}
          updatePickupIgnoreInventory={updatePickupIgnoreInventory}
          setLayout={setLayout}
          updateProcessorPreloadSlot={updateProcessorPreloadSlot}
          simIsRunning={sim.isRunning}
        />
      </main>

      <SiteInfoBar currentYear={currentYear} t={t} />

      {itemPickerState && pickerTargetDevice && (
        <ItemPickerDialog
          itemPickerState={itemPickerState}
          pickerSelectedItemId={pickerSelectedItemId}
          pickerDisabledItemIds={pickerDisabledItemIds}
          language={language}
          t={t}
          getItemIconPath={getItemIconPath}
          onClose={() => setItemPickerState(null)}
          onSelectItem={handleItemPickerSelect}
        />
      )}

      {isWikiOpen && <WikiPanel language={language} t={t} onClose={() => setIsWikiOpen(false)} />}
      {isPlannerOpen && <PlannerPanel language={language} t={t} onClose={() => setIsPlannerOpen(false)} />}
    </div>
  )
}

export default App
