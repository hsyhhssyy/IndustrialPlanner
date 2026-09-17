import type { BlueprintPlannerFlow } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { itemLogisticsKind, transportCapacity } from "./geometry";
import { PlannerCandidateError, sumMaterial, type PlannerNetwork, type PlannerNode } from "./model";
import { createPlainNode, type PlannerPlacement } from "./placement";
import { createRecipeNode } from "./production-network";

export function materialBalance(network: PlannerNetwork): Map<string, number> {
  const result = sumMaterial(network.nodes.flatMap((node) => node.outputs));
  for (const flow of [...network.nodes.flatMap((node) => node.inputs), ...network.request.plan.targets]) {
    result.set(flow.itemId, (result.get(flow.itemId) ?? 0) - flow.perMinute);
  }
  return result;
}

export function addTerminals(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, separateOperatingSupply = false, fluidGroupSize = 64): void {
  const available = new Set([...network.request.plan.infiniteItemIds, ...network.request.plan.externalSupplies.map((entry) => entry.itemId)]);
  const balance = materialBalance(network);
  const sources: BlueprintPlannerFlow[] = [];
  const outputs = sumMaterial(network.request.plan.targets);
  for (const [itemId, rate] of balance) {
    if (rate < -1e-6) {
      if (!available.has(itemId)) throw new PlannerCandidateError(`原规划缺少物料来源：${itemId}，${(-rate).toFixed(2)}/min`);
      sources.push({ itemId, perMinute: -rate });
    } else if (rate > 1e-6) outputs.set(itemId, (outputs.get(itemId) ?? 0) + rate);
  }
  const dockNodes: PlannerNode[] = network.nodes.filter((node) => node.purpose === "startup" && node.definition.id === "unloader_1");
  const externalSources: PlannerNode[] = [];
  for (const flow of sources) {
    const kind = itemLogisticsKind(registry, flow.itemId);
    const mode = kind === LOGISTICS_KIND.belt ? network.request.options.solidSupply : network.request.options.fluidSupply;
    const deliveries: Array<{ perMinute: number; consumer?: PlannerNode; storageGroupIds?: readonly string[]; targets?: PlannerNode["supplyTargets"] }> = [];
// AI-REMOVED 2026-09-16:
// Reason: 按容量合并外供，禁止默认逐设备复制无限源。
// Trigger: 用户要求供料硬约束、紧凑布局和无人值守调参。
// Evidence: 供料约束与施工评分.md；旧实现逐设备创建无限源。
// Replacement: 下方按端口额定容量分配单口/多口暗管
// Risk: 需真实 Dense 验证新供料拓扑。
// Human Review: Required
// Original code:
//     // 内取暗管没有外部单线汇入约束；为独立用料口提供本地源，避免人为制造分配瓶颈。
//     const localConduits = mode === "conduit" && !network.nodes.some(node => node.recipe !== null && node.outputs.some(output => output.itemId === flow.itemId));
//     if (localConduits) {
//       for (const consumer of network.nodes.filter(node => node.recipe !== null)) for (const input of consumer.inputs.filter(input => input.itemId === flow.itemId)) {
//         for (let remaining = input.perMinute; remaining > 1e-6; remaining -= transportCapacity(kind)) {
//           deliveries.push({ perMinute: Math.min(transportCapacity(kind), remaining), consumer, storageGroupIds: input.storageGroupIds });
//         }
//       }
//     } else {
//       for (let remaining = flow.perMinute; remaining > 1e-6; remaining -= transportCapacity(kind)) deliveries.push({ perMinute: Math.min(transportCapacity(kind), remaining) });
//     }
    const facilityCapacity = mode === "conduit" ? transportCapacity(kind) * 2 : transportCapacity(kind);
    const demands = mode === "conduit"
      && !network.nodes.some(node => node.recipe !== null && node.outputs.some(output => output.itemId === flow.itemId))
      ? network.nodes.flatMap(node => node.inputs.filter(input => input.itemId === flow.itemId).map(input => ({ node, input,
        operating: input.storageGroupIds !== undefined && node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
          && channel.ingredientStorageGroupIds.some(id => input.storageGroupIds!.includes(id))) }))) : [];
    const pools = demands.length ? (separateOperatingSupply ? [false, true].map(operating => demands.filter(demand => demand.operating === operating)) : [demands]) : [];
    const groups = pools.length ? pools.filter(pool => pool.length).map(pool => ({
      rate: pool.reduce((sum, demand) => sum + demand.input.perMinute, 0),
      targets: pool.map(demand => ({ entityId: demand.node.entity.id, storageGroupIds: demand.input.storageGroupIds })),
    })).flatMap(group => group.targets.length <= fluidGroupSize ? [group] : clusterTerminalDemands(
      demands.filter(demand => group.targets.some(target => target.entityId === demand.node.entity.id && target.storageGroupIds === demand.input.storageGroupIds))
        .map(demand => ({ node: demand.node, perMinute: demand.input.perMinute, storageGroupIds: demand.input.storageGroupIds })), fluidGroupSize))
      : [{ rate: flow.perMinute, targets: undefined }];
    for (const group of groups) for (let remaining = group.rate; remaining > 1e-6; remaining -= facilityCapacity) {
      deliveries.push({ perMinute: Math.min(facilityCapacity, remaining), targets: group.targets });
    }
    for (const delivery of deliveries) {
      const rate = delivery.perMinute;
      const definitionId = mode === "external" ? registry.queries.resolveLogisticsDefinitionId(kind, "straight")
        : mode === "warehouse" ? "unloader_1" : rate > transportCapacity(kind) ? "udpipe_unloader_2" : "udpipe_unloader_1";
      const base = { ...createPlainNode(registry, definitionId, `eda-source-${network.nodes.length}`, "supply"), supplyTargets: delivery.targets };
      const node: PlannerNode = mode === "external" ? { ...base, external: true } : delivery.consumer === undefined ? base
        : { ...base, supplyTarget: { entityId: delivery.consumer.entity.id, storageGroupIds: delivery.storageGroupIds } };
      node.outputs.push({ itemId: flow.itemId, perMinute: rate });
      network.nodes.push(node);
      if (mode === "external") externalSources.push(node);
      else if (mode === "warehouse") {
        const group = node.definition.storageSlotGroups[0]!;
        const slot = group.slots[0]!;
        configureSource(node, flow.itemId, false);
        const link = registry.queries.buildWarehouseSlotLinkForEntity({ entityId: node.entity.id, storageSlotGroupId: group.id, slotId: slot.id, itemId: flow.itemId });
        network.slotLinks.push({ ...link, id: `eda-warehouse-${network.slotLinks.length}` });
        network.initialSlots.push({ entityId: node.entity.id, storageGroupId: group.id, slotId: slot.id, itemType: flow.itemId, count: slot.capacity, ignoreStock: true });
        dockNodes.push(node);
      } else {
        configureSource(node, flow.itemId, true);
        const peers = delivery.targets?.map(target => network.nodes.find(peer => peer.entity.id === target.entityId)!) ?? [];
        placement.placeAnywhere(node, 0, delivery.consumer?.entity.position ?? terminalGroupCenter(peers));
      }
    }
  }
  for (const [itemId, rate] of outputs) {
    if (rate <= 1e-6) continue;
    const target = network.request.plan.targets.some((flow) => flow.itemId === itemId);
    const kind = itemLogisticsKind(registry, itemId);
    const destroy = !target && network.request.options.byproducts === "destroy"
      ? registry.recipeDefinitions.find((recipe) => recipe.outputs.length === 0 && recipe.inputs.length === 1
        && recipe.inputs[0]!.itemId === itemId && recipe.gasDiffusionOutput === undefined && recipe.powerOutput === undefined
        && !recipe.tags.includes(CONSUMPTION_RECIPE_TAG) && !recipe.machineId.startsWith("cheat_")
        && isRecipeAvailableByActivity(recipe, network.request.plan.activeActivityIds)) : undefined;
    if (destroy !== undefined) {
      const cycles = rate / destroy.inputs[0]!.amount;
      const count = Math.ceil(cycles * destroy.durationSeconds / 60 - 1e-6);
      for (let index = 0; index < count; index++) {
        const node = createRecipeNode(registry, destroy, `eda-destroy-${network.nodes.length}`, cycles / count, "byproduct");
        network.nodes.push(node); placement.placeAnywhere(node);
      }
      continue;
    }
    const definitionId = kind === LOGISTICS_KIND.pipe ? "udpipe_loader_1"
      : network.request.options.solidOutput === "warehouse" ? "loader_1" : "storager_1";
    const deliveries: Array<{ perMinute: number; producer?: PlannerNode; storageGroupIds?: readonly string[]; targets?: PlannerNode["outputSources"] }> = [];
// AI-REMOVED 2026-09-16:
// Reason: 合并流体产物，避免每台设备单独配置暗管入口。
// Trigger: 用户要求供料硬约束、紧凑布局和无人值守调参。
// Evidence: 供料约束与施工评分.md；旧实现逐设备创建无限源。
// Replacement: 下方按容量统一输出
// Risk: 需真实 Dense 验证新供料拓扑。
// Human Review: Required
// Original code:
//     const localConduits = kind === LOGISTICS_KIND.pipe && !network.nodes.some(node => node.recipe !== null && node.inputs.some(input => input.itemId === itemId));
//     if (localConduits) {
//       for (const producer of network.nodes.filter(node => node.recipe !== null)) for (const output of producer.outputs.filter(output => output.itemId === itemId)) {
//         for (let remaining = output.perMinute; remaining > 1e-6; remaining -= transportCapacity(kind)) {
//           deliveries.push({ perMinute: Math.min(transportCapacity(kind), remaining), producer, storageGroupIds: output.storageGroupIds });
//         }
//       }
//     } else for (let remaining = rate; remaining > 1e-6; remaining -= transportCapacity(kind)) deliveries.push({ perMinute: Math.min(transportCapacity(kind), remaining) });
    const outputCapacity = kind === LOGISTICS_KIND.pipe ? transportCapacity(kind) * 2 : transportCapacity(kind);
    const outputGroups = kind === LOGISTICS_KIND.pipe && !network.nodes.some(node => node.inputs.some(input => input.itemId === itemId))
      ? clusterTerminalDemands(network.nodes.flatMap(node => node.outputs.filter(output => output.itemId === itemId)
        .map(output => ({ node, perMinute: output.perMinute, storageGroupIds: output.storageGroupIds }))), fluidGroupSize)
      : [{ rate, targets: undefined }];
    for (const group of outputGroups) for (let remaining = group.rate; remaining > 1e-6; remaining -= outputCapacity) {
      deliveries.push({ perMinute: Math.min(outputCapacity, remaining), targets: group.targets });
    }
    for (const delivery of deliveries) {
      const base = { ...createPlainNode(registry, definitionId === "udpipe_loader_1" && delivery.perMinute > transportCapacity(kind) ? "udpipe_loader_2" : definitionId, `eda-output-${network.nodes.length}`, target ? "product" : "byproduct"), outputSources: delivery.targets };
      const node: PlannerNode = delivery.producer === undefined ? base : { ...base,
        outputSource: { entityId: delivery.producer.entity.id, storageGroupIds: delivery.storageGroupIds } };
      node.inputs.push({ itemId, perMinute: delivery.perMinute });
      network.nodes.push(node);
      if (definitionId === "loader_1") dockNodes.push(node);
      else placement.placeAnywhere(node, 0, delivery.producer?.entity.position
        ?? terminalGroupCenter(delivery.targets?.map(target => network.nodes.find(peer => peer.entity.id === target.entityId)!) ?? []));
    }
  }
  addWarehouseBus(registry, network, dockNodes);
  // 所有外接输入位于同一最右边界，外侧一格仅供验证夹具使用。
  const bounds = placement.bounds();
  const boundaryX = Math.max(...network.nodes.filter((node) => !node.external).map((node) => { const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition }); return rect.x + rect.width; }), bounds.x + bounds.width, placement.minimumX + placement.rowWidth +
    Math.max(...network.nodes.map((node) => Math.max(node.definition.footprint.width, node.definition.footprint.height)), 1)) + 8;
  if (externalSources.length) placement.maximumX = boundaryX + 1;
  for (let index = 0; index < externalSources.length; index++) {
    const node = externalSources[index]!;
    placement.place(node, { x: boundaryX, y: placement.minimumY + index * 3 }, 180);
  }
}

/** 按初始几何邻近性分组，使一个供排设施服务一个局部区域，避免所有支路集中到同一狭窄入口。 */
function clusterTerminalDemands(demands: readonly { node: PlannerNode; perMinute: number; storageGroupIds?: readonly string[] }[], maximum: number) {
  const remaining = [...demands].sort((a, b) => a.node.entity.position.y - b.node.entity.position.y || a.node.entity.position.x - b.node.entity.position.x);
  const groups: Array<{ rate: number; targets: Array<{ entityId: string; storageGroupIds?: readonly string[] }> }> = [];
  while (remaining.length) {
    const seed = remaining.shift()!, group = [seed];
    while (group.length < maximum && remaining.length) {
      const center = terminalGroupCenter(group.map(entry => entry.node))!;
      remaining.sort((a, b) => Math.abs(a.node.entity.position.x - center.x) + Math.abs(a.node.entity.position.y - center.y)
        - Math.abs(b.node.entity.position.x - center.x) - Math.abs(b.node.entity.position.y - center.y));
      group.push(remaining.shift()!);
    }
    groups.push({ rate: group.reduce((sum, entry) => sum + entry.perMinute, 0),
      targets: group.map(entry => ({ entityId: entry.node.entity.id, storageGroupIds: entry.storageGroupIds })) });
  }
  return groups;
}

function terminalGroupCenter(nodes: readonly PlannerNode[]) {
  return nodes.length ? { x: Math.round(nodes.reduce((sum, node) => sum + node.entity.position.x, 0) / nodes.length),
    y: Math.round(nodes.reduce((sum, node) => sum + node.entity.position.y, 0) / nodes.length) } : undefined;
}

export function configureSource(node: PlannerNode, itemId: string, infinite: boolean): void {
  const groupIndex = node.definition.storageSlotGroups.findIndex((group) =>
    node.definition.portStorageBindings.some((binding) => binding.storageSlotGroupId === group.id
      && node.definition.portGroups.some((portGroup) => portGroup.id === binding.portGroupId && portGroup.direction === "output")));
  if (groupIndex < 0) throw new PlannerCandidateError(`供给设备缺少输出库存：${node.definition.id}`);
  const slot = node.definition.storageSlotGroups[groupIndex]!.slots[0]!;
  const prefix = `storageSlotGroups[${groupIndex}].slots[0]`;
  node.entity.config[`${prefix}.lock`] = itemId;
  node.entity.config[`${prefix}.initialItemType`] = itemId;
  node.entity.config[`${prefix}.initialCount`] = infinite ? slot.capacity : 0;
  node.entity.config[`${prefix}.ignoreStock`] = infinite;
}

function addWarehouseBus(registry: RegistryContract, network: PlannerNetwork, docks: readonly PlannerNode[]): void {
  if (!docks.length) return;
  const source = createPlainNode(registry, "log_hongs_bus_source", "eda-bus-source", "bus");
  const segment = registry.queries.findEntityDefinition("log_hongs_bus")!;
  const width = source.definition.footprint.width;
  source.entity.position = { x: 0, y: 0 };
  network.nodes.push(source);
  if (network.request.options.warehouseBus === "free") {
    const sides = [docks.filter((_, index) => index % 2 === 0), docks.filter((_, index) => index % 2 === 1)];
    sides.forEach((side, sideIndex) => {
      let offset = width * 2;
      for (const dock of side) {
        dock.entity.position = sideIndex === 0 ? { x: width, y: offset } : { x: offset, y: source.definition.footprint.height };
        const supplies = dock.purpose === "supply" || dock.purpose === "startup";
        dock.entity.rotation = sideIndex === 0 ? (supplies ? 270 : 90) : (supplies ? 0 : 180);
        offset += dock.definition.footprint.width + 1;
      }
      for (let start = width; side.length > 0 && start < offset; start += segment.footprint.height) {
        const node = createPlainNode(registry, segment.id, `eda-bus-${sideIndex}-${start}`, "bus");
        node.entity.position = sideIndex === 0 ? { x: 0, y: start } : { x: start, y: 0 };
        node.entity.rotation = sideIndex === 0 ? 0 : 90;
        network.nodes.push(node);
      }
    });
    return;
  }
  let y = 0;
  for (const dock of docks) {
    dock.entity.position = { x: width, y };
    dock.entity.rotation = dock.purpose === "supply" || dock.purpose === "startup" ? 270 : 90;
    y += dock.definition.footprint.width;
  }
  for (let offset = source.definition.footprint.height; offset < y; offset += segment.footprint.height) {
    const node = createPlainNode(registry, segment.id, `eda-bus-${offset}`, "bus");
    node.entity.position = { x: 0, y: offset };
    network.nodes.push(node);
  }
}
