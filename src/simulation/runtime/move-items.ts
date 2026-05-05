import type { CompiledSimulationTopology } from "@/domain/types/simulation";

import type { SimulationMutableRuntimeState } from "./runtime-state";

export function moveItems(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  const interactedDeviceIds = new Set<string>();

  for (const transfer of state.transient.transfers) {
    const edge = topology.transferEdges[transfer.edgeId];
    if (edge === undefined) {
      continue;
    }

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