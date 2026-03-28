import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDeviceById } from '../../domain/geometry'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID, LIQUID_ITEM_IDS, RECIPES, SOLID_ITEM_IDS } from '../../domain/registry'
import { buildProcessorPreloadSlots, processorBufferSpec, serializeProcessorPreloadSlots } from '../../domain/shared/deviceConfig'
import {
  inputBufferAllowedTypesForSlot,
  isExternalLiquidSourceDeviceType,
  normalizeExternalLiquidSourceItemId,
} from '../../domain/shared/itemPickerRules'
import type { DeviceRuntime, ItemId, LayoutState } from '../../domain/types'
import { normalizeReactorPoolConfig } from '../../sim/reactorPool'
import { useReactorPoolConfigDomain } from './reactorPoolConfigDomain'
import { useBuildConfigDomain } from './useBuildConfigDomain'
import type { ItemPickerFilter, ItemPickerState } from '../../ui/dialogs/itemPicker.types'
const PICKUP_OUTPUT_PORT_ID = 'p_out_mid'
const PROTOCOL_HUB_OUTPUT_PORT_IDS = ['out_w_2', 'out_w_5', 'out_w_8', 'out_e_2', 'out_e_5', 'out_e_8'] as const
const LIQUID_STORAGE_TANK_TYPE_ID: LayoutState['devices'][number]['typeId'] = 'item_port_liquid_storager_1'

function isAdmissionDeviceType(typeId: LayoutState['devices'][number]['typeId'] | undefined) {
  return typeId === 'item_log_admission' || typeId === 'item_pipe_admission'
}

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

  const {
    updateAdmissionItem,
    updateAdmissionAmount,
    updatePickupItem,
    updatePickupIgnoreInventory,
    updateProtocolHubOutputItem,
    updateProtocolHubOutputIgnoreInventory,
    updatePumpOutputItem,
    updateProcessorPreloadSlot,
    updateDevicePreloadInput,
  } = useBuildConfigDomain({
    setLayout,
    isOreItemId,
    processorBufferSpec,
    buildProcessorPreloadSlots,
    serializeProcessorPreloadSlots,
  })

  const { updateReactorSelectedRecipe, updateReactorSolidOutputItem, updateReactorLiquidOutputItemA, updateReactorLiquidOutputItemB } =
    useReactorPoolConfigDomain({ setLayout })

  const selectedDevice = useMemo(() => {
    if (selection.length !== 1) return null
    return getDeviceById(layout, selection[0])
  }, [layout, selection])

  const selectedRuntime = useMemo(() => {
    if (!selectedDevice) return undefined
    return runtimeById[selectedDevice.instanceId]
  }, [runtimeById, selectedDevice])

  const selectedPickupItemId =
    selectedDevice?.typeId === 'item_port_unloader_1'
      ? (selectedDevice.config.protocolHubOutputs ?? []).find((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)?.itemId ??
        selectedDevice.config.pickupItemId
      : undefined
  const selectedAdmissionItemId = isAdmissionDeviceType(selectedDevice?.typeId) ? selectedDevice?.config.admissionItemId : undefined
  const selectedAdmissionAmount = isAdmissionDeviceType(selectedDevice?.typeId)
    ? (typeof selectedDevice.config.admissionAmount === 'number' && selectedDevice.config.admissionAmount >= 0
      ? Math.floor(selectedDevice.config.admissionAmount)
      : undefined)
    : undefined
  const selectedPickupItemIsOre = isOreItemId(selectedPickupItemId)
  const selectedPickupIgnoreInventory =
    selectedDevice?.typeId === 'item_port_unloader_1' && selectedPickupItemId
      ? selectedPickupItemIsOre ||
        Boolean(
          (selectedDevice.config.protocolHubOutputs ?? []).find((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)?.ignoreInventory ??
            selectedDevice.config.pickupIgnoreInventory,
        )
      : false
  const selectedPumpOutputItemId =
    selectedDevice && isExternalLiquidSourceDeviceType(selectedDevice.typeId)
      ? normalizeExternalLiquidSourceItemId(selectedDevice.config.pumpOutputItemId)
      : undefined
  const selectedProtocolHubOutputs = useMemo(() => {
    if (selectedDevice?.typeId !== 'item_port_sp_hub_1') return []
    const byPortId = new Map((selectedDevice.config.protocolHubOutputs ?? []).map((entry) => [entry.portId, entry]))
    return PROTOCOL_HUB_OUTPUT_PORT_IDS.map((portId, portIndex) => {
      const entry = byPortId.get(portId)
      const itemId = entry?.itemId
      const itemIsOre = isOreItemId(itemId)
      return {
        portId,
        portIndex,
        itemId,
        itemIsOre,
        ignoreInventory: itemId ? itemIsOre || Boolean(entry?.ignoreInventory) : false,
      }
    })
  }, [isOreItemId, selectedDevice])
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
  const selectedDevicePreloadItemId =
    selectedDevice?.typeId === LIQUID_STORAGE_TANK_TYPE_ID && ITEM_BY_ID[selectedDevice.config.preloadInputItemId ?? '']?.type === 'liquid'
      ? selectedDevice.config.preloadInputItemId
      : undefined
  const selectedDevicePreloadAmount =
    selectedDevice?.typeId === LIQUID_STORAGE_TANK_TYPE_ID
      ? Math.max(0, Math.floor(Number(selectedDevice.config.preloadInputAmount) || 0))
      : 0

  const reactorRecipeCandidates = useMemo(
    () => RECIPES.filter((recipe) => recipe.machineType === 'item_port_mix_pool_1'),
    [],
  )

  const selectedReactorPoolConfig = useMemo(() => {
    if (!selectedDevice || selectedDevice.typeId !== 'item_port_mix_pool_1') return null
    return normalizeReactorPoolConfig(selectedDevice.config)
  }, [selectedDevice])

  const reactorSolidOutputItemCandidates = useMemo(
    () => SOLID_ITEM_IDS,
    [],
  )

  const reactorLiquidOutputItemCandidates = useMemo(
    () => LIQUID_ITEM_IDS,
    [],
  )

  const pickerTargetDevice = useMemo(() => {
    if (!itemPickerState) return null
    if (
      itemPickerState.kind === 'storageSlotPinned' ||
      itemPickerState.kind === 'storageSlotPreload' ||
      itemPickerState.kind === 'plannerTarget' ||
      itemPickerState.kind === 'admissionConfig'
    ) return null
    return getDeviceById(layout, itemPickerState.deviceInstanceId)
  }, [itemPickerState, layout])

  const pickerPreloadSlots = useMemo(() => {
    if (!itemPickerState || itemPickerState.kind !== 'preload' || !pickerTargetDevice) return []
    const spec = processorBufferSpec(pickerTargetDevice.typeId)
    return buildProcessorPreloadSlots(pickerTargetDevice, spec.inputSlotCapacities)
  }, [itemPickerState, pickerTargetDevice])

  const pickerSelectedItemId = useMemo(() => {
    if (!itemPickerState || !pickerTargetDevice) return undefined
    if (itemPickerState.kind === 'pickup') {
      return (pickerTargetDevice.config.protocolHubOutputs ?? []).find((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)?.itemId ??
        pickerTargetDevice.config.pickupItemId
    }
    if (itemPickerState.kind === 'admission') {
      return pickerTargetDevice.config.admissionItemId
    }
    if (itemPickerState.kind === 'protocolHubOutput') {
      const entry = (pickerTargetDevice.config.protocolHubOutputs ?? []).find((item) => item.portId === itemPickerState.portId)
      return entry?.itemId
    }
    if (itemPickerState.kind === 'pumpOutput') {
      return normalizeExternalLiquidSourceItemId(pickerTargetDevice.config.pumpOutputItemId)
    }
    if (itemPickerState.kind === 'preload') {
      if (pickerTargetDevice.typeId === LIQUID_STORAGE_TANK_TYPE_ID) {
        return ITEM_BY_ID[pickerTargetDevice.config.preloadInputItemId ?? '']?.type === 'liquid'
          ? pickerTargetDevice.config.preloadInputItemId
          : undefined
      }
      return pickerPreloadSlots[itemPickerState.slotIndex]?.itemId ?? undefined
    }
    return undefined
  }, [itemPickerState, pickerPreloadSlots, pickerTargetDevice])

  const pickerFilter = useMemo<ItemPickerFilter | undefined>(() => {
    if (!itemPickerState) return undefined
    if (itemPickerState.kind === 'pickup') {
      return { allowedTypes: ['solid'] }
    }
    if (itemPickerState.kind === 'admission') {
      return {
        allowedTypes: pickerTargetDevice?.typeId === 'item_pipe_admission' ? ['liquid'] : ['solid'],
      }
    }
    if (itemPickerState.kind === 'protocolHubOutput') {
      return { allowedTypes: ['solid'] }
    }
    if (itemPickerState.kind === 'pumpOutput') {
      return {
        allowedTypes: ['liquid'],
      }
    }
    if (itemPickerState.kind === 'preload') {
      if (!pickerTargetDevice) return { allowedTypes: ['solid'] }
      if (pickerTargetDevice.typeId === LIQUID_STORAGE_TANK_TYPE_ID) {
        return { allowedTypes: ['liquid'] }
      }
      return {
        allowedTypes: inputBufferAllowedTypesForSlot(pickerTargetDevice.typeId, itemPickerState.slotIndex),
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
    if (
      itemPickerState.kind === 'storageSlotPinned' ||
      itemPickerState.kind === 'storageSlotPreload' ||
      itemPickerState.kind === 'plannerTarget' ||
      itemPickerState.kind === 'admissionConfig'
    ) return
    const target = getDeviceById(layout, itemPickerState.deviceInstanceId)
    if (!target) {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'pickup' && target.typeId !== 'item_port_unloader_1') {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'admission' && !isAdmissionDeviceType(target.typeId)) {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'protocolHubOutput' && target.typeId !== 'item_port_sp_hub_1') {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'pumpOutput' && !isExternalLiquidSourceDeviceType(target.typeId)) {
      setItemPickerState(null)
      return
    }
    if (itemPickerState.kind === 'preload' && DEVICE_TYPE_BY_ID[target.typeId].runtimeKind !== 'processor') {
      if (target.typeId !== LIQUID_STORAGE_TANK_TYPE_ID) {
        setItemPickerState(null)
      }
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
      } else if (itemPickerState.kind === 'admission') {
        updateAdmissionItem(pickerTargetDevice.instanceId, itemId ?? undefined)
      } else if (itemPickerState.kind === 'protocolHubOutput') {
        updateProtocolHubOutputItem(pickerTargetDevice.instanceId, itemPickerState.portId, itemId ?? undefined)
      } else if (itemPickerState.kind === 'pumpOutput') {
        const nextItemId = normalizeExternalLiquidSourceItemId(itemId ?? undefined)
        updatePumpOutputItem(pickerTargetDevice.instanceId, nextItemId)
      } else if (itemPickerState.kind === 'preload') {
        if (pickerTargetDevice.typeId === LIQUID_STORAGE_TANK_TYPE_ID) {
          updateDevicePreloadInput(pickerTargetDevice.instanceId, { itemId })
        } else {
          updateProcessorPreloadSlot(pickerTargetDevice.instanceId, itemPickerState.slotIndex, { itemId })
        }
      }
    },
    [
      itemPickerState,
      pickerTargetDevice,
      updateAdmissionItem,
      updatePickupItem,
      updateProtocolHubOutputItem,
      updatePumpOutputItem,
      updateDevicePreloadInput,
      updateProcessorPreloadSlot,
    ],
  )

  return {
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
    selectedDevicePreloadItemId,
    selectedDevicePreloadAmount,
    pickerTargetDevice,
    pickerSelectedItemId,
    pickerFilter,
    pickerAllowsEmpty,
    pickerDisabledItemIds,
    handleItemPickerSelect,
    updateAdmissionItem,
    updateAdmissionAmount,
    updatePickupIgnoreInventory,
    updateProtocolHubOutputIgnoreInventory,
    updateProcessorPreloadSlot,
    updateDevicePreloadInput,
    reactorRecipeCandidates,
    selectedReactorPoolConfig,
    reactorSolidOutputItemCandidates,
    reactorLiquidOutputItemCandidates,
    updateReactorSelectedRecipe,
    updateReactorSolidOutputItem,
    updateReactorLiquidOutputItemA,
    updateReactorLiquidOutputItemB,
  }
}