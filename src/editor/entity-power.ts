import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRect } from "@/domain/shared/grid";
import { areGridRectsIntersecting, resolveEntityGridRect, resolvePowerRangeGridRect } from "@/shared/geometry/power-range";

export function resolvePowerRangeProviders(entities: readonly WorldEntity[], registry: RegistryContract, target: GridRect): readonly WorldEntity[] {
  return entities.filter((entity) => {
    const definition = registry.queries.findEntityDefinition(entity.definitionId);
    if (definition === undefined || definition === null) return false;
    const range = resolvePowerRangeGridRect({ entity, definition });
    return range !== null && areGridRectsIntersecting(range, target);
  });
}

export function resolvePoweredEntityIds(entities: readonly WorldEntity[], registry: RegistryContract): readonly string[] {
  const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
  const ranges = entities.flatMap((entity) => {
    const definition = definitions.get(entity.definitionId);
    if (definition === undefined) return [];
    const range = resolvePowerRangeGridRect({ entity, definition });
    return range === null ? [] : [range];
  });
  if (ranges.length === 0) return [];
  return entities.flatMap((entity) => {
    const definition = definitions.get(entity.definitionId);
    if (definition === undefined) return [];
    const rect = resolveEntityGridRect({ entity, definition });
    return ranges.some((range) => areGridRectsIntersecting(range, rect)) ? [entity.id] : [];
  });
}
