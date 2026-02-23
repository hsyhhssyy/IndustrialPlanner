import { DEVICE_TYPE_BY_ID } from '../registry'
import type { DeviceInstance, DeviceTypeId, ItemId, PreloadInputConfigEntry } from '../types'
import { clamp } from './math'

export type ProcessorPreloadSlot = { itemId: ItemId | null; amount: number }

export function processorBufferSpec(typeId: DeviceTypeId) {
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

export function buildProcessorPreloadSlots(device: DeviceInstance, slotCapacities: number[]): ProcessorPreloadSlot[] {
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

export function serializeProcessorPreloadSlots(slots: ProcessorPreloadSlot[]): PreloadInputConfigEntry[] {
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