import type { CompiledSimulationTopology } from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

/**
 * 单基地模式在与区域仓库一致的 10 秒边界提交有限地区资源。
 * 余量以六分之一物品为单位保存，避免浮点累计误差。
 */
export function applySingleBaseRegionalResourceSupply(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
): void {
  if (topology.simulationMode !== "single-base") {
    return;
  }
  const finiteRates = topology.regionalResourceSupply?.finitePerMinuteByItemId ?? {};
  if (Object.keys(finiteRates).length === 0) {
    return;
  }

  const windowTicks = topology.standardTickRate * 10;
  const previousCompletedWindows = Math.floor(
    Math.max(0, state.lastAdvancedTickNumber - 1) / windowTicks,
  );
  const currentCompletedWindows = Math.floor(
    Math.max(0, state.tickNumber - 1) / windowTicks,
  );
  const completedWindowCount = currentCompletedWindows - previousCompletedWindows;
  if (completedWindowCount <= 0) {
    return;
  }

  for (const [itemId, perMinute] of Object.entries(finiteRates)) {
    const numerator = (state.persistent.regionalResourceRemainderSixths[itemId] ?? 0)
      + perMinute * completedWindowCount;
    const amount = Math.floor(numerator / 6);
    state.persistent.regionalResourceRemainderSixths[itemId] = numerator % 6;
    if (amount <= 0) {
      continue;
    }

    const warehouseSlotId = findWarehouseItemSlotId(topology, itemId);
    if (warehouseSlotId === null) {
      continue;
    }
    const storageSlotId = resolveStorageSlotId(state, warehouseSlotId);
    const slotState = state.persistent.slots[storageSlotId];
    if (slotState === undefined) {
      continue;
    }
    slotState.itemType = itemId;
    slotState.count += amount;
    state.transient.recipeStatsDelta.produced[itemId] =
      (state.transient.recipeStatsDelta.produced[itemId] ?? 0) + amount;
  }
}

function findWarehouseItemSlotId(
  topology: CompiledSimulationTopology,
  itemId: string,
): string | null {
  for (const device of Object.values(topology.devices)) {
    if (device.definitionId !== "warehouse") {
      continue;
    }
    for (const nodeId of device.nodeIds) {
      const node = topology.nodes[nodeId];
      if (node === undefined) {
        continue;
      }
      for (const slotId of node.slotIds) {
        const slot = topology.slots[slotId];
        if (slot?.lock === itemId || slot?.initialItemType === itemId) {
          return slotId;
        }
      }
    }
  }
  return null;
}
