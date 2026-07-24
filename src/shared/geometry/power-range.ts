import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import {
  getGridFootprintCenterCells,
  getRotatedGridFootprint,
} from "./grid";

export function resolvePowerRangeGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
}): GridRect | null {
  const powerRange = normalizePowerRange(options.definition.powerRange);
  if (powerRange === null) {
    return null;
  }

  const rotatedFootprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );
  const center = getGridFootprintCenterCells(
    options.entity.position,
    rotatedFootprint,
  );
  const halfRange = powerRange / 2;

  return {
    x: center.x - halfRange,
    y: center.y - halfRange,
    width: powerRange,
    height: powerRange,
  };
}

export function resolveGasDiffusionRangeGridRect(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  gasDiffusionRange: number;
}): GridRect | null {
  const gasDiffusionRange = options.gasDiffusionRange;
  if (!Number.isFinite(gasDiffusionRange) || gasDiffusionRange <= 0) {
    return null;
  }

  const rotatedFootprint = getRotatedGridFootprint(
    options.definition.footprint,
    options.entity.rotation,
  );
  const center = getGridFootprintCenterCells(
    options.entity.position,
    rotatedFootprint,
  );
  const halfRange = gasDiffusionRange / 2;

  return {
    x: center.x - halfRange,
    y: center.y - halfRange,
    width: gasDiffusionRange,
    height: gasDiffusionRange,
  };
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

function normalizePowerRange(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}
