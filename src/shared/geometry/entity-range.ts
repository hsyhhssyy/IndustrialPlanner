import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityRangeDefinition } from "@/domain/registry/types/entity-range";
import type { GridPoint, GridRect, GridRectSize, GridRotation } from "@/domain/shared/grid";
import { rotateLocalGridRect } from "./grid";

/** 局部几何只转换一次，保持离体距离与设备朝向。 */
export function resolveLocalRangeGridRect(
  position: GridPoint,
  footprint: GridRectSize,
  rotation: GridRotation,
  localRect: GridRect,
): GridRect {
  const rotated = rotateLocalGridRect(localRect, footprint, rotation);
  return { ...rotated, x: position.x + rotated.x, y: position.y + rotated.y };
}

export function resolveEntityRangeGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  range: EntityRangeDefinition;
}): GridRect {
  return resolveLocalRangeGridRect(
    options.entity.position, options.definition.footprint,
    options.entity.rotation, options.range.localRect,
  );
}

export function findEntityRange(
  definition: EntityDefinition,
  rangeId: string,
): EntityRangeDefinition {
  const range = definition.ranges?.find((entry) => entry.id === rangeId);
  if (!range) throw new Error(`Unknown range ${definition.id}:${rangeId}`);
  return range;
}

/** 电力只有一套电网几何；由 Registry 校验单设备不重复声明。 */
export function findPowerRange(definition: EntityDefinition): EntityRangeDefinition | undefined {
  return definition.ranges?.find((range) => range.interactionKind === "power");
}
