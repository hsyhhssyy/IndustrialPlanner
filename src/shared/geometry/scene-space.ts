import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { SceneBounds, SceneOuterRing, SceneSpace } from "@/domain/shared/scene-space";

export type SceneBoundarySide = "top" | "right" | "bottom" | "left";

/** 法向坐标总是有限；切向端点为 null 时表示射线或直线。 */
export interface SceneBoundarySegment {
  readonly areaId: string;
  readonly side: SceneBoundarySide;
  readonly coordinate: number;
  readonly start: number | null;
  readonly end: number | null;
}

export function validateSceneSpace(space: SceneSpace): void {
  const ids = new Set<string>();
  for (const area of space.areas) {
    if (area.id.length === 0 || ids.has(area.id)) {
      throw new Error(`Invalid or duplicate scene area id: ${area.id}`);
    }
    ids.add(area.id);
    for (const value of Object.values(area.bounds)) {
      if (value !== null && !Number.isSafeInteger(value)) {
        throw new Error(`Invalid scene bounds: ${area.id}`);
      }
    }
    const { minX, maxX, minY, maxY } = area.bounds;
    if ((minX !== null && maxX !== null && minX >= maxX)
      || (minY !== null && maxY !== null && minY >= maxY)) {
      throw new Error(`Empty scene area: ${area.id}`);
    }
    for (const [side, edge] of [
      ["top", minY], ["right", maxX], ["bottom", maxY], ["left", minX],
    ] as const) {
      const depth = area.outerRing[side];
      if (!Number.isSafeInteger(depth) || depth < 0 || (edge === null && depth !== 0)) {
        throw new Error(`Invalid scene outer ring: ${area.id}/${side}`);
      }
    }
    for (const value of Object.values(expandSceneBounds(area.bounds, area.outerRing))) {
      if (value !== null && !Number.isSafeInteger(value)) {
        throw new Error(`Scene outer ring exceeds safe coordinates: ${area.id}`);
      }
    }
  }
}

export function expandSceneBounds(bounds: SceneBounds, ring: SceneOuterRing): SceneBounds {
  return {
    minX: bounds.minX === null ? null : bounds.minX - ring.left,
    maxX: bounds.maxX === null ? null : bounds.maxX + ring.right,
    minY: bounds.minY === null ? null : bounds.minY - ring.top,
    maxY: bounds.maxY === null ? null : bounds.maxY + ring.bottom,
  };
}

export function isPointInSceneBounds(bounds: SceneBounds, point: GridPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && (bounds.minX === null || point.x >= bounds.minX)
    && (bounds.maxX === null || point.x < bounds.maxX)
    && (bounds.minY === null || point.y >= bounds.minY)
    && (bounds.maxY === null || point.y < bounds.maxY);
}

export function isRectInSceneBounds(bounds: SceneBounds, rect: GridRect): boolean {
  return isFiniteGridRect(rect)
    && (bounds.minX === null || rect.x >= bounds.minX)
    && (bounds.maxX === null || rect.x + rect.width <= bounds.maxX)
    && (bounds.minY === null || rect.y >= bounds.minY)
    && (bounds.maxY === null || rect.y + rect.height <= bounds.maxY);
}

export function intersectsSceneBounds(bounds: SceneBounds, rect: GridRect): boolean {
  return clipSceneBounds(bounds, rect) !== null;
}

/** 只在有限视口内物化矩形，禁止用巨大占地代替无界。 */
export function clipSceneBounds(bounds: SceneBounds, viewport: GridRect): GridRect | null {
  if (!isFiniteGridRect(viewport)) return null;
  const x = Math.max(bounds.minX ?? viewport.x, viewport.x);
  const y = Math.max(bounds.minY ?? viewport.y, viewport.y);
  const right = Math.min(bounds.maxX ?? viewport.x + viewport.width, viewport.x + viewport.width);
  const bottom = Math.min(bounds.maxY ?? viewport.y + viewport.height, viewport.y + viewport.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function sceneBoundsToFiniteRect(bounds: SceneBounds): GridRect | null {
  const { minX, maxX, minY, maxY } = bounds;
  if (minX === null || maxX === null || minY === null || maxY === null) return null;
  const rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return isFiniteGridRect(rect) ? rect : null;
}

/** 返回外接空间，不能用它替代逐区域资格和完整占地校验。 */
export function unionSceneBounds(bounds: readonly SceneBounds[]): SceneBounds | null {
  if (bounds.length === 0) return null;
  return {
    minX: unionEdge(bounds.map((value) => value.minX), Math.min),
    maxX: unionEdge(bounds.map((value) => value.maxX), Math.max),
    minY: unionEdge(bounds.map((value) => value.minY), Math.min),
    maxY: unionEdge(bounds.map((value) => value.maxY), Math.max),
  };
}

/** 并集真实外缘；去掉被其他区域覆盖的边、接缝及重复轮廓。 */
export function resolveSceneBoundarySegments(
  areas: readonly { readonly id: string; readonly bounds: SceneBounds }[],
  deduplicate = true,
): SceneBoundarySegment[] {
  const result: SceneBoundarySegment[] = [];
  areas.forEach((area, index) => {
    const { minX, maxX, minY, maxY } = area.bounds;
    for (const [side, coordinate, start, end] of [
      ["top", minY, minX, maxX], ["right", maxX, minY, maxY],
      ["bottom", maxY, minX, maxX], ["left", minX, minY, maxY],
    ] as const) {
      if (coordinate === null) continue;
      let intervals = [[start ?? -Infinity, end ?? Infinity]];
      areas.forEach((other, otherIndex) => {
        if (otherIndex === index) return;
        const horizontal = side === "top" || side === "bottom";
        const lower = (horizontal ? other.bounds.minY : other.bounds.minX) ?? -Infinity;
        const upper = (horizontal ? other.bounds.maxY : other.bounds.maxX) ?? Infinity;
        const negative = side === "top" || side === "left";
        const covered = negative
          ? lower < coordinate && upper >= coordinate
          : lower <= coordinate && upper > coordinate;
        const duplicate = deduplicate && otherIndex < index && (negative ? lower : upper) === coordinate;
        if (!covered && !duplicate) return;
        const cutStart = (horizontal ? other.bounds.minX : other.bounds.minY) ?? -Infinity;
        const cutEnd = (horizontal ? other.bounds.maxX : other.bounds.maxY) ?? Infinity;
        intervals = intervals.flatMap(([from, to]) => {
          if (cutEnd <= from! || cutStart >= to!) return [[from!, to!]];
          const remaining: number[][] = [];
          if (cutStart > from!) remaining.push([from!, cutStart]);
          if (cutEnd < to!) remaining.push([cutEnd, to!]);
          return remaining;
        });
      });
      for (const [from, to] of intervals) {
        result.push({
          areaId: area.id, side, coordinate,
          start: Number.isFinite(from) ? from! : null,
          end: Number.isFinite(to) ? to! : null,
        });
      }
    }
  });
  return result;
}

/** 裁剪只缩短真实线段，不生成视口裁剪边。 */
export function clipSceneBoundarySegment(
  segment: SceneBoundarySegment,
  viewport: GridRect,
): { readonly from: GridPoint; readonly to: GridPoint } | null {
  if (!isFiniteGridRect(viewport)) return null;
  const horizontal = segment.side === "top" || segment.side === "bottom";
  const normalMin = horizontal ? viewport.y : viewport.x;
  const normalMax = normalMin + (horizontal ? viewport.height : viewport.width);
  if (segment.coordinate < normalMin || segment.coordinate > normalMax) return null;
  const tangentMin = horizontal ? viewport.x : viewport.y;
  const tangentMax = tangentMin + (horizontal ? viewport.width : viewport.height);
  const start = Math.max(segment.start ?? tangentMin, tangentMin);
  const end = Math.min(segment.end ?? tangentMax, tangentMax);
  if (start >= end) return null;
  return horizontal
    ? { from: { x: start, y: segment.coordinate }, to: { x: end, y: segment.coordinate } }
    : { from: { x: segment.coordinate, y: start }, to: { x: segment.coordinate, y: end } };
}

function isFiniteGridRect(rect: GridRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height]
    .every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function unionEdge(values: readonly (number | null)[], combine: (...values: number[]) => number): number | null {
  return values.some((value) => value === null) ? null : combine(...values as number[]);
}
