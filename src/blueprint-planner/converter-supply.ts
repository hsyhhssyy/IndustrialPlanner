import type { RegistryContract } from "@/domain/registry/registry-contract";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { PlannerCandidateError, type MaterialDemand, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { buildLayoutGraph } from "./layout-graph";
import { plannerStartupClosure, type PlannerStartupOperation } from "@/shared/planner-startup";

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

/** 只信任本任务声明的输入边界；可采集标签不等于已接入该物料。 */
export function converterExternalItems(network: PlannerNetwork): ReadonlySet<string> {
  return new Set([...network.request.plan.infiniteItemIds,
    ...network.request.plan.externalSupplies.filter(flow => flow.perMinute > 0).map(flow => flow.itemId),
    ...network.request.plan.supplyPolicies?.filter(policy => policy.source === "external").map(policy => policy.itemId) ?? []]);
}

/** 根据真实库存绑定回溯所有开机条件，普通配方同样必须先取得原料和运行耗材。 */
export function converterNetworkStartup(registry: RegistryContract, network: PlannerNetwork, wires?: readonly PlannerWire[]) {
  const operations: PlannerStartupOperation[] = [];
  // AI-REMOVED 2026-10-29:
  // Reason: Registry 的可采集属性不能替代本任务实际声明的输入边界。
  // Trigger: 原图供气回归发现转换机自产物被误当作免费外供，启动罐未生成。
  // Evidence: 识别请求只声明息壤输入，resolve 却把可采集的息壤气返回为 external。
  // Replacement: converterExternalItems。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // const rules = new PlannerSupplyRules(registry, network.request.plan, network.request.options.converterStartup);
  const externalItems = converterExternalItems(network);
  const boundaries = new Set<string>();
  const token = (id: string, item: string, group = "*") => JSON.stringify([id, group, item]);
  const groups = (port: PlannerWire["source"]) => {
    const node = network.nodes.find(entry => entry.entity.id === port.entityId)!;
    return node.definition.portStorageBindings.filter(binding => binding.portGroupId === node.definition.portGroups[port.groupIndex]!.id)
      .map(binding => binding.storageSlotGroupId);
  };
  for (const node of network.nodes) {
    const id = node.entity.id;
    node.definition.storageSlotGroups.forEach((group, groupIndex) => group.slots.forEach((_, slotIndex) => {
      const prefix = `storageSlotGroups[${groupIndex}].slots[${slotIndex}]`;
      const item = node.entity.config[`${prefix}.initialItemType`];
      if (typeof item === "string" && Number(node.entity.config[`${prefix}.initialCount`] ?? 0) > 0) boundaries.add(token(id, item, group.id));
    }));
    for (const slot of network.initialSlots) if (slot.entityId === id && slot.count > 0 && slot.itemType !== null) {
      boundaries.add(token(id, slot.itemType, slot.storageGroupId));
    }
    const outputs = node.outputs.flatMap(flow => [token(id, flow.itemId),
      ...(flow.storageGroupIds ?? wires?.filter(wire => wire.source.entityId === id && wire.itemIds.includes(flow.itemId))
        .flatMap(wire => groups(wire.source)) ?? []).map(group => token(id, flow.itemId, group))]);
    if (node.recipe) {
      const demands = new Map<string, MaterialDemand>();
      for (const flow of node.inputs.filter(flow => flow.perMinute > 1e-6)) {
        const key = JSON.stringify([flow.itemId, [...flow.storageGroupIds ?? []].sort()]);
        const previous = demands.get(key);
        demands.set(key, previous ? { ...previous, perMinute: previous.perMinute + flow.perMinute,
          sourceEntityIds: previous.sourceEntityIds && flow.sourceEntityIds ? [...new Set([...previous.sourceEntityIds, ...flow.sourceEntityIds])] : undefined } : flow);
      }
      const requirements = [...demands.values()].map(flow => wires
        ? [...wires.filter(wire => wire.target.entityId === id && wire.itemIds.includes(flow.itemId)
          && (!flow.storageGroupIds?.length || groups(wire.target).some(group => flow.storageGroupIds!.includes(group))))
          .flatMap(wire => groups(wire.source).map(group => token(wire.source.entityId, flow.itemId, group))),
          ...flow.storageGroupIds?.map(group => token(id, flow.itemId, group)) ?? []]
        : [
          ...(flow.sourceEntityIds ?? network.nodes.filter(source => source.outputs.some(output => output.itemId === flow.itemId && output.perMinute > 1e-6))
            .map(source => source.entity.id)).map(source => token(source, flow.itemId)),
          ...!flow.sourceEntityIds && externalItems.has(flow.itemId)
            ? (boundaries.add(`boundary:${flow.itemId}`), [`boundary:${flow.itemId}`]) : [],
        ]);
      if (node.recipe.requiredEnvironmentAnyOf?.length) requirements.push(node.recipe.requiredEnvironmentAnyOf.map(item => `environment:${item}`));
      if (node.recipe.environmentOutput) outputs.push(`environment:${node.recipe.environmentOutput.itemId}`);
      operations.push({ id, requirements, outputs });
    } else if (node.purpose === "supply" || node.external) {
      operations.push({ id, requirements: [], outputs });
    } else if (wires) {
      // 每个库存通道单独传播；同一桥接器的独立通道不能互相带起。
      for (const wire of wires.filter(entry => entry.source.entityId === id)) for (const item of wire.itemIds) {
        for (const group of groups(wire.source)) {
          const upstream = wires.filter(entry => entry.target.entityId === id && entry.itemIds.includes(item) && groups(entry.target).includes(group))
            .flatMap(entry => groups(entry.source).map(sourceGroup => token(entry.source.entityId, item, sourceGroup)));
          operations.push({ id: token(id, item, group), requirements: [upstream], outputs: [token(id, item, group)] });
        }
      }
    } else {
      for (const flow of node.outputs) operations.push({ id: token(id, flow.itemId),
        requirements: [node.inputs.filter(input => input.itemId === flow.itemId).flatMap(input => input.sourceEntityIds ?? [])
          .map(source => token(source, flow.itemId))], outputs: [token(id, flow.itemId)] });
    }
  }
  return plannerStartupClosure(operations, boundaries);
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
// AI-CORRECTION 2026-10-29：供料拓扑独立领取 X 次，邻近关系改按稳定设备序，避免布局扰动偷偷切换拓扑。
// AI-CORRECTION 2026-10-29：保留原几何近邻候选；只在单元首次构网时确定，后续由检查点固定真实网表，不在布局扰动时重抽。
export function createConverterSupplyContext(registry: RegistryContract, network: PlannerNetwork) {
  return { consumers: converterConsumers(registry, network), natural: converterNetworkStartup(registry, network), external: converterExternalItems(network) };
}

export function planConverterSupply(registry: RegistryContract, network: PlannerNetwork, variant = 0,
  context = createConverterSupplyContext(registry, network)): ConverterSupply[] {
  const { consumers, natural } = context;
  const extra = Math.floor(variant / Math.max(1, 3 * consumers.length ** 2)) % 2 === 1;
  const result: ConverterSupply[] = [];
  for (const itemId of new Set(consumers.map(entry => entry.input.itemId))) {
    if (context.external.has(itemId)) continue;
    const entries = consumers.filter(entry => entry.input.itemId === itemId).sort((a, b) => a.node.entity.id.localeCompare(b.node.entity.id));
    const offset = Math.floor(variant / 3) % entries.length;
    const ordered = [...entries.slice(offset), ...entries.slice(0, offset)];
    const mode = variant % 3;
    const rootCount = 1 + Math.floor(variant / (3 * entries.length)) % entries.length;
    const roots = new Set(Array.from({ length: rootCount }, (_, index) => ordered[Math.ceil(index * ordered.length / rootCount)]!.node.entity.id));
    const sources = extra && network.request.options.converterStartup !== "reject" ? [] : network.nodes
      .filter(node => !entries.some(entry => entry.node === node) && natural.started.has(node.entity.id))
      .flatMap(node => {
        const capacity = node.outputs.filter(flow => flow.itemId === itemId).reduce((sum, flow) => sum + flow.perMinute, 0);
        return capacity > 1e-6 ? [{ node, capacity, input: { itemId, perMinute: 0 } }] : [];
      });
    const remaining = new Map([...entries, ...sources].map(entry => [entry.node.entity.id, entry.capacity]));
    const active: ConverterConsumer[] = [...sources];
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
      const source = sources.find(entry => remaining.get(entry.node.entity.id)! + 1e-6 >= consumer.input.perMinute);
      if (source) { assign(consumer, source); continue; }
      const starter = sources.find(entry => remaining.get(entry.node.entity.id)! > 1e-6);
      if (starter && consumer.capacity + remaining.get(starter.node.entity.id)! + 1e-6 >= consumer.input.perMinute) {
        // 慢速内生来源可与自产回流合流，不能要求启动来源单独承担全部稳态耗材。
        const amount = Math.min(remaining.get(starter.node.entity.id)!, consumer.input.perMinute);
        remaining.set(starter.node.entity.id, remaining.get(starter.node.entity.id)! - amount);
        remaining.set(consumer.node.entity.id, remaining.get(consumer.node.entity.id)! - consumer.input.perMinute + amount);
        result.push({ entityId: consumer.node.entity.id, sourceId: starter.node.entity.id, itemId, perMinute: amount, storageGroupIds: consumer.input.storageGroupIds! },
          { entityId: consumer.node.entity.id, sourceId: consumer.node.entity.id, itemId,
            perMinute: consumer.input.perMinute - amount, storageGroupIds: consumer.input.storageGroupIds! });
        active.push(consumer); rootById.set(consumer.node.entity.id, starter.node.entity.id);
        continue;
      }
      if (network.request.options.converterStartup === "reject" || !network.request.options.converterStartup) {
        throw new PlannerCandidateError("当前供料拓扑没有可自动启动的上游来源。");
      }
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
  const natural = converterNetworkStartup(registry, network, wires);
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
        // AI-CORRECTION 2026-10-29：普通生产节点只有全部开机前置条件可达时才是自然启动来源。
        else if (node.purpose === "supply" || node.external || natural.started.has(source)) external.add(target);
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
