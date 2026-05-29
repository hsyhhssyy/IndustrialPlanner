import type {
  CompiledSimulationTopology,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";

/**
 * 将设备（协议储存箱）所有本地槽位的物品提交到仓库。
 *
 * 部分提交语义：仓库容量不足时移动可容纳数量，剩余留在本地槽位。
 * 提交后 count=0 的槽位清空 itemType。
 */
export function submitSlotsToWarehouse(
  topology: CompiledSimulationTopology,
  state: SimulationMutableRuntimeState,
  compiledDeviceId: string,
): void {
  const device = topology.devices[compiledDeviceId];
  if (device === undefined) return;

  // 找到仓库设备
  const warehouseDeviceId = findWarehouseDeviceId(topology);
  if (warehouseDeviceId === null) return;

  const warehouseNodeId = `${warehouseDeviceId}/node:warehouse`;

  // 遍历该设备的所有节点和槽位
  for (const nodeId of device.nodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) continue;

    for (const slotId of node.slotIds) {
      const storageSlotId = resolveStorageSlotId(state, slotId);
      const localSlot = state.persistent.slots[storageSlotId];
      if (localSlot === undefined || localSlot.itemType === null || localSlot.count <= 0) {
        continue;
      }

      // 找到仓库中对应物品的槽位
      const warehouseSlotId = `${warehouseNodeId}/slot:${localSlot.itemType}`;
      const warehouseStorageSlotId = resolveStorageSlotId(state, warehouseSlotId);
      const warehouseSlot = state.persistent.slots[warehouseStorageSlotId];
      if (warehouseSlot === undefined) continue;

      const warehouseCap = topology.slots[warehouseSlotId]?.capacity ?? Number.MAX_SAFE_INTEGER;
      const remainingCap = Math.max(0, warehouseCap - (warehouseSlot.count ?? 0));
      if (remainingCap <= 0) continue;

      // 部分提交：min(本地数量, 仓库剩余容量)
      const submitCount = Math.min(localSlot.count, remainingCap);
      warehouseSlot.itemType = localSlot.itemType;
      warehouseSlot.count = (warehouseSlot.count ?? 0) + submitCount;
      localSlot.count -= submitCount;
      if (localSlot.count <= 0) {
        localSlot.itemType = null;
        localSlot.count = 0;
      }
    }
  }
}

function findWarehouseDeviceId(
  topology: CompiledSimulationTopology,
): string | null {
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device !== undefined && device.definitionId === "warehouse") {
      return deviceId;
    }
  }
  return null;
}
