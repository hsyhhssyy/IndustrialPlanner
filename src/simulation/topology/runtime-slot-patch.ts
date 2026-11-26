import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import type { CompiledSimulationTopology } from "../contracts";

export function resolveCompiledDeviceId(
  topology: CompiledSimulationTopology,
  entityId: string,
): string | null {
  if (topology.devices[entityId] !== undefined) {
    return entityId;
  }

  const directCompiledId = `device:${entityId}`;
  if (topology.devices[directCompiledId] !== undefined) {
    return directCompiledId;
  }

  return topology.ordering.deviceOrder.find((deviceId) =>
    topology.devices[deviceId]?.sourceEntityId === entityId,
  ) ?? null;
}

/** 一个编辑槽可能有两个物流视图。替换它的总库存时沿用已有货物所在视图，空槽沿用拓扑的初始出货位置。 */
export function resolveRuntimeSlotPatch(
  topology: CompiledSimulationTopology,
  deviceId: string,
  patch: Pick<SimulationRuntimeSlotPatch, "storageGroupId" | "slotId">,
  occupied: (slot: string) => boolean,
): { views: string[]; stockView: string } | null {
  const views: string[] = [];
  for (const nodeId of topology.devices[deviceId]!.nodeIds) {
    const node = topology.nodes[nodeId]!;
    if (node.sourceStorageSlotGroupId !== patch.storageGroupId) continue;
    const slot = node.slotIds.find(id => topology.slots[id]?.sourceSlotId === patch.slotId);
    if (!slot) continue;
    if (node.viewRole === "output-view") views.unshift(slot);
    else views.push(slot);
  }
  return views.length ? { views, stockView: views.find(occupied) ?? views[0]! } : null;
}
