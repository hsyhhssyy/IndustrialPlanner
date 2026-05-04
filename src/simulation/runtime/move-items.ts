import type { CompiledSimulationTopology } from "@/domain/types/simulation";

import type { SimulationMutableRuntimeState } from "./runtime-state";

export function moveItems(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  const interactedDeviceIds = new Set<string>();

  for (const edgeId of topology.ordering.edgeOrder) {
    const edge = topology.transferEdges[edgeId];
    const edgeState = state.transient.edges[edgeId];
    if (
      edge === undefined
      || edgeState === undefined
      || edgeState.isDeleted
      || edgeState.shadowPull !== "accept"
      || edgeState.shadowPush !== "accept"
      || edgeState.sourceSlotId === null
      || edgeState.targetSlotId === null
      || edgeState.itemType === null
      || edgeState.amount <= 0
    ) {
      continue;
    }

    const sourceSlot = topology.slots[edgeState.sourceSlotId];
    const sourceStorageSlotId = resolveStorageSlotId(state, edgeState.sourceSlotId);
    const targetStorageSlotId = resolveStorageSlotId(state, edgeState.targetSlotId);
    const sourceSlotState = state.persistent.slots[sourceStorageSlotId];
    const targetSlotState = state.persistent.slots[targetStorageSlotId];
    if (sourceSlot === undefined || sourceSlotState === undefined || targetSlotState === undefined) {
      continue;
    }

    if (!sourceSlot.ignoreStock) {
      sourceSlotState.count = Math.max(0, sourceSlotState.count - edgeState.amount);
    }
    if (targetSlotState.itemType === null) {
      targetSlotState.itemType = edgeState.itemType;
    }
    targetSlotState.count += edgeState.amount;

    state.transient.transfers.push({
      edgeId,
      sourceSlotId: edgeState.sourceSlotId,
      targetSlotId: edgeState.targetSlotId,
      itemType: edgeState.itemType,
      amount: edgeState.amount,
    });

    const sourceCacheGroup = topology.cacheGroups[edge.sourceCacheGroupId];
    const targetCacheGroup = topology.cacheGroups[edge.targetCacheGroupId];
    if (sourceCacheGroup !== undefined) {
      interactedDeviceIds.add(sourceCacheGroup.deviceId);
    }
    if (targetCacheGroup !== undefined) {
      interactedDeviceIds.add(targetCacheGroup.deviceId);
    }
  }

  submitSlots(topology, state, interactedDeviceIds);

  for (const deviceId of topology.ordering.deviceOrder) {
    const deviceState = state.persistent.devices[deviceId];
    if (deviceState !== undefined) {
      deviceState.block = !interactedDeviceIds.has(deviceId);
    }
  }
}

function resolveStorageSlotId(
  state: SimulationMutableRuntimeState,
  slotId: string,
): string {
  return state.persistent.proxyTargetSlotIdBySourceSlotId[slotId] ?? slotId;
}

function submitSlots(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  interactedDeviceIds: Set<string>,
): void {
  for (const slotId of topology.ordering.slotOrder) {
    const slot = topology.slots[slotId];
    const slotState = state.persistent.slots[slotId];
    if (slot === undefined || slotState === undefined || slotState.itemType === null || slotState.count <= 0) {
      continue;
    }

    const isDue = slot.submitMode === "every-tick"
      || (slot.submitMode === "every-n-seconds"
        && slot.submitIntervalTicks !== null
        && state.tickNumber > 0
        && state.tickNumber % slot.submitIntervalTicks === 0);
    if (!isDue) {
      continue;
    }

    const warehouseSlotId = findWarehouseSlotId(topology, slotState.itemType);
    const warehouseSlotState = warehouseSlotId === null
      ? undefined
      : state.persistent.slots[warehouseSlotId];
    if (warehouseSlotState === undefined) {
      continue;
    }

    warehouseSlotState.itemType = slotState.itemType;
    warehouseSlotState.count += slotState.count;
    slotState.count = 0;

    const cacheGroup = topology.cacheGroups[slot.cacheGroupId];
    if (cacheGroup !== undefined) {
      interactedDeviceIds.add(cacheGroup.deviceId);
    }
  }
}

function findWarehouseSlotId(
  topology: CompiledSimulationTopology,
  itemType: string,
): string | null {
  for (const slotId of topology.ordering.slotOrder) {
    const slot = topology.slots[slotId];
    const cacheGroup = slot === undefined ? undefined : topology.cacheGroups[slot.cacheGroupId];
    const device = cacheGroup === undefined ? undefined : topology.devices[cacheGroup.deviceId];
    if (device?.definitionId === "warehouse" && slot?.sourceSlotId === itemType) {
      return slotId;
    }
  }
  return null;
}