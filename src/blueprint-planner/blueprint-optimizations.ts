import type { RegistryContract } from "@/domain/registry/registry-contract";
import { DEFAULT_BLUEPRINT_OPTIMIZATIONS } from "@/shared/planner-task";
import { getPlannerPorts, transportCapacity } from "./geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { PlannerPlacement } from "./placement";
import { PlannerRandom } from "./search-random";
import { wireProductionNetwork } from "./wiring";
import { buildLayoutGraph } from "./layout-graph";

export const blueprintPortKey = (port: PlannerWire["source"]) => `${port.entityId}/${port.groupIndex}/${port.portIndex}`;

/** 库存链接、标签和业务配置具有独立含义，不随物流树重建而丢弃。 */
export function blueprintRebuildableNodes(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[]): Set<string> {
  const linked = new Set(network.slotLinks.flatMap(link => [link.source.entityId, link.target.entityId]));
  const nodes = network.nodes.filter(node => node.purpose === "logistics" && !node.boundaryPort && !linked.has(node.entity.id)
    && new Set([...node.inputs, ...node.outputs].map(flow => flow.itemId)).size <= 1
    && !node.entity.tags.length && ["splitter", "converger", "connector", "admission"].includes(registry.queries.resolveLogisticsRole(node.definition.id) ?? "")
    && Object.keys(node.entity.config).every(blueprintPortConfigKey));
  const ids = new Set(nodes.map(node => node.entity.id));
  const graph = buildLayoutGraph([...ids], wires.filter(wire => ids.has(wire.source.entityId) && ids.has(wire.target.entityId))
    .map(wire => ({ from: wire.source.entityId, to: wire.target.entityId })));
  return new Set(nodes.filter(node => !graph.groups[graph.groupIndexByNodeId.get(node.entity.id)!]!.cyclic).map(node => node.entity.id));
}

function storageGroups(node: PlannerNode, port: PlannerWire["source"]): string[] {
  return node.definition.portStorageBindings.filter(binding => binding.portGroupId === node.definition.portGroups[port.groupIndex]!.id)
    .map(binding => binding.storageSlotGroupId).sort();
}

export function blueprintPortConfigKey(key: string): boolean {
  return /^portGroups\[\d+\]\.ports\[\d+\]\.(acceptRule|priorityGroup|roundRobinSeed|admissionRule)(\..+)?$/.test(key);
}

const portConfigPrefix = (port: PlannerWire["source"]) => `portGroups[${port.groupIndex}].ports[${port.portIndex}].`;

function portConfigurationClass(node: PlannerNode, port: PlannerWire["source"]): string {
  const definition = node.definition.portGroups[port.groupIndex]!.ports[port.portIndex]!;
  return JSON.stringify([port.groupIndex, port.direction, port.kind, storageGroups(node, port), definition.acceptRule, definition.admissionRule ?? null]);
}

function portConfiguration(node: PlannerNode, port: PlannerWire["source"]): Record<string, unknown> {
  const definition = node.definition.portGroups[port.groupIndex]!.ports[port.portIndex]!;
  const prefix = portConfigPrefix(port);
  return { priorityGroup: definition.priorityGroup, roundRobinSeed: definition.roundRobinSeed,
    ...Object.fromEntries(Object.entries(node.entity.config).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value])) };
}

/** 每一组等价接口的配置必须仍是原配置的排列，不能借换口更改过滤或限流。 */
export function assertBlueprintPortConfigurations(registry: RegistryContract, before: PlannerNode, after: PlannerNode): void {
  const signature = (node: PlannerNode) => (["input", "output"] as const).flatMap(direction => getPlannerPorts(registry, node.entity, node.definition, direction)
    .map(port => JSON.stringify([portConfigurationClass(node, port), Object.entries(portConfiguration(node, port)).sort(([a], [b]) => a.localeCompare(b))])))
    .sort().join("\n");
  if (signature(before) !== signature(after)) throw new Error(`换口改变了端口控制语义：${before.entity.id}`);
}

/** 按真实端口库存通道穿过物流设施；桥接的两条通道不能混接。 */
export function blueprintLogicalWires(network: PlannerNetwork, wires: readonly PlannerWire[], controls: ReadonlySet<string>): PlannerWire[] {
  const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
  const result: PlannerWire[] = [];
  const visit = (wire: PlannerWire, path: ReadonlySet<string>) => {
    if (!controls.has(wire.target.entityId)) { result.push(wire); return; }
    const node = nodes.get(wire.target.entityId)!;
    const key = blueprintPortKey(wire.target);
    if (path.has(key)) throw new PlannerCandidateError("闭合物流控制回路保留原结构，本次不重建。");
    if (wire.itemIds.length !== 1) throw new PlannerCandidateError("混合物料物流树保留原结构，本次不重建。");
    const groups = storageGroups(node, wire.target);
    const outputs = wires.filter(next => next.source.entityId === node.entity.id && next.itemIds.length === 1
      && next.itemIds[0] === wire.itemIds[0] && storageGroups(node, next.source).some(group => groups.includes(group)));
    const total = outputs.reduce((sum, next) => sum + next.perMinute, 0);
    if (!outputs.length || total <= 0) throw new PlannerCandidateError("物流支路缺少可识别的稳定出口。");
    const nextPath = new Set(path).add(key);
    for (const output of outputs) visit({ ...output, source: wire.source, perMinute: wire.perMinute * output.perMinute / total }, nextPath);
  };
  for (const wire of wires) if (!controls.has(wire.source.entityId)) visit(wire, new Set());
  const merged = new Map<string, PlannerWire>();
  for (const wire of result) {
    const key = `${blueprintPortKey(wire.source)}>${blueprintPortKey(wire.target)}:${wire.itemIds.join(",")}`;
    const previous = merged.get(key);
    merged.set(key, { ...wire, perMinute: wire.perMinute + (previous?.perMinute ?? 0) });
  }
  return [...merged.values()];
}

/** 只交换等流量、同物料的端点，设备各库存通道的供需量保持不变。 */
// AI-CORRECTION 2026-10-12：允许重建物流时按端口总供需重新分配，分流与汇流允许不同流量的连接重组。
export function reassignBlueprintConnections(wires: readonly PlannerWire[], random: PlannerRandom, rebuildLogistics = false): PlannerWire[] {
  if (rebuildLogistics) {
    const groups = new Map<string, PlannerWire[]>();
    for (const wire of wires) {
      if (wire.itemIds.length !== 1) throw new PlannerCandidateError("混合物料连接保留原结构，本次不重分配。");
      const key = `${wire.source.kind}/${wire.itemIds[0]}`;
      groups.set(key, [...(groups.get(key) ?? []), wire]);
    }
    const result: PlannerWire[] = [];
    for (const group of groups.values()) {
      const totals = (side: "source" | "target") => {
        const ports = new Map<string, { port: PlannerWire["source"]; remaining: number }>();
        for (const wire of group) {
          const port = wire[side], key = blueprintPortKey(port);
          const entry = ports.get(key) ?? { port, remaining: 0 };
          entry.remaining += wire.perMinute; ports.set(key, entry);
        }
        return random.shuffle([...ports.values()]);
      };
      const suppliers = totals("source");
      for (const consumer of totals("target")) for (const supplier of suppliers) {
        const amount = Math.min(consumer.remaining, supplier.remaining);
        if (amount <= 1e-8) continue;
        result.push({ source: supplier.port, target: consumer.port, itemIds: group[0]!.itemIds, perMinute: amount });
        consumer.remaining -= amount; supplier.remaining -= amount;
      }
    }
    return result;
  }
  const result = wires.map(wire => ({ ...wire }));
  const groups = new Map<string, number[]>();
  result.forEach((wire, index) => {
    const key = `${wire.source.kind}/${wire.itemIds.slice().sort().join(",")}/${wire.perMinute.toFixed(6)}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  for (const indices of groups.values()) {
    const targets = random.shuffle(indices.map(index => result[index]!.target));
    indices.forEach((index, at) => { result[index] = { ...result[index]!, target: targets[at]! }; });
  }
  return result;
}

/** 换口只使用相同库存、过滤和优先级语义的接口，不修改设备配置。 */
// AI-CORRECTION 2026-10-12：端口控制配置随连接整体迁移，配方、库存及其他配置仍保留。
export function reassignBlueprintPorts(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[], random: PlannerRandom): PlannerWire[] {
  // AI-REMOVED 2026-10-12:
  // Reason: 原图常把闲置口过滤为关闭，保持物理过滤位置会让换口权限失效。
  // Trigger: 真实植物回流网表的换口回归失败。Evidence: 四十个种子均无换口。
  // Replacement: 下方按等价端口置换过滤、限流、优先级与轮询配置。
  // Risk: 只允许等价库存及基础端口定义，交付继续检查配置置换和真实产率。Human Review: Required
  // Original code:
  //   const result = wires.map(wire => ({ ...wire }));
  //   for (const node of network.nodes) for (const side of ["source", "target"] as const) {
  //     if (node.boundaryPort) continue;
  //     const direction = side === "source" ? "output" : "input";
  //     const groups = new Map<string, number[]>();
  //     result.forEach((wire, index) => {
  //       if (wire[side].entityId !== node.entity.id) return;
  //       const key = blueprintPortKey(wire[side]);
  //       groups.set(key, [...(groups.get(key) ?? []), index]);
  //     });
  //     const occupied = new Set<string>();
  //     for (const indices of random.shuffle([...groups.values()])) {
  //       const previous = result[indices[0]!]![side];
  //       const prefix = (port: typeof previous) => `portGroups[${port.groupIndex}].ports[${port.portIndex}]`;
  //       const semantics = (port: typeof previous) => JSON.stringify([storageGroups(node, port),
  //         node.entity.config[`${prefix(port)}.priorityGroup`] ?? node.definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.priorityGroup,
  //         node.entity.config[`${prefix(port)}.admissionRule`] ?? node.definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.admissionRule]);
  //       const ports = random.shuffle(getPlannerPorts(registry, node.entity, node.definition, direction).filter(port => !occupied.has(blueprintPortKey(port))
  //         && port.kind === previous.kind && semantics(port) === semantics(previous)
  //         && indices.every(index => result[index]!.itemIds.every(item => plannerPortAcceptsItem(registry, node.entity, node.definition, port, item)))));
  //       const port = ports[0];
  //       if (!port) throw new PlannerCandidateError("本次换口组合没有完整的等价端口匹配。");
  //       occupied.add(blueprintPortKey(port));
  //       for (const index of indices) result[index] = { ...result[index]!, [side]: port };
  //     }
  //   }
  //   return result;
  const remapped = new Map<string, PlannerWire["source"]>();
  for (const node of network.nodes) {
    if (node.boundaryPort || node.definition.portGroups.some(group => group.direction === "bidirectional")
      || Object.keys(node.entity.config).some(key => key.startsWith("portGroups") && !blueprintPortConfigKey(key))) continue;
    const groups = new Map<string, PlannerWire["source"][]>();
    for (const direction of ["input", "output"] as const) for (const port of getPlannerPorts(registry, node.entity, node.definition, direction)) {
      const key = portConfigurationClass(node, port);
      groups.set(key, [...(groups.get(key) ?? []), port]);
    }
    const original = node.entity.config;
    const next = { ...original };
    for (const ports of groups.values()) {
      if (ports.length < 2) continue;
      const destinations = random.shuffle(ports);
      for (const [index, source] of ports.entries()) {
        const target = destinations[index]!;
        remapped.set(blueprintPortKey(source), target);
        const prefix = portConfigPrefix(target);
        for (const key of Object.keys(next)) if (key.startsWith(prefix)) delete next[key];
        for (const [field, value] of Object.entries(portConfiguration(node, source))) next[prefix + field] = value;
      }
    }
    node.entity.config = next;
  }
  return wires.map(wire => ({ ...wire, source: remapped.get(blueprintPortKey(wire.source)) ?? wire.source,
    target: remapped.get(blueprintPortKey(wire.target)) ?? wire.target }));
}

export async function rebuildBlueprintLogistics(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[], checkBudget: () => void): Promise<PlannerWire[]> {
  const configs = new Map(network.nodes.map(node => [node.entity.id, structuredClone(node.entity.config)]));
  const placement = new PlannerPlacement(registry, Math.max(32, ...network.nodes.map(node => node.entity.position.x + 16)), 0, 0, 0, 0);
  placement.reserve(network.nodes);
  const result = await wireProductionNetwork(registry, network, placement, checkBudget, false, true, false, undefined, wires);
  for (const node of network.nodes) if (configs.has(node.entity.id)) node.entity.config = configs.get(node.entity.id)!;
  const reserved = new Set([...network.request.blueprintSource!.blueprint.entityOrder, ...configs.keys()]);
  const renamed = new Map<string, string>();
  for (const node of network.nodes) if (!configs.has(node.entity.id)) {
    const previous = node.entity.id;
    while (reserved.has(node.entity.id)) node.entity.id += "_";
    reserved.add(node.entity.id); renamed.set(previous, node.entity.id);
  }
  return result.map(wire => ({ ...wire, source: { ...wire.source, entityId: renamed.get(wire.source.entityId) ?? wire.source.entityId },
    target: { ...wire.target, entityId: renamed.get(wire.target.entityId) ?? wire.target.entityId } }));
}

/** 新任务的权限同时约束生成和交付；缺省字段的旧检查点沿用原验收。 */
export function assertBlueprintOptimizationWires(registry: RegistryContract, before: PlannerNetwork, beforeWires: readonly PlannerWire[],
  after: PlannerNetwork, afterWires: readonly PlannerWire[]): void {
  const policy = before.request.options.blueprintOptimizations;
  if (!policy) return;
  const original = blueprintLogicalWires(before, beforeWires, policy.rebuildLogistics ? blueprintRebuildableNodes(registry, before, beforeWires) : new Set());
  const candidate = blueprintLogicalWires(after, afterWires, policy.rebuildLogistics ? blueprintRebuildableNodes(registry, after, afterWires) : new Set());
  const summarize = (network: PlannerNetwork, wires: readonly PlannerWire[], relations: boolean) => {
    const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
    const endpoint = (port: PlannerWire["source"], item: string) => {
      const node = nodes.get(port.entityId)!;
      if (policy.mergeBoundaryFacilities && ["supply", "product"].includes(node.purpose)) return `${node.purpose}/${node.definition.id}/${item}`;
      return policy.reassignPorts ? `${port.entityId}/${storageGroups(node, port).join(",")}` : blueprintPortKey(port);
    };
    const totals = new Map<string, number>();
    for (const wire of wires) for (const item of wire.itemIds) {
      const source = endpoint(wire.source, item), target = endpoint(wire.target, item);
      for (const key of relations ? [`${source}>${target}/${item}`] : [`out:${source}/${item}`, `in:${target}/${item}`]) {
        totals.set(key, (totals.get(key) ?? 0) + wire.perMinute);
      }
    }
    return totals;
  };
  const expected = summarize(before, original, !policy.reassignConnections), actual = summarize(after, candidate, !policy.reassignConnections);
  if (expected.size !== actual.size || [...expected].some(([key, value]) => Math.abs(value - (actual.get(key) ?? -Infinity)) > 1e-4)) {
    throw new Error("候选改变了未授权的进出料口、供料关系或物料流量。");
  }
  for (const wire of afterWires) if (wire.perMinute > transportCapacity(wire.source.kind) + 1e-6) throw new Error("候选连接超过端口吞吐量。");
}

export function blueprintOptimizationPolicy(network: PlannerNetwork) {
  return network.request.options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS;
}
