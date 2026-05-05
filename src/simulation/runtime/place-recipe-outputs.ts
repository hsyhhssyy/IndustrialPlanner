import type {
  CompiledSimulationRecipePlan,
  CompiledSimulationSlotTemplate,
  CompiledSimulationTopology,
  SimulationItemDomain,
} from "@/domain/types/simulation"

import type { RuntimeRecipeItem, RuntimeSlotState } from "./runtime-state"
import { getRuntimeLinkTopologyState } from "./cache-link-topology"

export function placeRecipeOutputs(
  topology: CompiledSimulationTopology,
  slots: Record<string, RuntimeSlotState>,
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): boolean {
  const outputItems = resolveOutputItems(plan, inputItems)
  for (const outputItem of outputItems) {
    let remainingAmount = outputItem.amount
    while (remainingAmount > 0) {
      const target = findOutputTarget(topology, slots, plan, outputItem.itemType)
      if (target === null) {
        return false
      }

      const amount = Math.min(target.availableAmount, remainingAmount)
      const targetSlot = slots[target.slotId]
      if (targetSlot === undefined) {
        return false
      }
      targetSlot.itemType = outputItem.itemType
      targetSlot.count += amount
      remainingAmount -= amount
    }
  }

  return true
}

function resolveOutputItems(
  plan: CompiledSimulationRecipePlan,
  inputItems: readonly RuntimeRecipeItem[],
): RuntimeRecipeItem[] {
  const outputItems: RuntimeRecipeItem[] = []
  for (const output of plan.outputs) {
    const itemType = output.itemId === "same-as-input"
      ? inputItems[0]?.itemType ?? null
      : output.itemId
    if (itemType === null || itemType === "any") {
      continue
    }
    outputItems.push({
      itemType,
      amount: output.amount,
    })
  }
  return outputItems
}

function findOutputTarget(
  topology: CompiledSimulationTopology,
  slots: Record<string, RuntimeSlotState>,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
): {
  readonly slotId: string;
  readonly availableAmount: number;
} | null {
  const linkTopologyState = getRuntimeLinkTopologyState(topology)
  const sameItemTarget = findOutputTargetByMode(topology, slots, plan, itemType, "same-item", linkTopologyState)
  if (sameItemTarget !== null) {
    return sameItemTarget
  }
  return findOutputTargetByMode(topology, slots, plan, itemType, "empty", linkTopologyState)
}

function findOutputTargetByMode(
  topology: CompiledSimulationTopology,
  slots: Record<string, RuntimeSlotState>,
  plan: CompiledSimulationRecipePlan,
  itemType: string,
  mode: "same-item" | "empty",
  linkTopologyState: ReturnType<typeof getRuntimeLinkTopologyState>,
): {
  readonly slotId: string;
  readonly availableAmount: number;
} | null {
  for (const cacheGroupId of plan.productCacheGroupIds) {
    const cacheGroup = topology.cacheGroups[cacheGroupId]
    if (cacheGroup === undefined) {
      continue
    }

    for (const slotId of cacheGroup.slotIds) {
      const storageSlotId = resolveStorageSlotIdFromSlots(linkTopologyState, slotId)
      const slot = topology.slots[storageSlotId] ?? topology.slots[slotId]
      const slotState = slots[storageSlotId]
      if (slot === undefined || slotState === undefined || !slotCanHold(topology, slot, itemType)) {
        continue
      }

      if (mode === "same-item" && slotState.itemType !== itemType) {
        continue
      }
      if (mode === "empty" && slotState.count > 0) {
        continue
      }
      if (mode === "empty" && slot.lock !== null && slot.lock !== itemType) {
        continue
      }

      const availableAmount = resolveAvailableOutputAmount(
        slots,
        slotId,
        slot,
        slotState,
        linkTopologyState,
      )
      if (availableAmount > 0) {
        return { slotId: storageSlotId, availableAmount }
      }
    }
  }

  return null
}

function resolveStorageSlotIdFromSlots(
  linkTopologyState: ReturnType<typeof getRuntimeLinkTopologyState>,
  slotId: string,
): string {
  return linkTopologyState.shareAllTargetSlotIdBySourceSlotId[slotId] ?? slotId
}

function resolveAvailableOutputAmount(
  slots: Record<string, RuntimeSlotState>,
  slotId: string,
  slot: CompiledSimulationSlotTemplate,
  slotState: RuntimeSlotState,
  linkTopologyState: ReturnType<typeof getRuntimeLinkTopologyState>,
): number {
  const sharedCapacitySlotIds = linkTopologyState.sharedCapacitySlotIdsBySlotId[slotId]
  if (sharedCapacitySlotIds === undefined) {
    return Math.max(0, slot.capacity - slotState.count)
  }

  const visitedStorageSlotIds = new Set<string>()
  let occupiedCount = 0
  for (const sharedCapacitySlotId of sharedCapacitySlotIds) {
    const sharedStorageSlotId = resolveStorageSlotIdFromSlots(linkTopologyState, sharedCapacitySlotId)
    if (visitedStorageSlotIds.has(sharedStorageSlotId)) {
      continue
    }

    visitedStorageSlotIds.add(sharedStorageSlotId)
    occupiedCount += slots[sharedStorageSlotId]?.count ?? 0
  }

  return Math.max(
    0,
    (linkTopologyState.sharedCapacityLimitBySlotId[slotId] ?? slot.capacity) - occupiedCount,
  )
}

function slotCanHold(
  topology: CompiledSimulationTopology,
  slot: CompiledSimulationSlotTemplate,
  itemType: string,
): boolean {
  if (slot.lock !== null && slot.lock !== itemType) {
    return false
  }
  if (slot.domain === "any") {
    return true
  }
  return getItemDomain(topology, itemType) === slot.domain
}

function getItemDomain(
  topology: CompiledSimulationTopology,
  itemType: string,
): SimulationItemDomain {
  const item = topology.itemCatalog[itemType]
  if (item !== undefined) {
    return item.domain
  }
  return itemType.includes("_liquid") || itemType.startsWith("liquid_")
    ? "liquid"
    : "solid"
}