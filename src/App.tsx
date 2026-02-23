import { memo, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DEVICE_TYPE_BY_ID, ITEMS, PLACEABLE_TYPES, RECIPES } from './domain/registry'
import { getDeviceSpritePath } from './domain/deviceSprites'
import {
  buildOccupancyMap,
  cellToDeviceId,
  EDGE_ANGLE,
  getRotatedPorts,
} from './domain/geometry'
import { buildBeltTrackPath, getBeltItemPosition, junctionArrowPoints } from './domain/shared/beltVisual'
import {
  formatCompactNumber,
  formatCompactStock,
  formatInputBufferAmounts,
  formatInventoryAmounts,
  formatOutputBufferAmounts,
  formatSlotValue,
} from './domain/shared/formatters'
import { clamp, rotatedFootprintSize } from './domain/shared/math'
import { isKnownDeviceTypeId, isOreItemId } from './domain/shared/predicates'
import { recipeForDevice } from './domain/shared/recipes'
import { getRuntimeStatusText, shouldShowRuntimeStallOverlay } from './domain/shared/runtime'
import { cycleTicksFromSeconds } from './domain/shared/simulation'
import { clampViewportOffset, getMaxCellSizeForViewport, getZoomStep } from './domain/shared/viewport'
import type {
  DeviceInstance,
  DeviceRuntime,
  DeviceTypeId,
  EditMode,
  ItemId,
  Rotation,
} from './domain/types'
import { usePersistentState } from './core/usePersistentState'
import { createTranslator, getDeviceLabel, getItemLabel, type Language } from './i18n'
import { WikiPanel } from './ui/wikiPanel.tsx'
import { PlannerPanel } from './ui/plannerPanel.tsx'
import { LeftPanel } from './ui/panels/LeftPanel'
import { CenterPanel } from './ui/panels/CenterPanel'
import { RightPanel } from './ui/panels/RightPanel'
import { TopBar } from './ui/TopBar'
import { SiteInfoBar } from './ui/SiteInfoBar'
import { ItemPickerDialog } from './ui/dialogs/ItemPickerDialog'
import { WorldContent } from './ui/world/WorldContent'
import { useKnowledgeDomain } from './features/knowledge/useKnowledgeDomain'
import { useBaseLayoutDomain } from './features/base/useBaseLayoutDomain'
import { useSimulationDomain } from './features/simulation/useSimulationDomain'
import { useSimulationControlDomain } from './features/simulation/useSimulationControlDomain'
import { useObservabilityDomain } from './features/observability/useObservabilityDomain'
import { useWorldOverlaysDomain } from './features/observability/useWorldOverlaysDomain'
import { PLACE_GROUP_LABEL_KEY, PLACE_GROUP_ORDER, getPlaceGroup, useBuildDomainActions } from './features/build/useBuildDomain'
import { useBuildInteractionDomain } from './features/build/useBuildInteractionDomain'
import { useBuildPreviewDomain } from './features/build/useBuildPreviewDomain'
import { useBuildHotkeysDomain } from './features/build/useBuildHotkeysDomain'
import { useBuildPickerDomain } from './features/build/useBuildPickerDomain'
import { useBlueprintDomain } from './features/blueprint/useBlueprintDomain'
import { useBlueprintOrchestrationDomain } from './features/blueprint/useBlueprintOrchestrationDomain'
import { useBlueprintHotkeysDomain } from './features/blueprint/useBlueprintHotkeysDomain'
import {
  stopSimulation,
} from './sim/engine'

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

function getItemIconPath(itemId: ItemId) {
  return `/itemicon/${itemId}.png`
}

function getDeviceMenuIconPath(typeId: DeviceTypeId) {
  if (typeId === 'item_log_splitter') return '/device-icons/item_log_splitter.png'
  if (typeId === 'item_log_converger') return '/device-icons/item_log_converger.png'
  if (typeId === 'item_log_connector') return '/device-icons/item_log_connector.png'
  return `/device-icons/${typeId}.png`
}

function formatRecipeSummary(typeId: DeviceTypeId, language: Language) {
  const recipe = recipeForDevice(typeId)
  if (!recipe) return '-'
  const input = recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  const output = recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  return `${input} -> ${output}`
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

  const gridRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const deleteBoxConfirmingRef = useRef(false)
  const resizeStateRef = useRef<null | { side: 'left' | 'right'; startX: number; startWidth: number }>(null)

  const t = useMemo(() => createTranslator(language), [language])
  const {
    activeBaseId,
    setActiveBaseId,
    layout,
    setLayout,
    currentBaseId,
    currentBase,
    foundationIdSet,
    zoomScale,
    canvasOffsetXPx,
    canvasOffsetYPx,
    canvasWidthPx,
    canvasHeightPx,
    layoutRef,
    unknownDevicesCount,
  } = useBaseLayoutDomain({
    cellSize,
    baseCellSize: BASE_CELL_SIZE,
    setSelection,
    t,
  })

  const { isWikiOpen, setIsWikiOpen, isPlannerOpen, setIsPlannerOpen } = useKnowledgeDomain()
  const { sim, updateSim, measuredTickRate } = useSimulationDomain({ layoutRef })

  const occupancyMap = useMemo(() => buildOccupancyMap(layout), [layout])
  const cellDeviceMap = useMemo(() => cellToDeviceId(layout), [layout])
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

  const { blueprintPlacementPreview } = useBlueprintOrchestrationDomain({
    blueprints,
    selectedBlueprintId,
    setSelectedBlueprintId,
    activePlacementBlueprint,
    simIsRunning: sim.isRunning,
    hoverCell,
    blueprintPlacementRotation,
    buildBlueprintPlacementPreview,
  })

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

  const {
    itemPickerState,
    setItemPickerState,
    selectedDevice,
    selectedRuntime,
    selectedPickupItemId,
    selectedPickupItemIsOre,
    selectedPickupIgnoreInventory,
    selectedProcessorBufferSpec,
    selectedPreloadSlots,
    selectedPreloadTotal,
    pickerTargetDevice,
    pickerSelectedItemId,
    pickerDisabledItemIds,
    handleItemPickerSelect,
    updatePickupIgnoreInventory,
    updateProcessorPreloadSlot,
  } = useBuildPickerDomain({
    layout,
    selection,
    runtimeById: sim.runtimeById,
    simIsRunning: sim.isRunning,
    setLayout,
    isOreItemId,
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

  const { inTransitItems, runtimeStallOverlays, powerRangeOutlines } = useWorldOverlaysDomain({
    layout,
    runtimeById: sim.runtimeById,
    baseCellSize: BASE_CELL_SIZE,
    beltViewboxSize: BELT_VIEWBOX_SIZE,
    getBeltItemPosition,
    shouldShowRuntimeStallOverlay,
    rotatedFootprintSize,
  })

  const selectionSet = useMemo(() => new Set(selection), [selection])
  const dragPreviewOriginsById = useMemo(() => new Map(Object.entries(dragPreviewPositions)), [dragPreviewPositions])

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

  const { handleStartSimulation } = useSimulationControlDomain({
    unknownDevicesCount,
    t,
    layout,
    updateSim,
  })

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
