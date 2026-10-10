import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { SimulationBlueprintScene } from "@/domain/simulation";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { resolveEntityGridRect, resolvePowerRangeGridRect, areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { buildLayoutGraph } from "./layout-graph";
import { filterPort, findLogisticsDevice, getPlannerPorts } from "./geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { createPlainNode, type PlannerPlacement } from "./placement";
import { configureSource } from "./terminals";
import { converterStartupRoots, planConverterSupply, type ConverterSupply } from "./converter-supply";

export interface PlantStartup {
  readonly picker: PlannerNode;
  readonly source: PlannerNode;
  readonly admission: PlannerNode;
  readonly itemId: string;
}

/** 沿凝聚图传播上游到达时间；循环内部计入真实路程，不把无关并行线路串联累加。 */
export function converterStartupTimes(network: PlannerNetwork, wires: readonly PlannerWire[], travelSeconds: readonly number[], transitionDelay = 10): Map<string, number> {
  const graph = buildLayoutGraph(network.nodes.map(node => node.entity.id), wires.map(wire => ({ from: wire.source.entityId, to: wire.target.entityId })));
  const arrival = graph.groups.map(() => 0);
  for (const { group, index } of graph.groups.map((group, index) => ({ group, index })).sort((a, b) => a.group.rank - b.group.rank)) {
    const processing = network.nodes.filter(node => group.nodeIds.includes(node.entity.id)).reduce((sum, node) => sum + (node.recipe?.durationSeconds ?? 0), 0);
    const cycleTravel = wires.reduce((sum, wire, wireIndex) => sum + (graph.groupIndexByNodeId.get(wire.source.entityId) === index
      && graph.groupIndexByNodeId.get(wire.target.entityId) === index ? travelSeconds[wireIndex]! : 0), 0);
    arrival[index] = arrival[index]! + processing + cycleTravel;
    wires.forEach((wire, wireIndex) => {
      if (graph.groupIndexByNodeId.get(wire.source.entityId) !== index) return;
      const target = graph.groupIndexByNodeId.get(wire.target.entityId)!;
      if (target !== index) arrival[target] = Math.max(arrival[target]!, arrival[index]! + travelSeconds[wireIndex]! + transitionDelay);
    });
  }
  return new Map(network.nodes.map(node => [node.entity.id, arrival[graph.groupIndexByNodeId.get(node.entity.id)!]!]));
}

/** 启动库存有限；持续运行仍由产物回流并经过原有工作消耗限速。 */
export function prepareConverterStartups(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement,
  supplies: readonly ConverterSupply[] = planConverterSupply(registry, network)): void {
  const mode = network.request.options.converterStartup ?? "reject";
  const rules = new PlannerSupplyRules(registry, network.request.plan, mode);
  for (const producer of [...network.nodes]) {
    const self = producer.recipe ? rules.selfConsumption(producer.recipe) : null;
    if (!self) continue;
    if (mode === "reject" || self.netCapacityPerMinute <= 1e-6) throw new PlannerCandidateError(`转化设备自循环无法启动：${producer.entity.id}`);
    const input = producer.inputs.find(flow => flow.itemId === self.itemId && flow.storageGroupIds?.some(id =>
      producer.definition.recipeChannels.some(channel => channel.type === "consumption-channel" && channel.ingredientStorageGroupIds.includes(id))));
    const group = producer.definition.storageSlotGroups.find(entry => input?.storageGroupIds?.includes(entry.id));
    const slot = group?.slots[0];
    if (!input || !group || !slot) throw new PlannerCandidateError("转化设备缺少可初始化的运行耗材槽。");
    const supply = supplies.find(entry => entry.entityId === producer.entity.id && entry.itemId === self.itemId);
    if (!supply) throw new PlannerCandidateError("转化设备缺少耗材供给关系。");
    producer.inputs.splice(producer.inputs.indexOf(input), 1, { ...input, sourceEntityIds: [supply.sourceId] });
    if (supply.sourceId !== producer.entity.id) continue;
    if (mode === "manual") {
      // AI-REMOVED 2026-10-05:
      // Reason: 第 0 秒补入的 5 个耗材可能在上游原料抵达前耗尽。
      // Trigger: 用户要求一次性手动启动，真实 Dense 液体/气体测试发现提前耗尽。
      // Evidence: 原料延迟到达后目标与启动产出探针均为零。
      // Replacement: scheduleConverterStartups 使用最终路由到达时间安排一次补料。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // network.initialSlots.push({ entityId: producer.entity.id, storageGroupId: group.id, slotId: slot.id,
      //   itemType: self.itemId, count: slot.capacity, ignoreStock: false });
      continue;
    }
    const domain = registry.queries.resolveItemDomain(self.itemId);
    if (domain !== ItemDomainFlag.Liquid && domain !== ItemDomainFlag.Gas) throw new PlannerCandidateError("转化设备启动耗材必须是液体或气体。");
    let sequence = network.nodes.length;
    while (network.nodes.some(node => node.entity.id === `eda-converter-startup-${sequence}`)) sequence++;
    const tank = createPlainNode(registry, domain === ItemDomainFlag.Gas ? "gas_storager_1" : "liquid_storager_1",
      `eda-converter-startup-${sequence}`, "startup");
    const storage = tank.definition.storageSlotGroups[0]!;
    tank.inputs.push({ itemId: self.itemId, perMinute: input.perMinute, storageGroupIds: [storage.id], sourceEntityIds: [producer.entity.id] });
    tank.outputs.push({ itemId: self.itemId, perMinute: input.perMinute, storageGroupIds: [storage.id] });
    const selectedInput = producer.inputs.findIndex(flow => flow.itemId === input.itemId && flow.storageGroupIds === input.storageGroupIds);
    producer.inputs[selectedInput] = { ...producer.inputs[selectedInput]!, sourceEntityIds: [tank.entity.id] };
    // 罐体只供给该设备的耗材口，由该设备的真实产出补回，不充当额外的稳态来源。
    Object.assign(tank, { supplyTarget: { entityId: producer.entity.id, storageGroupIds: input.storageGroupIds },
      outputSource: { entityId: producer.entity.id, storageGroupIds: producer.outputs.find(flow => flow.itemId === self.itemId)!.storageGroupIds } });
    tank.entity.config["storageSlotGroups[0].slots[0].initialItemType"] = self.itemId;
    tank.entity.config["storageSlotGroups[0].slots[0].lock"] = self.itemId;
    tank.entity.config["storageSlotGroups[0].slots[0].ignoreStock"] = false;
    placement.placeAnywhere(tank, 0, producer.entity.position);
    network.nodes.push(tank);
  }
}

/** 手动启动仅进入独立验证场景；原料到达后补满一次耗材槽。 */
export function scheduleConverterStartups(
  registry: RegistryContract, network: PlannerNetwork, startupSeconds: (entityId: string) => number,
  wires?: readonly PlannerWire[],
): NonNullable<SimulationBlueprintScene["scheduledSlots"]> {
  if (network.request.options.converterStartup !== "manual") return [];
  const rules = new PlannerSupplyRules(registry, network.request.plan, "manual");
  const roots = converterStartupRoots(registry, network, wires);
  return network.nodes.flatMap(producer => {
    const self = producer.recipe ? rules.selfConsumption(producer.recipe) : null;
    if (!self || !roots.has(producer.entity.id)) return [];
    const groupIds = producer.definition.recipeChannels.filter(channel => channel.type === "consumption-channel")
      .flatMap(channel => channel.ingredientStorageGroupIds);
    return producer.definition.storageSlotGroups.filter(group => groupIds.includes(group.id)).flatMap(group => group.slots.map(slot => ({
      simulationSeconds: startupSeconds(producer.entity.id),
      patch: { entityId: producer.entity.id, storageGroupId: group.id, slotId: slot.id,
        itemType: self.itemId, count: slot.capacity, ignoreStock: false },
    })));
  });
}

/** 使用最终路由的启动等待时间估算罐体库存，拒绝超容量候选，不预填整罐掩盖缺料。 */
export function configureConverterStartupInventory(network: PlannerNetwork, startupSeconds: (entityId: string) => number): void {
  for (const tank of network.nodes.filter(node => node.purpose === "startup" && node.supplyTarget
    && ["liquid_storager_1", "gas_storager_1"].includes(node.definition.id))) {
    const target = network.nodes.find(node => node.entity.id === tank.supplyTarget!.entityId)!;
    const group = target.definition.storageSlotGroups.find(entry => tank.supplyTarget!.storageGroupIds?.includes(entry.id))!;
    const count = group.slots.reduce((sum, slot) => sum + slot.capacity, 0)
      + Math.ceil(tank.outputs[0]!.perMinute * (startupSeconds(target.entity.id) + 10) / 60);
    if (count > tank.definition.storageSlotGroups[0]!.slots[0]!.capacity) throw new PlannerCandidateError("转化设备回流过长，启动罐容量不足。");
    tank.entity.config["storageSlotGroups[0].slots[0].initialCount"] = count;
  }
}

export function preparePlantStartups(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement): PlantStartup[] {
  const producers = new Map<string, string[]>();
  for (const node of network.nodes) {
    for (const output of node.outputs) producers.set(output.itemId, [...(producers.get(output.itemId) ?? []), node.entity.id]);
  }
  const graph = buildLayoutGraph(network.nodes.map((node) => node.entity.id), network.nodes.flatMap((node) =>
    node.inputs.flatMap((input) => (producers.get(input.itemId) ?? []).map((from) => ({ from, to: node.entity.id })))));
  const startups: PlantStartup[] = [];
  for (const picker of [...network.nodes]) {
    if (picker.definition.id !== "seedcol_1" || picker.recipe === null) continue;
    const group = graph.groups[graph.groupIndexByNodeId.get(picker.entity.id)!];
    if (!group?.cyclic || !group.nodeIds.some((id) => network.nodes.some((node) => node.entity.id === id
      && (node.definition.id === "planter_1" || node.definition.id === "planter_1_liquid")))) continue;
    const input = picker.inputs[0]!;
    const groupIndex = picker.definition.storageSlotGroups.findIndex((entry) => input.storageGroupIds?.includes(entry.id));
    if (groupIndex < 0) throw new PlannerCandidateError("植物循环缺少可初始化的采种机输入槽。");
    if (network.request.options.plantStartup === "preload") {
      const prefix = `storageSlotGroups[${groupIndex}].slots[0]`;
      picker.entity.config[`${prefix}.initialItemType`] = input.itemId;
      picker.entity.config[`${prefix}.initialCount`] = 50;
      picker.entity.config[`${prefix}.lock`] = input.itemId;
      continue;
    }
    const source = createPlainNode(registry, "unloader_1", `eda-startup-source-${network.nodes.length}`, "startup");
    configureSource(source, input.itemId, true);
    network.nodes.push(source);
    const storage = source.definition.storageSlotGroups[0]!, slot = storage.slots[0]!;
    const link = registry.queries.buildWarehouseSlotLinkForEntity({ entityId: source.entity.id, storageSlotGroupId: storage.id, slotId: slot.id, itemId: input.itemId });
    network.slotLinks.push({ ...link, id: `eda-warehouse-${network.slotLinks.length}` });
    network.initialSlots.push({ entityId: source.entity.id, storageGroupId: storage.id, slotId: slot.id, itemType: input.itemId, count: slot.capacity, ignoreStock: true });
    const definition = findLogisticsDevice(registry, LOGISTICS_KIND.belt, "admission");
    const admission = createPlainNode(registry, definition.id, `eda-startup-admission-${network.nodes.length}`, "startup");
    placement.placeAnywhere(admission, 0, picker.entity.position);
    network.nodes.push(admission);
    const inlet = getPlannerPorts(registry, admission.entity, definition, "input", input.itemId)[0]!;
    admission.entity.config[`portGroups[${inlet.groupIndex}].ports[${inlet.portIndex}].admissionRule`] = {
      itemId: input.itemId, limit: 29, perMinuteLimit: null,
    };
    startups.push({ picker, source, admission, itemId: input.itemId });
  }
  return startups;
}

export function connectPlantStartups(registry: RegistryContract, startups: readonly PlantStartup[], wires: PlannerWire[]): void {
  for (const { picker, source, admission, itemId } of startups) {
    const target = getPlannerPorts(registry, picker.entity, picker.definition, "input", itemId).find((port) =>
      !wires.some((wire) => wire.target.entityId === port.entityId && wire.target.groupIndex === port.groupIndex && wire.target.portIndex === port.portIndex));
    if (target === undefined) throw new PlannerCandidateError("植物循环没有可用于启动供给的采种机输入端口。");
    filterPort(picker.entity, target, itemId);
    const inlet = getPlannerPorts(registry, admission.entity, admission.definition, "input", itemId)[0]!;
    const outlet = getPlannerPorts(registry, admission.entity, admission.definition, "output", itemId)[0]!;
    const sourcePort = getPlannerPorts(registry, source.entity, source.definition, "output", itemId)[0]!;
    wires.push({ source: sourcePort, target: inlet, itemIds: [itemId], perMinute: 30 });
    wires.push({ source: outlet, target, itemIds: [itemId], perMinute: 30 });
  }
}

// AI-REMOVED 2026-09-16:
// Reason: 初排供电桩数量不能成为后续设备布局的固定约束。
// Trigger: 赤铜矿紧凑规划出现全部几何合格但两个设备始终缺少覆盖。
// Evidence: 运行 1789569174504-774676 的 remainingConflicts.power 为 2。
// Replacement: 下方按候选布局完成供电覆盖的 placePower。
// Risk: 新增桩位必须避开所有已选物流端口与验证夹具。
// Human Review: Required
// Original code:
// export async function placePower(registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, checkBudget: () => void = () => {}): Promise<void> {
//   const pending = network.nodes.filter((node) => node.definition.requiresPower);
//   while (pending.length > 0) {
//     checkBudget();
//     await new Promise<void>((resolve) => setTimeout(resolve, 0));
//     const powered = collectPoweredEntityIds(network.nodes.filter((node) => placement.placed.includes(node)).map((node) => node.entity), registry.entityDefinitions);
//     for (let index = pending.length - 1; index >= 0; index--) if (powered.has(pending[index]!.entity.id)) pending.splice(index, 1);
//     if (!pending.length) return;
//     const node = createPlainNode(registry, "power_diffuser_1", `eda-power-${network.nodes.length}`, "power");
//     const target = pending[0]!;
//     const targetRect = resolveEntityGridRect({ entity: target.entity, definition: target.definition });
//     const range = node.definition.powerRange!;
//     let best: { x: number; y: number; coverage: number } | null = null;
//     for (let y = Math.max(placement.minimumY, targetRect.y - range); y <= targetRect.y + targetRect.height + range; y++) {
//       for (let x = Math.max(placement.minimumX, targetRect.x - range); x <= targetRect.x + targetRect.width + range; x++) {
//         if (!placement.canPlace(node, { x, y }, 0)) continue;
//         const power = resolvePowerRangeGridRect({ entity: { ...node.entity, position: { x, y } }, definition: node.definition })!;
//         if (!areGridRectsIntersecting(power, targetRect)) continue;
//         const coverage = pending.filter((entry) => areGridRectsIntersecting(power, resolveEntityGridRect({ entity: entry.entity, definition: entry.definition }))).length;
//         if (best === null || coverage > best.coverage) best = { x, y, coverage };
//       }
//     }
//     if (best === null) throw new PlannerCandidateError(`找不到供电桩位置：${target.definition.id}`);
//     placement.place(node, { x: best.x, y: best.y });
//     network.nodes.push(node);
//   }
// }

/** 供电属于布局的派生设施；按最终设备位置补齐，并计入完整交付范围。 */
export async function placePower(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
  fixtures: readonly WorldEntity[], outline: { width: number; height: number }, checkBudget: () => void): Promise<PlannerNode[] | null> {
  const definition = registry.queries.findEntityDefinition("power_diffuser_1")!;
  const rects = [...network.nodes.map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition })),
    ...fixtures.map(entity => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }))];
  const ports = wires.flatMap(wire => [wire.source.outside, wire.target.outside]);
  const pending = network.nodes.filter(node => node.definition.requiresPower).map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
  const result: PlannerNode[] = [];
  const minimumX = 0;
  const minimumY = 0;
  while (pending.length) {
    checkBudget();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const node = createPlainNode(registry, definition.id, `eda-power-${result.length}`, "power");
    let best: { x: number; y: number; coverage: number; distance: number } | null = null;
    for (let y = minimumY; y + definition.footprint.height <= outline.height; y++) for (let x = minimumX; x + definition.footprint.width <= outline.width; x++) {
      const rect = { x, y, ...definition.footprint };
      if (rects.some(other => areGridRectsIntersecting(rect, other)) || ports.some(port => port.x >= x && port.x < x + rect.width && port.y >= y && port.y < y + rect.height)) continue;
      const range = resolvePowerRangeGridRect({ entity: { ...node.entity, position: { x, y } }, definition })!;
      const covered = pending.filter(other => areGridRectsIntersecting(range, other));
      const distance = covered.reduce((sum, other) => sum + Math.abs(x - other.x) + Math.abs(y - other.y), 0);
      if (covered.length && (best === null || covered.length > best.coverage || (covered.length === best.coverage && distance < best.distance))) best = { x, y, coverage: covered.length, distance };
    }
    if (best === null) return null;
    node.entity.position = { x: best.x, y: best.y }; result.push(node);
    rects.push(resolveEntityGridRect({ entity: node.entity, definition }));
    const range = resolvePowerRangeGridRect({ entity: node.entity, definition })!;
    for (let i = pending.length - 1; i >= 0; i--) if (areGridRectsIntersecting(range, pending[i]!)) pending.splice(i, 1);
  }
  return result;
}
