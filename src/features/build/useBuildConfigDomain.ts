import { useCallback } from 'react'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID } from '../../domain/registry'
import { clamp } from '../../domain/shared/math'
import type { DeviceInstance, ItemId, LayoutState, PreloadInputConfigEntry } from '../../domain/types'

type ProcessorPreloadSlot = { itemId: ItemId | null; amount: number }

type UseBuildConfigDomainParams = {
  setLayout: (updater: LayoutState | ((current: LayoutState) => LayoutState)) => void
  isOreItemId: (itemId: ItemId | undefined) => boolean
  processorBufferSpec: (typeId: DeviceInstance['typeId']) => { inputSlotCapacities: number[] }
  buildProcessorPreloadSlots: (device: DeviceInstance, slotCapacities: number[]) => ProcessorPreloadSlot[]
  serializeProcessorPreloadSlots: (slots: ProcessorPreloadSlot[]) => PreloadInputConfigEntry[]
}

export function useBuildConfigDomain({
  setLayout,
  isOreItemId,
  processorBufferSpec,
  buildProcessorPreloadSlots,
  serializeProcessorPreloadSlots,
}: UseBuildConfigDomainParams) {
  const updatePickupItem = useCallback(
    (deviceInstanceId: string, pickupItemId: ItemId | undefined) => {
      const normalizedPickupItemId =
        pickupItemId && ITEM_BY_ID[pickupItemId]?.type === 'solid' ? pickupItemId : undefined
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) =>
          device.instanceId === deviceInstanceId
            ? (() => {
                const nextConfig = { ...device.config, pickupItemId: normalizedPickupItemId }
                if (!normalizedPickupItemId) {
                  delete nextConfig.pickupIgnoreInventory
                } else if (isOreItemId(normalizedPickupItemId)) {
                  nextConfig.pickupIgnoreInventory = true
                }
                return { ...device, config: nextConfig }
              })()
            : device,
        ),
      }))
    },
    [isOreItemId, setLayout],
  )

  const updatePickupIgnoreInventory = useCallback(
    (deviceInstanceId: string, enabled: boolean) => {
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (device.instanceId !== deviceInstanceId || device.typeId !== 'item_port_unloader_1') return device
          const pickupItemId = device.config.pickupItemId
          if (!pickupItemId) return { ...device, config: { ...device.config, pickupIgnoreInventory: false } }
          return {
            ...device,
            config: {
              ...device.config,
              pickupIgnoreInventory: isOreItemId(pickupItemId) ? true : enabled,
            },
          }
        }),
      }))
    },
    [isOreItemId, setLayout],
  )

  const updatePumpOutputItem = useCallback(
    (deviceInstanceId: string, pumpOutputItemId: ItemId | undefined) => {
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) =>
          device.instanceId === deviceInstanceId && device.typeId === 'item_port_water_pump_1'
            ? { ...device, config: { ...device.config, pumpOutputItemId } }
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
          const hasItemPatch = patch.itemId !== undefined
          const nextItemId = hasItemPatch ? (patch.itemId ?? null) : currentSlot.itemId
          let requestedAmount = patch.amount !== undefined ? patch.amount : currentSlot.amount
          if (hasItemPatch && nextItemId && patch.amount === undefined) {
            const normalizedCurrent = Math.floor(Number.isFinite(currentSlot.amount) ? currentSlot.amount : 0)
            if (normalizedCurrent <= 0) {
              requestedAmount = 1
            }
          }
          const slotCap = spec.inputSlotCapacities[slotIndex] ?? 50
          const normalizedAmount = nextItemId
            ? clamp(Math.floor(Number.isFinite(requestedAmount) ? requestedAmount : 0), 0, slotCap)
            : 0
          const finalItemId = nextItemId && normalizedAmount > 0 ? nextItemId : null

          slots[slotIndex] = {
            itemId: finalItemId,
            amount: finalItemId ? normalizedAmount : 0,
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
    [buildProcessorPreloadSlots, processorBufferSpec, serializeProcessorPreloadSlots, setLayout],
  )

  return {
    updatePickupItem,
    updatePickupIgnoreInventory,
    updatePumpOutputItem,
    updateProcessorPreloadSlot,
  }
}