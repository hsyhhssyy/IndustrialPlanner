import { PlannerItemRules } from "@/shared/planner-item-policy";
import type { BlueprintPlannerFlow } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: boundary.ts
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
// import { resolveEntityGridRect } from "@/shared/geometry/power-range";

import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { getPlannerPorts, itemLogisticsKind, transportCapacity } from "./geometry";
import { PlannerCandidateError, sumMaterial, type PlannerNetwork, type PlannerNode } from "./model";
import { createPlainNode, type PlannerPlacement } from "./placement";
import { createRecipeNode } from "./production-network";
import { restrictPort } from "./wiring";
import type { PlannerSearchOptions } from "./search-types";

export function materialBalance(network: PlannerNetwork): Map<string, number> {
  const result = sumMaterial(network.nodes.flatMap((node) => node.outputs));
  for (const flow of [...network.nodes.flatMap((node) => node.inputs), ...network.request.plan.targets]) {
    result.set(flow.itemId, (result.get(flow.itemId) ?? 0) - flow.perMinute);
  }
  return result;
}

function isRoundedRunningConsumptionShortfall(network: PlannerNetwork, itemId: string, shortfall: number): boolean {
  const plan = network.request.plan;
  const plannedProduction = plan.recipes.reduce((total, recipe) => total
    + recipe.outputs.filter(flow => flow.itemId === itemId).reduce((sum, flow) => sum + flow.perMinute, 0)
    - recipe.inputs.filter(flow => flow.itemId === itemId).reduce((sum, flow) => sum + flow.perMinute, 0),
  -plan.targets.filter(flow => flow.itemId === itemId).reduce((sum, flow) => sum + flow.perMinute, 0));
  if (plannedProduction < -1e-6) return false;
  const plannedRunning = plan.recipes.flatMap(recipe => recipe.runningInputs)
    .filter(flow => flow.itemId === itemId).reduce((sum, flow) => sum + flow.perMinute, 0);
  const actualRunning = network.nodes.filter(node => node.purpose === "production").reduce((total, node) => total
    + node.inputs.filter(input => input.itemId === itemId && input.storageGroupIds?.some(groupId =>
      node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
        && channel.ingredientStorageGroupIds.includes(groupId))))
      .reduce((sum, input) => sum + input.perMinute, 0), 0);
  const extraRunning = actualRunning - plannedRunning;
  return extraRunning > 1e-6 && Math.abs(extraRunning - plannedProduction - shortfall) <= 1e-4;
}

export function addTerminals(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, separateOperatingSupply = false, fluidGroupSize = 64, compact = false, stashPackingVariant = 0, conduitTopology: PlannerSearchOptions["conduitTopology"] = "local"): void {
  if (!Number.isSafeInteger(stashPackingVariant) || stashPackingVariant < 0) throw new Error("储存箱分组序号必须为非负整数。");
  const itemRules = new PlannerItemRules(registry, network.request.options);
  const available = new Set([...network.request.plan.infiniteItemIds, ...network.request.plan.externalSupplies.map((entry) => entry.itemId)]);
  const balance = materialBalance(network);
  const sources: BlueprintPlannerFlow[] = [];
  const outputs = sumMaterial(network.request.plan.targets);
  for (const [itemId, rate] of balance) {
    if (rate < -1e-6) {
      if (!available.has(itemId)) {
        const advice = isRoundedRunningConsumptionShortfall(network, itemId, -rate)
          ? "。设备按整台放置后，运行消耗高于原规划；请在产线规划将「设备最低消耗」设为「取整计算」，重新生成并启动 EDA 任务。" : "";
        throw new PlannerCandidateError(`原规划缺少物料来源：${itemId}，${(-rate).toFixed(2)}/min${advice}`);
      }
      sources.push({ itemId, perMinute: -rate });
    } else if (rate > 1e-6) outputs.set(itemId, (outputs.get(itemId) ?? 0) + rate);
  }
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: boundary.ts::PlannerBoundary
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   const dockNodes: PlannerNode[] = network.nodes.filter((node) => node.purpose === "startup" && node.definition.id === "unloader_1");

// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: boundary.ts::PlannerBoundary
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   const externalSources: PlannerNode[] = [];

  for (const flow of sources) {
    const kind = itemLogisticsKind(registry, flow.itemId);
    const mode = itemRules.supply(flow.itemId);
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
    // 共享暗管按运力分设施，不再因消费者数量多而截断主管；排液设施仍沿用 fluidGroupSize。
    const supplyGroupSize = conduitTopology === "local" ? fluidGroupSize : Math.max(1, demands.length);
    const groups = pools.length ? pools.filter(pool => pool.length).map(pool => ({
      rate: pool.reduce((sum, demand) => sum + demand.input.perMinute, 0),
      targets: pool.map(demand => ({ entityId: demand.node.entity.id, storageGroupIds: demand.input.storageGroupIds })),
    })).flatMap(group => group.targets.length <= supplyGroupSize ? [group] : clusterTerminalDemands(
      demands.filter(demand => group.targets.some(target => target.entityId === demand.node.entity.id && target.storageGroupIds === demand.input.storageGroupIds))
        .map(demand => ({ node: demand.node, perMinute: demand.input.perMinute, storageGroupIds: demand.input.storageGroupIds })), supplyGroupSize))
      : [{ rate: flow.perMinute, targets: undefined }];
    for (const group of groups) for (let remaining = group.rate; remaining > 1e-6; remaining -= facilityCapacity) {
      deliveries.push({ perMinute: Math.min(facilityCapacity, remaining), targets: group.targets });
    }
    for (const delivery of deliveries) {
      const rate = delivery.perMinute;
      const definitionId = mode === "external" ? registry.queries.resolveLogisticsDefinitionId(kind, "straight")
        : mode === "warehouse" ? "unloader_1" : rate > transportCapacity(kind) || (compact && conduitTopology === "local" && (delivery.targets?.length ?? 0) > 1)
          ? "udpipe_unloader_2" : "udpipe_unloader_1";
      const base = { ...createPlainNode(registry, definitionId, `eda-source-${network.nodes.length}`, "supply"), supplyTargets: delivery.targets };
      const node: PlannerNode = mode === "external" ? { ...base, external: true } : delivery.consumer === undefined ? base
        : { ...base, supplyTarget: { entityId: delivery.consumer.entity.id, storageGroupIds: delivery.storageGroupIds } };
      node.outputs.push({ itemId: flow.itemId, perMinute: rate });
      network.nodes.push(node);
      if (mode === "warehouse") {
        const group = node.definition.storageSlotGroups[0]!;
        const slot = group.slots[0]!;
        configureSource(node, flow.itemId, true);
        const link = registry.queries.buildWarehouseSlotLinkForEntity({ entityId: node.entity.id, storageSlotGroupId: group.id, slotId: slot.id, itemId: flow.itemId });
        network.slotLinks.push({ ...link, id: `eda-warehouse-${network.slotLinks.length}` });
        network.initialSlots.push({ entityId: node.entity.id, storageGroupId: group.id, slotId: slot.id, itemType: flow.itemId, count: slot.capacity, ignoreStock: true });
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: boundary.ts::PlannerBoundary
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//         dockNodes.push(node);

      } else if (mode !== "external") {
        // AI-REMOVED 2026-10-03:
        // Reason: 暗管外供必须通过仓库物品链接无限取货，不能预填本地无限库存。
        // Trigger: 用户要求生成蓝图对应“仓库物品链接 → 无限”的设置方式。
        // Evidence: configureSource 仅写本地槽位；Registry 和 Inspector 使用 share-all 仓库链接及 ignoreStock。
        // Replacement: 下方 buildWarehouseSlotLinkForEntity 与槽位 ignoreStock。
        // Risk: Low；既有任务结果不自动重写。Human Review: Required
        // Original code:
        // configureSource(node, flow.itemId, true);
        const group = node.definition.storageSlotGroups[0]!;
        const slot = group.slots[0]!;
        const link = registry.queries.buildWarehouseSlotLinkForEntity({ entityId: node.entity.id,
          storageSlotGroupId: group.id, slotId: slot.id, itemId: flow.itemId });
        network.slotLinks.push({ ...link, id: `eda-warehouse-${network.slotLinks.length}` });
        node.entity.config["storageSlotGroups[0].slots[0].ignoreStock"] = true;
        const peers = delivery.targets?.map(target => network.nodes.find(peer => peer.entity.id === target.entityId)!) ?? [];
        placement.placeAnywhere(node, 0, delivery.consumer?.entity.position ?? terminalGroupCenter(peers));
      }
    }
  }
  let stashPackingChoice = stashPackingVariant;
  for (const [itemId, rate] of outputs) {
    if (rate <= 1e-6) continue;
    const target = network.request.plan.targets.some((flow) => flow.itemId === itemId);
    const kind = itemLogisticsKind(registry, itemId);
    const destroy = !target && itemRules.byproducts(itemId) === "destroy"
      ? registry.recipeDefinitions.find((recipe) => {
        const device = registry.queries.findEntityDefinition(recipe.machineId);
        // 配方存在不代表能够施工；计算器中的虚拟倾倒动作没有实际设备通道，必须回退到输出。
        return recipe.outputs.length === 0 && recipe.inputs.length === 1
          && recipe.inputs[0]!.itemId === itemId && recipe.gasDiffusionOutput === undefined && recipe.powerOutput === undefined
          && !recipe.tags.includes(CONSUMPTION_RECIPE_TAG) && !recipe.machineId.startsWith("cheat_")
          && device !== null && !device.tags.includes("不可摆放")
          && device.recipeChannels.some(channel => channel.type !== "consumption-channel")
          && !device.placementBehaviors.some(behavior => behavior.type === "snap-to-outer-ring-edge")
          && isRecipeAvailableByActivity(recipe, network.request.plan.activeActivityIds);
      }) : undefined;
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
      : itemRules.output(itemId) === "warehouse" ? "loader_1" : "storager_1";
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
    if (definitionId === "storager_1") {
      const template = createPlainNode(registry, definitionId, "eda-output-capacity", "product");
      const lanes = getPlannerPorts(registry, template.entity, template.definition, "input", itemId).length;
      if (!lanes) throw new PlannerCandidateError(`储存箱没有可接收物品的端口：${itemId}`);
      const requiredLanes = Math.max(1, Math.ceil(rate / outputCapacity - 1e-6));
      const minimum = Math.ceil(requiredLanes / lanes);
      const alternatives = requiredLanes - minimum + 1;
      const count = minimum + stashPackingChoice % alternatives;
      stashPackingChoice = Math.floor(stashPackingChoice / alternatives);
      let remaining = rate;
      for (let index = 0; index < count; index++) {
        const portCount = Math.max(1, Math.ceil(Math.ceil(remaining / outputCapacity - 1e-6) / (count - index)));
        const perMinute = Math.min(remaining, portCount * outputCapacity);
        deliveries.push({ perMinute });
        remaining -= perMinute;
      }
    } else {
      for (const group of outputGroups) for (let remaining = group.rate; remaining > 1e-6; remaining -= outputCapacity) {
        deliveries.push({ perMinute: Math.min(outputCapacity, remaining), targets: group.targets });
      }
    }
    for (const delivery of deliveries) {
      const base = { ...createPlainNode(registry, definitionId === "udpipe_loader_1" && delivery.perMinute > transportCapacity(kind) ? "udpipe_loader_2" : definitionId, `eda-output-${network.nodes.length}`, target ? "product" : "byproduct"), outputSources: delivery.targets };
      const node: PlannerNode = delivery.producer === undefined ? base : { ...base,
        outputSource: { entityId: delivery.producer.entity.id, storageGroupIds: delivery.storageGroupIds } };
      node.inputs.push({ itemId, perMinute: delivery.perMinute });
      if (definitionId === "storager_1") {
        // 2026-09-30：一箱一种物品，多条线按独立端口接入；未接线端口也不能混入其他物品。
        node.definition.storageSlotGroups.forEach((group, groupIndex) => group.slots.forEach((_, slotIndex) => {
          node.entity.config[`storageSlotGroups[${groupIndex}].slots[${slotIndex}].lock`] = itemId;
        }));
        const drains = getPlannerStashDrainPorts(registry, node);
        for (const direction of ["input", "output"] as const) for (const port of getPlannerPorts(registry, node.entity, node.definition, direction)) {
          restrictPort(registry, node, port, direction === "input" || drains.some(drain => drain.groupIndex === port.groupIndex && drain.portIndex === port.portIndex) ? [itemId] : []);
        }
      }
      network.nodes.push(node);
      if (definitionId !== "loader_1") placement.placeAnywhere(node, 0, delivery.producer?.entity.position
        ?? terminalGroupCenter(delivery.targets?.map(target => network.nodes.find(peer => peer.entity.id === target.entityId)!) ?? []));
    }
  }
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: candidate.ts::PlannerBoundary.arrange
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//   addWarehouseBus(registry, network, dockNodes);
//   // 所有外接输入位于同一最右边界，外侧一格仅供验证夹具使用。
//   const bounds = placement.bounds();
//   const boundaryX = Math.max(...network.nodes.filter((node) => !node.external).map((node) => { const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition }); return rect.x + rect.width; }), bounds.x + bounds.width, placement.minimumX + placement.rowWidth +
//     Math.max(...network.nodes.map((node) => Math.max(node.definition.footprint.width, node.definition.footprint.height)), 1)) + 8;
//   if (externalSources.length) placement.maximumX = boundaryX + 1;
//   for (let index = 0; index < externalSources.length; index++) {
//     const node = externalSources[index]!;
//     placement.place(node, { x: boundaryX, y: placement.minimumY + index * 3 }, 180);
//   }

}

/** 验收排空与布局预留共用，按接收速率开启足量独立出口，不能靠箱内库存掩盖瓶颈。 */
export function getPlannerStashDrainPorts(registry: RegistryContract, node: PlannerNode) {
  if (node.definition.id !== "storager_1" || (node.purpose !== "product" && node.purpose !== "byproduct")) return [];
  const items = new Set(node.inputs.map(flow => flow.itemId));
  if (items.size !== 1) throw new PlannerCandidateError("协议储存箱只能接收同一种物品。");
  const ports = getPlannerPorts(registry, node.entity, node.definition, "output", node.inputs[0]!.itemId);
  const count = Math.max(1, Math.ceil(node.inputs.reduce((sum, flow) => sum + flow.perMinute, 0) / transportCapacity("belt") - 1e-6));
  if (count > ports.length) throw new PlannerCandidateError("储存箱持续排空运力不足。");
  return ports.slice(0, count);
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

// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: boundary.ts::PlannerBoundary
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
// function addWarehouseBus(registry: RegistryContract, network: PlannerNetwork, docks: readonly PlannerNode[]): void {
//   if (!docks.length) return;
//   const source = createPlainNode(registry, "log_hongs_bus_source", "eda-bus-source", "bus");
//   const segment = registry.queries.findEntityDefinition("log_hongs_bus")!;
//   const width = source.definition.footprint.width;
//   source.entity.position = { x: 0, y: 0 };
//   network.nodes.push(source);
//   if (network.request.options.warehouseBus === "free") {
//     const sides = [docks.filter((_, index) => index % 2 === 0), docks.filter((_, index) => index % 2 === 1)];
//     sides.forEach((side, sideIndex) => {
//       let offset = width * 2;
//       for (const dock of side) {
//         dock.entity.position = sideIndex === 0 ? { x: width, y: offset } : { x: offset, y: source.definition.footprint.height };
//         const supplies = dock.purpose === "supply" || dock.purpose === "startup";
//         dock.entity.rotation = sideIndex === 0 ? (supplies ? 270 : 90) : (supplies ? 0 : 180);
//         offset += dock.definition.footprint.width + 1;
//       }
//       for (let start = width; side.length > 0 && start < offset; start += segment.footprint.height) {
//         const node = createPlainNode(registry, segment.id, `eda-bus-${sideIndex}-${start}`, "bus");
//         node.entity.position = sideIndex === 0 ? { x: 0, y: start } : { x: start, y: 0 };
//         node.entity.rotation = sideIndex === 0 ? 0 : 90;
//         network.nodes.push(node);
//       }
//     });
//     return;
//   }
//   let y = 0;
//   for (const dock of docks) {
//     dock.entity.position = { x: width, y };
//     dock.entity.rotation = dock.purpose === "supply" || dock.purpose === "startup" ? 270 : 90;
//     y += dock.definition.footprint.width;
//   }
//   for (let offset = source.definition.footprint.height; offset < y; offset += segment.footprint.height) {
//     const node = createPlainNode(registry, segment.id, `eda-bus-${offset}`, "bus");
//     node.entity.position = { x: 0, y: offset };
//     network.nodes.push(node);
//   }
// }
