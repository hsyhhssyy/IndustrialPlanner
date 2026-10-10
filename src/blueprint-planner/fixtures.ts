import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, getPlannerPorts, ROTATIONS, opposite, resolveTransportPose, type PlannerPort } from "./geometry";
import { createPlainNode } from "./placement";

/** 排空传送带与收货夹具是两种真实实体；布局、路由和仿真共用其占用规则。 */
export function plannerDrainEntities(registry: RegistryContract, port: PlannerPort, id: string): WorldEntity[] {
  const sink = createPlainNode(registry, "cheat_infinite_solid", `${id}-sink`, "logistics");
  for (const rotation of ROTATIONS) {
    sink.entity.rotation = rotation;
    const peer = getPlannerPorts(registry, sink.entity, sink.definition, "input").find(peer => peer.edge === opposite(port.edge));
    if (!peer) continue;
    for (const [groupIndex, group] of sink.definition.portGroups.entries()) for (const [portIndex] of group.ports.entries()) {
      if (groupIndex !== peer.groupIndex || portIndex !== peer.portIndex) sink.entity.config[`portGroups[${groupIndex}].ports[${portIndex}].acceptRule.base`] = { kind: "none" };
    }
    break;
  }
  sink.entity.position = { x: port.outside.x * 2 - port.cell.x, y: port.outside.y * 2 - port.cell.y };
  return [{ id: `${id}-drain`, ...resolveTransportPose(registry, port.kind, opposite(port.edge), port.edge),
    position: { ...port.outside }, config: {}, tags: [] }, sink.entity];
}

export function plannerFixtureConflicts(registry: RegistryContract, fixtures: readonly WorldEntity[], entities: readonly WorldEntity[]): string[] {
  return entities.filter(entity => fixtures.some(fixture => {
    const definition = registry.queries.findEntityDefinition(fixture.definitionId)!;
    const other = registry.queries.findEntityDefinition(entity.definitionId)!;
    return !allowsPlannerOverlap(registry, definition, other) && areGridRectsIntersecting(
      resolveEntityGridRect({ entity: fixture, definition }), resolveEntityGridRect({ entity, definition: other }));
  })).map(entity => entity.id);
}

export function plannerObstacleMask(registry: RegistryContract, definitionId: string): number {
  const definition = registry.queries.findEntityDefinition(definitionId)!;
  return (["belt", "pipe"] as const).reduce((mask, kind, bit) => mask | (allowsPlannerOverlap(registry, definition,
    registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId(kind, "straight"))!) ? 0 : 1 << bit), 0);
}
