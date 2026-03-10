import { useMemo, useState } from 'react'
import { BASES, DEVICE_TYPE_BY_ID } from '../../domain/registry'
import type { BaseDef, BaseId, DeviceInstance, DeviceRuntime, ItemId, LayoutState, PowerMode, SimState, SlotData } from '../../domain/types'
import { getDeviceLabel, getItemLabel, type Language } from '../../i18n'
import { isBufferedBeltTransportDevice, neighborsFromLinks } from '../../domain/geometry'
import {
  getPortPriorityGroup,
  hasCustomPortPriorityGroups,
  normalizePriorityCursorArray,
  orderPortsByPriorityGroup,
  shouldShowPortPriorityConfigButton,
} from '../../domain/shared/portPriority'
import type { ItemPickerState } from '../dialogs/itemPicker.types'

type ProcessorBufferSpec = {
  inputSlots: number
  outputSlots: number
  inputSlotCapacities: number[]
  outputSlotCapacities: number[]
  inputTotalCapacity: number
  outputTotalCapacity: number
}

type ProcessorPreloadSlot = { itemId: ItemId | null; amount: number }

type RightPanelProps = {
  t: (key: string, params?: Record<string, string | number>) => string
  language: Language
  layout: LayoutState
  currentBaseId: BaseId
  currentBase: BaseDef
  totalPowerDemandKw: number
  powerMode: PowerMode
  setPowerMode: (mode: PowerMode) => void
  initialBatteryPercent: number
  setInitialBatteryPercent: (value: number) => void
  powerDemandOverrideKw: number | null
  setPowerDemandOverrideKw: (value: number | null) => void
  setActiveBaseId: (id: BaseId) => void
  setSelection: (updater: string[] | ((current: string[]) => string[])) => void
  selectedDevice: DeviceInstance | null
  selectedRuntime: DeviceRuntime | undefined
  sim: SimState
  getRuntimeStatusText: (runtime: DeviceRuntime | undefined, t: (key: string, params?: Record<string, string | number>) => string) => string
  getInternalStatusText: (
    selectedDevice: DeviceInstance,
    runtime: DeviceRuntime | undefined,
    t: (key: string, params?: Record<string, string | number>) => string,
  ) => string
  formatRecipeSummary: (typeId: DeviceInstance['typeId'], language: Language, recipeId?: string) => string
  cycleTicksFromSeconds: (cycleSeconds: number, tickRateHz: number) => number
  recipeForDevice: (typeId: DeviceInstance['typeId'], recipeId?: string) => { cycleSeconds: number } | undefined
  formatInputBufferAmounts: (
    language: Language,
    amounts: Partial<Record<ItemId, number>>,
    slots: number,
    capacity: number,
    t: (key: string, params?: Record<string, string | number>) => string,
  ) => string
  formatOutputBufferAmounts: (
    language: Language,
    amounts: Partial<Record<ItemId, number>>,
    slots: number,
    capacity: number,
    t: (key: string, params?: Record<string, string | number>) => string,
  ) => string
  formatInventoryAmounts: (
    language: Language,
    amounts: Partial<Record<ItemId, number>>,
    t: (key: string, params?: Record<string, string | number>) => string,
  ) => string
  formatSlotValue: (
    slot: SlotData | null,
    language: Language,
    t: (key: string, params?: Record<string, string | number>) => string,
  ) => string
  selectedProcessorBufferSpec: ProcessorBufferSpec | null
  selectedPreloadSlots: ProcessorPreloadSlot[]
  selectedPreloadTotal: number
  selectedAdmissionItemId: ItemId | undefined
  selectedAdmissionAmount: number | undefined
  selectedPickupItemId: ItemId | undefined
  selectedPumpOutputItemId: ItemId | undefined
  selectedPickupItemIsOre: boolean
  selectedPickupIgnoreInventory: boolean
  selectedProtocolHubOutputs: Array<{
    portId: string
    portIndex: number
    itemId: ItemId | undefined
    itemIsOre: boolean
    ignoreInventory: boolean
  }>
  getItemIconPath: (itemId: ItemId) => string
  setItemPickerState: (
    state: ItemPickerState | null
  ) => void
  updateAdmissionAmount: (deviceInstanceId: string, admissionAmount: number | undefined) => void
  updatePickupIgnoreInventory: (deviceInstanceId: string, enabled: boolean) => void
  updateProtocolHubOutputIgnoreInventory: (deviceInstanceId: string, portId: string, enabled: boolean) => void
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
  openStorageSlotConfigDialog: (deviceInstanceId: string) => void
  openPortPriorityConfigDialog: (deviceInstanceId: string) => void
  updateProcessorPreloadSlot: (deviceInstanceId: string, slotIndex: number, patch: { itemId?: ItemId | null; amount?: number }) => void
  reactorRecipeCandidates: Array<{
    id: string
    cycleSeconds: number
    inputs: Array<{ itemId: ItemId; amount: number }>
    outputs: Array<{ itemId: ItemId; amount: number }>
  }>
  selectedReactorPoolConfig: {
    selectedRecipeIds: string[]
    solidOutputItemId?: string
    liquidOutputItemIdA?: string
    liquidOutputItemIdB?: string
  } | null
  reactorSolidOutputItemCandidates: ItemId[]
  reactorLiquidOutputItemCandidates: ItemId[]
  updateReactorSelectedRecipe: (deviceInstanceId: string, slotIndex: 0 | 1, recipeId: string | null) => void
  updateReactorSolidOutputItem: (deviceInstanceId: string, itemId: ItemId | null) => void
  updateReactorLiquidOutputItemA: (deviceInstanceId: string, itemId: ItemId | null) => void
  updateReactorLiquidOutputItemB: (deviceInstanceId: string, itemId: ItemId | null) => void
  simIsRunning: boolean
  onCollapse: () => void
}

export function RightPanel({
  t,
  language,
  layout,
  currentBaseId,
  currentBase,
  totalPowerDemandKw,
  powerMode,
  setPowerMode,
  initialBatteryPercent,
  setInitialBatteryPercent,
  powerDemandOverrideKw,
  setPowerDemandOverrideKw,
  setActiveBaseId,
  setSelection,
  selectedDevice,
  selectedRuntime,
  sim,
  getRuntimeStatusText,
  getInternalStatusText,
  formatRecipeSummary,
  cycleTicksFromSeconds,
  recipeForDevice,
  formatInputBufferAmounts,
  formatOutputBufferAmounts,
  formatInventoryAmounts,
  formatSlotValue,
  selectedProcessorBufferSpec,
  selectedPreloadSlots,
  selectedPreloadTotal,
  selectedAdmissionItemId,
  selectedAdmissionAmount,
  selectedPickupItemId,
  selectedPumpOutputItemId,
  selectedPickupItemIsOre,
  selectedPickupIgnoreInventory,
  selectedProtocolHubOutputs,
  getItemIconPath,
  setItemPickerState,
  updateAdmissionAmount,
  updatePickupIgnoreInventory,
  updateProtocolHubOutputIgnoreInventory,
  setLayout,
  openStorageSlotConfigDialog,
  openPortPriorityConfigDialog,
  updateProcessorPreloadSlot,
  reactorRecipeCandidates,
  selectedReactorPoolConfig,
  reactorSolidOutputItemCandidates,
  reactorLiquidOutputItemCandidates,
  updateReactorSelectedRecipe,
  updateReactorSolidOutputItem,
  updateReactorLiquidOutputItemA,
  updateReactorLiquidOutputItemB,
  simIsRunning,
  onCollapse,
}: RightPanelProps) {
  const slotConfigSupportedTypeIds = new Set<DeviceInstance['typeId']>([
    'item_port_storager_1',
    'item_port_sp_hub_1',
    'item_port_mix_pool_1',
  ])

  const getPreloadSlotLabel = (deviceTypeId: DeviceInstance['typeId'], slotIndex: number) => {
    if (deviceTypeId === 'item_port_xiranite_oven_1') {
      if (slotIndex === 0) return t('detail.preloadSlotSolidInput')
      if (slotIndex === 1) return t('detail.preloadSlotLiquidInput')
    }
    return t('detail.preloadSlot', { index: slotIndex + 1 })
  }

  const getReactorRecipeOptionLabel = (recipe: {
    id: string
    inputs: Array<{ itemId: ItemId; amount: number }>
    outputs: Array<{ itemId: ItemId; amount: number }>
  }) => {
    const inputLabel = recipe.inputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
    const outputLabel = recipe.outputs.map((entry) => `${getItemLabel(language, entry.itemId)} x${entry.amount}`).join(' + ')
    return `${inputLabel} -> ${outputLabel}`
  }

  const baseGroups = [
    { key: 'valley4', titleKey: 'right.baseGroup.valley4', tag: '四号谷地' },
    { key: 'wuling', titleKey: 'right.baseGroup.wuling', tag: '武陵' },
  ] as const
  const [showMultiBaseTooltip, setShowMultiBaseTooltip] = useState(false)

  const inputSourceDebugEntries = useMemo(() => {
    if (!selectedDevice || !selectedRuntime) return [] as Array<{ title: string; cursor: string; items: string[] }>

    const isBridgeConnectorType = (typeId: DeviceInstance['typeId']) => typeId === 'item_log_connector' || typeId === 'item_pipe_connector'
    const receiveLaneForPort = (device: DeviceInstance, runtime: DeviceRuntime, toPortId: string) => {
      if (isBufferedBeltTransportDevice(device.typeId) && 'slot' in runtime) return 'output'
      if (isBridgeConnectorType(device.typeId)) {
        if (toPortId.endsWith('_n') || toPortId.endsWith('_s')) return 'ns'
        return 'we'
      }
      if ('slot' in runtime) return 'slot'
      return 'output'
    }
    const lanePriorityCursors = (lane: string) => normalizePriorityCursorArray(selectedRuntime.inputPriorityGroupCursorByLane?.[`${selectedDevice.instanceId}:${lane}`])
    const sourceLabel = (instanceId: string) => {
      const sourceDevice = layout.devices.find((device) => device.instanceId === instanceId)
      return sourceDevice?.typeId ?? instanceId
    }

    const links = neighborsFromLinks(layout)
    const inLinks = links.inMap.get(selectedDevice.instanceId) ?? []
    if (inLinks.length === 0) return []

    const linksByPort = new Map<string, typeof inLinks>()
    for (const link of inLinks) {
      const existing = linksByPort.get(link.to.portId)
      if (existing) {
        existing.push(link)
      } else {
        linksByPort.set(link.to.portId, [link])
      }
    }

    const entries: Array<{ title: string; cursor: string; items: string[] }> = []
    const pushEntry = (title: string, cursor: string, lane: string, portOrder: string[]) => {
      const items: string[] = []
      const orderedPorts = orderPortsByPriorityGroup(portOrder, (portId) => getPortPriorityGroup(selectedDevice.config, portId), lanePriorityCursors(lane))

      for (const portId of orderedPorts) {
        const orderedLinks = [...(linksByPort.get(portId) ?? [])].sort((left, right) => {
          const fromCmp = left.from.instanceId.localeCompare(right.from.instanceId)
          if (fromCmp !== 0) return fromCmp
          return left.from.portId.localeCompare(right.from.portId)
        })
        const priorityGroup = getPortPriorityGroup(selectedDevice.config, portId)
        for (const link of orderedLinks) {
          items.push(`${portId} [G${priorityGroup}] ← ${sourceLabel(link.from.instanceId)}:${link.from.portId}`)
        }
      }
      if (items.length > 0) {
        entries.push({ title, cursor, items })
      }
    }

    const portsByLane = new Map<string, string[]>()
    for (const portId of [...linksByPort.keys()]) {
      const lane = receiveLaneForPort(selectedDevice, selectedRuntime, portId)
      const key = lane ?? 'unknown'
      const existing = portsByLane.get(key)
      if (existing) existing.push(portId)
      else portsByLane.set(key, [portId])
    }

    for (const [lane, ports] of portsByLane.entries()) {
      const activeCursorGroups = lanePriorityCursors(lane)
        .map((value, index) => ({ value, group: index + 1 }))
        .filter((entry) => entry.value > 0)
        .map((entry) => `G${entry.group}=${entry.value}`)
        .join(' ')
      pushEntry(t('detail.inputSourceOrderSharedLane', { lane }), activeCursorGroups || '-', lane, ports)
    }

    return entries
  }, [layout, selectedDevice, selectedRuntime, t])

  const canConfigurePortPriority = Boolean(selectedDevice && shouldShowPortPriorityConfigButton(selectedDevice))
  const hasCustomPortPriority = Boolean(selectedDevice && hasCustomPortPriorityGroups(selectedDevice.config))
  const isAdmissionDevice = selectedDevice?.typeId === 'item_log_admission'
  const showCompactAdmissionRuntimeView = Boolean(isAdmissionDevice && simIsRunning)
  const effectivePowerDemandKw = sim.isRunning ? sim.powerStats.totalDemandKw : (powerDemandOverrideKw ?? totalPowerDemandKw)

  return (
    <aside className="panel right-panel">
      <div className="right-lot-heading">
        <h3>{t('right.lot')}</h3>
        <span
          className="right-lot-tooltip-wrap"
          onMouseEnter={() => setShowMultiBaseTooltip(true)}
          onMouseLeave={() => setShowMultiBaseTooltip(false)}
        >
          <button
            type="button"
            className="right-lot-tooltip-trigger"
            aria-label={t('right.multiBaseHintLabel')}
            onClick={() => setShowMultiBaseTooltip((current) => !current)}
            onBlur={() => setShowMultiBaseTooltip(false)}
          >
            {t('right.multiBaseHintLabel')}
          </button>
          {showMultiBaseTooltip && (
            <span className="right-lot-tooltip-bubble" role="tooltip">
              {t('right.multiBaseHintContent')}
            </span>
          )}
        </span>
        <button
          type="button"
          className="panel-heading-toggle panel-heading-toggle-right"
          aria-label={t('panel.rightCollapse')}
          title={t('panel.rightCollapse')}
          onClick={() => onCollapse()}
        >
          {t('panel.collapseButton')}
        </button>
      </div>
      {simIsRunning ? (
        <section className="base-group-section">
          <p className="base-group-title">{currentBase.name}</p>
        </section>
      ) : (
        baseGroups.map((group) => {
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
                        if (simIsRunning) return
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
        })
      )}
      <div className="kv"><span>{t('right.basePlaceableSize')}</span><span>{currentBase.placeableSize}x{currentBase.placeableSize}</span></div>
      <div className="kv"><span>{t('right.totalPowerDemand')}</span><span>{totalPowerDemandKw} kW</span></div>
      <div className="kv">
        <span>{t('right.powerDemandOverride')}</span>
        <span>
          <input
            type="number"
            min={0}
            step={1}
            value={powerDemandOverrideKw ?? ''}
            placeholder={t('right.followRealDemand')}
            onChange={(event) => {
              const rawValue = event.target.value.trim()
              if (rawValue.length === 0) {
                setPowerDemandOverrideKw(null)
                return
              }
              const parsed = Number.parseInt(rawValue, 10)
              setPowerDemandOverrideKw(Number.isFinite(parsed) ? parsed : null)
            }}
          />
        </span>
      </div>
      <div className="kv"><span>{t('right.powerDemandEffective')}</span><span>{effectivePowerDemandKw} kW</span></div>
      <div className="kv">
        <span>{t('right.powerMode')}</span>
        <span>
          <select
            value={powerMode}
            disabled={simIsRunning}
            onChange={(event) => setPowerMode(event.target.value as PowerMode)}
          >
            <option value="real">{t('right.powerMode.real')}</option>
            <option value="infinite">{t('right.powerMode.infinite')}</option>
          </select>
        </span>
      </div>
      {powerMode === 'real' && (
        <div className="kv">
          <span>{t('right.initialBatteryPercent')}</span>
          <span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={initialBatteryPercent}
              disabled={simIsRunning}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                const normalized = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0
                setInitialBatteryPercent(normalized)
              }}
            />
          </span>
        </div>
      )}
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
          {!showCompactAdmissionRuntimeView && DEVICE_TYPE_BY_ID[selectedDevice.typeId].tags && DEVICE_TYPE_BY_ID[selectedDevice.typeId].tags!.length > 0 && (
            <div className="kv"><span>{t('detail.tags')}</span><span>{DEVICE_TYPE_BY_ID[selectedDevice.typeId].tags!.join(', ')}</span></div>
          )}
          {!showCompactAdmissionRuntimeView && <div className="kv"><span>{t('detail.instanceId')}</span><span>{selectedDevice.instanceId}</span></div>}
          <div className="kv"><span>{t('detail.deviceType')}</span><span>{getDeviceLabel(language, selectedDevice.typeId)}</span></div>
          {!showCompactAdmissionRuntimeView && <div className="kv"><span>{t('detail.devicePowerDemand')}</span><span>{DEVICE_TYPE_BY_ID[selectedDevice.typeId].powerDemand} kW</span></div>}
          {!showCompactAdmissionRuntimeView && <div className="kv"><span>{t('detail.rotation')}</span><span>{selectedDevice.rotation}</span></div>}
          {!showCompactAdmissionRuntimeView && <div className="kv"><span>{t('detail.position')}</span><span>{selectedDevice.origin.x},{selectedDevice.origin.y}</span></div>}
          <div className="kv"><span>{t('detail.currentStatus')}</span><span>{getRuntimeStatusText(selectedRuntime, t)}</span></div>
          <div className="kv">
            <span>{t('detail.internalStatus')}</span>
            <span>{getInternalStatusText(selectedDevice, selectedRuntime, t)}</span>
          </div>
          {selectedRuntime && !showCompactAdmissionRuntimeView && (
            <>
              <div className="kv">
                <span>{t('detail.inputSourceOrder')}</span>
                <span>{inputSourceDebugEntries.length > 0 ? t('detail.inputSourceOrderVisible') : t('detail.inputSourceOrderEmpty')}</span>
              </div>
              {inputSourceDebugEntries.map((entry, entryIndex) => (
                <div key={`input-source-order-${entryIndex}`}>
                  <div className="kv">
                    <span>{entry.title}</span>
                    <span>{entry.cursor}</span>
                  </div>
                  {entry.items.map((item, itemIndex) => (
                    <div key={`input-source-order-${entryIndex}-${itemIndex}`} className="kv">
                      <span>{t('detail.inputSourceOrderRank', { index: itemIndex + 1 })}</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          {!showCompactAdmissionRuntimeView && slotConfigSupportedTypeIds.has(selectedDevice.typeId) && (
            <div className="kv">
              <span>{t('detail.storageSlotConfig')}</span>
              <span>
                <button
                  type="button"
                  disabled={simIsRunning}
                  onClick={() => openStorageSlotConfigDialog(selectedDevice.instanceId)}
                >
                  {t('detail.storageSlotConfig')}
                </button>
              </span>
            </div>
          )}
          {!showCompactAdmissionRuntimeView && (
            <div className="kv">
              <span>{t('detail.portPriorityConfigStatus')}</span>
              <span>{hasCustomPortPriority ? t('detail.portPriorityConfigStatusCustom') : t('detail.portPriorityConfigStatusDefault')}</span>
            </div>
          )}
          {!showCompactAdmissionRuntimeView && canConfigurePortPriority && (
            <div className="kv">
              <span>{t('detail.portPriorityConfig')}</span>
              <span>
                <button
                  type="button"
                  disabled={simIsRunning}
                  onClick={() => openPortPriorityConfigDialog(selectedDevice.instanceId)}
                >
                  {t('detail.portPriorityConfig')}
                </button>
              </span>
            </div>
          )}
          {isBufferedBeltTransportDevice(selectedDevice.typeId) && selectedRuntime && 'slot' in selectedRuntime && (
            <>
              {(() => {
                const beltItemId = selectedRuntime.slot?.itemId
                  ?? ('outputBuffer' in selectedRuntime
                    ? selectedRuntime.outputSlotItems.find((itemId) => itemId && (selectedRuntime.outputBuffer[itemId] ?? 0) > 0)
                    : null)
                  ?? ('inputBuffer' in selectedRuntime
                    ? selectedRuntime.inputSlotItems.find((itemId) => itemId && (selectedRuntime.inputBuffer[itemId] ?? 0) > 0)
                    : null)

                return (
                  <div className="kv">
                    <span>{t('detail.currentItem')}</span>
                    <span>{beltItemId ? getItemLabel(language, beltItemId) : t('detail.empty')}</span>
                  </div>
                )
              })()}
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
              {!isBufferedBeltTransportDevice(selectedDevice.typeId) && 'inputBuffer' in selectedRuntime && 'outputBuffer' in selectedRuntime && (
                (() => {
                  if (selectedDevice.typeId === 'item_port_mix_pool_1' && sim.isRunning) {
                    const laneRecipeIds = selectedRuntime.reactorActiveRecipeIds ?? [undefined, undefined]
                    const laneProgressTicks = selectedRuntime.reactorCycleProgressTicks ?? [0, 0]
                    const lastCompletedCycleTicks = selectedRuntime.lastCompletedCycleTicks
                    const lastCompletionIntervalTicks = selectedRuntime.lastCompletionIntervalTicks

                    return (
                      <>
                        {[0, 1].map((laneIndex) => {
                          const recipeId = laneRecipeIds[laneIndex] ?? selectedReactorPoolConfig?.selectedRecipeIds[laneIndex]
                          const recipe = recipeId ? reactorRecipeCandidates.find((entry) => entry.id === recipeId) : undefined
                          const recipeLabel = recipe ? getReactorRecipeOptionLabel(recipe) : t('detail.reactorNoRecipe')
                          const cycleTicks = recipe ? cycleTicksFromSeconds(recipe.cycleSeconds, sim.tickRateHz) : 0
                          const laneTicks = laneProgressTicks[laneIndex] ?? 0
                          const progress =
                            recipe && cycleTicks > 0
                              ? `${(Math.min(1, laneTicks / cycleTicks) * 100).toFixed(1)}% (${laneTicks}/${cycleTicks})`
                              : '-'

                          return (
                            <div key={`reactor-parallel-progress-${laneIndex}`}>
                              <div className="kv">
                                <span>{t('detail.reactorRecipeSlot', { index: laneIndex + 1 })}</span>
                                <span>{recipeLabel}</span>
                              </div>
                              <div className="kv">
                                <span>{t('detail.reactorParallelProgress', { index: laneIndex + 1 })}</span>
                                <span>{progress}</span>
                              </div>
                            </div>
                          )
                        })}
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
                  }

                  const recipe = recipeForDevice(selectedDevice.typeId, selectedRuntime.activeRecipeId)
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
                        <span>{formatRecipeSummary(selectedDevice.typeId, language, selectedRuntime.activeRecipeId)}</span>
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
              {!isBufferedBeltTransportDevice(selectedDevice.typeId) && 'inputBuffer' in selectedRuntime && (
                selectedDevice.typeId === 'item_port_mix_pool_1' && sim.isRunning
                  ? (
                    <>
                      <div className="kv">
                        <span>{t('detail.reactorSlots')}</span>
                        <span>-</span>
                      </div>
                      {selectedRuntime.inputSlotItems.slice(0, 5).map((itemId, slotIndex) => {
                        const amount = itemId ? (selectedRuntime.inputBuffer[itemId] ?? 0) : 0
                        const value = itemId ? `${getItemLabel(language, itemId)} x${amount}` : t('detail.empty')
                        return (
                          <div key={`reactor-runtime-slot-${slotIndex}`} className="kv">
                            <span>{t('detail.preloadSlot', { index: slotIndex + 1 })}</span>
                            <span>{value}</span>
                          </div>
                        )
                      })}
                    </>
                    )
                  : (
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
                    )
              )}
              {!isBufferedBeltTransportDevice(selectedDevice.typeId) && 'outputBuffer' in selectedRuntime && (
                !(selectedDevice.typeId === 'item_port_mix_pool_1' && sim.isRunning) && (
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
                )
              )}
              {'inventory' in selectedRuntime && (
                <div className="kv">
                  <span>{t('detail.cacheInventory')}</span>
                  <span>{formatInventoryAmounts(language, selectedRuntime.inventory, t)}</span>
                </div>
              )}
              {'inventory' in selectedRuntime && Array.isArray(selectedRuntime.bufferGroups) && selectedRuntime.bufferGroups.length > 0 &&
                (selectedDevice.typeId === 'item_port_sp_hub_1' || selectedDevice.typeId === 'item_port_storager_1') && (
                <>
                  {selectedRuntime.bufferGroups[0].slots
                    .slice()
                    .sort((left, right) => left.slotIndex - right.slotIndex)
                    .map((slot) => (
                      <div key={`storage-runtime-slot-${slot.slotIndex}`} className="kv">
                        <span>{t('detail.preloadSlot', { index: slot.slotIndex + 1 })}</span>
                        <span>
                          {slot.currentItemId && slot.amount > 0
                            ? `${getItemLabel(language, slot.currentItemId)} x${slot.amount}`
                            : `${t('detail.empty')}${slot.mode === 'pinned' && !slot.pinnedItemId ? ' (pinned)' : ''}`}
                        </span>
                      </div>
                    ))}
                </>
              )}
              {'slot' in selectedRuntime && (
                <div className="kv">
                  <span>{t('detail.cacheSlot')}</span>
                  <span>{formatSlotValue(selectedRuntime.slot, language, t)}</span>
                </div>
              )}
              {(selectedDevice.typeId === 'item_log_connector' || selectedDevice.typeId === 'item_pipe_connector') && 'nsSlot' in selectedRuntime && (
                <div className="kv">
                  <span>{t('detail.cacheNsSlot')}</span>
                  <span>{formatSlotValue(selectedRuntime.nsSlot, language, t)}</span>
                </div>
              )}
              {(selectedDevice.typeId === 'item_log_connector' || selectedDevice.typeId === 'item_pipe_connector') && 'weSlot' in selectedRuntime && (
                <div className="kv">
                  <span>{t('detail.cacheWeSlot')}</span>
                  <span>{formatSlotValue(selectedRuntime.weSlot, language, t)}</span>
                </div>
              )}
            </>
          )}
          {selectedDevice.typeId === 'item_port_unloader_1' && (
            <>
              <div className="kv kv-no-border kv-pickup-inline">
                <span>{t('detail.pickupItem')}</span>
                <span className="kv-pickup-inline-value">
                  <span className="kv-pickup-stack">
                    <button
                      type="button"
                      className="picker-open-btn picker-open-btn-inline"
                      disabled={simIsRunning}
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
                    <label className="switch-toggle switch-toggle-inline" aria-label={t('detail.pickupIgnoreInventory')}>
                      <span className={`switch-side-label ${!selectedPickupIgnoreInventory ? 'active' : ''}`}>
                        {t('detail.pickupUseStock')}
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedPickupIgnoreInventory}
                        disabled={simIsRunning || !selectedPickupItemId || selectedPickupItemIsOre}
                        onChange={(event) => {
                          updatePickupIgnoreInventory(selectedDevice.instanceId, event.target.checked)
                        }}
                      />
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-thumb" />
                      </span>
                      <span className={`switch-side-label ${selectedPickupIgnoreInventory ? 'active' : ''}`}>
                        {t('detail.pickupIgnoreShort')}
                      </span>
                    </label>
                  </span>
                </span>
              </div>
            </>
          )}
          {selectedDevice.typeId === 'item_log_admission' && (
            <>
              {simIsRunning ? (
                <>
                  <div className="kv">
                    <span>{t('detail.admissionItem')}</span>
                    <span>{selectedAdmissionItemId ? getItemLabel(language, selectedAdmissionItemId) : t('detail.unselected')}</span>
                  </div>
                  <div className="kv">
                    <span>{t('detail.admissionAmount')}</span>
                    <span>{selectedAdmissionAmount ?? '-'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="kv kv-no-border kv-pickup-inline">
                    <span>{t('detail.admissionItem')}</span>
                    <span className="kv-pickup-inline-value">
                      <button
                        type="button"
                        className="picker-open-btn picker-open-btn-inline"
                        disabled={simIsRunning}
                        onClick={() => setItemPickerState({ kind: 'admission', deviceInstanceId: selectedDevice.instanceId })}
                      >
                        <span className="pickup-picker-current">
                          {selectedAdmissionItemId ? (
                            <img
                              className="pickup-picker-current-icon"
                              src={getItemIconPath(selectedAdmissionItemId)}
                              alt=""
                              aria-hidden="true"
                              draggable={false}
                            />
                          ) : (
                            <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                          )}
                          <span>{selectedAdmissionItemId ? getItemLabel(language, selectedAdmissionItemId) : t('detail.unselected')}</span>
                        </span>
                      </button>
                    </span>
                  </div>
                  <div className="kv">
                    <span>{t('detail.admissionAmount')}</span>
                    <span>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        step={1}
                        disabled={simIsRunning || !selectedAdmissionItemId}
                        value={selectedAdmissionAmount ?? ''}
                        placeholder={t('detail.unselected')}
                        onChange={(event) => {
                          const rawValue = event.target.value.trim()
                          if (rawValue.length === 0) {
                            updateAdmissionAmount(selectedDevice.instanceId, undefined)
                            return
                          }
                          const parsed = Number.parseInt(rawValue, 10)
                          updateAdmissionAmount(selectedDevice.instanceId, Number.isFinite(parsed) ? parsed : undefined)
                        }}
                      />
                    </span>
                  </div>
                </>
              )}
              {selectedRuntime && 'producedItemsTotal' in selectedRuntime && (
                <div className="kv">
                  <span>{t('detail.admissionPassedCount')}</span>
                  <span>{selectedRuntime.producedItemsTotal}</span>
                </div>
              )}
            </>
          )}
          {selectedDevice.typeId === 'item_port_water_pump_1' && (
            <>
              <div className="kv kv-no-border kv-pickup-inline">
                <span>{t('detail.pumpOutputLiquid')}</span>
                <span className="kv-pickup-inline-value">
                  <button
                    type="button"
                    className="picker-open-btn picker-open-btn-inline"
                    disabled={simIsRunning}
                    onClick={() => setItemPickerState({ kind: 'pumpOutput', deviceInstanceId: selectedDevice.instanceId })}
                  >
                    <span className="pickup-picker-current">
                      {selectedPumpOutputItemId ? (
                        <img
                          className="pickup-picker-current-icon"
                          src={getItemIconPath(selectedPumpOutputItemId)}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                      ) : (
                        <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                      )}
                      <span>
                        {selectedPumpOutputItemId
                          ? getItemLabel(language, selectedPumpOutputItemId)
                          : t('detail.unselected')}
                      </span>
                    </span>
                  </button>
                </span>
              </div>
            </>
          )}
          {selectedDevice.typeId === 'item_port_sp_hub_1' && (
            <>
              <div className="kv">
                <span>{t('detail.protocolHubOutputs')}</span>
                <span>{selectedProtocolHubOutputs.length}</span>
              </div>
              {selectedProtocolHubOutputs.map((entry) => (
                <div key={`protocol-hub-output-${entry.portId}`} className="kv kv-no-border kv-pickup-inline">
                  <span>{t('detail.protocolHubOutputPort', { index: entry.portIndex + 1 })}</span>
                  <span className="kv-pickup-inline-value">
                    <span className="kv-pickup-stack">
                      <button
                        type="button"
                        className="picker-open-btn picker-open-btn-inline"
                        disabled={simIsRunning}
                        onClick={() =>
                          setItemPickerState({
                            kind: 'protocolHubOutput',
                            deviceInstanceId: selectedDevice.instanceId,
                            portId: entry.portId,
                            portIndex: entry.portIndex,
                          })
                        }
                      >
                        <span className="pickup-picker-current">
                          {entry.itemId ? (
                            <img
                              className="pickup-picker-current-icon"
                              src={getItemIconPath(entry.itemId)}
                              alt=""
                              aria-hidden="true"
                              draggable={false}
                            />
                          ) : (
                            <span className="pickup-picker-current-icon pickup-picker-current-icon--empty">?</span>
                          )}
                          <span>{entry.itemId ? getItemLabel(language, entry.itemId) : t('detail.unselected')}</span>
                        </span>
                      </button>
                      <label className="switch-toggle switch-toggle-inline" aria-label={t('detail.pickupIgnoreInventory')}>
                        <span className={`switch-side-label ${!entry.ignoreInventory ? 'active' : ''}`}>
                          {t('detail.pickupUseStock')}
                        </span>
                        <input
                          type="checkbox"
                          checked={entry.ignoreInventory}
                          disabled={simIsRunning || !entry.itemId || entry.itemIsOre}
                          onChange={(event) => {
                            updateProtocolHubOutputIgnoreInventory(selectedDevice.instanceId, entry.portId, event.target.checked)
                          }}
                        />
                        <span className="switch-track" aria-hidden="true">
                          <span className="switch-thumb" />
                        </span>
                        <span className={`switch-side-label ${entry.ignoreInventory ? 'active' : ''}`}>
                          {t('detail.pickupIgnoreShort')}
                        </span>
                      </label>
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
          {selectedDevice.typeId === 'item_port_storager_1' && (
            <>
              <div className="kv kv-switch">
                <span>{t('detail.submitWarehouse')}</span>
                <span className="kv-switch-value">
                  <label className="switch-toggle" aria-label={t('detail.submitWarehouse')}>
                    <input
                      type="checkbox"
                      checked={selectedDevice.config.submitToWarehouse ?? true}
                      disabled={simIsRunning}
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
                    <span className="switch-track" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                  </label>
                </span>
              </div>
            </>
          )}
          {selectedDevice.typeId === 'item_port_mix_pool_1' && !simIsRunning && selectedReactorPoolConfig && (
            <div className="picker">
              <label>{t('detail.reactorPool')}</label>
              {[0, 1].map((index) => {
                const recipeId = selectedReactorPoolConfig.selectedRecipeIds[index] ?? ''
                return (
                  <div key={`reactor-recipe-slot-${index}`} className="preload-slot-row">
                    <span className="preload-slot-label">{t('detail.reactorRecipeSlot', { index: index + 1 })}</span>
                    <select
                      value={recipeId}
                      onChange={(event) => {
                        const value = event.target.value.trim()
                        updateReactorSelectedRecipe(selectedDevice.instanceId, index as 0 | 1, value.length > 0 ? value : null)
                      }}
                    >
                      <option value="">{t('detail.reactorNoRecipe')}</option>
                      {reactorRecipeCandidates.map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>
                          {getReactorRecipeOptionLabel(recipe)}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}

              <div className="preload-slot-row">
                <span className="preload-slot-label">{t('detail.reactorSolidOutputItem')}</span>
                <select
                  value={selectedReactorPoolConfig.solidOutputItemId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    updateReactorSolidOutputItem(selectedDevice.instanceId, value.length > 0 ? (value as ItemId) : null)
                  }}
                >
                  <option value="">{t('detail.reactorNoRecipe')}</option>
                  {reactorSolidOutputItemCandidates.map((itemId) => (
                    <option key={`reactor-solid-${itemId}`} value={itemId}>
                      {getItemLabel(language, itemId)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="preload-slot-row">
                <span className="preload-slot-label">{t('detail.reactorLiquidOutA')}</span>
                <select
                  value={selectedReactorPoolConfig.liquidOutputItemIdA ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    updateReactorLiquidOutputItemA(selectedDevice.instanceId, value.length > 0 ? (value as ItemId) : null)
                  }}
                >
                  <option value="">{t('detail.reactorNoRecipe')}</option>
                  {reactorLiquidOutputItemCandidates.map((itemId) => (
                    <option key={`reactor-liquid-${itemId}`} value={itemId}>
                      {getItemLabel(language, itemId)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="preload-slot-row">
                <span className="preload-slot-label">{t('detail.reactorLiquidOutB')}</span>
                <select
                  value={selectedReactorPoolConfig.liquidOutputItemIdB ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    updateReactorLiquidOutputItemB(selectedDevice.instanceId, value.length > 0 ? (value as ItemId) : null)
                  }}
                >
                  <option value="">{t('detail.reactorNoRecipe')}</option>
                  {reactorLiquidOutputItemCandidates.map((itemId) => (
                    <option key={`reactor-liquid-b-${itemId}`} value={itemId}>
                      {getItemLabel(language, itemId)}
                    </option>
                  ))}
                </select>
              </div>

              <small>{t('detail.reactorHint')}</small>
            </div>
          )}
          {DEVICE_TYPE_BY_ID[selectedDevice.typeId].runtimeKind === 'processor' && !simIsRunning && (
            <div className="picker">
              <label>{t('detail.preloadInput')}</label>
              <div className="preload-slot-list">
                {selectedPreloadSlots.map((slot, slotIndex) => (
                  <div key={`${selectedDevice.instanceId}-preload-${slotIndex}`} className="preload-slot-row">
                    <span className="preload-slot-label">{getPreloadSlotLabel(selectedDevice.typeId, slotIndex)}</span>
                    <button
                      type="button"
                      className="picker-open-btn"
                      disabled={simIsRunning}
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
                      disabled={simIsRunning || !slot.itemId}
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
  )
}
