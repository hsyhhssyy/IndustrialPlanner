import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import { resolveEntityGridRect, resolvePowerRangeGridRect, areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { buildLayoutGraph } from "./layout-graph";
import { filterPort, findLogisticsDevice, getPlannerPorts } from "./geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { createPlainNode, type PlannerPlacement } from "./placement";
import { configureSource } from "./terminals";

export interface PlantStartup {
  readonly picker: PlannerNode;
  readonly source: PlannerNode;
  readonly admission: PlannerNode;
  readonly itemId: string;
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
    configureSource(source, input.itemId, false);
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
  const minimumX = network.nodes.some(node => node.purpose === "bus") ? 4 : 0;
  const minimumY = minimumX > 0 && network.request.options.warehouseBus === "free" ? 4 : 0;
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
