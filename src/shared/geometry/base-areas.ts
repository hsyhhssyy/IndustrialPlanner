import type { BaseDefinition, BaseOuterRingDefinition } from "@/domain/registry/types/base-definition";
import type { GridPoint, GridRect, GridRectSize } from "@/domain/shared/grid";

export interface BaseAreaGeometry {
  readonly id: string;
  readonly placeableRect: GridRect;
  readonly outerRect: GridRect;
  readonly outerRing: BaseOuterRingDefinition;
}

// AI-REMOVED 2026-09-26:
// Reason: 放置标签语义不属于几何模块。
// Trigger: 分区代码收口到既有共享标签文件。
// Evidence: src/shared/base-tags.ts 已承载基地标签常量。
// Replacement: src/shared/base-tags.ts 的 BASE_AREA_ONLY_TAG_PREFIX。
// Risk: Low。
// Human Review: Required
// Original code:
// export const BASE_AREA_ONLY_TAG_PREFIX = "baseAreaOnly=";

export function resolveBaseAreas(base: BaseDefinition): BaseAreaGeometry[] {
  return [
    createBaseAreaGeometry(base.id, { x: 0, y: 0 }, base.placeableArea, base.outerRing),
    ...(base.subAreas ?? []).map((area) =>
      createBaseAreaGeometry(area.id, area.position, area.placeableArea, area.outerRing)
    ),
  ];
}

export function resolveBaseAreaContainingRect(
  base: BaseDefinition,
  rect: GridRect,
  scope: "placeable" | "outer",
): BaseAreaGeometry | null {
  return resolveBaseAreas(base).find((area) =>
    isGridRectContainedBy(scope === "placeable" ? area.placeableRect : area.outerRect, rect)
  ) ?? null;
}

export function isGridPointInBaseArea(
  base: BaseDefinition,
  point: GridPoint,
  scope: "placeable" | "outer",
): boolean {
  return isGridPointInBaseAreas(resolveBaseAreas(base), point, scope);
}

export function isGridPointInBaseAreas(
  areas: readonly BaseAreaGeometry[],
  point: GridPoint,
  scope: "placeable" | "outer",
): boolean {
  return areas.some((area) => {
    const rect = scope === "placeable" ? area.placeableRect : area.outerRect;
    return point.x >= rect.x && point.y >= rect.y
      && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
  });
}

// AI-REMOVED 2026-09-26:
// Reason: 当前调用方已经持有区域数组，保留此额外包装只会重复分配几何对象。
// Trigger: 分区放置校验性能复核。
// Evidence: Editor 的相交判断在单次校验前调用 resolveBaseAreas，未使用此函数。
// Replacement: src/editor/placement-validation.ts 的 applyInsideBaseForbiddenReasons。
// Risk: Low。
// Human Review: Required
// Original code:
// export function intersectsBasePlaceableArea(base: BaseDefinition, rect: GridRect): boolean {
//   return resolveBaseAreas(base).some((area) =>
//     area.placeableRect.width > 0 && area.placeableRect.height > 0
//     && rect.x < area.placeableRect.x + area.placeableRect.width
//     && rect.x + rect.width > area.placeableRect.x
//     && rect.y < area.placeableRect.y + area.placeableRect.height
//     && rect.y + rect.height > area.placeableRect.y
//   );
// }

export function resolveBaseOuterBounds(base: BaseDefinition): GridRect {
  const outerRects = resolveBaseAreas(base).map((area) => area.outerRect);
  const x = Math.min(...outerRects.map((rect) => rect.x));
  const y = Math.min(...outerRects.map((rect) => rect.y));
  const right = Math.max(...outerRects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...outerRects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

function createBaseAreaGeometry(
  id: string,
  position: GridPoint,
  placeableArea: GridRectSize,
  outerRing: BaseOuterRingDefinition,
): BaseAreaGeometry {
  return {
    id,
    placeableRect: { ...position, ...placeableArea },
    outerRect: {
      x: position.x - outerRing.left,
      y: position.y - outerRing.top,
      width: placeableArea.width + outerRing.left + outerRing.right,
      height: placeableArea.height + outerRing.top + outerRing.bottom,
    },
    outerRing,
  };
}

function isGridRectContainedBy(container: GridRect, target: GridRect): boolean {
  return target.width > 0 && target.height > 0
    && target.x >= container.x && target.y >= container.y
    && target.x + target.width <= container.x + container.width
    && target.y + target.height <= container.y + container.height;
}
