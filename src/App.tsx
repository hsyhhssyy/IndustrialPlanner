import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DEVICE_TYPE_BY_ID, PLACEABLE_TYPES } from './domain/registry'
import {
  buildOccupancyMap,
  cellToDeviceId,
  EDGE_ANGLE,
  isBufferedBeltTransportDevice,
} from './domain/geometry'
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
import { buildPortPriorityGroupConfig } from './domain/shared/portPriority'
import { isSuperRecipeDevice, shouldShowSuperRecipeContent } from './domain/shared/superRecipeVisibility'
import { getDeviceMenuIconPath, getItemIconPath } from './assets/iconPaths'
import type {
  DeviceInstance,
  DeviceRuntime,
  DeviceTypeId,
  ItemId,
  PowerMode,
  StorageSlotConfigEntry,
} from './domain/types'
import { usePersistentState } from './core/usePersistentState'
import { createTranslator, getItemLabel, type Language } from './i18n'
import { useAppContext } from './app/AppContext'
import { WorkbenchProvider } from './app/WorkbenchContext'
import { ActivityBar } from './ui/panels/ActivityBar'
import { LeftPanel } from './ui/panels/LeftPanel'
import { CenterPanel } from './ui/panels/CenterPanel'
import { RightPanel } from './ui/panels/RightPanel'
import { TopBar } from './ui/TopBar'
import { SiteInfoBar } from './ui/SiteInfoBar'
import { ToolDialog } from './ui/dialogs/ToolDialog'
import { HelpDialog } from './ui/dialogs/HelpDialog'
import { ItemPickerDialog } from './ui/dialogs/ItemPickerDialog'
import { PortPriorityConfigDialog } from './ui/dialogs/PortPriorityConfigDialog'
import { SettingsDialog } from './ui/dialogs/SettingsDialog'
import { StorageSlotConfigDialog } from './ui/dialogs/StorageSlotConfigDialog'
import { WorldContent } from './ui/world/WorldContent'
import { StaticDeviceLayer } from './ui/world/StaticDeviceLayer'
import { useBaseLayoutDomain } from './features/base/useBaseLayoutDomain'
import { useSimulationDomain } from './features/simulation/useSimulationDomain'
import { useSimulationControlDomain } from './features/simulation/useSimulationControlDomain'
import { useObservabilityDomain } from './features/observability/useObservabilityDomain'
import { useWorldOverlaysDomain } from './features/observability/useWorldOverlaysDomain'
import { PLACE_GROUP_LABEL_KEY, PLACE_GROUP_ORDER, getPlaceGroup, useBuildDomainActions } from './features/build/useBuildDomain'
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

  if (!isBufferedBeltTransportDevice(selectedDevice.typeId) || !('slot' in runtime)) {
    return getRuntimeStatusText(runtime, t)
  }

  const hasQueuedInput = 'inputBuffer' in runtime && Object.values(runtime.inputBuffer).some((amount) => (amount ?? 0) > 0)
  const hasReadyOutput = 'outputBuffer' in runtime && Object.values(runtime.outputBuffer).some((amount) => (amount ?? 0) > 0)
  const slot = runtime.slot
  if (!slot) return t(hasQueuedInput ? 'detail.internal.queuedInput' : 'detail.internal.readyInput')
  if (slot.progress01 < 1) return t('detail.internal.inTransit', { progress: slot.progress01.toFixed(2) })
  if (hasReadyOutput) return t('detail.internal.readyCommit', { progress: slot.progress01.toFixed(2) })
  return t('detail.internal.readyCommit', { progress: slot.progress01.toFixed(2) })
}

function formatRecipeSummary(typeId: DeviceTypeId, language: Language, recipeId?: string) {
  const recipe = recipeForDevice(typeId, recipeId)
  if (!recipe) return '-'
  const input = recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  const output = recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
  return `${input} -> ${output}`
}

const BASE_CELL_SIZE = 64
const STATS_TOP_N = 20
const LEFT_PANEL_MIN_WIDTH = 340
const RIGHT_PANEL_MIN_WIDTH = LEFT_PANEL_MIN_WIDTH
const PANEL_MAX_WIDTH = 560

const HIDDEN_DEVICE_LABEL_TYPES = new Set<DeviceTypeId>([
  'item_log_splitter',
  'item_log_converger',
  'item_log_connector',
  'item_log_admission',
  'item_pipe_splitter',
  'item_pipe_converger',
  'item_pipe_admission',
  'item_pipe_connector',
])
const OUT_OF_LOT_TOAST_KEY = 'toast.outOfLot'
const FALLBACK_PLACEMENT_TOAST_KEY = 'toast.invalidPlacementFallback'
const MAX_RECENT_PICKER_ITEMS = 32
const SLOT_CONFIG_SUPPORTED_TYPE_IDS = new Set<DeviceTypeId>([
  'item_port_storager_1',
  'item_port_sp_hub_1',
  'item_port_mix_pool_1',
])

function normalizeRecentPickerItemIds(value: ItemId[]) {
  if (!Array.isArray(value)) return []
  const unique: ItemId[] = []
  const seen = new Set<string>()
  for (const itemId of value) {
    if (typeof itemId !== 'string' || seen.has(itemId)) continue
    unique.push(itemId)
    seen.add(itemId)
    if (unique.length >= MAX_RECENT_PICKER_ITEMS) break
  }
  return unique
}

function normalizePowerDemandOverrideKw(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  return clamp(Math.round(value), 0, 999_999_999)
}

function getTouchDistance(touchA: Touch, touchB: Touch) {
  return Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY)
}

function getTouchMidpoint(touchA: Touch, touchB: Touch) {
  return {
    clientX: (touchA.clientX + touchB.clientX) / 2,
    clientY: (touchA.clientY + touchB.clientY) / 2,
  }
}

function App() {
  const currentYear = new Date().getFullYear()
  const [powerMode, setPowerMode] = usePersistentState<PowerMode>('stage3-power-mode', 'infinite')
  const [initialBatteryPercent, setInitialBatteryPercent] = usePersistentState<number>('stage3-initial-battery-percent', 100)
  const [configuredPowerDemandOverrideKw, setConfiguredPowerDemandOverrideKw] = usePersistentState<number | null>(
    'stage5-power-demand-override-kw',
    null,
    normalizePowerDemandOverrideKw,
  )
  const [recentPickerItemIds, setRecentPickerItemIds] = usePersistentState<ItemId[]>(
    'stage3-item-picker-recent-item-ids',
    [],
    normalizeRecentPickerItemIds,
  )
  const [storageSlotConfigDeviceId, setStorageSlotConfigDeviceId] = useState<string | null>(null)
  const [portPriorityConfigDeviceId, setPortPriorityConfigDeviceId] = useState<string | null>(null)

  const gridRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<null | { side: 'left' | 'right'; startX: number; startWidth: number }>(null)
  const pinchZoomStateRef = useRef<null | {
    startDistance: number
    startCellSize: number
    startMidpoint: { clientX: number; clientY: number }
    startViewOffset: { x: number; y: number }
  }>(null)

  const {
    state: {
      isToolOpen,
      isHelpOpen,
      isSettingsOpen,
      language,
      superRecipeEnabled,
      maxTicksPerFrame,
      uiTheme,
      leftPanelWidth,
      rightPanelWidth,
      leftPanelCollapsed,
      rightPanelCollapsed,
    },
    actions: {
      closeTool,
      closeHelp,
      closeSettings,
      appendDebugLog,
      setLeftPanelWidth,
      setRightPanelWidth,
      setLeftPanelCollapsed,
      setRightPanelCollapsed,
    },
    editor: {
      state: {
        mode,
        placeType,
        placeRotation,
        placeOperation,
        deleteTool,
        cellSize,
        viewOffset,
        selection,
        logStart,
        logCurrent,
        logTrace,
        hoverCell,
        dragPreviewPositions,
        dragInvalidSelection,
        dragRect,
      },
      actions: {
        setMode,
        setPlaceType,
        setPlaceRotation,
        setPlaceOperation,
        setCellSize,
        setViewOffset,
        setSelection,
        setLogStart,
        setLogCurrent,
        setLogTrace,
      },
    },
    eventBus,
  } = useAppContext()
  const t = useMemo(() => createTranslator(language), [language])
  const {
    activeBaseId,
    setActiveBaseId,
    layout,
    setLayout,
    currentBaseId,
    currentBase,
    foundationIdSet,
    foundationMovableIdSet,
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

  const {
    sim,
    updateSim,
    measuredTickRate,
    measuredFrameRate,
    smoothedFrameRate,
    minFrameRate,
    maxFrameRate,
    longFrame50Count,
    longFrame100Count,
    maxFrameTimeMs,
    avgFrameTimeMs,
    avgTicksPerFrame,
    maxTicksPerFrameSeen,
    avgTickWorkMs,
    maxTickWorkMs,
    avgUiCommitGapMs,
    maxUiCommitGapMs,
    avgPowerSupply1hKw,
    avgPowerSupply30mKw,
    avgPowerSupply10mKw,
  } = useSimulationDomain({ layoutRef, maxTicksPerFrame })

  const occupancyMap = useMemo(() => buildOccupancyMap(layout), [layout])
  const cellDeviceMap = useMemo(() => cellToDeviceId(layout), [layout])
  const visiblePlaceableTypes = useMemo(
    () =>
      PLACEABLE_TYPES.filter((deviceType) => {
        const matchesBase = !deviceType.tags?.includes('武陵') || currentBase.tags.includes('武陵')
        if (!matchesBase) return false
        return shouldShowSuperRecipeContent(superRecipeEnabled, isSuperRecipeDevice(deviceType))
      }),
    [currentBase, superRecipeEnabled],
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
    if (placeOperation !== 'pipe') return
    if (currentBase.tags.includes('武陵')) return
    setPlaceOperation('default')
    setLogStart(null)
    setLogCurrent(null)
    setLogTrace([])
  }, [currentBase.tags, placeOperation, setLogCurrent, setLogStart, setLogTrace, setPlaceOperation])

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  const {
    blueprints,
    userBlueprints,
    systemBlueprints,
    selectedBlueprintId,
    selectBlueprint,
    armedBlueprintId,
    setArmedBlueprintId,
    clipboardBlueprint,
    setClipboardBlueprint,
    blueprintPlacementRotation,
    setBlueprintPlacementRotation,
    armBlueprint,
    disarmBlueprint,
    renameBlueprint,
    shareBlueprintToClipboard,
    shareBlueprintToFile,
    importBlueprintFromText,
    importBlueprintFromFile,
    deleteBlueprint,
    activePlacementBlueprint,
    saveSelectionAsBlueprint,
    buildBlueprintPlacementPreview,
    cloneDeviceConfig,
  } = useBlueprintDomain({
    activeBaseId,
    placeOperation,
    layout,
    selection,
    foundationIdSet,
    t,
  })

  const { blueprintPlacementPreview } = useBlueprintOrchestrationDomain({
    blueprints,
    selectedBlueprintId,
    setSelectedBlueprintId: selectBlueprint,
    armedBlueprintId,
    setArmedBlueprintId,
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
    setInitialBatteryPercent((current) => {
      if (!Number.isFinite(current)) return 100
      return Math.min(100, Math.max(0, Math.floor(current)))
    })
  }, [setInitialBatteryPercent])

  useEffect(() => {
    setConfiguredPowerDemandOverrideKw((current) => normalizePowerDemandOverrideKw(current))
  }, [setConfiguredPowerDemandOverrideKw])

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
    setArmedBlueprintId,
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
    foundationMovableIdSet,
    currentBaseOuterRing: currentBase.outerRing,
    setLayout,
    outOfLotToastKey: OUT_OF_LOT_TOAST_KEY,
    fallbackPlacementToastKey: FALLBACK_PLACEMENT_TOAST_KEY,
    t,
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.dataset.uiTheme = uiTheme
    return () => {
      delete document.body.dataset.uiTheme
    }
  }, [uiTheme])

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

  const applyViewportPinchTransform = useCallback(
    (
      startCellSize: number,
      startViewOffset: { x: number; y: number },
      startMidpointClientX: number,
      startMidpointClientY: number,
      nextCellSize: number,
      nextMidpointClientX: number,
      nextMidpointClientY: number,
    ) => {
      const viewport = viewportRef.current
      if (!viewport) return

      const maxCellSize = getMaxCellSizeForViewport(viewport)
      const next = clamp(Math.round(nextCellSize), 12, maxCellSize)
      const viewportRect = viewport.getBoundingClientRect()
      const startAnchorX = startMidpointClientX - viewportRect.left
      const startAnchorY = startMidpointClientY - viewportRect.top
      const nextAnchorX = nextMidpointClientX - viewportRect.left
      const nextAnchorY = nextMidpointClientY - viewportRect.top
      const startZoomScale = startCellSize / BASE_CELL_SIZE
      const nextZoomScale = next / BASE_CELL_SIZE
      const startScaledCellSize = BASE_CELL_SIZE * startZoomScale

      const worldX = (startAnchorX - startViewOffset.x) / startScaledCellSize
      const worldY = (startAnchorY - startViewOffset.y) / startScaledCellSize
      const nextOffset = {
        x: nextAnchorX - worldX * BASE_CELL_SIZE * nextZoomScale,
        y: nextAnchorY - worldY * BASE_CELL_SIZE * nextZoomScale,
      }
      const clampedOffset = clampViewportOffset(
        nextOffset,
        { width: viewport.clientWidth, height: viewport.clientHeight },
        { width: canvasWidthPx * nextZoomScale, height: canvasHeightPx * nextZoomScale },
      )

      appendDebugLog(
        'pinch',
        `Pinch transform: ${startCellSize}px -> ${next}px, midpoint=(${Math.round(nextMidpointClientX)}, ${Math.round(nextMidpointClientY)}), viewport=${viewport.clientWidth}x${viewport.clientHeight}`,
      )

      setViewOffset(clampedOffset)
      if (next !== cellSize) {
        setCellSize(next)
      }
    },
    [appendDebugLog, canvasHeightPx, canvasWidthPx, cellSize, clampViewportOffset, getMaxCellSizeForViewport, setCellSize, setViewOffset],
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        pinchZoomStateRef.current = null
        return
      }

      const [touchA, touchB] = [event.touches[0], event.touches[1]]
      const startDistance = getTouchDistance(touchA, touchB)
      const startMidpoint = getTouchMidpoint(touchA, touchB)
      pinchZoomStateRef.current = {
        startDistance,
        startCellSize: cellSize,
        startMidpoint,
        startViewOffset: viewOffset,
      }
      appendDebugLog(
        'pinch',
        `Touch start: distance=${startDistance.toFixed(1)}, cellSize=${cellSize}px, midpoint=(${Math.round(startMidpoint.clientX)}, ${Math.round(startMidpoint.clientY)})`,
      )
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        pinchZoomStateRef.current = null
        return
      }

      const pinchState = pinchZoomStateRef.current
      if (!pinchState || pinchState.startDistance <= 0) return

      event.preventDefault()
      const [touchA, touchB] = [event.touches[0], event.touches[1]]
      const midpoint = getTouchMidpoint(touchA, touchB)
      const nextDistance = getTouchDistance(touchA, touchB)
      const scaleRatio = nextDistance / pinchState.startDistance
      if (!Number.isFinite(scaleRatio) || scaleRatio <= 0) return

      applyViewportPinchTransform(
        pinchState.startCellSize,
        pinchState.startViewOffset,
        pinchState.startMidpoint.clientX,
        pinchState.startMidpoint.clientY,
        pinchState.startCellSize * scaleRatio,
        midpoint.clientX,
        midpoint.clientY,
      )
    }

    const handleTouchEnd = () => {
      appendDebugLog('pinch', 'Touch end')
      pinchZoomStateRef.current = null
    }

    viewport.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false })
    viewport.addEventListener('touchend', handleTouchEnd)
    viewport.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
      viewport.removeEventListener('touchend', handleTouchEnd)
      viewport.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [appendDebugLog, applyViewportPinchTransform, cellSize, viewOffset])

  const {
    itemPickerState,
    setItemPickerState,
    selectedDevice,
    selectedRuntime,
    selectedAdmissionItemId,
    selectedAdmissionAmount,
    selectedPickupItemId,
    selectedPumpOutputItemId,
    selectedPickupItemIsOre,
    selectedPickupIgnoreInventory,
    selectedProtocolHubOutputs,
    selectedProcessorBufferSpec,
    selectedPreloadSlots,
    selectedPreloadTotal,
    pickerTargetDevice,
    pickerSelectedItemId,
    pickerFilter,
    pickerAllowsEmpty,
    pickerDisabledItemIds,
    handleItemPickerSelect,
    updateAdmissionAmount,
    updatePickupIgnoreInventory,
    updateProtocolHubOutputIgnoreInventory,
    updateProcessorPreloadSlot,
    reactorRecipeCandidates,
    selectedReactorPoolConfig,
    reactorSolidOutputItemCandidates,
    reactorLiquidOutputItemCandidates,
    updateReactorSelectedRecipe,
    updateReactorSolidOutputItem,
    updateReactorLiquidOutputItemA,
    updateReactorLiquidOutputItemB,
  } = useBuildPickerDomain({
    layout,
    selection,
    runtimeById: sim.runtimeById,
    simIsRunning: sim.isRunning,
    setLayout,
    isOreItemId,
  })

  const storageSlotConfigDevice = useMemo(() => {
    if (!storageSlotConfigDeviceId) return null
    const target = layout.devices.find((device) => device.instanceId === storageSlotConfigDeviceId)
    if (!target || !SLOT_CONFIG_SUPPORTED_TYPE_IDS.has(target.typeId)) return null
    return target
  }, [layout.devices, storageSlotConfigDeviceId])

  const portPriorityConfigDevice = useMemo(() => {
    if (!portPriorityConfigDeviceId) return null
    return layout.devices.find((device) => device.instanceId === portPriorityConfigDeviceId) ?? null
  }, [layout.devices, portPriorityConfigDeviceId])

  const { toPlaceOrigin, logisticsPreview, logisticsPreviewDevices, logisticsEndpointHighlights, portChevrons, placePreview } = useBuildPreviewDomain({
    layout,
    currentBaseOuterRing: currentBase.outerRing,
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
    hiddenLabelDeviceTypes: HIDDEN_DEVICE_LABEL_TYPES,
  })

  const centerInteractionParams = {
    viewport: {
      viewportRef,
      currentBaseOuterRing: currentBase.outerRing,
      zoomScale,
      viewOffset,
      canvasWidthPx,
      canvasHeightPx,
      baseCellSize: BASE_CELL_SIZE,
      cellSize,
      getMaxCellSizeForViewport,
      getZoomStep,
      clampViewportOffset,
    },
    build: {
      layout,
      setLayout,
      placeRotation,
      toPlaceOrigin,
      simIsRunning: sim.isRunning,
      logisticsPreview,
      cellDeviceMap,
      occupancyMap,
      foundationIdSet,
      foundationMovableIdSet,
    },
    blueprint: {
      activePlacementBlueprint,
      clipboardBlueprint,
      buildBlueprintPlacementPreview,
      blueprintPlacementRotation,
      setBlueprintPlacementRotation,
      setClipboardBlueprint,
      setArmedBlueprintId,
    },
    i18n: {
      t,
      outOfLotToastKey: OUT_OF_LOT_TOAST_KEY,
      fallbackPlacementToastKey: FALLBACK_PLACEMENT_TOAST_KEY,
    },
  }

  const { runtimeStallOverlays, powerRangeOutlines } = useWorldOverlaysDomain({
    layout,
    runtimeById: sim.runtimeById,
    baseCellSize: BASE_CELL_SIZE,
    shouldShowRuntimeStallOverlay,
    rotatedFootprintSize,
  })

  const selectionSet = useMemo(() => new Set(selection), [selection])
  const emptyHighlightedSet = useMemo(() => new Set<string>(), [])
  const dragPreviewOriginsById = useMemo(() => new Map(Object.entries(dragPreviewPositions)), [dragPreviewPositions])

  const powerPolePlacementPreview = useMemo(() => {
    if (mode !== 'place' || placeType !== 'item_port_power_diffuser_1' || !placePreview) {
      return {
        previewOutline: null as null | { key: string; left: number; top: number; width: number; height: number; isPreview: true },
        highlightedDeviceIds: emptyHighlightedSet,
      }
    }

    const poleX = placePreview.origin.x
    const poleY = placePreview.origin.y
    const minX = poleX - 5
    const maxX = poleX + 6
    const minY = poleY - 5
    const maxY = poleY + 6

    const highlightedDeviceIds = new Set<string>()
    for (const device of layout.devices) {
      const type = DEVICE_TYPE_BY_ID[device.typeId]
      if (!type || !type.requiresPower) continue
      const footprint = rotatedFootprintSize(type.size, device.rotation)
      let isInRange = false
      for (let y = 0; y < footprint.height && !isInRange; y += 1) {
        for (let x = 0; x < footprint.width; x += 1) {
          const cellX = device.origin.x + x
          const cellY = device.origin.y + y
          if (cellX >= minX && cellX <= maxX && cellY >= minY && cellY <= maxY) {
            isInRange = true
            break
          }
        }
      }
      if (isInRange) highlightedDeviceIds.add(device.instanceId)
    }

    return {
      previewOutline: {
        key: 'power-range-preview',
        left: minX * BASE_CELL_SIZE,
        top: minY * BASE_CELL_SIZE,
        width: 12 * BASE_CELL_SIZE,
        height: 12 * BASE_CELL_SIZE,
        isPreview: true as const,
      },
      highlightedDeviceIds,
    }
  }, [emptyHighlightedSet, layout.devices, mode, placePreview, placeType])

  const worldPowerRangeOutlines = useMemo(() => {
    if (!powerPolePlacementPreview.previewOutline) return powerRangeOutlines
    return [...powerRangeOutlines, powerPolePlacementPreview.previewOutline]
  }, [powerPolePlacementPreview.previewOutline, powerRangeOutlines])

  const worldPowerRangeCells = useMemo(() => {
    const cells = new Map<string, { key: string; left: number; top: number; width: number; height: number; isPreview?: boolean }>()
    for (const outline of worldPowerRangeOutlines) {
      const startX = Math.round(outline.left / BASE_CELL_SIZE)
      const startY = Math.round(outline.top / BASE_CELL_SIZE)
      const cellWidth = Math.round(outline.width / BASE_CELL_SIZE)
      const cellHeight = Math.round(outline.height / BASE_CELL_SIZE)
      for (let y = 0; y < cellHeight; y += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          const cellX = startX + x
          const cellY = startY + y
          const key = `${cellX},${cellY}`
          if (cells.has(key)) continue
          cells.set(key, {
            key: `power-range-cell-${key}`,
            left: cellX * BASE_CELL_SIZE,
            top: cellY * BASE_CELL_SIZE,
            width: BASE_CELL_SIZE,
            height: BASE_CELL_SIZE,
            isPreview: outline.isPreview,
          })
        }
      }
    }
    return [...cells.values()]
  }, [worldPowerRangeOutlines])

  const handleToggleLeftPanel = useCallback(() => {
    appendDebugLog('panel', `Toggle left panel requested: currentCollapsed=${leftPanelCollapsed}`)
    setLeftPanelCollapsed((current) => !current)
  }, [appendDebugLog, leftPanelCollapsed, setLeftPanelCollapsed])

  const handleToggleRightPanel = useCallback(() => {
    appendDebugLog('panel', `Toggle right panel requested: currentCollapsed=${rightPanelCollapsed}`)
    setRightPanelCollapsed((current) => !current)
  }, [appendDebugLog, rightPanelCollapsed, setRightPanelCollapsed])

  const uiHint = sim.isRunning
    ? t('status.running')
    : mode === 'blueprint'
      ? t('status.mode.blueprint')
      : mode === 'delete'
        ? t('status.mode.delete')
        : t('status.mode.place')

  const effectiveLeftPanelWidth = leftPanelCollapsed ? 0 : leftPanelWidth
  const effectiveRightPanelWidth = rightPanelCollapsed ? 0 : rightPanelWidth
  const leftPanelRailWidth = leftPanelCollapsed ? 0 : 6
  const rightPanelRailWidth = rightPanelCollapsed ? 0 : 6

  useEffect(() => {
    appendDebugLog('panel', `Left panel state changed: collapsed=${leftPanelCollapsed}, width=${effectiveLeftPanelWidth}`)
  }, [appendDebugLog, effectiveLeftPanelWidth, leftPanelCollapsed])

  useEffect(() => {
    appendDebugLog('panel', `Right panel state changed: collapsed=${rightPanelCollapsed}, width=${effectiveRightPanelWidth}`)
  }, [appendDebugLog, effectiveRightPanelWidth, rightPanelCollapsed])

  const ignoredInfiniteItemIds = useMemo(() => {
    const itemIds = new Set<ItemId>()
    for (const device of layout.devices) {
      if (device.typeId !== 'item_port_unloader_1' && device.typeId !== 'item_port_sp_hub_1') continue
      const outputs = device.config.protocolHubOutputs ?? []
      for (const output of outputs) {
        const outputItemId = output.itemId
        if (!outputItemId) continue
        if (isOreItemId(outputItemId) || output.ignoreInventory) {
          itemIds.add(outputItemId)
        }
      }

      if (device.typeId === 'item_port_unloader_1' && outputs.length === 0) {
        const pickupItemId = device.config.pickupItemId
        if (pickupItemId && (isOreItemId(pickupItemId) || device.config.pickupIgnoreInventory)) {
          itemIds.add(pickupItemId)
        }
      }
    }
    return itemIds
  }, [layout.devices])

  const { statsAndDebugSection } = useObservabilityDomain({
    sim,
    measuredTickRate,
    measuredFrameRate,
    smoothedFrameRate,
    minFrameRate,
    maxFrameRate,
    longFrame50Count,
    longFrame100Count,
    maxFrameTimeMs,
    avgFrameTimeMs,
    avgTicksPerFrame,
    maxTicksPerFrameSeen,
    avgTickWorkMs,
    maxTickWorkMs,
    avgUiCommitGapMs,
    maxUiCommitGapMs,
    avgPowerSupply1hKw,
    avgPowerSupply30mKw,
    avgPowerSupply10mKw,
    ignoredInfiniteItemIds,
    powerMode,
    language,
    t,
    formatCompactNumber,
    formatCompactStock,
    statsTopN: STATS_TOP_N,
  })

  const totalPowerDemandKw = useMemo(
    () => layout.devices.reduce((sum, device) => sum + (DEVICE_TYPE_BY_ID[device.typeId]?.powerDemand ?? 0), 0),
    [layout.devices],
  )

  const activePowerDemandOverrideKw = sim.isRunning ? sim.powerDemandOverrideKw : configuredPowerDemandOverrideKw

  const setActivePowerDemandOverrideKw = useCallback(
    (value: number | null) => {
      const normalized = normalizePowerDemandOverrideKw(value)
      if (sim.isRunning) {
        updateSim((current) => ({
          ...current,
          powerDemandOverrideKw: normalized,
        }))
        return
      }
      setConfiguredPowerDemandOverrideKw(normalized)
    },
    [setConfiguredPowerDemandOverrideKw, sim.isRunning, updateSim],
  )

  const beginPanelResize = (side: 'left' | 'right', startX: number) => {
    resizeStateRef.current = {
      side,
      startX,
      startWidth: side === 'left' ? leftPanelWidth : rightPanelWidth,
    }
  }

  const mainDeviceUnderlayLayer = (
    <StaticDeviceLayer
      renderPass="underlay"
      devices={layout.devices}
      selectionSet={selectionSet}
      invalidSelectionSet={dragInvalidSelection}
      highlightedSet={powerPolePlacementPreview.highlightedDeviceIds}
      previewOriginsById={dragPreviewOriginsById}
      language={language}
      showRuntimeItemIcons={false}
      showPreloadSummary={!sim.isRunning}
      runtimeById={sim.runtimeById}
      simTick={sim.tick}
    />
  )

  const mainDeviceTransitLayer = (
    <StaticDeviceLayer
      renderPass="transit"
      devices={layout.devices}
      selectionSet={selectionSet}
      invalidSelectionSet={dragInvalidSelection}
      highlightedSet={powerPolePlacementPreview.highlightedDeviceIds}
      previewOriginsById={dragPreviewOriginsById}
      language={language}
      showRuntimeItemIcons={false}
      showPreloadSummary={!sim.isRunning}
      runtimeById={sim.runtimeById}
      simTick={sim.tick}
    />
  )

  const mainDeviceOverlayLayer = (
    <StaticDeviceLayer
      renderPass="overlay"
      devices={layout.devices}
      selectionSet={selectionSet}
      invalidSelectionSet={dragInvalidSelection}
      highlightedSet={powerPolePlacementPreview.highlightedDeviceIds}
      previewOriginsById={dragPreviewOriginsById}
      language={language}
      showRuntimeItemIcons={false}
      showPreloadSummary={!sim.isRunning}
      runtimeById={sim.runtimeById}
      simTick={sim.tick}
    />
  )

  const mainDeviceAdornmentLayer = (
    <StaticDeviceLayer
      renderPass="adornment"
      devices={layout.devices}
      selectionSet={selectionSet}
      invalidSelectionSet={dragInvalidSelection}
      highlightedSet={powerPolePlacementPreview.highlightedDeviceIds}
      previewOriginsById={dragPreviewOriginsById}
      language={language}
      showRuntimeItemIcons={false}
      showPreloadSummary={!sim.isRunning}
      runtimeById={sim.runtimeById}
      simTick={sim.tick}
    />
  )

  const logisticsPreviewUnderlayLayer =
    mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe') && logisticsPreviewDevices.length > 0 ? (
      <StaticDeviceLayer
        renderPass="underlay"
        devices={logisticsPreviewDevices}
        selectionSet={new Set()}
        invalidSelectionSet={new Set()}
        highlightedSet={emptyHighlightedSet}
        previewOriginsById={new Map()}
        language={language}
        extraClassName="logistics-preview-device"
        showRuntimeItemIcons={false}
      />
    ) : null

  const logisticsPreviewOverlayLayer =
    mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe') && logisticsPreviewDevices.length > 0 ? (
      <StaticDeviceLayer
        renderPass="overlay"
        devices={logisticsPreviewDevices}
        selectionSet={new Set()}
        invalidSelectionSet={new Set()}
        highlightedSet={emptyHighlightedSet}
        previewOriginsById={new Map()}
        language={language}
        extraClassName="logistics-preview-device"
        showRuntimeItemIcons={false}
      />
    ) : null

  const blueprintPreviewUnderlayLayer =
    blueprintPlacementPreview && blueprintPlacementPreview.devices.length > 0 ? (
      <StaticDeviceLayer
        renderPass="underlay"
        devices={blueprintPlacementPreview.devices}
        selectionSet={new Set()}
        invalidSelectionSet={new Set()}
        highlightedSet={emptyHighlightedSet}
        previewOriginsById={new Map()}
        language={language}
        extraClassName={`blueprint-preview-device ${blueprintPlacementPreview.isValid ? 'valid' : 'invalid'}`}
        showRuntimeItemIcons={false}
      />
    ) : null

  const blueprintPreviewOverlayLayer =
    blueprintPlacementPreview && blueprintPlacementPreview.devices.length > 0 ? (
      <StaticDeviceLayer
        renderPass="overlay"
        devices={blueprintPlacementPreview.devices}
        selectionSet={new Set()}
        invalidSelectionSet={new Set()}
        highlightedSet={emptyHighlightedSet}
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
      powerRangeOutlines={worldPowerRangeOutlines}
      powerRangeCells={worldPowerRangeCells}
      underlayLayer={(
        <>
          {mainDeviceUnderlayLayer}
          {logisticsPreviewUnderlayLayer}
          {blueprintPreviewUnderlayLayer}
        </>
      )}
      transitLayer={<>{mainDeviceTransitLayer}</>}
      overlayLayer={(
        <>
          {mainDeviceOverlayLayer}
          {logisticsPreviewOverlayLayer}
          {blueprintPreviewOverlayLayer}
        </>
      )}
      adornmentLayer={<>{mainDeviceAdornmentLayer}</>}
      runtimeStallOverlays={runtimeStallOverlays}
      logisticsEndpointHighlights={logisticsEndpointHighlights}
      portChevrons={portChevrons}
      placePreview={placePreview}
      dragRect={dragRect}
    />
  )

  const { handleStartSimulation } = useSimulationControlDomain({
    unknownDevicesCount,
    t,
    layout,
    powerMode,
    initialBatteryPercent,
    powerDemandOverrideKw: configuredPowerDemandOverrideKw,
    updateSim,
    onStarted: () => {
      setMode('place')
      setPlaceOperation('default')
      setPlaceType('')
      setLogStart(null)
      setLogCurrent(null)
      setLogTrace([])
    },
  })

  useEffect(() => {
    const unsubscribeStart = eventBus.on('sim.control.start', () => {
      handleStartSimulation()
    })
    const unsubscribeStop = eventBus.on('sim.control.stop', () => {
      updateSim((current) => stopSimulation(current))
    })
    const unsubscribeSetSpeed = eventBus.on('sim.control.setSpeed', (speed) => {
      updateSim((current) => ({ ...current, speed }))
    })

    return () => {
      unsubscribeStart()
      unsubscribeStop()
      unsubscribeSetSpeed()
    }
  }, [eventBus, handleStartSimulation, updateSim])

  useEffect(() => {
    const unsubscribeDeleteAll = eventBus.on('left.delete.all', () => {
      void handleDeleteAll()
    })
    const unsubscribeDeleteAllBelts = eventBus.on('left.delete.allBelts', () => {
      void handleDeleteAllBelts()
    })
    const unsubscribeClearLot = eventBus.on('left.clearLot', () => {
      void handleClearLot()
    })
    const unsubscribeSaveSelectionAsBlueprint = eventBus.on('left.blueprint.saveSelection', () => {
      void saveSelectionAsBlueprint()
    })
    const unsubscribeSelectBlueprint = eventBus.on('left.blueprint.select', (id) => {
      selectBlueprint(id)
    })
    const unsubscribeArmBlueprint = eventBus.on('left.blueprint.arm', (id) => {
      setMode('blueprint')
      setPlaceOperation('blueprint')
      armBlueprint(id)
    })
    const unsubscribeDisarmBlueprint = eventBus.on('left.blueprint.disarm', () => {
      setMode('blueprint')
      setPlaceOperation('blueprint')
      disarmBlueprint()
    })
    const unsubscribeRenameBlueprint = eventBus.on('left.blueprint.rename', (id) => {
      void renameBlueprint(id)
    })
    const unsubscribeShareBlueprintToClipboard = eventBus.on('left.blueprint.shareClipboard', (id) => {
      void shareBlueprintToClipboard(id)
    })
    const unsubscribeShareBlueprintToFile = eventBus.on('left.blueprint.shareFile', (id) => {
      shareBlueprintToFile(id)
    })
    const unsubscribeImportBlueprintFromText = eventBus.on('left.blueprint.importText', (text) => {
      void importBlueprintFromText(text)
    })
    const unsubscribeImportBlueprintFromFile = eventBus.on('left.blueprint.importFile', (file) => {
      void importBlueprintFromFile(file)
    })
    const unsubscribeDeleteBlueprint = eventBus.on('left.blueprint.delete', (id) => {
      void deleteBlueprint(id)
    })

    return () => {
      unsubscribeDeleteAll()
      unsubscribeDeleteAllBelts()
      unsubscribeClearLot()
      unsubscribeSaveSelectionAsBlueprint()
      unsubscribeSelectBlueprint()
      unsubscribeArmBlueprint()
      unsubscribeDisarmBlueprint()
      unsubscribeRenameBlueprint()
      unsubscribeShareBlueprintToClipboard()
      unsubscribeShareBlueprintToFile()
      unsubscribeImportBlueprintFromText()
      unsubscribeImportBlueprintFromFile()
      unsubscribeDeleteBlueprint()
    }
  }, [
    armBlueprint,
    deleteBlueprint,
    disarmBlueprint,
    eventBus,
    handleClearLot,
    handleDeleteAll,
    handleDeleteAllBelts,
    importBlueprintFromFile,
    importBlueprintFromText,
    renameBlueprint,
    saveSelectionAsBlueprint,
    selectBlueprint,
    setMode,
    setPlaceOperation,
    shareBlueprintToClipboard,
    shareBlueprintToFile,
  ])

  return (
    <div className="app-shell" data-theme={uiTheme}>
      <TopBar
        isRunning={sim.isRunning}
        speed={sim.speed}
        cellSize={cellSize}
        leftPanelCollapsed={leftPanelCollapsed}
        rightPanelCollapsed={rightPanelCollapsed}
        onToggleLeftPanel={handleToggleLeftPanel}
        onToggleRightPanel={handleToggleRightPanel}
        t={t}
      />

      <main
        className="main-grid"
        style={{
          ['--left-panel-width' as string]: `${effectiveLeftPanelWidth}px`,
          ['--right-panel-width' as string]: `${effectiveRightPanelWidth}px`,
          ['--left-panel-rail-width' as string]: `${leftPanelRailWidth}px`,
          ['--right-panel-rail-width' as string]: `${rightPanelRailWidth}px`,
        }}
      >
        <ActivityBar simIsRunning={sim.isRunning} />

        <div className={`panel-slot panel-slot-left${leftPanelCollapsed ? ' is-collapsed' : ''}`} aria-hidden={leftPanelCollapsed}>
          {!leftPanelCollapsed && (
            <WorkbenchProvider
              value={{
                simIsRunning: sim.isRunning,
                mode,
                language,
                t,
                canUsePipePlacement: currentBase.tags.includes('武陵'),
                placeOperation,
                placeType,
                visiblePlaceableTypes,
                placeGroupOrder: PLACE_GROUP_ORDER,
                placeGroupLabelKey: PLACE_GROUP_LABEL_KEY,
                getPlaceGroup,
                getDeviceMenuIconPath,
                deleteTool,
                blueprints,
                userBlueprints,
                systemBlueprints,
                selectedBlueprintId,
                armedBlueprintId,
                statsAndDebugSection,
              }}
            >
              <LeftPanel />
            </WorkbenchProvider>
          )}
        </div>

        <div
          className={`panel-resizer panel-resizer-left${leftPanelCollapsed ? ' is-collapsed' : ''}`}
          onMouseDown={(event) => {
            if (leftPanelCollapsed) return
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
          interactionParams={centerInteractionParams}
          mode={mode}
          canvasWidthPx={canvasWidthPx}
          canvasHeightPx={canvasHeightPx}
          baseCellSize={BASE_CELL_SIZE}
          viewOffset={viewOffset}
          zoomScale={zoomScale}
          worldContent={worldContent}
        />

        <div
          className={`panel-resizer panel-resizer-right${rightPanelCollapsed ? ' is-collapsed' : ''}`}
          onMouseDown={(event) => {
            if (rightPanelCollapsed) return
            event.preventDefault()
            beginPanelResize('right', event.clientX)
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
        />

        <div className={`panel-slot panel-slot-right${rightPanelCollapsed ? ' is-collapsed' : ''}`} aria-hidden={rightPanelCollapsed}>
          {!rightPanelCollapsed && (
            <RightPanel
              t={t}
              language={language}
              layout={layout}
              currentBaseId={currentBaseId}
              currentBase={currentBase}
              totalPowerDemandKw={totalPowerDemandKw}
              powerMode={powerMode}
              setPowerMode={setPowerMode}
              initialBatteryPercent={initialBatteryPercent}
              setInitialBatteryPercent={setInitialBatteryPercent}
              powerDemandOverrideKw={activePowerDemandOverrideKw}
              setPowerDemandOverrideKw={setActivePowerDemandOverrideKw}
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
              selectedAdmissionItemId={selectedAdmissionItemId}
              selectedAdmissionAmount={selectedAdmissionAmount}
              selectedPickupItemId={selectedPickupItemId}
              selectedPumpOutputItemId={selectedPumpOutputItemId}
              selectedPickupItemIsOre={selectedPickupItemIsOre}
              selectedPickupIgnoreInventory={selectedPickupIgnoreInventory}
              selectedProtocolHubOutputs={selectedProtocolHubOutputs}
              getItemIconPath={getItemIconPath}
              setItemPickerState={setItemPickerState}
              updateAdmissionAmount={updateAdmissionAmount}
              updatePickupIgnoreInventory={updatePickupIgnoreInventory}
              updateProtocolHubOutputIgnoreInventory={updateProtocolHubOutputIgnoreInventory}
              setLayout={setLayout}
              openStorageSlotConfigDialog={(deviceInstanceId) => setStorageSlotConfigDeviceId(deviceInstanceId)}
              openPortPriorityConfigDialog={(deviceInstanceId) => setPortPriorityConfigDeviceId(deviceInstanceId)}
              updateProcessorPreloadSlot={updateProcessorPreloadSlot}
              reactorRecipeCandidates={reactorRecipeCandidates}
              selectedReactorPoolConfig={selectedReactorPoolConfig}
              reactorSolidOutputItemCandidates={reactorSolidOutputItemCandidates}
              reactorLiquidOutputItemCandidates={reactorLiquidOutputItemCandidates}
              updateReactorSelectedRecipe={updateReactorSelectedRecipe}
              updateReactorSolidOutputItem={updateReactorSolidOutputItem}
              updateReactorLiquidOutputItemA={updateReactorLiquidOutputItemA}
              updateReactorLiquidOutputItemB={updateReactorLiquidOutputItemB}
              simIsRunning={sim.isRunning}
            />
          )}
        </div>
      </main>

      <SiteInfoBar
        currentYear={currentYear}
        uiHint={uiHint}
        uiTheme={uiTheme}
        t={t}
      />

      {itemPickerState && pickerTargetDevice && (
        <ItemPickerDialog
          itemPickerState={itemPickerState}
          pickerSelectedItemId={pickerSelectedItemId}
          recentItemIds={recentPickerItemIds}
          pickerDisabledItemIds={pickerDisabledItemIds}
          pickerFilter={pickerFilter}
          pickerAllowsEmpty={pickerAllowsEmpty}
          superRecipeEnabled={superRecipeEnabled}
          language={language}
          t={t}
          getItemIconPath={getItemIconPath}
          onClose={() => setItemPickerState(null)}
          onSelectItem={(itemId) => {
            handleItemPickerSelect(itemId)
            if (!itemId) return
            setRecentPickerItemIds((current) => {
              const next = [itemId, ...current.filter((existing) => existing !== itemId)]
              return next.slice(0, MAX_RECENT_PICKER_ITEMS)
            })
          }}
        />
      )}

      {storageSlotConfigDevice && (
        <StorageSlotConfigDialog
          key={storageSlotConfigDevice.instanceId}
          device={storageSlotConfigDevice}
          language={language}
          t={t}
          getItemIconPath={getItemIconPath}
          onClose={() => setStorageSlotConfigDeviceId(null)}
          onSave={(slots: StorageSlotConfigEntry[]) => {
            setLayout((current) => ({
              ...current,
              devices: current.devices.map((device) => {
                if (device.instanceId !== storageSlotConfigDevice.instanceId || !SLOT_CONFIG_SUPPORTED_TYPE_IDS.has(device.typeId)) return device
                const nextConfig = { ...device.config }
                if (slots.length > 0) {
                  nextConfig.storageSlots = slots
                } else {
                  delete nextConfig.storageSlots
                }

                const legacyPreloads = slots
                  .filter((slot) => Boolean(slot.preloadItemId) && (slot.preloadAmount ?? 0) > 0)
                  .map((slot) => ({
                    slotIndex: slot.slotIndex,
                    itemId: slot.preloadItemId as ItemId,
                    amount: Math.max(0, Math.floor(slot.preloadAmount ?? 0)),
                  }))

                if (device.typeId === 'item_port_storager_1' || device.typeId === 'item_port_sp_hub_1') {
                  if (legacyPreloads.length > 0) {
                    nextConfig.storagePreloadInputs = legacyPreloads
                  } else {
                    delete nextConfig.storagePreloadInputs
                  }
                }

                return { ...device, config: nextConfig }
              }),
            }))
          }}
        />
      )}

      {portPriorityConfigDevice && (
        <PortPriorityConfigDialog
          key={portPriorityConfigDevice.instanceId}
          device={portPriorityConfigDevice}
          language={language}
          t={t}
          onClose={() => setPortPriorityConfigDeviceId(null)}
          onSave={(groupsByPort) => {
            setLayout((current) => ({
              ...current,
              devices: current.devices.map((device) => {
                if (device.instanceId !== portPriorityConfigDevice.instanceId) return device
                const nextConfig = { ...device.config }
                const normalizedGroups = buildPortPriorityGroupConfig(Object.entries(groupsByPort))
                if (normalizedGroups) {
                  nextConfig.portPriorityGroups = normalizedGroups
                } else {
                  delete nextConfig.portPriorityGroups
                }
                return { ...device, config: nextConfig }
              }),
            }))
          }}
        />
      )}

      {isToolOpen && <ToolDialog language={language} t={t} superRecipeEnabled={superRecipeEnabled} onClose={closeTool} />}
      {isHelpOpen && <HelpDialog language={language} t={t} onClose={closeHelp} />}
      {isSettingsOpen && <SettingsDialog t={t} onClose={closeSettings} />}
    </div>
  )
}

export default App
