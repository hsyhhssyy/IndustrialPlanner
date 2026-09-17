import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { EntityAcceptRuleDefinition } from "@/domain/registry/types/entity-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { findLogisticsDevice, getPlannerPorts, transportCapacity, type PlannerPort } from "./geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { createPlainNode, type PlannerPlacement } from "./placement";
import { buildLayoutGraph } from "./layout-graph";
import { partitionEqualFlows } from "./equal-flow";

interface Allocation {
  port: PlannerPort;
  readonly node: PlannerNode;
  readonly amounts: Map<string, number>;
  remaining: number;
  consumption: boolean;
}

interface Connection {
  source: PlannerPort;
  target: PlannerPort;
  readonly amounts: Map<string, number>;
}

export async function wireProductionNetwork(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, checkBudget: () => void = () => {}): Promise<PlannerWire[]> {
  const outputs = allocatePorts(registry, network.nodes, "output");
  const inputs = allocatePorts(registry, network.nodes, "input");
  const connections: Connection[] = [];
  const suppliers = new Map<string, Array<{ allocation: Allocation; remaining: number }>>();
  for (const allocation of outputs) {
    for (const [itemId, amount] of allocation.amounts) {
      const entries = suppliers.get(itemId) ?? [];
      entries.push({ allocation, remaining: amount });
      suppliers.set(itemId, entries);
    }
  }
  // 先满足生产和回流，再接目标与副产物出口；不会把循环的回流量当成净产出。
  const consumerOrder = [...inputs].sort((left, right) => Number(isSink(left.node)) - Number(isSink(right.node)));
  for (const consumer of consumerOrder) {
    for (const [itemId, amount] of consumer.amounts) {
      let remaining = amount;
      const providers = [...(suppliers.get(itemId) ?? [])].sort((left, right) =>
        distance(left.allocation.port, consumer.port) - distance(right.allocation.port, consumer.port));
      for (const provider of providers) {
        if (remaining < 1e-6) break;
        if (provider.remaining < 1e-6) continue;
        // AI-REMOVED 2026-09-16:
        // Reason: 供料目标从单个消费者扩展到同类需求池。
        // Trigger: 允许独立分组运行消耗，以比较外供数量与实际面积。
        // Evidence: 流体冗余是二级惩罚，不是禁止更多源的硬约束。
        // Replacement: 下方 permitted 目标集合检查。
        // Risk: 禁止跨需求池串料。Human Review: Required。
        // Original code:
        //         const dedicated = provider.allocation.node.supplyTarget;
        //         if (dedicated !== undefined && (dedicated.entityId !== consumer.node.entity.id
        //           || (dedicated.storageGroupIds !== undefined && !consumer.node.definition.portStorageBindings.some(binding =>
        //             binding.portGroupId === consumer.node.definition.portGroups[consumer.port.groupIndex]!.id && dedicated.storageGroupIds!.includes(binding.storageSlotGroupId))))) continue;
        const dedicated = provider.allocation.node.supplyTarget;
        const permitted = dedicated === undefined ? provider.allocation.node.supplyTargets : [dedicated];
        if (permitted?.length && !permitted.some(target => target.entityId === consumer.node.entity.id
          && (target.storageGroupIds === undefined || consumer.node.definition.portStorageBindings.some(binding =>
            binding.portGroupId === consumer.node.definition.portGroups[consumer.port.groupIndex]!.id
            && target.storageGroupIds!.includes(binding.storageSlotGroupId))))) continue;
        // AI-REMOVED 2026-09-16:
        // Reason: 输出设施支持局部生产者组，不能跨组抢占已分配输出。
        // Trigger: 流体供排分组与训练结构参数。
        // Evidence: 全部废液集中到一个入口造成持续布线瓶颈。
        // Replacement: 下方 outputSources 集合检查。
        // Risk: 仍需容量和真实产量验证。Human Review: Required。
        // Original code:
        //         const outputSource = consumer.node.outputSource;
        //         if (outputSource !== undefined && (outputSource.entityId !== provider.allocation.node.entity.id
        //           || (outputSource.storageGroupIds !== undefined && !provider.allocation.node.definition.portStorageBindings.some(binding =>
        //             binding.portGroupId === provider.allocation.node.definition.portGroups[provider.allocation.port.groupIndex]!.id
        //             && outputSource.storageGroupIds!.includes(binding.storageSlotGroupId))))) continue;
        const outputSource = consumer.node.outputSource;
        const outputSources = outputSource === undefined ? consumer.node.outputSources : [outputSource];
        if (outputSources?.length && !outputSources.some(source => source.entityId === provider.allocation.node.entity.id
          && (source.storageGroupIds === undefined || provider.allocation.node.definition.portStorageBindings.some(binding =>
            binding.portGroupId === provider.allocation.node.definition.portGroups[provider.allocation.port.groupIndex]!.id
            && source.storageGroupIds!.includes(binding.storageSlotGroupId))))) continue;
        const transferred = Math.min(remaining, provider.remaining);
        const existing = connections.find((entry) => samePort(entry.source, provider.allocation.port) && samePort(entry.target, consumer.port));
        if (existing === undefined) connections.push({ source: provider.allocation.port, target: consumer.port, amounts: new Map([[itemId, transferred]]) });
        else existing.amounts.set(itemId, (existing.amounts.get(itemId) ?? 0) + transferred);
        remaining -= transferred; provider.remaining -= transferred;
      }
      if (remaining > 1e-6) throw new PlannerCandidateError(`物料不足：${itemId}，缺少 ${remaining.toFixed(2)}/min`);
    }
  }
  const extraConnections: Connection[] = [];
  for (const input of inputs) {
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const exportedRate = [...input.amounts.values()].reduce((sum, rate) => sum + rate, 0);
    if (!input.consumption && (input.node.purpose !== "product" || exportedRate >= transportCapacity(input.port.kind))) continue;
// AI-REMOVED 2026-09-16:
// Reason: 每个运行消耗通道都必须经过准入口，背压不能替代限速。
// Trigger: 用户要求供料硬约束、紧凑布局和无人值守调参。
// Evidence: 供料约束与施工评分.md；旧实现逐设备创建无限源。
// Replacement: 下方无条件为 consumption 输入设置准入口
// Risk: 需真实 Dense 验证新供料拓扑。
// Human Review: Required
// Original code:
//     // 独立供料会自然背压；只在与其他消费者争用同一生产端口时限制运行消耗。
//     if (input.consumption && connections.filter(connection => samePort(connection.target, input.port)).every(connection =>
//       connections.filter(other => samePort(other.source, connection.source)).length === 1)) continue;
    if (input.amounts.size !== 1) throw new PlannerCandidateError("运行消耗端口需要独立物料线路。");
    const [itemId, rate] = [...input.amounts][0]!;
    const definition = findLogisticsDevice(registry, input.port.kind, "admission");
    const limiter = createPlainNode(registry, definition.id, `eda-limiter-${network.nodes.length}`, "logistics");
    placement.placeAnywhere(limiter, 0, input.port.outside);
    network.nodes.push(limiter);
    const inlet = getPlannerPorts(registry, limiter.entity, definition, "input", itemId)[0]!;
    const outlet = getPlannerPorts(registry, limiter.entity, definition, "output", itemId)[0]!;
    limiter.entity.config[`portGroups[${inlet.groupIndex}].ports[${inlet.portIndex}].admissionRule`] = {
      itemId, limit: null, perMinuteLimit: Math.ceil(rate / 6 - 1e-6) * 6,
    };
    for (const connection of connections) if (samePort(connection.target, input.port)) connection.target = inlet;
    extraConnections.push({ source: outlet, target: input.port, amounts: new Map(input.amounts) });
  }
  connections.push(...extraConnections);

  const outputGroups = groupConnections(connections, "source");
  for (const group of outputGroups.values()) {
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (group.length > 1) expandSplitTree(registry, network, placement, connections, group, group[0]!.source, false);
  }
  const inputGroups = groupConnections(connections, "target");
  for (const group of inputGroups.values()) {
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (group.length > 1) expandConvergers(registry, network, placement, connections, group);
  }
  // 未使用端口关闭，避免靠近设备的其他线路意外取走产物或送入错误原料。
  for (const node of network.nodes.filter((entry) => entry.recipe !== null)) {
    for (const direction of ["input", "output"] as const) {
      for (const port of getPlannerPorts(registry, node.entity, node.definition, direction)) restrictPort(registry, node, port, []);
    }
  }
  for (const allocation of [...outputs, ...inputs]) restrictPort(registry, allocation.node, allocation.port, [...allocation.amounts.keys()]);
  const graph = buildLayoutGraph(network.nodes.map((node) => node.entity.id), connections.map((connection) => ({ from: connection.source.entityId, to: connection.target.entityId })));
  for (const connection of connections) {
    const group = graph.groupIndexByNodeId.get(connection.source.entityId)!;
    if (!graph.groups[group]!.cyclic) continue;
    const node = network.nodes.find((entry) => entry.entity.id === connection.source.entityId)!;
    const port = connection.source;
    // 分流器保持均分；回流优先级只用于设备自身的独立输出口。
    if (registry.queries.resolveLogisticsRole(node.definition.id) === "splitter") continue;
    // 先让循环蓄满回流库存；其余分支在回流端背压后取得净产物。
    node.entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].priorityGroup`] =
      graph.groupIndexByNodeId.get(connection.target.entityId) === group ? 1 : 5;
  }
  return connections.map((connection) => ({
    source: connection.source, target: connection.target,
    itemIds: [...connection.amounts.keys()], perMinute: [...connection.amounts.values()].reduce((sum, value) => sum + value, 0),
    minimumCells: minimumAdmissionSpacing(network, connection),
  }));
}

function minimumAdmissionSpacing(network: PlannerNetwork, connection: Connection): number {
  const source = network.nodes.find(node => node.entity.id === connection.source.entityId)!;
  const target = network.nodes.find(node => node.entity.id === connection.target.entityId)!;
  if (!source.definition.tags.includes("splitter") && !["pipe_splitter", "log_splitter"].includes(source.definition.id)) return 0;
  const rule = target.entity.config[`portGroups[${connection.target.groupIndex}].ports[${connection.target.portIndex}].admissionRule`];
  return rule && typeof rule === "object" && "perMinuteLimit" in rule && typeof rule.perMinuteLimit === "number"
    ? Math.ceil(rule.perMinuteLimit / 6) : 0;
}

function allocatePorts(registry: RegistryContract, nodes: readonly PlannerNode[], direction: "input" | "output"): Allocation[] {
  const result: Allocation[] = [];
  for (const node of nodes) {
    const allocations = new Map<string, Allocation>();
    const flows = direction === "input" ? node.inputs : node.outputs;
    for (const flow of flows) {
      let remaining = flow.perMinute;
      const counterparts = nodes.filter(other => other !== node).flatMap(other => (direction === "input" ? other.outputs : other.inputs)
        .filter(otherFlow => otherFlow.itemId === flow.itemId).flatMap(otherFlow => getPlannerPorts(registry, other.entity, other.definition,
          direction === "input" ? "output" : "input", flow.itemId, otherFlow.storageGroupIds)));
      const connectionDistance = (port: PlannerPort) => Math.min(...counterparts.map(other => distance(port, other)), 1_000_000);
      const candidates = getPlannerPorts(registry, node.entity, node.definition, direction, flow.itemId, flow.storageGroupIds)
        .sort((left, right) => Number(allocations.has(portKey(left))) - Number(allocations.has(portKey(right)))
          || connectionDistance(left) - connectionDistance(right));
      for (const port of candidates) {
        if (remaining < 1e-6) break;
        let allocation = allocations.get(portKey(port));
        if (allocation !== undefined && port.kind === LOGISTICS_KIND.pipe && !allocation.amounts.has(flow.itemId)) continue;
        if (allocation === undefined) {
          allocation = { port, node, remaining: transportCapacity(port.kind), amounts: new Map(), consumption: false };
          allocations.set(portKey(port), allocation);
        }
        const amount = Math.min(remaining, allocation.remaining);
        if (amount <= 1e-6) continue;
        allocation.amounts.set(flow.itemId, (allocation.amounts.get(flow.itemId) ?? 0) + amount);
        allocation.remaining -= amount; remaining -= amount;
        allocation.consumption ||= direction === "input" && flow.storageGroupIds !== undefined
          && node.definition.recipeChannels.some((channel) => channel.type === "consumption-channel"
            && channel.ingredientStorageGroupIds.some((id) => flow.storageGroupIds!.includes(id)));
      }
      if (remaining > 1e-6) throw new PlannerCandidateError(`设备端口运力不足：${node.definition.id} / ${flow.itemId}`);
    }
    result.push(...allocations.values());
  }
  return result;
}

// AI-REMOVED 2026-09-16:
// Reason: 分流和汇流约束不同，旧通用级联无法保证均分。
// Trigger: 用户要求等流量分流或完整准入口限制。
// Evidence: A 接一个设备和 B，B 接两个设备时比例为 1/2、1/4、1/4。
// Replacement: expandSplitTree 和 expandConvergers。
// Risk: 需真实布线和产量验证。Human Review: Required。
// Original code:
// function expandJunctions(
//   registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement,
//   connections: Connection[], group: Connection[], role: "splitter" | "converger",
// ): void {
//   const shared = role === "splitter" ? "source" : "target";
//   const branchDirection = role === "splitter" ? "output" : "input";
//   let root = group[0]![shared];
//   let offset = 0;
//   while (offset < group.length) {
//     const definition = findLogisticsDevice(registry, root.kind, role);
//     const node = createPlainNode(registry, definition.id, `eda-junction-${network.nodes.length}`, "logistics");
//     placement.placeAnywhere(node, 0, root.outside);
//     network.nodes.push(node);
//     const trunk = getPlannerPorts(registry, node.entity, definition, role === "splitter" ? "input" : "output")[0]!;
//     const branches = getPlannerPorts(registry, node.entity, definition, branchDirection);
//     const remaining = group.slice(offset);
//     const trunkAmounts = new Map<string, number>();
//     for (const connection of remaining) {
//       for (const [item, rate] of connection.amounts) trunkAmounts.set(item, (trunkAmounts.get(item) ?? 0) + rate);
//     }
//     connections.push({
//       source: role === "splitter" ? root : trunk,
//       target: role === "splitter" ? trunk : root,
//       amounts: trunkAmounts,
//     });
//     const take = remaining.length <= branches.length ? remaining.length : branches.length - 1;
//     for (let index = 0; index < take; index++) {
//       const connection = remaining[index]!;
//       const port = branches[index]!;
//       connection[shared] = port;
//       restrictPort(registry, node, port, [...connection.amounts.keys()]);
//       if (role === "splitter") {
//         const target = network.nodes.find((entry) => entry.entity.id === connection.target.entityId);
//         node.entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].priorityGroup`] = target !== undefined && isSink(target) ? 5 : 1;
//       }
//     }
//     offset += take;
//     root = branches.at(-1)!;
//   }
// }
function expandConvergers(
  registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement,
  connections: Connection[], group: Connection[],
): void {
  const shared = "target";
  const branchDirection = "input";
  let root = group[0]![shared];
  let offset = 0;
  while (offset < group.length) {
    const definition = findLogisticsDevice(registry, root.kind, "converger");
    const node = createPlainNode(registry, definition.id, `eda-junction-${network.nodes.length}`, "logistics");
    placement.placeAnywhere(node, 0, root.outside);
    network.nodes.push(node);
    const trunk = getPlannerPorts(registry, node.entity, definition, "output")[0]!;
    const branches = getPlannerPorts(registry, node.entity, definition, branchDirection);
    const remaining = group.slice(offset);
    const trunkAmounts = new Map<string, number>();
    for (const connection of remaining) {
      for (const [item, rate] of connection.amounts) trunkAmounts.set(item, (trunkAmounts.get(item) ?? 0) + rate);
    }
    connections.push({
      source: trunk,
      target: root,
      amounts: trunkAmounts,
    });
    const take = remaining.length <= branches.length ? remaining.length : branches.length - 1;
    for (let index = 0; index < take; index++) {
      const connection = remaining[index]!;
      const port = branches[index]!;
      connection[shared] = port;
      restrictPort(registry, node, port, [...connection.amounts.keys()]);

    }
    offset += take;
    root = branches.at(-1)!;
  }
}

export function restrictPort(registry: RegistryContract, node: PlannerNode, port: PlannerPort, items: readonly string[]): void {
  const original = node.definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.acceptRule;
  const base: EntityAcceptRuleDefinition["base"] = items.length === 1
    ? { kind: "item", itemId: items[0]! } : { kind: "domain", flags: ItemDomainFlag.Solid };
  node.entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].acceptRule`] = {
    base, exclude: items.length === 1 ? original.exclude : registry.itemDefinitions.filter((item) => !items.includes(item.id)).map((item) => item.id),
  } satisfies EntityAcceptRuleDefinition;
}

function groupConnections(connections: readonly Connection[], key: "source" | "target"): Map<string, Connection[]> {
  const result = new Map<string, Connection[]>();
  for (const connection of connections) {
    const id = portKey(connection[key]);
    const entries = result.get(id) ?? [];
    entries.push(connection); result.set(id, entries);
  }
  return result;
}

function isSink(node: PlannerNode): boolean { return node.purpose === "product" || node.purpose === "byproduct"; }
function portKey(port: PlannerPort): string { return `${port.entityId}/${port.groupIndex}/${port.portIndex}`; }
function samePort(left: PlannerPort, right: PlannerPort): boolean { return portKey(left) === portKey(right); }
function distance(left: PlannerPort, right: PlannerPort): number { return Math.abs(left.cell.x - right.cell.x) + Math.abs(left.cell.y - right.cell.y); }

function expandSplitTree(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement,
  connections: Connection[], leaves: Connection[], root: PlannerPort, meteringRequired: boolean): void {
  if (leaves.length === 1) {
    const leaf = leaves[0]!;
    leaf.source = root;
    if (!meteringRequired) return;
    const target = network.nodes.find(node => node.entity.id === leaf.target.entityId)!;
    const existing = target.entity.config[`portGroups[${leaf.target.groupIndex}].ports[${leaf.target.portIndex}].admissionRule`];
    if (existing && typeof existing === "object" && "perMinuteLimit" in existing && typeof existing.perMinuteLimit === "number") return;
    if (leaf.amounts.size !== 1) throw new PlannerCandidateError("非等流量混合物料分支不能用单物料准入口限速。");
    const [itemId, rate] = [...leaf.amounts][0]!;
    const definition = findLogisticsDevice(registry, root.kind, "admission");
    const limiter = createPlainNode(registry, definition.id, `eda-branch-limiter-${network.nodes.length}`, "logistics");
    placement.placeAnywhere(limiter, 0, leaf.target.outside); network.nodes.push(limiter);
    const inlet = getPlannerPorts(registry, limiter.entity, definition, "input", itemId)[0]!;
    const outlet = getPlannerPorts(registry, limiter.entity, definition, "output", itemId)[0]!;
    limiter.entity.config[`portGroups[${inlet.groupIndex}].ports[${inlet.portIndex}].admissionRule`] = { itemId, limit: null, perMinuteLimit: rate };
    connections.push({ source: outlet, target: leaf.target, amounts: new Map(leaf.amounts) });
    leaf.target = inlet;
    return;
  }
  const definition = findLogisticsDevice(registry, root.kind, "splitter");
  const node = createPlainNode(registry, definition.id, `eda-split-${network.nodes.length}`, "logistics");
  placement.placeAnywhere(node, 0, root.outside); network.nodes.push(node);
  const inlet = getPlannerPorts(registry, node.entity, definition, "input")[0]!;
  const branches = getPlannerPorts(registry, node.entity, definition, "output");
  const rate = (leaf: Connection) => [...leaf.amounts.values()].reduce((sum, amount) => sum + amount, 0);
  const groups = partitionEqualFlows(leaves, rate, branches.length);
  const totals = groups.map(group => group.reduce((sum, leaf) => sum + rate(leaf), 0));
  const unequal = totals.some(total => Math.abs(total - totals[0]!) > 1e-6);
  const amounts = new Map<string, number>();
  for (const leaf of leaves) for (const [item, amount] of leaf.amounts) amounts.set(item, (amounts.get(item) ?? 0) + amount);
  connections.push({ source: root, target: inlet, amounts });
  for (const [index, branch] of branches.entries()) {
    const group = groups[index];
    restrictPort(registry, node, branch, group?.flatMap(leaf => [...leaf.amounts.keys()]).filter((id, at, all) => all.indexOf(id) === at) ?? []);
    // 所有启用分支使用相同优先级；不以 priorityGroup 伪造比例分流。
    node.entity.config[`portGroups[${branch.groupIndex}].ports[${branch.portIndex}].priorityGroup`] = 1;
    if (group) expandSplitTree(registry, network, placement, connections, group, branch, meteringRequired || unequal);
  }
}
