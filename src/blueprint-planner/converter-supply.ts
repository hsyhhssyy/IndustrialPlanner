import type { RegistryContract } from "@/domain/registry/registry-contract";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { PlannerCandidateError, type MaterialDemand, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { buildLayoutGraph } from "./layout-graph";

export interface ConverterSupply {
  readonly entityId: string;
  readonly itemId: string;
  readonly sourceId: string;
  readonly perMinute: number;
  readonly storageGroupIds: readonly string[];
}

export interface ConverterConsumer {
  readonly node: PlannerNode;
  readonly input: MaterialDemand;
  readonly capacity: number;
}

/** 依据配方及库存通道识别直接耗材循环，不按设备或物品名称建立特例。 */
export function converterConsumers(registry: RegistryContract, network: PlannerNetwork): ConverterConsumer[] {
  const rules = new PlannerSupplyRules(registry, network.request.plan, network.request.options.converterStartup);
  return network.nodes.flatMap(node => {
    const self = node.recipe ? rules.selfConsumption(node.recipe) : null;
    if (!self) return [];
    const groups = node.definition.recipeChannels.filter(channel => channel.type === "consumption-channel")
      .flatMap(channel => channel.ingredientStorageGroupIds);
    const inputs = node.inputs.filter(flow => flow.itemId === self.itemId && flow.storageGroupIds?.some(id => groups.includes(id)));
    if (!inputs.length) return [];
    const input = { itemId: self.itemId, perMinute: inputs.reduce((sum, flow) => sum + flow.perMinute, 0),
      storageGroupIds: [...new Set(inputs.flatMap(flow => flow.storageGroupIds ?? []))] };
    const capacity = node.outputs.filter(flow => flow.itemId === self.itemId).reduce((sum, flow) => sum + flow.perMinute, 0);
    return input.perMinute > 1e-6 && capacity > 1e-6 ? [{ node, input, capacity }] : [];
  });
}

/** 按摆位与剩余产能生成集中、级联或局部分组供料；角色可轮换，所有方案保持毛产量和净需求。 */
export function planConverterSupply(registry: RegistryContract, network: PlannerNetwork, variant = 0): ConverterSupply[] {
  const consumers = converterConsumers(registry, network);
  const result: ConverterSupply[] = [];
  for (const itemId of new Set(consumers.map(entry => entry.input.itemId))) {
    const entries = consumers.filter(entry => entry.input.itemId === itemId).sort((a, b) => a.node.entity.id.localeCompare(b.node.entity.id));
    const offset = Math.floor(variant / 3) % entries.length;
    const ordered = [...entries.slice(offset), ...entries.slice(0, offset)];
    const mode = variant % 3;
    const rootCount = 1 + Math.floor(variant / (3 * entries.length)) % entries.length;
    const roots = new Set(Array.from({ length: rootCount }, (_, index) => ordered[Math.ceil(index * ordered.length / rootCount)]!.node.entity.id));
    const remaining = new Map(entries.map(entry => [entry.node.entity.id, entry.capacity]));
    const active: ConverterConsumer[] = [];
    const children = new Map<string, number>();
    const rootById = new Map<string, string>();
    const assign = (consumer: ConverterConsumer, source: ConverterConsumer) => {
      const sourceId = source.node.entity.id;
      remaining.set(sourceId, remaining.get(sourceId)! - consumer.input.perMinute);
      children.set(sourceId, (children.get(sourceId) ?? 0) + 1);
      rootById.set(consumer.node.entity.id, rootById.get(sourceId) ?? sourceId);
      result.push({ entityId: consumer.node.entity.id, sourceId, itemId, perMinute: consumer.input.perMinute,
        storageGroupIds: consumer.input.storageGroupIds! });
      active.push(consumer);
    };
    for (const consumer of ordered.filter(entry => roots.has(entry.node.entity.id))) {
      if (remaining.get(consumer.node.entity.id)! + 1e-6 < consumer.input.perMinute) {
        throw new PlannerCandidateError("候选启动设备的计划产出不足以维持自身耗材。");
      }
      assign(consumer, consumer);
    }
    for (const consumer of ordered.filter(entry => !roots.has(entry.node.entity.id))) {
      const distance = (source: ConverterConsumer) => Math.abs(source.node.entity.position.x - consumer.node.entity.position.x)
        + Math.abs(source.node.entity.position.y - consumer.node.entity.position.y);
      const region = Math.floor(ordered.indexOf(consumer) * rootCount / ordered.length);
      const root = ordered[Math.ceil(region * ordered.length / rootCount)]!.node.entity.id;
      const available = active.filter(source => remaining.get(source.node.entity.id)! + 1e-6 >= consumer.input.perMinute
        && (rootCount === 1 || rootById.get(source.node.entity.id) === root));
      if (mode === 1) available.sort((a, b) => distance(a) - distance(b));
      if (mode === 2) available.sort((a, b) => Math.floor((children.get(a.node.entity.id) ?? 0) / 3)
        - Math.floor((children.get(b.node.entity.id) ?? 0) / 3) || active.indexOf(a) - active.indexOf(b));
      const source = available[0] ?? consumer;
      if (remaining.get(source.node.entity.id)! + 1e-6 < consumer.input.perMinute) {
        throw new PlannerCandidateError("当前供气组合没有足够的单路产能满足设备工作消耗。");
      }
      assign(consumer, source);
    }
  }
  return result;
}

/** 从实际线路回溯耗材来源；普通原料线路不参与启动循环分组。 */
export function converterStartupRoots(registry: RegistryContract, network: PlannerNetwork, wires?: readonly PlannerWire[]): Set<string> {
  const result = new Set<string>();
  const consumers = converterConsumers(registry, network);
  const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
  const storageGroups = (port: PlannerWire["source"]) => {
    const node = nodes.get(port.entityId)!;
    return node.definition.portStorageBindings.filter(binding => binding.portGroupId === node.definition.portGroups[port.groupIndex]!.id)
      .map(binding => binding.storageSlotGroupId);
  };
  const upstreamPort = (wire: PlannerWire) => ({ id: wire.source.entityId, groups: storageGroups(wire.source) });
  for (const itemId of new Set(consumers.map(entry => entry.input.itemId))) {
    const group = consumers.filter(entry => entry.input.itemId === itemId);
    const ids = new Set(group.map(entry => entry.node.entity.id));
    const edges: { from: string; to: string }[] = [];
    const external = new Set<string>();
    for (const entry of group) {
      const target = entry.node.entity.id;
      const pending = wires ? wires.filter(wire => wire.target.entityId === target && wire.itemIds.includes(itemId)
        && entry.node.definition.portStorageBindings.some(binding => binding.portGroupId === entry.node.definition.portGroups[wire.target.groupIndex]!.id
          && entry.input.storageGroupIds!.includes(binding.storageSlotGroupId))).map(upstreamPort)
        : entry.node.inputs.filter(flow => flow.itemId === itemId && flow.storageGroupIds?.some(id => entry.input.storageGroupIds!.includes(id)))
          .flatMap(flow => (flow.sourceEntityIds ?? [target]).map(id => ({ id, groups: [] as string[] })));
      const visited = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!, source = current.id;
        const key = JSON.stringify(current);
        if (visited.has(key)) continue;
        visited.add(key);
        if (ids.has(source)) { edges.push({ from: source, to: target }); continue; }
        const node = nodes.get(source);
        if (!node) throw new PlannerCandidateError("启动供料引用了不存在的设备。");
        const upstream = wires ? wires.filter(wire => wire.target.entityId === source && wire.itemIds.includes(itemId)
          && (!current.groups.length || storageGroups(wire.target).some(id => current.groups.includes(id)))).map(upstreamPort)
          : node.inputs.filter(flow => flow.itemId === itemId).flatMap(flow => (flow.sourceEntityIds ?? []).map(id => ({ id, groups: [] as string[] })));
        if (upstream.length) pending.push(...upstream);
        else if (node.purpose === "supply" || node.external || node.recipe) external.add(target);
      }
    }
    const graph = buildLayoutGraph([...ids], edges);
    graph.groups.forEach((component, index) => {
      const incoming = edges.some(edge => graph.groupIndexByNodeId.get(edge.to) === index && graph.groupIndexByNodeId.get(edge.from) !== index);
      if (!incoming && !component.nodeIds.some(id => external.has(id))) result.add(component.nodeIds[0]!);
    });
  }
  return result;
}
