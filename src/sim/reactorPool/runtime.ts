import type { DeviceConfig, ItemId, ProcessorRuntime, RecipeDef } from '../../domain/types'
import { ITEM_BY_ID } from '../../domain/registry'
import { normalizeReactorPoolConfig } from './config'
import {
  findBoundSlotIndex,
  findFirstEmptySlot,
  isReactorInputPort,
  isLiquidItem,
} from './slotMap'
import type { ReactorOutputPortId } from './types'
import {
  getReactorLiquidOutputPortIds,
  getReactorSolidOutputPortIds,
  isReactorLiquidInputPort,
  isReactorLiquidOutputPort,
  isReactorSolidInputPort,
  isReactorSolidOutputPort,
} from './types'

export type ReactorOutputNodeId = 'solid-output' | 'liquid-output-a' | 'liquid-output-b'

export type ReactorResolvedOutputNode = {
  nodeId: ReactorOutputNodeId
  portIds: ReactorOutputPortId[]
  configuredItemId: ItemId | null
  mappedSlotIndex: number | null
  itemId: ItemId | null
  amount: number
}

function configuredReactorOutputItemId(
  deviceTypeId: DeviceConfig extends never ? never : import('../../domain/types').DeviceInstance['typeId'],
  deviceConfig: DeviceConfig,
  fromPortId: ReactorOutputPortId,
): ItemId | null {
  const cfg = normalizeReactorPoolConfig(deviceTypeId, deviceConfig)
  if (isReactorSolidOutputPort(fromPortId)) {
    return (cfg.solidOutputItemId as ItemId | undefined) ?? null
  }
  if (fromPortId === 'out_w_1') {
    return (cfg.liquidOutputItemIdA as ItemId | undefined) ?? null
  }
  return (cfg.liquidOutputItemIdB as ItemId | undefined) ?? null
}

function findMappedReactorOutputSlotIndex(runtime: ProcessorRuntime, itemId: ItemId) {
  if ((runtime.inputBuffer[itemId] ?? 0) <= 0) return null
  for (let slotIndex = 0; slotIndex < runtime.inputSlotItems.length; slotIndex += 1) {
    if (runtime.inputSlotItems[slotIndex] === itemId) return slotIndex
  }
  return null
}

export function resolveReactorOutputNodes(
  deviceTypeId: import('../../domain/types').DeviceInstance['typeId'],
  runtime: ProcessorRuntime,
  deviceConfig: DeviceConfig,
): ReactorResolvedOutputNode[] {
  const reactorOutputNodePorts: Array<{ nodeId: ReactorOutputNodeId; portIds: ReactorOutputPortId[] }> = [
    { nodeId: 'solid-output', portIds: [...getReactorSolidOutputPortIds(deviceTypeId)] },
    { nodeId: 'liquid-output-a', portIds: [getReactorLiquidOutputPortIds(deviceTypeId)[0] ?? 'out_w_1'] },
    { nodeId: 'liquid-output-b', portIds: [getReactorLiquidOutputPortIds(deviceTypeId)[1] ?? 'out_w_3'] },
  ]

  return reactorOutputNodePorts.map(({ nodeId, portIds }) => {
    const configuredItemId = configuredReactorOutputItemId(deviceTypeId, deviceConfig, portIds[0])
    if (!configuredItemId) {
      return {
        nodeId,
        portIds,
        configuredItemId: null,
        mappedSlotIndex: null,
        itemId: null,
        amount: 0,
      }
    }

    const mappedSlotIndex = findMappedReactorOutputSlotIndex(runtime, configuredItemId)
    if (mappedSlotIndex === null) {
      return {
        nodeId,
        portIds,
        configuredItemId,
        mappedSlotIndex: null,
        itemId: null,
        amount: 0,
      }
    }

    return {
      nodeId,
      portIds,
      configuredItemId,
      mappedSlotIndex,
      itemId: configuredItemId,
      amount: runtime.inputBuffer[configuredItemId] ?? 0,
    }
  })
}

export function resolveReactorOutputNodeForPort(
  deviceTypeId: import('../../domain/types').DeviceInstance['typeId'],
  runtime: ProcessorRuntime,
  deviceConfig: DeviceConfig,
  fromPortId: string,
): ReactorResolvedOutputNode | null {
  if (!isReactorSolidOutputPort(fromPortId) && !isReactorLiquidOutputPort(fromPortId)) return null
  return resolveReactorOutputNodes(deviceTypeId, runtime, deviceConfig).find((node) => node.portIds.includes(fromPortId)) ?? null
}

function clearSlotIfEmpty(buffer: Partial<Record<ItemId, number>>, slotItems: Array<ItemId | null>, itemId: ItemId) {
  if ((buffer[itemId] ?? 0) > 0) return
  const slotIndex = slotItems.findIndex((bound) => bound === itemId)
  if (slotIndex >= 0) slotItems[slotIndex] = null
}

function tryAddAtFixedSlot(
  buffer: Partial<Record<ItemId, number>>,
  slotItems: Array<ItemId | null>,
  slotCapacities: number[],
  slotIndex: number,
  itemId: ItemId,
  amount: number,
) {
  if (amount <= 0) return true
  if (slotIndex < 0 || slotIndex >= slotItems.length) return false
  const existingSlotIndex = slotItems.findIndex((slotItemId) => slotItemId === itemId)
  if (existingSlotIndex >= 0 && existingSlotIndex !== slotIndex) return false
  const bound = slotItems[slotIndex]
  if (bound && bound !== itemId) return false
  const cap = slotCapacities[slotIndex] ?? 50
  const next = (buffer[itemId] ?? 0) + amount
  if (next > cap) return false
  slotItems[slotIndex] = itemId
  buffer[itemId] = next
  return true
}

function tryAddToSharedSlotPool(
  buffer: Partial<Record<ItemId, number>>,
  slotItems: Array<ItemId | null>,
  slotCapacities: number[],
  itemId: ItemId,
  amount: number,
) {
  if (amount <= 0) return true
  const existingSlotIndex = findBoundSlotIndex(slotItems, itemId)
  const targetSlotIndex = existingSlotIndex >= 0 ? existingSlotIndex : findFirstEmptySlot(slotItems)
  if (targetSlotIndex < 0) return false
  return tryAddAtFixedSlot(buffer, slotItems, slotCapacities, targetSlotIndex, itemId, amount)
}

export function reactorAcceptInputFromPort(
  runtime: ProcessorRuntime,
  toPortId: string,
  itemId: ItemId,
  amount: number,
  inputSlotCapacities: number[],
) {
  if (!isReactorInputPort(toPortId)) return false
  const itemType = ITEM_BY_ID[itemId]?.type
  if (isReactorLiquidInputPort(toPortId) && !isLiquidItem(itemType)) return false
  if (isReactorSolidInputPort(toPortId) && isLiquidItem(itemType)) return false
  return tryAddToSharedSlotPool(runtime.inputBuffer, runtime.inputSlotItems, inputSlotCapacities, itemId, amount)
}

export function reactorPeekOutputForPort(
  deviceTypeId: import('../../domain/types').DeviceInstance['typeId'],
  runtime: ProcessorRuntime,
  deviceConfig: DeviceConfig,
  fromPortId: string,
): ItemId | null {
  return resolveReactorOutputNodeForPort(deviceTypeId, runtime, deviceConfig, fromPortId)?.itemId ?? null
}

export function reactorCanAcceptRecipeOutputsInSharedSlotPool(
  runtime: ProcessorRuntime,
  recipe: RecipeDef,
  sharedSlotCapacities: number[],
) {
  const shadowBuffer = { ...runtime.inputBuffer }
  const shadowSlots = [...runtime.inputSlotItems]

  for (const output of recipe.outputs) {
    if (!tryAddToSharedSlotPool(shadowBuffer, shadowSlots, sharedSlotCapacities, output.itemId, output.amount)) {
      return false
    }
  }

  return true
}

export function reactorCommitRecipeOutputsToSharedSlotPool(
  runtime: ProcessorRuntime,
  recipe: RecipeDef,
  sharedSlotCapacities: number[],
) {
  let produced = 0

  for (const output of recipe.outputs) {
    const ok = tryAddToSharedSlotPool(runtime.inputBuffer, runtime.inputSlotItems, sharedSlotCapacities, output.itemId, output.amount)
    if (!ok) break
    produced += output.amount
  }

  return produced
}

export function reactorSelectedRecipeIds(
  deviceTypeId: import('../../domain/types').DeviceInstance['typeId'],
  deviceConfig: DeviceConfig,
): string[] {
  return normalizeReactorPoolConfig(deviceTypeId, deviceConfig).selectedRecipeIds
}

export function reactorConsumeItemFromSharedSlotPool(runtime: ProcessorRuntime, itemId: ItemId, amount: number) {
  if (amount <= 0) return true
  if ((runtime.inputBuffer[itemId] ?? 0) < amount) return false
  runtime.inputBuffer[itemId] = Math.max(0, (runtime.inputBuffer[itemId] ?? 0) - amount)
  clearSlotIfEmpty(runtime.inputBuffer, runtime.inputSlotItems, itemId)
  return true
}
