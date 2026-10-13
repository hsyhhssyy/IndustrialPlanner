import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import { findEntityRange, findPowerRange, resolveEntityRangeGridRect } from "./entity-range";

import {
  getRotatedGridFootprint,
} from "./grid";

// AI-REMOVED 2026-10-13:
// Reason: 统一设备范围声明、几何和交互处理，替代中心正方形专用实现。
// Trigger: 洒水机和定向离体区域支持。
// Evidence: Search-First 确认旧电力、气体各自重复计算范围。
// Replacement: src/shared/geometry/entity-range.ts。
// Risk: 保持既有供电与气体规则，需范围回归验证。
// Human Review: Required
// Original code:
// export function resolvePowerRangeGridRect(options: {
//   entity: WorldEntity;
//   definition: EntityDefinition;
// }): GridRect | null {
//   const powerRange = normalizePowerRange(options.definition.powerRange);
//   if (powerRange === null) {
//     return null;
//   }
//
//   const rotatedFootprint = getRotatedGridFootprint(
//     options.definition.footprint,
//     options.entity.rotation,
//   );
//   const center = getGridFootprintCenterCells(
//     options.entity.position,
//     rotatedFootprint,
//   );
//   const halfRange = powerRange / 2;
//
//   return {
//     x: center.x - halfRange,
//     y: center.y - halfRange,
//     width: powerRange,
//     height: powerRange,
//   };
// }
//
// export function resolveGasDiffusionRangeGridRect(options: {
//   entity: WorldEntity;
//   definition: EntityDefinition;
//   gasDiffusionRange: number;
// }): GridRect | null {
//   const gasDiffusionRange = options.gasDiffusionRange;
//   if (!Number.isFinite(gasDiffusionRange) || gasDiffusionRange <= 0) {
//     return null;
//   }
//
//   const rotatedFootprint = getRotatedGridFootprint(
//     options.definition.footprint,
//     options.entity.rotation,
//   );
//   const center = getGridFootprintCenterCells(
//     options.entity.position,
//     rotatedFootprint,
//   );
//   const halfRange = gasDiffusionRange / 2;
//
//   return {
//     x: center.x - halfRange,
//     y: center.y - halfRange,
//     width: gasDiffusionRange,
//     height: gasDiffusionRange,
//   };
// }
//
export function resolvePowerRangeGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect | null {
  const range = findPowerRange(options.definition);
  return range ? resolveEntityRangeGridRect({ ...options, range }) : null;
}

export function resolveGasDiffusionRangeGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  rangeId: string;
}): GridRect {
  return resolveEntityRangeGridRect({
    ...options, range: findEntityRange(options.definition, options.rangeId),
  });
}

export function resolveEntityGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect {
  const rotatedFootprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );

  return {
    x: options.entity.position.x,
    y: options.entity.position.y,
    width: rotatedFootprint.width,
    height: rotatedFootprint.height,
  };
}

export function areGridRectsIntersecting(
  left: GridRect,
  right: GridRect,
): boolean {
  return left.x + left.width > right.x
    && left.x < right.x + right.width
    && left.y + left.height > right.y
    && left.y < right.y + right.height;
}

/**
 * container 是否完全包含 contained（包含贴边）。
 * contained 任一边界超出 container 则返回 false。
 */
export function areGridRectsContaining(
  container: GridRect,
  contained: GridRect,
): boolean {
  return contained.x >= container.x
    && contained.y >= container.y
    && contained.x + contained.width <= container.x + container.width
    && contained.y + contained.height <= container.y + container.height;
}

// AI-REMOVED 2026-10-13:
// Reason: 统一设备范围声明、几何和交互处理，替代中心正方形专用实现。
// Trigger: 洒水机和定向离体区域支持。
// Evidence: Search-First 确认旧电力、气体各自重复计算范围。
// Replacement: src/registry/entity-range-validation.ts。
// Risk: 保持既有供电与气体规则，需范围回归验证。
// Human Review: Required
// Original code:
// function normalizePowerRange(value: number | undefined): number | null {
//   if (value === undefined || !Number.isFinite(value) || value <= 0) {
//     return null;
//   }
//
//   return value;
// }
//
/** 供电覆盖统一使用实体矩形与供电范围相交的现有规则。 */
export function collectPoweredEntityIds(
  entities: readonly WorldEntity[],
  definitions: readonly EntityDefinition[],
): Set<string> {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const ranges = entities.flatMap((entity) => {
    const definition = byId.get(entity.definitionId);
    if (definition === undefined) return [];
    const range = resolvePowerRangeGridRect({ entity, definition });
    return range === null ? [] : [range];
  });
  return new Set(entities.flatMap((entity) => {
    const definition = byId.get(entity.definitionId);
    if (definition === undefined) return [];
    const rect = resolveEntityGridRect({ entity, definition });
    return ranges.some((range) => areGridRectsIntersecting(rect, range)) ? [entity.id] : [];
  }));
}
