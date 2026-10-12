import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveBaseAreas, type BaseAreaGeometry } from "./geometry/base-areas";

/** 仅解析区域资格；占地、核心区、外围和碰撞继续由放置校验处理。 */
export function resolveEntityPlacementAreas(
  definition: Pick<EntityDefinition, "placementWhitelist">,
  base: Pick<BaseDefinition, "id">,
  areas: readonly BaseAreaGeometry[],
): readonly BaseAreaGeometry[] {
  if (definition.placementWhitelist === undefined) return areas;
  const entry = definition.placementWhitelist.find((candidate) => candidate.baseId === base.id);
  if (entry === undefined) return [];
  const areaIds = entry.areaIds;
  return areaIds === undefined
    ? areas
    : areas.filter((area) => areaIds.includes(area.id));
}

/** 在注册时拒绝错误引用和退役标签，避免运行态默默放宽设备权限。 */
export function validateEntityPlacementWhitelists(
  definitions: readonly Pick<EntityDefinition, "id" | "tags" | "placementWhitelist">[],
  bases: readonly BaseDefinition[],
): void {
  const areaIdsByBaseId = new Map(bases.map((base) => [
    base.id, new Set(resolveBaseAreas(base).map((area) => area.id)),
  ]));
  for (const definition of definitions) {
    const retiredTag = definition.tags.find((tag) =>
      tag.startsWith("baseOnly=") || tag.startsWith("baseAreaOnly="),
    );
    if (retiredTag !== undefined) {
      throw new Error(`Retired placement tag on ${definition.id}: ${retiredTag}`);
    }
    const seenBaseIds = new Set<string>();
    for (const entry of definition.placementWhitelist ?? []) {
      const areaIds = areaIdsByBaseId.get(entry.baseId);
      if (areaIds === undefined) {
        throw new Error(`Unknown placement base on ${definition.id}: ${entry.baseId}`);
      }
      if (seenBaseIds.has(entry.baseId)) {
        throw new Error(`Duplicate placement base on ${definition.id}: ${entry.baseId}`);
      }
      seenBaseIds.add(entry.baseId);
      if (entry.areaIds === undefined) continue;
      if (entry.areaIds.length === 0) {
        throw new Error(`Empty placement areas on ${definition.id}: ${entry.baseId}`);
      }
      const seenAreaIds = new Set<string>();
      for (const areaId of entry.areaIds) {
        if (!areaIds.has(areaId)) {
          throw new Error(`Unknown placement area on ${definition.id}: ${entry.baseId}/${areaId}`);
        }
        if (seenAreaIds.has(areaId)) {
          throw new Error(`Duplicate placement area on ${definition.id}: ${entry.baseId}/${areaId}`);
        }
        seenAreaIds.add(areaId);
      }
    }
  }
}
