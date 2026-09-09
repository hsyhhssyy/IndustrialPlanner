import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";

export interface RegionOutlineSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export type RegionGridRectRelation = "contained" | "boundary" | "outside";

export function isValidRegionGridRect(rect: GridRect): boolean {
  return Number.isSafeInteger(rect.x)
    && Number.isSafeInteger(rect.y)
    && Number.isSafeInteger(rect.width)
    && Number.isSafeInteger(rect.height)
    && rect.width > 0
    && rect.height > 0
    && Number.isSafeInteger(rect.x + rect.width)
    && Number.isSafeInteger(rect.y + rect.height)
    && Number.isSafeInteger(rect.width * rect.height);
}

export function normalizeRegionRects(rects: readonly GridRect[]): GridRect[] {
  const validRects = rects.filter(isValidRegionGridRect);
  if (validRects.length === 0) {
    return [];
  }

  const yBoundaries = Array.from(new Set(validRects.flatMap((rect) => [
    rect.y,
    rect.y + rect.height,
  ]))).sort((left, right) => left - right);
  const result: GridRect[] = [];
  let activeRects = new Map<string, GridRect>();

  for (let index = 0; index < yBoundaries.length - 1; index += 1) {
    const top = yBoundaries[index];
    const bottom = yBoundaries[index + 1];
    if (top === undefined || bottom === undefined || bottom <= top) {
      continue;
    }

    const intervals = mergeIntervals(validRects.flatMap((rect) => (
      rect.y <= top && rect.y + rect.height >= bottom
        ? [{ start: rect.x, end: rect.x + rect.width }]
        : []
    )));
    const nextActiveRects = new Map<string, GridRect>();

    for (const interval of intervals) {
      const key = `${interval.start}:${interval.end}`;
      const activeRect = activeRects.get(key);
      nextActiveRects.set(key, activeRect === undefined
        ? {
          x: interval.start,
          y: top,
          width: interval.end - interval.start,
          height: bottom - top,
        }
        : {
          ...activeRect,
          height: bottom - activeRect.y,
        });
    }

    for (const [key, activeRect] of activeRects) {
      if (!nextActiveRects.has(key)) {
        result.push(activeRect);
      }
    }

    activeRects = nextActiveRects;
  }

  result.push(...activeRects.values());
  return result.sort(compareGridRects);
}

export function addRegionRect(
  rects: readonly GridRect[],
  rect: GridRect,
): GridRect[] {
  return isValidRegionGridRect(rect)
    ? normalizeRegionRects([...rects, rect])
    : normalizeRegionRects(rects);
}

export function subtractRegionRect(
  rects: readonly GridRect[],
  subtractRect: GridRect,
): GridRect[] {
  if (!isValidRegionGridRect(subtractRect)) {
    return normalizeRegionRects(rects);
  }

  return normalizeRegionRects(normalizeRegionRects(rects).flatMap((rect) => (
    subtractGridRect(rect, subtractRect)
  )));
}

export function resolveRegionGridArea(rects: readonly GridRect[]): number {
  return normalizeRegionRects(rects).reduce(
    (sum, rect) => sum + rect.width * rect.height,
    0,
  );
}

export function resolveRegionGridBounds(rects: readonly GridRect[]): GridRect | null {
  const normalized = normalizeRegionRects(rects);
  if (normalized.length === 0) {
    return null;
  }

  const left = Math.min(...normalized.map((rect) => rect.x));
  const top = Math.min(...normalized.map((rect) => rect.y));
  const right = Math.max(...normalized.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...normalized.map((rect) => rect.y + rect.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function isRegionRectangle(rects: readonly GridRect[]): boolean {
  const bounds = resolveRegionGridBounds(rects);
  return bounds !== null
    && resolveRegionGridArea(rects) === bounds.width * bounds.height;
}

export function resolveRegionShapeSummary(
  rects: readonly GridRect[],
  cellUnit = "格",
): string {
  const bounds = resolveRegionGridBounds(rects);
  if (bounds === null) {
    return `0 ${cellUnit}`;
  }

  return isRegionRectangle(rects)
    ? `${bounds.width} × ${bounds.height} ${cellUnit}`
    : `${resolveRegionGridArea(rects)} ${cellUnit}`;
}

export function resolveGridRectRegionRelation(
  gridRect: GridRect,
  regionRects: readonly GridRect[],
): RegionGridRectRelation {
  if (!isValidRegionGridRect(gridRect)) {
    return "outside";
  }

  const intersectionArea = normalizeRegionRects(regionRects).reduce(
    (sum, regionRect) => sum + resolveGridRectIntersectionArea(gridRect, regionRect),
    0,
  );
  if (intersectionArea === 0) {
    return "outside";
  }

  return intersectionArea === gridRect.width * gridRect.height
    ? "contained"
    : "boundary";
}

export function translateRegionRects(
  rects: readonly GridRect[],
  vector: GridPoint,
): GridRect[] {
  if (!Number.isSafeInteger(vector.x) || !Number.isSafeInteger(vector.y)) {
    return [];
  }

  return normalizeRegionRects(rects.map((rect) => ({
    ...rect,
    x: rect.x + vector.x,
    y: rect.y + vector.y,
  })));
}

export function transformRegionRectsBetweenBounds(options: {
  readonly rects: readonly GridRect[];
  readonly sourceBounds: GridRect;
  readonly targetBounds: GridRect;
  readonly rotation: GridRotation;
}): GridRect[] {
  return normalizeRegionRects(options.rects.map((rect) => {
    const relativeRect = {
      x: rect.x - options.sourceBounds.x,
      y: rect.y - options.sourceBounds.y,
      width: rect.width,
      height: rect.height,
    };
    const transformed = rotateRelativeGridRect(
      relativeRect,
      options.sourceBounds,
      options.rotation,
    );

    return {
      ...transformed,
      x: options.targetBounds.x + transformed.x,
      y: options.targetBounds.y + transformed.y,
    };
  }));
}

export function createRegionOutlineSegments(
  rects: readonly GridRect[],
): RegionOutlineSegment[] {
  const horizontal = new Map<number, Array<{ start: number; end: number; delta: number }>>();
  const vertical = new Map<number, Array<{ start: number; end: number; delta: number }>>();

  for (const rect of normalizeRegionRects(rects)) {
    appendEdge(horizontal, rect.y, rect.x, rect.x + rect.width, 1);
    appendEdge(horizontal, rect.y + rect.height, rect.x, rect.x + rect.width, -1);
    appendEdge(vertical, rect.x, rect.y, rect.y + rect.height, 1);
    appendEdge(vertical, rect.x + rect.width, rect.y, rect.y + rect.height, -1);
  }

  return [
    ...resolveBoundaryIntervals(horizontal).map(({ axis, start, end }) => ({
      x1: start,
      y1: axis,
      x2: end,
      y2: axis,
    })),
    ...resolveBoundaryIntervals(vertical).map(({ axis, start, end }) => ({
      x1: axis,
      y1: start,
      x2: axis,
      y2: end,
    })),
  ];
}

function subtractGridRect(rect: GridRect, subtractRect: GridRect): GridRect[] {
  const left = Math.max(rect.x, subtractRect.x);
  const top = Math.max(rect.y, subtractRect.y);
  const right = Math.min(rect.x + rect.width, subtractRect.x + subtractRect.width);
  const bottom = Math.min(rect.y + rect.height, subtractRect.y + subtractRect.height);
  if (left >= right || top >= bottom) {
    return [rect];
  }

  return [
    { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
    { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
    { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
    { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
  ].filter(isValidRegionGridRect);
}

function resolveGridRectIntersectionArea(left: GridRect, right: GridRect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function mergeIntervals(
  intervals: readonly { readonly start: number; readonly end: number }[],
): Array<{ start: number; end: number }> {
  const sorted = intervals.slice().sort((left, right) => (
    left.start - right.start || left.end - right.end
  ));
  const merged: Array<{ start: number; end: number }> = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || interval.start > previous.end) {
      merged.push({ ...interval });
      continue;
    }

    previous.end = Math.max(previous.end, interval.end);
  }

  return merged;
}

function rotateRelativeGridRect(
  rect: GridRect,
  bounds: Pick<GridRect, "width" | "height">,
  rotation: GridRotation,
): GridRect {
  switch (rotation) {
    case 90:
      return {
        x: bounds.height - rect.y - rect.height,
        y: rect.x,
        width: rect.height,
        height: rect.width,
      };
    case 180:
      return {
        x: bounds.width - rect.x - rect.width,
        y: bounds.height - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return {
        x: rect.y,
        y: bounds.width - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
      };
    case 0:
    default:
      return { ...rect };
  }
}

function appendEdge(
  target: Map<number, Array<{ start: number; end: number; delta: number }>>,
  axis: number,
  start: number,
  end: number,
  delta: number,
): void {
  const entries = target.get(axis) ?? [];
  entries.push({ start, end, delta });
  target.set(axis, entries);
}

function resolveBoundaryIntervals(
  edgeMap: ReadonlyMap<number, readonly { start: number; end: number; delta: number }[]>,
): Array<{ axis: number; start: number; end: number }> {
  const result: Array<{ axis: number; start: number; end: number }> = [];

  for (const [axis, edges] of edgeMap) {
    const boundaries = Array.from(new Set(edges.flatMap((edge) => [edge.start, edge.end])))
      .sort((left, right) => left - right);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (start === undefined || end === undefined || start >= end) {
        continue;
      }

      const sum = edges.reduce((total, edge) => (
        edge.start <= start && edge.end >= end ? total + edge.delta : total
      ), 0);
      if (sum !== 0) {
        result.push({ axis, start, end });
      }
    }
  }

  return result;
}

function compareGridRects(left: GridRect, right: GridRect): number {
  return left.y - right.y
    || left.x - right.x
    || left.height - right.height
    || left.width - right.width;
}
