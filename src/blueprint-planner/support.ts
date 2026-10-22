import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { SimulationBlueprintScene } from "@/domain/simulation";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { resolveEntityGridRect, resolvePowerRangeGridRect, areGridRectsIntersecting, collectPoweredEntityIds } from "@/shared/geometry/power-range";
import { buildLayoutGraph } from "./layout-graph";
import { filterPort, findLogisticsDevice, getPlannerPorts } from "./geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { createPlainNode, type PlannerPlacement } from "./placement";
import { configureSource } from "./terminals";
import { converterStartupRoots, planConverterSupply, type ConverterSupply } from "./converter-supply";
import { PlannerRouter } from "./router";
import { searchPowerCover, type PowerSearchPosition } from "./power-search";

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

// AI-REMOVED 2026-10-21:
// Reason: 全局初排固定供电节点增加约束，Windows 完整预算未观察到可用收益，撤回该实验。
// Trigger: v36 软饮 20M 无首解，最好 28/32；v35 已到 32/32 但后置供电失败。
// Evidence: .temp/playwright-test/eda-adaptive-20261021/v36/item_bottled_food_5/，最佳快照为 20×26、6 个电桩。
// Replacement: 下方既有 placePower，在真实布线后计算覆盖与预留桩位；联合修复继续独立诊断。
// Risk: 布线与供电的耦合问题尚未解决，不能把撤回视为问题已修复。
// Human Review: Required
// Original code:
// /** 生成布局的供电设施进入共同几何搜索；覆盖初态只提供起点，桩位仍可移动。 */
// export async function preparePlannerPowerLayout(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
//   outline: { width: number; height: number }, checkBudget: () => void): Promise<PlannerNode[]> {
//   const fitted = await placePower(registry, network, wires, [], outline, checkBudget);
//   if (fitted !== null) return fitted;
//   // 2026-10-21：初排尚有碰撞或越界时，按 Registry 的真实覆盖范围建立有界初态，交由共同几何裁判修复。
//   // 不把初排无法补桩当成无解；设备和供电桩均是可移动变量，最终仍须同时通过占地、覆盖与布线验证。
//   const prototype = createPlainNode(registry, "power_diffuser_1", "eda-power-initial", "power");
//   const range = resolvePowerRangeGridRect(prototype);
//   if (!range || range.width <= 0 || range.height <= 0) throw new PlannerCandidateError("供电设施缺少有效覆盖范围。");
//   const columns = Math.ceil(outline.width / range.width), rows = Math.ceil(outline.height / range.height);
//   const result: PlannerNode[] = [];
//   for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
//     checkBudget();
//     const node = createPlainNode(registry, prototype.definition.id, `eda-power-${result.length}`, "power");
//     node.entity.position = {
//       x: Math.max(0, Math.min(outline.width - node.definition.footprint.width,
//         Math.round((column + 0.5) * outline.width / columns - range.x - range.width / 2))),
//       y: Math.max(0, Math.min(outline.height - node.definition.footprint.height,
//         Math.round((row + 0.5) * outline.height / rows - range.y - range.height / 2))),
//     };
//     result.push(node);
//   }
//   return result;
// }

/** 供电属于布局的派生设施；按最终设备位置补齐，并计入完整交付范围。 */
// AI-CORRECTION 2026-10-21：生成模式也用此函数建立可移动供电初态；原图重建与最终验收继续沿用本覆盖计算。
// AI-CORRECTION 2026-10-21：v36 默认供电初态实验已撤回；当前有效调用仍是最终覆盖与布线失败后的预留桩分支。
export async function placePower(registry: RegistryContract, network: PlannerNetwork, wires: readonly PlannerWire[],
  fixtures: readonly WorldEntity[], outline: { width: number; height: number }, checkBudget: () => void,
  softObstacles: readonly WorldEntity[] = [], alternatives?: { readonly seed: number; readonly onEvaluation: () => void;
    readonly search?: boolean }): Promise<PlannerNode[] | null> {
  const definition = registry.queries.findEntityDefinition("power_diffuser_1")!;
  const rects = [...network.nodes.map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition })),
    ...fixtures.map(entity => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }))];
  const ports = wires.flatMap(wire => [wire.source.outside, wire.target.outside]);
  // 2026-10-16：失败后的重布可以暂时拆线，为桩位优先选择需要移动线路最少的位置。
  const softRects = softObstacles.map(entity => resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  const powered = collectPoweredEntityIds(network.nodes.map(node => node.entity), registry.entityDefinitions);
  const pending = network.nodes.filter(node => node.definition.requiresPower && !powered.has(node.entity.id)).map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
  const originalTargets = [...pending], originalObstacleCount = rects.length;
  const result: PlannerNode[] = [];
  // 2026-10-21：先寻找保留必需通道的完整覆盖；找不到时保留普通覆盖，继续尝试联合移动。
  const hasCapacity = (power: readonly PlannerNode[]) => {
    checkBudget();
    const router = new PlannerRouter(registry, [...network.nodes.map(node => node.entity), ...fixtures, ...power.map(node => node.entity)],
      wires.flatMap(wire => [wire.source, wire.target]), { minimumX: 0, minimumY: 0, maximumX: outline.width - 1, maximumY: outline.height - 1, escapeLength: 0 });
    const state = router.staticConstraints(wires);
    return state.disconnectedWires === 0 && state.capacityDeficit === 0;
  };
  const fromPositions = (selected: readonly PowerSearchPosition[]) => selected.map((position, index) => {
    const power = createPlainNode(registry, definition.id, `eda-power-${index}`, "power");
    power.entity.position = { x: position.rect.x, y: position.rect.y }; return power;
  });
  const minimumX = 0;
  const minimumY = 0;
  while (pending.length) {
    checkBudget();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const node = createPlainNode(registry, definition.id, `eda-power-${result.length}`, "power");
    let best: { x: number; y: number; coverage: number; distance: number; score: number } | null = null;
    for (let y = minimumY; y + definition.footprint.height <= outline.height; y++) for (let x = minimumX; x + definition.footprint.width <= outline.width; x++) {
      const rect = { x, y, ...definition.footprint };
      if (rects.some(other => areGridRectsIntersecting(rect, other)) || ports.some(port => port.x >= x && port.x < x + rect.width && port.y >= y && port.y < y + rect.height)) continue;
      const range = resolvePowerRangeGridRect({ entity: { ...node.entity, position: { x, y } }, definition })!;
      const covered = pending.filter(other => areGridRectsIntersecting(range, other));
      const distance = covered.reduce((sum, other) => sum + Math.abs(x - other.x) + Math.abs(y - other.y), 0);
      const score = covered.length / (1 + softRects.filter(other => areGridRectsIntersecting(rect, other)).length);
      if (covered.length && (best === null || score > best.score || (score === best.score && distance < best.distance))) best = { x, y, coverage: covered.length, distance, score };
    }
    if (best === null || alternatives?.search) {
      if (!alternatives) return null;
      // 2026-10-17：撤销本轮贪心选择，固定设备/线路仍保留；最多 256 个分支计入调用方总预算。
      const obstacles = rects.slice(0, originalObstacleCount), positions: PowerSearchPosition[] = [];
      for (let y = 0; y + definition.footprint.height <= outline.height; y++) for (let x = 0; x + definition.footprint.width <= outline.width; x++) {
        checkBudget();
        const rect = { x, y, ...definition.footprint };
        if (obstacles.some(other => areGridRectsIntersecting(rect, other))
          || ports.some(port => port.x >= x && port.x < x + rect.width && port.y >= y && port.y < y + rect.height)) continue;
        const range = resolvePowerRangeGridRect({ entity: { ...node.entity, position: { x, y } }, definition })!;
        const covered = originalTargets.flatMap((target, index) => areGridRectsIntersecting(range, target) ? [index] : []);
        if (covered.length) positions.push({ rect, covered, obstruction: softRects.filter(other => areGridRectsIntersecting(rect, other)).length,
          distance: covered.reduce((sum, index) => sum + Math.abs(x - originalTargets[index]!.x) + Math.abs(y - originalTargets[index]!.y), 0) });
      }
      // AI-REMOVED 2026-10-23:
      // Reason: 完整覆盖才检查必要通道，会在已证明不可能的单桩分支耗尽覆盖预算。
      // Trigger: 新软饮31/31普通49位256分支失败，必要域35位168分支得到三桩。
      // Evidence: Windows probe578～579；共享容量证书独立核对591～592。
      // Replacement: 下方同256分支内先保留普通覆盖、过滤单桩必要域，再搜索完整安全覆盖。
      // Risk: 改变覆盖选择，若无安全完整覆盖仍保留真实完整覆盖供联合移动；Human Review: Required。
      // Original code:
      // let fallback: PlannerNode[] | undefined;
      // const selected = await searchPowerCover(positions, originalTargets.length, alternatives.seed, 256, alternatives.onEvaluation,
      // softObstacles.length ? positions => {
      // const nodes = fromPositions(positions); fallback ??= nodes; return hasCapacity(nodes);
      // } : undefined);
      // 2026-10-23：两次覆盖搜索共用原256分支；单桩必要条件只删固定主体下不可能的点，不当作全体移动无解。
      let evaluated = 0;
      const evaluate = () => { alternatives.onEvaluation(); evaluated++; };
      let selected = await searchPowerCover(positions, originalTargets.length, alternatives.seed, 256, evaluate);
      let fallback = selected ? fromPositions(selected) : undefined;
      if (selected && softObstacles.length && !hasCapacity(fallback!)) {
        const safePositions = positions.filter(position => hasCapacity(fromPositions([position])));
        let filteredFallback: PlannerNode[] | undefined;
        selected = await searchPowerCover(safePositions, originalTargets.length, alternatives.seed, 256 - evaluated, evaluate,
          selection => {
            const nodes = fromPositions(selection); filteredFallback ??= nodes; return hasCapacity(nodes);
          });
        // 已去除不可能单桩的完整覆盖优先作为联合移动入口；若没有这种完整覆盖，原普通覆盖仍保留。
        fallback = filteredFallback ?? fallback;
      }

      // AI-REMOVED 2026-10-21:
      // Reason: 覆盖节点构造抽出复用，用于共同通道检查。
      // Trigger: 合法供电与全通路径在候选重放阶段丢失。
      // Evidence: Windows probe250：同输入 17 次产生 496 格 Dense 达标候选。
      // Replacement: 本函数 fromPositions、完整覆盖接受回调及下方 return。
      // Risk: 所有覆盖、路径与 Dense 裁判保持；Human Review: Required。
      // Original code:
      // return selected?.map((position, index) => {
      //   const power = createPlainNode(registry, definition.id, `eda-power-${index}`, "power");
      //   power.entity.position = { x: position.rect.x, y: position.rect.y }; return power;
      // }) ?? null;
      return selected ? fromPositions(selected) : fallback ?? null;
    }
    node.entity.position = { x: best.x, y: best.y }; result.push(node);
    rects.push(resolveEntityGridRect({ entity: node.entity, definition }));
    const range = resolvePowerRangeGridRect({ entity: node.entity, definition })!;
    for (let i = pending.length - 1; i >= 0; i--) if (areGridRectsIntersecting(range, pending[i]!)) pending.splice(i, 1);
  }
  // 只额外调用一次显式 search 分支；若所有覆盖均有缺口，仍返回该分支的普通覆盖供联合移动。
  if (alternatives && !alternatives.search && softObstacles.length && !hasCapacity(result)) {
    return await placePower(registry, network, wires, fixtures, outline, checkBudget, softObstacles, { ...alternatives, search: true }) ?? result;
  }
  return result;
}
