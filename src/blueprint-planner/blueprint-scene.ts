import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import type { BlueprintPlannerBlueprintInput } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { getPlannerPorts, ROTATIONS, allowsPlannerOverlap, type PlannerPort } from "./geometry";
import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
import { createPlainNode } from "./placement";
// AI-REMOVED 2026-10-10: 重复排空装配已由 fixtures.ts 接管；原导入 opposite, resolveTransportPose；Risk: Low；Human Review: Required。
import { plannerDrainEntities } from "./fixtures";
import { configureSource } from "./terminals";
import { excludeDisconnectedBlueprintPipes } from "./blueprint-disconnections";

/** 夹具只作用于独立场景；供料只补用户声明的边界，绝不补贴内部生产。 */
export function blueprintRecognitionScene(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  blueprint: BlueprintDocument = input.blueprint, seconds = 600, discoverOutputs = false, plannedDrains?: ReadonlyMap<string, readonly PlannerPort[]>): SimulationBlueprintRunRequest {
  // 2026-10-08：原图保持在任务中；识别夹具和真实仿真使用排除断连支路后的副本。
  const effective = excludeDisconnectedBlueprintPipes(registry, input).input;
  if (blueprint === input.blueprint) blueprint = effective.blueprint;
  input = { ...effective, blueprint };
  const scene: { externalEntities: WorldEntity[]; externalSlotLinks: []; initialSlots: SimulationBlueprintRunRequest["scene"]["initialSlots"] extends readonly (infer T)[] ? T[] : never;
    powerMode: "infinite" } = { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" };
  const sinks = new Map<string, string[]>();
  const sources = new Map<string, string[]>();
  const attach = (port: PlannerPort, itemId: string, direction: "input" | "output", drain = false) => {
    const domain = registry.queries.resolveItemDomain(itemId);
    const definitionId = domain === ItemDomainFlag.Solid ? "cheat_infinite_solid"
      : domain === ItemDomainFlag.Gas ? "cheat_infinite_gas" : "cheat_infinite_liquid";
    const fixture = createPlainNode(registry, definitionId, `__blueprint_fixture_${scene.externalEntities.length}`, "logistics");
    if (blueprint.entities[fixture.entity.id]) throw new Error("蓝图包含保留的仿真夹具编号。");
    if (direction === "input") configureSource(fixture, itemId, true);
    let placed = false;
    for (const rotation of ROTATIONS) {
      fixture.entity.rotation = rotation; fixture.entity.position = { x: 0, y: 0 };
      const peer = getPlannerPorts(registry, fixture.entity, fixture.definition, direction === "input" ? "output" : "input")
        .find(candidate => candidate.outside.x - candidate.cell.x === port.cell.x - port.outside.x
          && candidate.outside.y - candidate.cell.y === port.cell.y - port.outside.y);
      if (!peer) continue;
      fixture.entity.position = { x: port.outside.x - peer.cell.x + Number(drain) * (port.outside.x - port.cell.x),
        y: port.outside.y - peer.cell.y + Number(drain) * (port.outside.y - port.cell.y) };
      for (const [groupIndex, group] of fixture.definition.portGroups.entries()) for (const [portIndex] of group.ports.entries()) {
        if (groupIndex !== peer.groupIndex || portIndex !== peer.portIndex) {
          fixture.entity.config[`portGroups[${groupIndex}].ports[${portIndex}].acceptRule.base`] = { kind: "none" };
        }
      }
      placed = true; break;
    }
    if (!placed) throw new Error(`无法为入口 ${port.entityId} 装配仿真条件。`);
    // AI-REMOVED 2026-10-10: 排空夹具统一建模，避免布局与仿真实体规则分叉。
    // Trigger: 排空线误封堵管道；Evidence: 灼铜原图；Replacement: plannerDrainEntities。
    // Risk: Low；Human Review: Required。
    //     const additions: WorldEntity[] = drain ? [{ id: `__blueprint_drain_${scene.externalEntities.length}`,
    //       ...resolveTransportPose(registry, port.kind, opposite(port.edge), port.edge), position: port.outside, config: {}, tags: [] }, fixture.entity] : [fixture.entity];
    const additions = drain ? plannerDrainEntities(registry, port, `__blueprint_drain_${scene.externalEntities.length}`) : [fixture.entity];
    if (additions.some(fixture => {
      const definition = registry.queries.findEntityDefinition(fixture.definitionId)!;
      const rect = resolveEntityGridRect({ entity: fixture, definition });
      return [...blueprint.entityOrder.map(id => blueprint.entities[id]!), ...scene.externalEntities].some(entity => {
        const other = registry.queries.findEntityDefinition(entity.definitionId)!;
        return !allowsPlannerOverlap(registry, definition, other) && areGridRectsIntersecting(rect, resolveEntityGridRect({ entity, definition: other }));
      });
    })) {
      if (drain) return null;
      throw new Error(`边界 ${port.entityId} 没有足够空间接入仿真条件。`);
    }
    scene.externalEntities.push(...additions);
    return additions[additions.length - 1]!.id;
  };
  for (const boundary of input.boundaries) {
    const entity = blueprint.entities[boundary.entityId];
    if (!entity) continue;
    // 发现阶段允许尚未确定的出口；正式验收仍须装配持续收货和物品探针。
    if (discoverOutputs && boundary.direction === "output" && boundary.itemId === null) continue;
    const itemId = boundary.itemId;
    if (!itemId || !registry.queries.findItemDefinition(itemId)) throw new Error(`请指定 ${boundary.entityId} 运送的物品。`);
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    if (boundary.kind === "port") {
      const port = getPlannerPorts(registry, entity, definition, boundary.direction)
        .find(port => definition.portGroups[port.groupIndex]!.id === boundary.portGroupId
          && definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.id === boundary.portId);
      if (!port) throw new Error(`边界端口不存在：${boundary.entityId}`);
      const fixture = attach(port, itemId, boundary.direction);
      if (boundary.direction === "output") sinks.set(itemId, [...sinks.get(itemId) ?? [], fixture!]);
      else sources.set(itemId, [...sources.get(itemId) ?? [], fixture!]);
    } else if (boundary.direction === "input") {
      sources.set(itemId, [...sources.get(itemId) ?? [], entity.id]);
      const outputs = definition.portGroups.filter(group => group.direction === "output").map(group => group.id);
      const groups = definition.portStorageBindings.filter(binding => outputs.includes(binding.portGroupId)).map(binding => binding.storageSlotGroupId);
      for (const group of definition.storageSlotGroups.filter(group => groups.includes(group.id))) {
        const slot = group.slots[0];
        if (slot) scene.initialSlots.push({ entityId: entity.id, storageGroupId: group.id, slotId: slot.id,
          itemType: itemId, count: slot.capacity, ignoreStock: true });
      }
    } else {
      sinks.set(itemId, [...sinks.get(itemId) ?? [], entity.id]);
      if (entity.definitionId === "storager_1") {
        const drains = (plannedDrains?.get(entity.id) ?? getPlannerPorts(registry, entity, definition, "output")).map(port => attach(port, itemId, "output", true));
        if (plannedDrains && drains.some(id => id === null)) throw new Error(`出口 ${entity.id} 的规划排空端口被占用。`);
        if (drains.every(id => id === null)) throw new Error(`出口 ${entity.id} 没有可用的排空端口。`);
      }
    }
  }
  const originals = blueprint.entityOrder.map(id => blueprint.entities[id]!);
  for (const [index, fixture] of scene.externalEntities.entries()) {
    const definition = registry.queries.findEntityDefinition(fixture.definitionId)!;
    const rect = resolveEntityGridRect({ entity: fixture, definition });
    if ([...originals, ...scene.externalEntities.slice(0, index)].some(entity => {
      const other = registry.queries.findEntityDefinition(entity.definitionId)!;
      return !allowsPlannerOverlap(registry, definition, other) && areGridRectsIntersecting(rect, resolveEntityGridRect({ entity, definition: other }));
    })) throw new Error(`边界 ${fixture.id} 没有足够空间接入仿真条件。`);
  }
  return { blueprint, scene, engine: { kind: "dense-v2", ticksPerSecond: 2 }, probes: [
    ...[...sinks].map(([itemId, entityIds]) => ({ id: itemId, itemId, entityIds, direction: "input" as const })),
    ...[...sources].map(([itemId, entityIds]) => ({ id: `input:${itemId}`, itemId, entityIds, direction: "output" as const })),
  ],
    // 2026-10-08：用户指定预热 360 仿真秒；seconds 只控制发现或产率验证的观察窗口。
    warmupSeconds: 360, observationSeconds: seconds, inventorySampleCount: 9, maxWallTimeMs: 120_000,
    activeActivityIds: input.activeActivityIds, collectAnalysis: true };
}
