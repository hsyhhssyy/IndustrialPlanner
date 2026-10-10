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
  sourceEntityIds?: readonly string[];
}

interface Connection {
  source: PlannerPort;
  target: PlannerPort;
  readonly amounts: Map<string, number>;
}

function availableNodeId(network: PlannerNetwork, prefix: string): string {
  let sequence = network.nodes.length;
  while (network.nodes.some(node => node.entity.id === `${prefix}-${sequence}`)) sequence++;
  return `${prefix}-${sequence}`;
}

export async function wireProductionNetwork(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, checkBudget: () => void = () => {}, compact = false, preferSharedAdmission = true, preferTrunk = false, managedItems?: ReadonlySet<string>): Promise<PlannerWire[]> {
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
  const consumerOrder = [...inputs].sort((left, right) => Number(isSink(left.node)) - Number(isSink(right.node))
    || Number(Boolean(right.sourceEntityIds)) - Number(Boolean(left.sourceEntityIds)));
  for (const consumer of consumerOrder) {
    for (const [itemId, amount] of consumer.amounts) {
      let remaining = amount;
      const providers = [...(suppliers.get(itemId) ?? [])].sort((left, right) =>
        Number(Boolean(right.allocation.node.supplyTarget)) - Number(Boolean(left.allocation.node.supplyTarget))
        || distance(left.allocation.port, consumer.port) - distance(right.allocation.port, consumer.port));
      for (const provider of providers) {
        if (remaining < 1e-6) break;
        if (provider.remaining < 1e-6) continue;
        if (consumer.sourceEntityIds && !consumer.sourceEntityIds.includes(provider.allocation.node.entity.id)) continue;
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
  // 启动根的回填优先独占同库存组空闲出口，避免分流树尚未蓄满时耗尽一次性启动库存。
  for (const group of groupConnections(connections, "source").values()) {
    if (group.length < 2) continue;
    const source = group[0]!.source;
    const node = network.nodes.find(entry => entry.entity.id === source.entityId)!;
    const returning = group.find(connection => connection.target.entityId === source.entityId || network.nodes.some(target =>
      target.entity.id === connection.target.entityId && target.purpose === "startup" && target.outputSource?.entityId === source.entityId));
    if (!returning) continue;
    const items = [...returning.amounts.keys()];
    const spare = getPlannerPorts(registry, node.entity, node.definition, "output", items[0])
      .filter(port => port.groupIndex === source.groupIndex && !connections.some(connection => samePort(connection.source, port))
        && items.every(item => getPlannerPorts(registry, node.entity, node.definition, "output", item).some(candidate => samePort(candidate, port))))
      .sort((a, b) => distance(a, returning.target) - distance(b, returning.target))[0];
    if (spare) returning.source = spare;
  }
  // 同一库存组的空闲输出口优先直连，避免先合并再分流引入限速、缓冲和额外占地。
  // AI-CORRECTION 2026-10-07: 普通生产分流已取消额外限速与缓冲；空闲口直连仍作为减少物流设施的候选。
  if (compact) for (const group of groupConnections(connections, "source").values()) {
    const node = network.nodes.find(entry => entry.entity.id === group[0]!.source.entityId)!;
    const original = group[0]!.source;
    for (const connection of group.slice(1)) {
      const items = [...connection.amounts.keys()];
      const spare = getPlannerPorts(registry, node.entity, node.definition, "output", items[0])
        .filter(port => port.groupIndex === original.groupIndex && !connections.some(other => samePort(other.source, port))
          && items.every(item => getPlannerPorts(registry, node.entity, node.definition, "output", item).some(other => samePort(other, port))))
        .sort((a, b) => distance(a, connection.target) - distance(b, connection.target))[0];
      if (spare) connection.source = spare;
    }
  }
  const extraConnections: Connection[] = [];
  const incomingByPort = groupConnections(connections, "target");
  const inputsByPort = new Map(inputs.map(input => [portKey(input.port), input]));
  const sharedAdmissions = [...groupConnections(connections, "source").values()].filter(group => {
    if (!preferSharedAdmission) return false;
    if (group.length < 2 || group.some(connection => connection.amounts.size !== 1)) return false;
    const itemId = [...group[0]!.amounts.keys()][0]!;
    if (group.some(connection => !connection.amounts.has(itemId))) return false;
    const source = group[0]!.source;
    const total = group.reduce((sum, connection) => sum + connection.amounts.get(itemId)!, 0);
    // 管道准入口在游戏中至多配置 60/min；限速窗口必须能精确表达该流量。
    if (total > Math.min(transportCapacity(source.kind), source.kind === LOGISTICS_KIND.pipe ? 60 : Infinity) + 1e-6
      || Math.abs(total / 6 - Math.round(total / 6)) > 1e-6) return false;
    if (group.some(connection => {
      const target = portKey(connection.target);
      const input = inputsByPort.get(target);
      return !input?.consumption || input.amounts.size !== 1 || incomingByPort.get(target)?.length !== 1
        || input.amounts.get(itemId) === undefined
        || Math.abs(input.amounts.get(itemId)! - connection.amounts.get(itemId)!) > 1e-6;
    })) return false;
    const splitter = findLogisticsDevice(registry, source.kind, "splitter");
    const branchCount = splitter.portGroups.filter(portGroup => portGroup.direction === "output")
      .reduce((sum, portGroup) => sum + portGroup.ports.length, 0);
    return matchesSplitShares(group, total, branchCount);
  });
  const sharedTargets = new Set(sharedAdmissions.flatMap(group => group.map(connection => portKey(connection.target))));
  for (const input of inputs) {
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // AI-REMOVED 2026-10-07:
    // Reason: 成品接收设施同样通过容量和背压拒收，不需要按目标流量额外限速。
    // Trigger: 用户明确只有工作消耗输入需要准入口，普通设备不因供料超过需求而限速。
    // Evidence: product 不是 consumption-channel；此条件为所有低于单线满速的成品出口增加准入口。
    // Replacement: 下方按 consumption 输入语义选择准入口。
    // Risk: 取整设备允许实际增产，仍以持续接收与真实产量验收；自循环工作消耗回填约束保留。
    // Human Review: Required
    // Original code:
    // const exportedRate = [...input.amounts.values()].reduce((sum, rate) => sum + rate, 0);
    // if (!input.consumption && (input.node.purpose !== "product" || exportedRate >= transportCapacity(input.port.kind))) continue;
    if (!input.consumption) continue;
    // AI-CORRECTION 2026-10-02: 下方原“每个运行消耗通道无条件放准入口”只在没有精确等分的共享上游限速时适用。
    if (sharedTargets.has(portKey(input.port))) continue;
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
    const limiter = createPlainNode(registry, definition.id, availableNodeId(network, "eda-limiter"), "logistics");
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
  for (const group of sharedAdmissions) {
    const source = group[0]!.source;
    const [itemId] = group[0]!.amounts.keys();
    const rate = group.reduce((sum, connection) => sum + connection.amounts.get(itemId!)!, 0);
    const definition = findLogisticsDevice(registry, source.kind, "admission");
    const limiter = createPlainNode(registry, definition.id, availableNodeId(network, "eda-shared-limiter"), "logistics");
    placement.placeAnywhere(limiter, 0, source.outside);
    network.nodes.push(limiter);
    const inlet = getPlannerPorts(registry, limiter.entity, definition, "input", itemId)[0]!;
    const outlet = getPlannerPorts(registry, limiter.entity, definition, "output", itemId)[0]!;
    limiter.entity.config[`portGroups[${inlet.groupIndex}].ports[${inlet.portIndex}].admissionRule`] = {
      itemId, limit: null, perMinuteLimit: rate,
    };
    for (const connection of group) connection.source = outlet;
    connections.push({ source, target: inlet, amounts: new Map([[itemId!, rate]]) });
  }

  const outputGroups = groupConnections(connections, "source");
  for (const group of outputGroups.values()) {
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const trunk = preferTrunk && group[0]!.source.kind === LOGISTICS_KIND.pipe
      && group.every(connection => inputsByPort.get(portKey(connection.target))?.consumption === false);
    if (group.length > 1) expandSplitTree(registry, network, placement, connections, group, group[0]!.source, trunk);
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
      for (const port of getPlannerPorts(registry, node.entity, node.definition, direction)) {
        if (managedItems && !(direction === "input" ? node.inputs : node.outputs).some(flow => managedItems.has(flow.itemId)
          && getPlannerPorts(registry, node.entity, node.definition, direction, flow.itemId, flow.storageGroupIds)
            .some(candidate => samePort(candidate, port)))) continue;
        restrictPort(registry, node, port, []);
      }
    }
  }
  for (const allocation of [...outputs, ...inputs]) restrictPort(registry, allocation.node, allocation.port, [...allocation.amounts.keys()]);
  for (const group of groupConnections(connections, "source").values()) {
    const node = network.nodes.find(entry => entry.entity.id === group[0]!.source.entityId)!;
    restrictPort(registry, node, group[0]!.source, [...new Set(group.flatMap(connection => [...connection.amounts.keys()]))]);
  }
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
      // AI-REMOVED 2026-10-09:
      // Reason: 在初排坐标上按来源缩窄端口距离池，耦合了最终关系与尚未优化的几何，退化双根案例。
      // Trigger: 五机双根真实回归退化；同摆位失败已定位为辅助端口越界及朝向问题。
      // Evidence: 双根旧端口池 120/min，新池触发额外分组后仅 109/min。
      // Replacement: 保留既有端口候选池，实际物料分配仍严格执行 sourceEntityIds。
      // Risk: 端口池是启发式；最终仍需真实路由和 Dense 验收。Human Review: Required。
      // Original code:
      // const counterparts = nodes.filter(other => other !== node && (direction !== "input" || !flow.sourceEntityIds || flow.sourceEntityIds.includes(other.entity.id)))
      // .flatMap(other => (direction === "input" ? other.outputs : other.inputs)
      // .filter(otherFlow => otherFlow.itemId === flow.itemId && (direction !== "output" || !otherFlow.sourceEntityIds || otherFlow.sourceEntityIds.includes(node.entity.id)))
      // .flatMap(otherFlow => getPlannerPorts(registry, other.entity, other.definition,
      // direction === "input" ? "output" : "input", flow.itemId, otherFlow.storageGroupIds)));
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
        if (allocation !== undefined && JSON.stringify(allocation.sourceEntityIds) !== JSON.stringify(flow.sourceEntityIds)) continue;
        if (allocation === undefined) {
          allocation = { port, node, remaining: transportCapacity(port.kind), amounts: new Map(), consumption: false };
          allocation.sourceEntityIds = flow.sourceEntityIds;
          allocations.set(portKey(port), allocation);
        }
        const amount = Math.min(remaining, allocation.remaining);
        if (amount <= 1e-6) continue;
        allocation.amounts.set(flow.itemId, (allocation.amounts.get(flow.itemId) ?? 0) + amount);
        allocation.remaining -= amount; remaining -= amount;
        allocation.consumption ||= direction === "input" && flow.storageGroupIds !== undefined
          && node.definition.recipeChannels.some((channel) => channel.type === "consumption-channel"
            && channel.ingredientStorageGroupIds.some((id) => flow.storageGroupIds!.includes(id)));
        // 2026-10-05：启动罐的回填量也必须限速，否则回流优先级会先填满 500 容量而饿死净产物分支。
        allocation.consumption ||= direction === "input" && node.purpose === "startup" && node.supplyTarget !== undefined;
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
    const node = createPlainNode(registry, definition.id, availableNodeId(network, "eda-junction"), "logistics");
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

/** 按即将生成的分流树逐层均分，只有每个末端份额都等于需求时才允许入口共用限速。 */
function matchesSplitShares(leaves: readonly Connection[], incomingRate: number, branchCount: number): boolean {
  const rate = (leaf: Connection) => [...leaf.amounts.values()].reduce((sum, amount) => sum + amount, 0);
  if (leaves.length === 1) return Math.abs(rate(leaves[0]!) - incomingRate) < 1e-6;
  if (branchCount < 2) return false;
  const groups = partitionEqualFlows(leaves, rate, branchCount).filter(group => group.length);
  if (groups.length < 2) return false;
  return groups.every(group => matchesSplitShares(group, incomingRate / groups.length, branchCount));
}

function expandSplitTree(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement,
  connections: Connection[], leaves: Connection[], root: PlannerPort, trunk: boolean): void {
  if (leaves.length === 1) {
    const leaf = leaves[0]!;
    leaf.source = root;
    // AI-REMOVED 2026-10-07:
    // Reason: 取消普通异量分支的自动限速；工作消耗准入口已由 wireProductionNetwork 按输入语义构造。
    // Trigger: 用户明确普通生产输入依靠缓冲区背压，要求支持单口暗管主管分流。
    // Evidence: 本任务供水 15/min 与 30/min 被非等量规则强制加准入口；工作消耗已有独立限速和审计。
    // Replacement: wireProductionNetwork 的 consumption 输入限速与 sharedAdmissions。
    // Risk: 普通输入需要真实仿真验证背压稳态；工作消耗限额不放宽。
    // Human Review: Required
    // Original code:
    // if (!meteringRequired) return;
    // const target = network.nodes.find(node => node.entity.id === leaf.target.entityId)!;
    // const existing = target.entity.config[`portGroups[${leaf.target.groupIndex}].ports[${leaf.target.portIndex}].admissionRule`];
    // if (existing && typeof existing === "object" && "perMinuteLimit" in existing && typeof existing.perMinuteLimit === "number") return;
    // if (leaf.amounts.size !== 1) throw new PlannerCandidateError("非等流量混合物料分支不能用单物料准入口限速。");
    // const [itemId, rate] = [...leaf.amounts][0]!;
    // const definition = findLogisticsDevice(registry, root.kind, "admission");
    // const limiter = createPlainNode(registry, definition.id, `eda-branch-limiter-${network.nodes.length}`, "logistics");
    // placement.placeAnywhere(limiter, 0, leaf.target.outside); network.nodes.push(limiter);
    // const inlet = getPlannerPorts(registry, limiter.entity, definition, "input", itemId)[0]!;
    // const outlet = getPlannerPorts(registry, limiter.entity, definition, "output", itemId)[0]!;
    // limiter.entity.config[`portGroups[${inlet.groupIndex}].ports[${inlet.portIndex}].admissionRule`] = { itemId, limit: null, perMinuteLimit: rate };
    // connections.push({ source: outlet, target: leaf.target, amounts: new Map(leaf.amounts) });
    // leaf.target = inlet;
    return;
  }
  const definition = findLogisticsDevice(registry, root.kind, "splitter");
  const node = createPlainNode(registry, definition.id, availableNodeId(network, "eda-split"), "logistics");
  placement.placeAnywhere(node, 0, root.outside); network.nodes.push(node);
  const inlet = getPlannerPorts(registry, node.entity, definition, "input")[0]!;
  const branches = getPlannerPorts(registry, node.entity, definition, "output");
  const rate = (leaf: Connection) => [...leaf.amounts.values()].reduce((sum, amount) => sum + amount, 0);
  // AI-REMOVED 2026-10-07:
  // Reason: 分流树按供料语义选择结构；普通支路不以计划流量不等触发限速。
  // Trigger: 用户明确普通生产输入依靠缓冲区背压，要求支持单口暗管主管分流。
  // Evidence: 本任务供水 15/min 与 30/min 被非等量规则强制加准入口；工作消耗已有独立限速和审计。
  // Replacement: 下方主管或均分树分组。
  // Risk: 主管需要更多分流器，仍与共享树及局部直连竞争面积。
  // Human Review: Required
  // Original code:
  // const groups = partitionEqualFlows(leaves, rate, branches.length);
  // const totals = groups.map(group => group.reduce((sum, leaf) => sum + rate(leaf), 0));
  // const unequal = totals.some(total => Math.abs(total - totals[0]!) > 1e-6);
  const ordered = trunk ? [...leaves].sort((a, b) => distance(root, a.target) - distance(root, b.target)) : leaves;
  const groups = trunk ? [[ordered[0]!], ordered.slice(1)] : partitionEqualFlows(leaves, rate, branches.length);
  const amounts = new Map<string, number>();
  for (const leaf of leaves) for (const [item, amount] of leaf.amounts) amounts.set(item, (amounts.get(item) ?? 0) + amount);
  connections.push({ source: root, target: inlet, amounts });
  for (const [index, branch] of branches.entries()) {
    const group = groups[index];
    restrictPort(registry, node, branch, group?.flatMap(leaf => [...leaf.amounts.keys()]).filter((id, at, all) => all.indexOf(id) === at) ?? []);
    // 所有启用分支使用相同优先级；不以 priorityGroup 伪造比例分流。
    node.entity.config[`portGroups[${branch.groupIndex}].ports[${branch.portIndex}].priorityGroup`] = 1;
    if (group) expandSplitTree(registry, network, placement, connections, group, branch, trunk);
  }
}
