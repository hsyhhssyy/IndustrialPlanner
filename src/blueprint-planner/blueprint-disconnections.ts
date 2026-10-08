import type { BlueprintPlannerBlueprintInput } from "@/domain/blueprint-planner";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { findDirectPortConnections } from "@/shared/port-connections";
import { getPlannerPorts } from "./geometry";

/** 内部障碍物导致的断连与朝空地开放的外接断口分开处理；不猜测缺格的连接意图。 */
export function excludeDisconnectedBlueprintPipes(registry: RegistryContract, input: BlueprintPlannerBlueprintInput) {
  const blueprint = input.blueprint;
  const definitions = new Map(blueprint.entityOrder.map(id => [id,
    registry.queries.findEntityDefinition(blueprint.entities[id]!.definitionId)!]));
  const ports = blueprint.entityOrder.flatMap(id => {
    const entity = blueprint.entities[id]!, definition = definitions.get(id)!;
    return (["input", "output"] as const).flatMap(direction => getPlannerPorts(registry, entity, definition, direction))
      .filter(port => definition.portGroups[port.groupIndex]!.isPipe).map(port => ({ ...port,
        id: `${id}/${port.groupIndex}/${port.portIndex}/${port.direction}`, deviceId: id,
        portGroupId: definition.portGroups[port.groupIndex]!.id,
        portDefinitionId: definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.id,
        isPipe: true, insideGridPoint: port.cell, outsideGridPoint: port.outside,
      }));
  });
  const connections = findDirectPortConnections(ports, id => registry.queries.isGeneralLogisticsDevice(definitions.get(id)!.id));
  const connected = new Set(connections.flatMap(connection => [connection.sourcePort.id, connection.targetPort.id]));
  // 分流、汇流和桥接器是支路边界；桥接器另一通道和其他支路不会被连带排除。
  const removable = new Set(blueprint.entityOrder.filter(id => {
    const definitionId = definitions.get(id)!.id;
    return registry.queries.isPipe(definitionId) || registry.queries.isPipeLogistics(definitionId)
      && registry.queries.resolveLogisticsRole(definitionId) === "admission";
  }));
  const neighbours = new Map<string, Set<string>>();
  const join = (left: string, right: string) => {
    if (!removable.has(left) || !removable.has(right)) return;
    for (const [from, to] of [[left, right], [right, left]]) {
      const entries = neighbours.get(from!) ?? new Set<string>();
      entries.add(to!); neighbours.set(from!, entries);
    }
  };
  for (const connection of connections) join(connection.sourcePort.entityId, connection.targetPort.entityId);
  const occupied = new Map<string, string[]>();
  for (const id of blueprint.entityOrder) {
    const definition = definitions.get(id)!;
    if (!definition.portGroups.some(group => group.isPipe)) continue;
    const rect = resolveEntityGridRect({ entity: blueprint.entities[id]!, definition });
    for (let x = rect.x; x < rect.x + rect.width; x++) for (let y = rect.y; y < rect.y + rect.height; y++) {
      const key = `${x},${y}`, entries = occupied.get(key) ?? [];
      entries.push(id); occupied.set(key, entries);
    }
  }
  const broken = new Set<string>(), locations = new Map<string, string>();
  for (const port of ports) {
    // 设备、分流和桥接器的未使用端口可以正常空置，不能反向把旁边经过的管道判坏。
    if (connected.has(port.id)) continue;
    for (const other of occupied.get(`${port.outside.x},${port.outside.y}`) ?? []) {
      if (other === port.entityId || !removable.has(port.entityId) && !removable.has(other)) continue;
      // 两端设备直接夹着一个完全断开的物流件时，仍能定位朝向错配；正常经过的线路不受影响。
      if (!removable.has(port.entityId) && ports.some(candidate => candidate.entityId === other && connected.has(candidate.id))) continue;
      if (removable.has(port.entityId)) broken.add(port.entityId);
      if (removable.has(other)) broken.add(other);
      join(port.entityId, other);
      const point = blueprint.entities[other]!.position;
      locations.set(other, `${other} (${point.x}, ${point.y})`);
    }
  }
  const excludedEntityIds = new Set(broken), queue = [...broken];
  for (let index = 0; index < queue.length; index++) for (const id of neighbours.get(queue[index]!) ?? []) {
    if (excludedEntityIds.has(id)) continue;
    excludedEntityIds.add(id); queue.push(id);
  }
  const warning = excludedEntityIds.size ? `检测到内部管道断连：${[...locations.values()].join("；")}。已排除对应整段支路（${excludedEntityIds.size} 个管道及准入口），其他支路保留。` : null;
  if (!excludedEntityIds.size) return { input, excludedEntityIds, warning };
  const effectiveBlueprint: BlueprintDocument = { ...structuredClone(blueprint),
    entityOrder: blueprint.entityOrder.filter(id => !excludedEntityIds.has(id)),
    entities: Object.fromEntries(Object.entries(structuredClone(blueprint.entities)).filter(([id]) => !excludedEntityIds.has(id))),
    slotLinks: structuredClone(blueprint.slotLinks.filter(link => !excludedEntityIds.has(link.source.entityId) && !excludedEntityIds.has(link.target.entityId))),
  };
  return { input: { ...input, blueprint: effectiveBlueprint, boundaries: input.boundaries.filter(boundary => !excludedEntityIds.has(boundary.entityId)) },
    excludedEntityIds, warning };
}

/** 提示随任务进度保存；已含同一提示的恢复消息不重复拼接。 */
export function withBlueprintDisconnectionWarning(registry: RegistryContract, input: BlueprintPlannerBlueprintInput, message: string | null): string | null {
  const warning = excludeDisconnectedBlueprintPipes(registry, input).warning;
  if (!warning || message?.includes(warning)) return message;
  return message ? `${warning}\n${message}` : warning;
}
