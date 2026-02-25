import { useEffect, useMemo, useRef } from 'react'
import './App.css'
import { PLACEABLE_TYPES } from './domain/registry'
import {
  buildOccupancyMap,
  cellToDeviceId,
  EDGE_ANGLE,
} from './domain/geometry'
import { getBeltItemPosition } from './domain/shared/beltVisual'
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
  ItemId,
} from './domain/types'
import { usePersistentState } from './core/usePersistentState'
import { createTranslator, getItemLabel, type Language } from './i18n'
import { WikiPanel } from './ui/wikiPanel.tsx'
import { PlannerPanel } from './ui/plannerPanel.tsx'
import { useAppContext } from './app/AppContext'
import { WorkbenchProvider } from './app/WorkbenchContext'
import { LeftPanel } from './ui/panels/LeftPanel'
import { CenterPanel } from './ui/panels/CenterPanel'
import { RightPanel } from './ui/panels/RightPanel'
import { TopBar } from './ui/TopBar'
import { SiteInfoBar } from './ui/SiteInfoBar'
import { ItemPickerDialog } from './ui/dialogs/ItemPickerDialog'
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
  if (typeId === 'item_pipe_splitter') return '/device-icons/item_log_splitter.png'
  if (typeId === 'item_pipe_converger') return '/device-icons/item_log_converger.png'
  if (typeId === 'item_pipe_connector') return '/device-icons/item_log_connector.png'
  if (typeId === 'item_port_water_pump_1') return '/device-icons/liquid_placeholder_structure.svg'
  if (typeId === 'item_port_liquid_storager_1') return '/device-icons/liquid_placeholder_structure.svg'
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

const HIDDEN_DEVICE_LABEL_TYPES = new Set<DeviceTypeId>([
  'item_log_splitter',
  'item_log_converger',
  'item_log_connector',
  'item_pipe_splitter',
  'item_pipe_converger',
  'item_pipe_connector',
])
const HIDDEN_CHEVRON_DEVICE_TYPES = new Set<DeviceTypeId>([
  'item_log_splitter',
  'item_log_converger',
  'item_log_connector',
  'item_pipe_splitter',
  'item_pipe_converger',
  'item_pipe_connector',
])
const OUT_OF_LOT_TOAST_KEY = 'toast.outOfLot'
const FALLBACK_PLACEMENT_TOAST_KEY = 'toast.invalidPlacementFallback'
function App() {
  const currentYear = new Date().getFullYear()
  const [leftPanelWidth, setLeftPanelWidth] = usePersistentState<number>('stage1-left-panel-width', 340)
  const [rightPanelWidth, setRightPanelWidth] = usePersistentState<number>('stage1-right-panel-width', 340)

  const gridRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<null | { side: 'left' | 'right'; startX: number; startWidth: number }>(null)

  const {
    state: { isWikiOpen, isPlannerOpen, language },
    actions: { closeWiki, closePlanner },
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
        setViewOffset,
        setSelection,
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
    mode === 'place' && (placeOperation === 'belt' || placeOperation === 'pipe') && logisticsPreviewDevices.length > 0 ? (
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
    <div className="app-shell">
      <TopBar
        uiHint={uiHint}
        isRunning={sim.isRunning}
        speed={sim.speed}
        cellSize={cellSize}
        t={t}
      />

      <main
        className="main-grid"
        style={{
          ['--left-panel-width' as string]: `${leftPanelWidth}px`,
          ['--right-panel-width' as string]: `${rightPanelWidth}px`,
        }}
      >
        <WorkbenchProvider
          value={{
            simIsRunning: sim.isRunning,
            mode,
            language,
            t,
            placeOperation,
            placeType,
            visiblePlaceableTypes,
            placeGroupOrder: PLACE_GROUP_ORDER,
            placeGroupLabelKey: PLACE_GROUP_LABEL_KEY,
            getPlaceGroup,
            getDeviceMenuIconPath,
            deleteTool,
            blueprints,
            selectedBlueprintId,
            armedBlueprintId,
            statsAndDebugSection,
          }}
        >
          <LeftPanel />
        </WorkbenchProvider>

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

      {isWikiOpen && <WikiPanel language={language} t={t} onClose={closeWiki} />}
      {isPlannerOpen && <PlannerPanel language={language} t={t} onClose={closePlanner} />}
    </div>
  )
}

export default App
