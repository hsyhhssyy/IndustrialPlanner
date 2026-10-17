import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { areGridRectsContaining, resolveEntityGridRect, resolveGasDiffusionRangeGridRect } from "@/shared/geometry/power-range";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "./model";
import { getPlannerPorts } from "./geometry";
import type { PlannerSearchSeed } from "./search-seed";
import { PlannerRandom } from "./search-random";

/** 2026-10-17：旧解只提供摆位，需求、设备数、供料设施及连线均由正式生产准备过程重新计算。 */
// AI-CORRECTION 2026-10-17：也返回兼容旧连接的软偏好；连线流量和容量仍重新分配，不能锁定旧拓扑。
export function guideProductionPlacement(registry: RegistryContract, network: PlannerNetwork,
  seed: PlannerSearchSeed, variant: number): PlannerWire[] {
  const previous = seed.network.nodes.map(node => ({ ...node, entity: structuredClone(node.entity) }));
  const random = new PlannerRandom(variant);
  const neighbors = new Map(previous.map(node => [node.entity.id, new Set<string>()]));
  for (const wire of seed.wires) {
    neighbors.get(wire.source.entityId)?.add(wire.target.entityId);
    neighbors.get(wire.target.entityId)?.add(wire.source.entityId);
  }
  // 环境依赖没有物流边；旋转整组时必须带上当前实际覆盖的消费者，避免破坏已成立的环境关系。
  for (const environment of previous) {
    const output = environment.recipeId && registry.queries.findRecipeDefinition(environment.recipeId)?.environmentOutput;
    if (!output) continue;
    const range = resolveGasDiffusionRangeGridRect({ entity: environment.entity,
      definition: registry.queries.findEntityDefinition(environment.entity.definitionId)!, rangeId: output.rangeId });
    if (!range) continue;
    for (const node of previous) {
      const recipe = node.recipeId && registry.queries.findRecipeDefinition(node.recipeId);
      if (!recipe || !recipe.requiredEnvironmentAnyOf?.includes(output.itemId)
        || !areGridRectsContaining(range, resolveEntityGridRect({ entity: node.entity,
          definition: registry.queries.findEntityDefinition(node.entity.definitionId)! }))) continue;
      neighbors.get(environment.entity.id)!.add(node.entity.id);
      neighbors.get(node.entity.id)!.add(environment.entity.id);
    }
  }
  const remaining = new Set(neighbors.keys()), components: string[][] = [];
  while (remaining.size) {
    const group = [remaining.values().next().value!]; remaining.delete(group[0]!);
    for (let cursor = 0; cursor < group.length; cursor++) for (const neighbor of neighbors.get(group[cursor]!) ?? []) {
      if (remaining.delete(neighbor)) group.push(neighbor);
    }
    components.push(group);
  }
  // 独立子网可以中心对称组合；这只是初始提案，后续单体和邻域移动仍能打破对称。
  if (components.length > 1) for (const ids of components) {
    if (random.integer(2) === 0) continue;
    const members = previous.filter(node => ids.includes(node.entity.id));
    if (members.some(node => node.boundaryPort || node.external)) continue;
    const rectangles = members.map(node => resolveEntityGridRect({ entity: node.entity,
      definition: registry.queries.findEntityDefinition(node.entity.definitionId)! }));
    const left = Math.min(...rectangles.map(rect => rect.x)), top = Math.min(...rectangles.map(rect => rect.y));
    const right = Math.max(...rectangles.map(rect => rect.x + rect.width)), bottom = Math.max(...rectangles.map(rect => rect.y + rect.height));
    members.forEach((node, index) => {
      const rect = rectangles[index]!;
      node.entity.position = { x: left + right - rect.x - rect.width, y: top + bottom - rect.y - rect.height };
      node.entity.rotation = ((node.entity.rotation + 180) % 360) as GridRotation;
    });
  }
  const key = (node: Pick<PlannerNode, "entity" | "purpose" | "inputs" | "outputs">, recipeId: string | null) => JSON.stringify([
    node.purpose, recipeId ?? node.entity.definitionId,
    [...new Set([...node.inputs, ...node.outputs].map(flow => flow.itemId))].sort(),
  ]);
  const available = new Map<string, typeof previous>();
  for (const node of previous) {
    const signature = key(node, node.recipeId);
    available.set(signature, [...available.get(signature) ?? [], node]);
  }
  const matched = new Map<string, PlannerNode>();
  for (const node of network.nodes) {
    const source = available.get(key(node, node.recipe?.id ?? null))?.shift();
    if (!source || node.boundaryPort || node.external) continue;
    matched.set(source.entity.id, node);
    node.entity.position = { ...source.entity.position };
    node.entity.rotation = source.entity.rotation;
  }
  // 旧连接仅作为端口和供需配对偏好；新流量、容量和新增来源仍由正式配线重新分配。
  return seed.wires.flatMap(wire => {
    const sourceNode = matched.get(wire.source.entityId), targetNode = matched.get(wire.target.entityId);
    if (!sourceNode || !targetNode) return [];
    const source = getPlannerPorts(registry, sourceNode.entity, sourceNode.definition, "output")
      .find(port => port.groupIndex === wire.source.groupIndex && port.portIndex === wire.source.portIndex);
    const target = getPlannerPorts(registry, targetNode.entity, targetNode.definition, "input")
      .find(port => port.groupIndex === wire.target.groupIndex && port.portIndex === wire.target.portIndex);
    return source && target ? [{ ...wire, source, target }] : [];
  });
}
