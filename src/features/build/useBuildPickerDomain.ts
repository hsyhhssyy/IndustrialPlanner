import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDeviceById } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID } from '../../domain/registry'
import { buildProcessorPreloadSlots, processorBufferSpec, serializeProcessorPreloadSlots } from '../../domain/shared/deviceConfig'
import type { DeviceRuntime, ItemId, LayoutState } from '../../domain/types'
import { useBuildConfigDomain } from './useBuildConfigDomain'

type ItemPickerState =
  | { kind: 'pickup'; deviceInstanceId: string }
  | { kind: 'pumpOutput'; deviceInstanceId: string }
  | { kind: 'preload'; deviceInstanceId: string; slotIndex: number }

type ItemPickerFilter = {
  allowedTypes?: Array<'solid' | 'liquid'>
  requiredTags?: string[]
  allowedItemIds?: ReadonlySet<ItemId>
}

function preloadAllowedTypesBySlot(deviceTypeId: LayoutState['devices'][number]['typeId'], slotIndex: number): Array<'solid' | 'liquid'> {
  if (
    deviceTypeId === 'item_port_xiranite_oven_1' ||
    deviceTypeId === 'item_port_liquid_filling_pd_mc_1' ||
    deviceTypeId === 'item_port_hydro_planter_1'
  ) {
    if (slotIndex === 1) return ['liquid']
    return ['solid']
  }
  return ['solid']
}

const DEFAULT_PUMP_OUTPUT_ITEM_ID: ItemId = 'item_liquid_water'
const PUMP_SELECTABLE_LIQUID_IDS = new Set<ItemId>([
  'item_liquid_water',
  'item_liquid_plant_grass_1',
  'item_liquid_plant_grass_2',
  'item_liquid_xiranite',
])

type UseBuildPickerDomainParams = {
  layout: LayoutState
  selection: string[]
  runtimeById: Record<string, DeviceRuntime>
  simIsRunning: boolean
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
  isOreItemId: (itemId: ItemId | undefined) => boolean
}

export function useBuildPickerDomain({ layout, selection, runtimeById, simIsRunning, setLayout, isOreItemId }: UseBuildPickerDomainParams) {
  const [itemPickerState, setItemPickerState] = useState<ItemPickerState | null>(null)

  const { updatePickupItem, updatePickupIgnoreInventory, updatePumpOutputItem, updateProcessorPreloadSlot } = useBuildConfigDomain({
    setLayout,
    isOreItemId,
    processorBufferSpec,
    buildProcessorPreloadSlots,
    serializeProcessorPreloadSlots,
  })

  const selectedDevice = useMemo(() => {
    if (selection.length !== 1) return null
    return getDeviceById(layout, selection[0])
  }, [layout, selection])

  const selectedRuntime = useMemo(() => {
    if (!selectedDevice) return undefined
    return runtimeById[selectedDevice.instanceId]
  }, [runtimeById, selectedDevice])

  const selectedPickupItemId =
    selectedDevice?.typeId === 'item_port_unloader_1' ? selectedDevice.config.pickupItemId : undefined
  const selectedPickupItemIsOre = isOreItemId(selectedPickupItemId)
  const selectedPickupIgnoreInventory =
    selectedDevice?.typeId === 'item_port_unloader_1' && selectedPickupItemId
      ? selectedPickupItemIsOre || Boolean(selectedDevice.config.pickupIgnoreInventory)
      : false
  const selectedPumpOutputItemId =
    selectedDevice?.typeId === 'item_port_water_pump_1'
      ? PUMP_SELECTABLE_LIQUID_IDS.has(selectedDevice.config.pumpOutputItemId ?? DEFAULT_PUMP_OUTPUT_ITEM_ID)
        ? (selectedDevice.config.pumpOutputItemId ?? DEFAULT_PUMP_OUTPUT_ITEM_ID)
        : DEFAULT_PUMP_OUTPUT_ITEM_ID
      : undefined
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
    if (itemPickerState.kind === 'pumpOutput') {
      const configured = pickerTargetDevice.config.pumpOutputItemId ?? DEFAULT_PUMP_OUTPUT_ITEM_ID
      return PUMP_SELECTABLE_LIQUID_IDS.has(configured) ? configured : DEFAULT_PUMP_OUTPUT_ITEM_ID
    }
    return pickerPreloadSlots[itemPickerState.slotIndex]?.itemId ?? undefined
  }, [itemPickerState, pickerPreloadSlots, pickerTargetDevice])

  const pickerFilter = useMemo<ItemPickerFilter | undefined>(() => {
    if (!itemPickerState) return undefined
    if (itemPickerState.kind === 'pickup') {
      return { allowedTypes: ['solid'] }
    }
    if (itemPickerState.kind === 'pumpOutput') {
      return {
        allowedTypes: ['liquid'],
        allowedItemIds: PUMP_SELECTABLE_LIQUID_IDS,
      }
    }
    if (itemPickerState.kind === 'preload') {
      if (!pickerTargetDevice) return { allowedTypes: ['solid'] }
      return {
        allowedTypes: preloadAllowedTypesBySlot(pickerTargetDevice.typeId, itemPickerState.slotIndex),
      }
    }
    return undefined
  }, [itemPickerState, pickerTargetDevice])

  const pickerAllowsEmpty = itemPickerState?.kind !== 'pumpOutput'

  const pickerDisabledItemIds = useMemo(() => {
    if (!itemPickerState || itemPickerState.kind !== 'preload') return new Set<ItemId>()
    return new Set(
      pickerPreloadSlots
        .filter((slot, slotIndex) => slotIndex !== itemPickerState.slotIndex && Boolean(slot.itemId))
        .map((slot) => slot.itemId as ItemId),
    )
  }, [itemPickerState, pickerPreloadSlots])

  useEffect(() => {
    if (simIsRunning) {
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
    if (itemPickerState.kind === 'pumpOutput' && target.typeId !== 'item_port_water_pump_1') {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'preload' && DEVICE_TYPE_BY_ID[target.typeId].runtimeKind !== 'processor') {
      setItemPickerState(null)
    }
  }, [itemPickerState, layout, simIsRunning])

  useEffect(() => {
    if (!itemPickerState) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setItemPickerState(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [itemPickerState])

  const handleItemPickerSelect = useCallback(
    (itemId: ItemId | null) => {
      if (!itemPickerState || !pickerTargetDevice) return
      if (itemPickerState.kind === 'pickup') {
        updatePickupItem(pickerTargetDevice.instanceId, itemId ?? undefined)
      } else if (itemPickerState.kind === 'pumpOutput') {
        const nextItemId = itemId && PUMP_SELECTABLE_LIQUID_IDS.has(itemId) ? itemId : DEFAULT_PUMP_OUTPUT_ITEM_ID
        updatePumpOutputItem(pickerTargetDevice.instanceId, nextItemId)
      } else {
        updateProcessorPreloadSlot(pickerTargetDevice.instanceId, itemPickerState.slotIndex, { itemId })
      }
    },
    [itemPickerState, pickerTargetDevice, updatePickupItem, updatePumpOutputItem, updateProcessorPreloadSlot],
  )

  return {
    itemPickerState,
    setItemPickerState,
    selectedDevice,
    selectedRuntime,
    selectedPickupItemId,
    selectedPumpOutputItemId,
    selectedPickupItemIsOre,
    selectedPickupIgnoreInventory,
    selectedProcessorBufferSpec,
    selectedPreloadSlots,
    selectedPreloadTotal,
    pickerTargetDevice,
    pickerSelectedItemId,
    pickerFilter,
    pickerAllowsEmpty,
    pickerDisabledItemIds,
    handleItemPickerSelect,
    updatePickupIgnoreInventory,
    updateProcessorPreloadSlot,
  }
}