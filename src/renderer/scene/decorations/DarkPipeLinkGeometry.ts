import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridFloatPoint } from "@/domain/shared/grid";
import { resolveSpriteGridRect } from "@/shared/geometry/grid";
import {
  resolveViewportPointFromWorldPoint,
  resolveViewportRectFromWorldGridRect,
} from "@/shared/geometry/viewport-transform";

import type { DecorationSyncContext } from "./DecorationSyncContext";

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export function resolveEntityViewportRect(options: {
  ctx: DecorationSyncContext;
  entity: WorldEntity;
  definition: EntityDefinition;
}): ViewportRect | null {
  const gridRect = resolveSpriteGridRect(
    options.entity.position,
    options.definition.footprint,
    null,
    options.entity.rotation,
  );

  return resolveViewportRectFromWorldGridRect({
    gridRect,
    viewportBounds: options.ctx.viewportBounds,
    viewportCenter: {
      x: options.ctx.viewportState.centerX,
      y: options.ctx.viewportState.centerY,
    },
    gridCellPixelSize: options.ctx.viewportState.gridCellPixelSize,
    displayRotation: options.ctx.viewportState.displayRotation,
  });
}

export function resolveEntityViewportCenter(options: {
  ctx: DecorationSyncContext;
  entity: WorldEntity;
  definition: EntityDefinition;
}): ViewportPoint {
  const gridRect = resolveSpriteGridRect(
    options.entity.position,
    options.definition.footprint,
    null,
    options.entity.rotation,
  );
  const worldPoint: GridFloatPoint = {
    x: gridRect.x + gridRect.width / 2,
    y: gridRect.y + gridRect.height / 2,
  };

  return resolveViewportPointFromWorldPoint({
    viewportBounds: options.ctx.viewportBounds,
    viewportCenter: {
      x: options.ctx.viewportState.centerX,
      y: options.ctx.viewportState.centerY,
    },
    gridCellPixelSize: options.ctx.viewportState.gridCellPixelSize,
    displayRotation: options.ctx.viewportState.displayRotation,
    worldPoint,
  });
}

export function buildEntityDefinitionMap(
  definitions: readonly EntityDefinition[],
): Map<string, EntityDefinition> {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

export function clipSegmentToViewport(options: {
  start: ViewportPoint;
  end: ViewportPoint;
  viewport: ViewportRect;
}): { start: ViewportPoint; end: ViewportPoint } | null {
  const minX = options.viewport.left;
  const minY = options.viewport.top;
  const maxX = options.viewport.left + options.viewport.width;
  const maxY = options.viewport.top + options.viewport.height;
  const dx = options.end.x - options.start.x;
  const dy = options.end.y - options.start.y;
  let t0 = 0;
  let t1 = 1;

  const tests: Array<[number, number]> = [
    [-dx, options.start.x - minX],
    [dx, maxX - options.start.x],
    [-dy, options.start.y - minY],
    [dy, maxY - options.start.y],
  ];

  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) {
        return null;
      }
      continue;
    }

    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return null;
      }
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) {
        return null;
      }
      t1 = Math.min(t1, r);
    }
  }

  return {
    start: {
      x: options.start.x + dx * t0,
      y: options.start.y + dy * t0,
    },
    end: {
      x: options.start.x + dx * t1,
      y: options.start.y + dy * t1,
    },
  };
}
