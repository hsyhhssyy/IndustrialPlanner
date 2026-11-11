import type { RegistryContract } from "@/domain/registry/registry-contract";
import { blueprintLogicalWires } from "./blueprint-optimizations";
import { frozenManualTopology, isManualNode, manualConnectionKey, manualConnectionQuotas } from "./manual-constraints";
import { PlannerCandidateError, type PlannerNetwork, type PlannerWire } from "./model";

/** 从最终端口网表穿过物流设施核对物料关系，不能只相信初次分配的配额。 */
export function assertManualTopology(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[]): void {
  if (!frozenManualTopology(network)) return;
  const preparation = network.request.manualLayout!.preparation;
  const actual = network.nodes.filter(node => isManualNode(registry, node));
  for (const expected of preparation.nodes) {
    const node = actual.find(node => node.entity.id === expected.id);
    if (!node || node.definition.id !== expected.definitionId || (node.recipe?.id ?? null) !== expected.recipeId) {
      throw new PlannerCandidateError("计算改变了已确认的设备职责。");
    }
  }
  if (actual.some(node => node.purpose !== "power" && !preparation.nodes.some(expected => expected.id === node.entity.id))) {
    throw new PlannerCandidateError("计算扩张了已确认的生产拓扑。");
  }
  const core = new Set(preparation.nodes.map(node => node.id));
  const controls = new Set(network.nodes.filter(node => node.purpose === "logistics" && !node.external).map(node => node.entity.id));
  const edges = blueprintLogicalWires(network, wires, controls);
  const quotas = manualConnectionQuotas(network.request.manualLayout)!;
  for (const edge of edges) if (core.has(edge.source.entityId) && core.has(edge.target.entityId)) for (const item of edge.itemIds) {
    const key = manualConnectionKey(edge.source.entityId, edge.target.entityId, item);
    quotas.set(key, (quotas.get(key) ?? 0) - edge.perMinute);
  }
  if ([...quotas.values()].some(rate => Math.abs(rate) > 1e-6)) throw new PlannerCandidateError("最终物流改变了已确认的生产拓扑。");
}
