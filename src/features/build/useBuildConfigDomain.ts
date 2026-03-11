import { useCallback } from 'react'
import { DEVICE_TYPE_BY_ID, ITEM_BY_ID } from '../../domain/registry'
import { clamp } from '../../domain/shared/math'
import type { DeviceInstance, ItemId, LayoutState, PreloadInputConfigEntry } from '../../domain/types'

const PROTOCOL_HUB_OUTPUT_PORT_IDS = ['out_w_2', 'out_w_5', 'out_w_8', 'out_e_2', 'out_e_5', 'out_e_8'] as const
const PICKUP_OUTPUT_PORT_ID = 'p_out_mid'

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
  const normalizeProtocolHubOutputItemId = useCallback((itemId: ItemId | undefined) => {
    return itemId && ITEM_BY_ID[itemId]?.type === 'solid' ? itemId : undefined
  }, [])

  const normalizeAdmissionItemId = useCallback((deviceTypeId: DeviceInstance['typeId'], itemId: ItemId | undefined) => {
    const expectedType = deviceTypeId === 'item_log_admission'
      ? 'solid'
      : deviceTypeId === 'item_pipe_admission'
        ? 'liquid'
        : null
    if (!expectedType) return undefined
    return itemId && ITEM_BY_ID[itemId]?.type === expectedType ? itemId : undefined
  }, [])

  const normalizeAdmissionAmount = useCallback((amount: number | undefined) => {
    if (!Number.isFinite(amount)) return undefined
    const normalized = Math.floor(amount as number)
    return normalized > 0 ? clamp(normalized, 1, 999) : undefined
  }, [])

  const updateAdmissionItem = useCallback(
    (deviceInstanceId: string, admissionItemId: ItemId | undefined) => {
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (device.instanceId !== deviceInstanceId) return device
          if (device.typeId !== 'item_log_admission' && device.typeId !== 'item_pipe_admission') return device
          const normalizedAdmissionItemId = normalizeAdmissionItemId(device.typeId, admissionItemId)
          const nextConfig = { ...device.config, admissionItemId: normalizedAdmissionItemId }
          if (!normalizedAdmissionItemId) {
            delete nextConfig.admissionAmount
          }
          return { ...device, config: nextConfig }
        }),
      }))
    },
    [normalizeAdmissionItemId, setLayout],
  )

  const updateAdmissionAmount = useCallback(
    (deviceInstanceId: string, admissionAmount: number | undefined) => {
      const normalizedAdmissionAmount = normalizeAdmissionAmount(admissionAmount)
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (device.instanceId !== deviceInstanceId) return device
          if (device.typeId !== 'item_log_admission' && device.typeId !== 'item_pipe_admission') return device
          const nextConfig = { ...device.config }
          if (!nextConfig.admissionItemId || normalizedAdmissionAmount === undefined) {
            delete nextConfig.admissionAmount
          } else {
            nextConfig.admissionAmount = normalizedAdmissionAmount
          }
          return { ...device, config: nextConfig }
        }),
      }))
    },
    [normalizeAdmissionAmount, setLayout],
  )

  const updatePickupItem = useCallback(
    (deviceInstanceId: string, pickupItemId: ItemId | undefined) => {
      const normalizedPickupItemId =
        pickupItemId && ITEM_BY_ID[pickupItemId]?.type === 'solid' ? pickupItemId : undefined
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) =>
          device.instanceId === deviceInstanceId && device.typeId === 'item_port_unloader_1'
            ? (() => {
                const outputsByPort = new Map((device.config.protocolHubOutputs ?? []).map((entry) => [entry.portId, { ...entry }]))
                if (normalizedPickupItemId) {
                  outputsByPort.set(PICKUP_OUTPUT_PORT_ID, {
                    portId: PICKUP_OUTPUT_PORT_ID,
                    itemId: normalizedPickupItemId,
                    ignoreInventory: isOreItemId(normalizedPickupItemId) ? true : Boolean(outputsByPort.get(PICKUP_OUTPUT_PORT_ID)?.ignoreInventory),
                  })
                } else {
                  outputsByPort.delete(PICKUP_OUTPUT_PORT_ID)
                }

                const nextOutputs = Array.from(outputsByPort.values())
                  .filter((entry) => Boolean(entry.itemId))
                  .map((entry) => ({
                    portId: entry.portId,
                    itemId: entry.itemId,
                    ignoreInventory: Boolean(entry.ignoreInventory),
                  }))

                const nextConfig = { ...device.config, pickupItemId: normalizedPickupItemId }
                if (nextOutputs.length > 0) {
                  nextConfig.protocolHubOutputs = nextOutputs
                } else {
                  delete nextConfig.protocolHubOutputs
                }

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
          const pickupEntry = (device.config.protocolHubOutputs ?? []).find((entry) => entry.portId === PICKUP_OUTPUT_PORT_ID)
          const pickupItemId = pickupEntry?.itemId ?? device.config.pickupItemId
          if (!pickupItemId) return { ...device, config: { ...device.config, pickupIgnoreInventory: false } }

          const outputsByPort = new Map((device.config.protocolHubOutputs ?? []).map((entry) => [entry.portId, { ...entry }]))
          outputsByPort.set(PICKUP_OUTPUT_PORT_ID, {
            portId: PICKUP_OUTPUT_PORT_ID,
            itemId: pickupItemId,
            ignoreInventory: isOreItemId(pickupItemId) ? true : enabled,
          })

          const nextOutputs = Array.from(outputsByPort.values())
            .filter((entry) => Boolean(entry.itemId))
            .map((entry) => ({
              portId: entry.portId,
              itemId: entry.itemId,
              ignoreInventory: Boolean(entry.ignoreInventory),
            }))

          return {
            ...device,
            config: {
              ...device.config,
              protocolHubOutputs: nextOutputs,
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

  const updateProtocolHubOutputItem = useCallback(
    (deviceInstanceId: string, portId: string, itemId: ItemId | undefined) => {
      if (!PROTOCOL_HUB_OUTPUT_PORT_IDS.includes(portId as (typeof PROTOCOL_HUB_OUTPUT_PORT_IDS)[number])) return
      const normalizedItemId = normalizeProtocolHubOutputItemId(itemId)
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (device.instanceId !== deviceInstanceId || device.typeId !== 'item_port_sp_hub_1') return device
          const outputsByPort = new Map((device.config.protocolHubOutputs ?? []).map((entry) => [entry.portId, { ...entry }]))
          const currentEntry = outputsByPort.get(portId) ?? { portId }
          const nextEntry = {
            ...currentEntry,
            itemId: normalizedItemId,
            ignoreInventory: normalizedItemId
              ? isOreItemId(normalizedItemId)
                ? true
                : Boolean(currentEntry.ignoreInventory)
              : false,
          }
          outputsByPort.set(portId, nextEntry)
          const nextOutputs = PROTOCOL_HUB_OUTPUT_PORT_IDS.map((id) => outputsByPort.get(id) ?? { portId: id })
            .filter((entry) => Boolean(entry.itemId))
            .map((entry) => ({
              portId: entry.portId,
              itemId: entry.itemId,
              ignoreInventory: Boolean(entry.ignoreInventory),
            }))

          const nextConfig = { ...device.config }
          if (nextOutputs.length > 0) {
            nextConfig.protocolHubOutputs = nextOutputs
          } else {
            delete nextConfig.protocolHubOutputs
          }
          return { ...device, config: nextConfig }
        }),
      }))
    },
    [isOreItemId, normalizeProtocolHubOutputItemId, setLayout],
  )

  const updateProtocolHubOutputIgnoreInventory = useCallback(
    (deviceInstanceId: string, portId: string, enabled: boolean) => {
      if (!PROTOCOL_HUB_OUTPUT_PORT_IDS.includes(portId as (typeof PROTOCOL_HUB_OUTPUT_PORT_IDS)[number])) return
      setLayout((current) => ({
        ...current,
        devices: current.devices.map((device) => {
          if (device.instanceId !== deviceInstanceId || device.typeId !== 'item_port_sp_hub_1') return device

          const outputsByPort = new Map((device.config.protocolHubOutputs ?? []).map((entry) => [entry.portId, { ...entry }]))
          const currentEntry = outputsByPort.get(portId)
          const itemId = currentEntry?.itemId
          if (!itemId) return device

          outputsByPort.set(portId, {
            ...currentEntry,
            ignoreInventory: isOreItemId(itemId) ? true : enabled,
          })

          const nextOutputs = PROTOCOL_HUB_OUTPUT_PORT_IDS.map((id) => outputsByPort.get(id) ?? { portId: id })
            .filter((entry) => Boolean(entry.itemId))
            .map((entry) => ({
              portId: entry.portId,
              itemId: entry.itemId,
              ignoreInventory: Boolean(entry.ignoreInventory),
            }))

          const nextConfig = { ...device.config }
          if (nextOutputs.length > 0) {
            nextConfig.protocolHubOutputs = nextOutputs
          } else {
            delete nextConfig.protocolHubOutputs
          }
          return { ...device, config: nextConfig }
        }),
      }))
    },
    [isOreItemId, setLayout],
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
    updateAdmissionItem,
    updateAdmissionAmount,
    updatePickupItem,
    updatePickupIgnoreInventory,
    updateProtocolHubOutputItem,
    updateProtocolHubOutputIgnoreInventory,
    updatePumpOutputItem,
    updateProcessorPreloadSlot,
  }
}