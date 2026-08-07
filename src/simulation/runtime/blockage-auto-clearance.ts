import type {
  CompiledSimulationBlockageAutoClearance,
  CompiledSimulationDevice,
  CompiledSimulationTopology,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

export function applyBlockageAutoClearance(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    const deviceState = state.persistent.devices[deviceId];
    const clearance = device?.blockageAutoClearance ?? null;
    if (device === undefined || deviceState === undefined || clearance === null || !clearance.enabled) {
      continue;
    }

    const blockedChannelCount = clearance.channelIds.reduce((count, channelId) => {
      const recipe = deviceState.channelRecipes[channelId] ?? null;
      return recipe?.state === "waiting-output" ? count + 1 : count;
    }, 0);
    if (blockedChannelCount < clearance.blockedChannelThreshold) {
      continue;
    }

    clearConfiguredSlots(topology, state, device, clearance);
  }
}

function clearConfiguredSlots(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  device: CompiledSimulationDevice,
  clearance: CompiledSimulationBlockageAutoClearance,
): void {
  const storageSlotIds = new Set<string>();

  for (const slotRef of clearance.slotRefs) {
    for (const slot of Object.values(topology.slots)) {
      const node = topology.nodes[slot.nodeId];
      if (
        node?.deviceId !== device.id
        || slot.sourceStorageSlotGroupId !== slotRef.storageSlotGroupId
        || (slotRef.slotId !== null && slot.sourceSlotId !== slotRef.slotId)
      ) {
        continue;
      }
      // 跳过用户设为无限的槽位，避免清空无限原料后产物流入时继承 ignoreStock 标记
      if (slot.ignoreStock) {
        continue;
      }
      storageSlotIds.add(resolveStorageSlotId(state, slot.id));
    }
  }

  let changed = false;
  for (const storageSlotId of storageSlotIds) {
    const slotState = state.persistent.slots[storageSlotId];
    if (slotState === undefined || (slotState.itemType === null && slotState.count === 0)) {
      continue;
    }

    slotState.itemType = null;
    slotState.count = 0;
    changed = true;
  }

  if (changed) {
    state.transient.reservedAmountByStorageSlotId = null;
  }
}
