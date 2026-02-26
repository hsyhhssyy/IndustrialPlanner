import { BASES, DEVICE_TYPE_BY_ID } from '../../domain/registry'
import type { BaseDef, BaseId, DeviceInstance, DeviceRuntime, ItemId, LayoutState, SimState, SlotData } from '../../domain/types'
import { getDeviceLabel, getItemLabel, type Language } from '../../i18n'
import { isBelt } from '../../domain/geometry'

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
  currentBaseId: BaseId
  currentBase: BaseDef
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
  formatRecipeSummary: (typeId: DeviceInstance['typeId'], language: Language) => string
  cycleTicksFromSeconds: (cycleSeconds: number, tickRateHz: number) => number
  recipeForDevice: (typeId: DeviceInstance['typeId']) => { cycleSeconds: number } | undefined
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
  selectedPickupItemId: ItemId | undefined
  selectedPumpOutputItemId: ItemId | undefined
  selectedPickupItemIsOre: boolean
  selectedPickupIgnoreInventory: boolean
  getItemIconPath: (itemId: ItemId) => string
  setItemPickerState: (
    state:
      | { kind: 'pickup'; deviceInstanceId: string }
      | { kind: 'pumpOutput'; deviceInstanceId: string }
      | { kind: 'preload'; deviceInstanceId: string; slotIndex: number }
      | null
  ) => void
  updatePickupIgnoreInventory: (deviceInstanceId: string, enabled: boolean) => void
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
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
}

export function RightPanel({
  t,
  language,
  currentBaseId,
  currentBase,
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
  selectedPickupItemId,
  selectedPumpOutputItemId,
  selectedPickupItemIsOre,
  selectedPickupIgnoreInventory,
  getItemIconPath,
  setItemPickerState,
  updatePickupIgnoreInventory,
  setLayout,
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
}: RightPanelProps) {
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

  return (
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
          {isBelt(selectedDevice.typeId) && selectedRuntime && 'slot' in selectedRuntime && (
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
              {'outputBuffer' in selectedRuntime && (
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
          {selectedDevice.typeId === 'item_port_storager_1' && (
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
