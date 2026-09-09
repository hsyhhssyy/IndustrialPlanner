import { describe, expect, it } from "vitest";

import {
  addRegionRect,
  createRegionOutlineSegments,
  normalizeRegionRects,
  resolveGridRectRegionRelation,
  resolveRegionGridArea,
  resolveRegionShapeSummary,
  subtractRegionRect,
  transformRegionRectsBetweenBounds,
} from "@/shared/geometry/region-rects";

describe("region rect geometry", () => {
  it("normalizes overlapping additions into non-overlapping stable rectangles", () => {
    const rects = addRegionRect(
      [{ x: 0, y: 0, width: 3, height: 2 }],
      { x: 2, y: 1, width: 3, height: 2 },
    );

    expect(rects).toEqual([
      { x: 0, y: 0, width: 3, height: 1 },
      { x: 0, y: 1, width: 5, height: 1 },
      { x: 2, y: 2, width: 3, height: 1 },
    ]);
    expect(resolveRegionGridArea(rects)).toBe(11);
    expect(normalizeRegionRects([...rects, ...rects])).toEqual(rects);
  });

  it("preserves holes and disconnected components after subtraction", () => {
    const withHole = subtractRegionRect(
      [{ x: 0, y: 0, width: 5, height: 5 }],
      { x: 1, y: 1, width: 3, height: 3 },
    );
    const disconnected = subtractRegionRect(
      [{ x: 0, y: 0, width: 7, height: 2 }],
      { x: 2, y: 0, width: 3, height: 2 },
    );

    expect(resolveRegionGridArea(withHole)).toBe(16);
    expect(resolveRegionShapeSummary(withHole)).toBe("16 格");
    expect(resolveGridRectRegionRelation(
      { x: 2, y: 2, width: 1, height: 1 },
      withHole,
    )).toBe("outside");
    expect(disconnected).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 5, y: 0, width: 2, height: 2 },
    ]);
  });

  it("distinguishes contained, boundary and outside device footprints", () => {
    const region = [
      { x: 0, y: 0, width: 4, height: 1 },
      { x: 0, y: 1, width: 1, height: 3 },
    ];

    expect(resolveGridRectRegionRelation(
      { x: 0, y: 0, width: 1, height: 4 },
      region,
    )).toBe("contained");
    expect(resolveGridRectRegionRelation(
      { x: 0, y: 0, width: 2, height: 2 },
      region,
    )).toBe("boundary");
    expect(resolveGridRectRegionRelation(
      { x: 5, y: 5, width: 1, height: 1 },
      region,
    )).toBe("outside");
  });

  it("rotates the complete region around the same source and target bounds", () => {
    const transformed = transformRegionRectsBetweenBounds({
      rects: [
        { x: 10, y: 20, width: 2, height: 1 },
        { x: 10, y: 21, width: 1, height: 2 },
      ],
      sourceBounds: { x: 10, y: 20, width: 3, height: 3 },
      targetBounds: { x: 30, y: 40, width: 3, height: 3 },
      rotation: 90,
    });

    expect(transformed).toEqual([
      { x: 30, y: 40, width: 3, height: 1 },
      { x: 32, y: 41, width: 1, height: 1 },
    ]);
    expect(resolveRegionGridArea(transformed)).toBe(4);
  });

  it("removes shared edges while retaining hole boundaries", () => {
    const ring = subtractRegionRect(
      [{ x: 0, y: 0, width: 3, height: 3 }],
      { x: 1, y: 1, width: 1, height: 1 },
    );
    const segments = createRegionOutlineSegments(ring);
    const totalLength = segments.reduce(
      (sum, segment) => sum + Math.abs(segment.x2 - segment.x1) + Math.abs(segment.y2 - segment.y1),
      0,
    );

    expect(totalLength).toBe(16);
  });
});
