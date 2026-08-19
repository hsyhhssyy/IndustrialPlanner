import type {
  CompiledSimulationTopology,
  RegionalWarehouseWriteContext,
} from "../types";
import type { SimulationMutableRuntimeState } from "./runtime-state";
import { resolveStorageSlotId } from "./runtime-slot-access";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";

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
  regionalWarehouse?: RegionalWarehouseWriteContext,
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
      if (
        topology.simulationMode === SIMULATION_MODE.regionalMultiBase
        && regionalWarehouse?.isWarehouseStorageSlotId(warehouseStorageSlotId) !== true
      ) {
        throw new Error(
          `Regional warehouse write context is required for target slot "${warehouseStorageSlotId}".`,
        );
      }
      if (regionalWarehouse?.isWarehouseStorageSlotId(warehouseStorageSlotId) === true) {
        regionalWarehouse.deposit(localSlot.itemType, submitCount);
      } else {
        warehouseSlot.itemType = localSlot.itemType;
        warehouseSlot.count = (warehouseSlot.count ?? 0) + submitCount;
      }
      localSlot.count -= submitCount;
      if (localSlot.count <= 0) {
        localSlot.itemType = null;
        localSlot.count = 0;
      }
    }
  }
}

// AI-REMOVED 2026-06-06:
// Reason: submitMode 全局扫描机制已删除；自动入仓统一改为 WarehouseSink，协议存储箱提交走 r_warehouse_submit 配方。
// Trigger: 用户要求 submit mode 机制彻底删除，未来都用 warehouse sink 或配方交货。
// Evidence: RUN_ID 20260606-041337-509040 中旧蓝图 every-tick slot 被全局扫描消费，导致产线目标箱库存增量为 0。
// Replacement: runtime-slot-access.findInputSlotForItem 动态返回仓库槽；submitSlotsToWarehouse 仅由 r_warehouse_submit 配方完成时调用。
// Risk: Medium - 旧 submitMode 配置不再有运行时效果，需由迁移器转换为 channelRecipes。
// Human Review: Required
//
// Original code:
// export function submitSlotsBySubmitMode(
//   topology: CompiledSimulationTopology,
//   state: SimulationMutableRuntimeState,
// ): void {
//   const warehouseDeviceId = findWarehouseDeviceId(topology);
//   if (warehouseDeviceId === null) return;
//
//   for (const slotId of topology.ordering.slotOrder) {
//     const slot = topology.slots[slotId];
//     if (slot === undefined || !shouldSubmitSlotAtTick(slot, state.tickNumber)) {
//       continue;
//     }
//
//     submitSingleSlotToWarehouse(topology, state, warehouseDeviceId, slotId);
//   }
// }
//
// function shouldSubmitSlotAtTick(
//   slot: CompiledSimulationSlot,
//   tickNumber: number,
// ): boolean {
//   switch (slot.submitMode) {
//     case "never":
//       return false;
//     case "every-tick":
//       return true;
//     case "every-n-seconds":
//       return slot.submitIntervalTicks !== null
//         && slot.submitIntervalTicks > 0
//         && tickNumber % slot.submitIntervalTicks === 0;
//   }
// }
//
// function submitSingleSlotToWarehouse(
//   topology: CompiledSimulationTopology,
//   state: SimulationMutableRuntimeState,
//   warehouseDeviceId: string,
//   slotId: string,
// ): void {
//   const storageSlotId = resolveStorageSlotId(state, slotId);
//   const localSlot = state.persistent.slots[storageSlotId];
//   if (localSlot === undefined || localSlot.itemType === null || localSlot.count <= 0) {
//     return;
//   }
//
//   const warehouseNodeId = `${warehouseDeviceId}/node:warehouse`;
//   const warehouseSlotId = `${warehouseNodeId}/slot:${localSlot.itemType}`;
//   const warehouseStorageSlotId = resolveStorageSlotId(state, warehouseSlotId);
//   if (warehouseStorageSlotId === storageSlotId) {
//     return;
//   }
//
//   const warehouseSlot = state.persistent.slots[warehouseStorageSlotId];
//   if (warehouseSlot === undefined) return;
//
//   const warehouseCap = topology.slots[warehouseSlotId]?.capacity ?? Number.MAX_SAFE_INTEGER;
//   const remainingCap = Math.max(0, warehouseCap - (warehouseSlot.count ?? 0));
//   if (remainingCap <= 0) return;
//
//   const submitCount = Math.min(localSlot.count, remainingCap);
//   warehouseSlot.itemType = localSlot.itemType;
//   warehouseSlot.count = (warehouseSlot.count ?? 0) + submitCount;
//   localSlot.count -= submitCount;
//   if (localSlot.count <= 0) {
//     localSlot.itemType = null;
//     localSlot.count = 0;
//   }
// }

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
