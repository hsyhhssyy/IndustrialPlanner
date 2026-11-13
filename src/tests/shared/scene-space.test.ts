import { describe, expect, it } from "vitest";
import type { SceneBounds, SceneSpace } from "@/domain/shared/scene-space";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import {
  clipSceneBoundarySegment, clipSceneBounds, expandSceneBounds, isPointInSceneBounds,
  isRectInSceneBounds, resolveSceneBoundarySegments, unionSceneBounds, validateSceneSpace,
} from "@/shared/geometry/scene-space";
import { resolveBaseAreaContainingRect } from "@/shared/geometry/base-areas";

const noRing = { top: 0, right: 0, bottom: 0, left: 0 };
const unbounded: SceneBounds = { minX: null, maxX: null, minY: null, maxY: null };
const viewport = { x: -30, y: -40, width: 80, height: 100 };

describe("scene space", () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))("checks all finite/unbounded combinations: %i", (mask) => {
    const bounds: SceneBounds = {
      minX: mask & 1 ? -10 : null, maxX: mask & 2 ? 20 : null,
      minY: mask & 4 ? -15 : null, maxY: mask & 8 ? 25 : null,
    };
    const outerRing = { left: mask & 1 ? 2 : 0, right: mask & 2 ? 3 : 0, top: mask & 4 ? 4 : 0, bottom: mask & 8 ? 5 : 0 };
    const space: SceneSpace = { areas: [{ id: "area", bounds, outerRing }] };
    expect(() => validateSceneSpace(space)).not.toThrow();
    const outer = expandSceneBounds(bounds, outerRing);
    expect(outer).toEqual({
      minX: mask & 1 ? -12 : null, maxX: mask & 2 ? 23 : null,
      minY: mask & 4 ? -19 : null, maxY: mask & 8 ? 30 : null,
    });
    for (const rotation of [0, 90, 180, 270] as const) {
      const footprint = getRotatedGridFootprint({ width: 3, height: 5 }, rotation);
      expect(isRectInSceneBounds(bounds, { x: -10, y: -15, ...footprint })).toBe(true);
      expect(isRectInSceneBounds(bounds, { x: 20 - footprint.width, y: 25 - footprint.height, ...footprint })).toBe(true);
      expect(isRectInSceneBounds(bounds, { x: -11, y: 0, ...footprint })).toBe(!(mask & 1));
      expect(isRectInSceneBounds(bounds, { x: 21 - footprint.width, y: 0, ...footprint })).toBe(!(mask & 2));
      expect(isRectInSceneBounds(bounds, { x: 0, y: -16, ...footprint })).toBe(!(mask & 4));
      expect(isRectInSceneBounds(bounds, { x: 0, y: 26 - footprint.height, ...footprint })).toBe(!(mask & 8));
    }
    expect(isPointInSceneBounds(bounds, { x: 20, y: 0 })).toBe(!(mask & 2));
    expect(isPointInSceneBounds(bounds, { x: 0, y: 25 })).toBe(!(mask & 8));
    const clipped = clipSceneBounds(bounds, viewport)!;
    expect(clipped).toEqual({
      x: mask & 1 ? -10 : -30, y: mask & 4 ? -15 : -40,
      width: (mask & 2 ? 20 : 50) - (mask & 1 ? -10 : -30),
      height: (mask & 8 ? 25 : 60) - (mask & 4 ? -15 : -40),
    });
    const segments = resolveSceneBoundarySegments(space.areas);
    expect(segments).toHaveLength([1, 2, 4, 8].filter((bit) => mask & bit).length);
    for (const segment of segments) {
      const line = clipSceneBoundarySegment(segment, viewport)!;
      expect(Object.values(line.from).every(Number.isFinite)).toBe(true);
      expect(Object.values(line.to).every(Number.isFinite)).toBe(true);
    }
  });

  it("distinguishes no area from unbounded space and rejects non-finite entity geometry", () => {
    const rect = { x: -1_000_000, y: 1_000_000, width: 5, height: 8 };
    expect(resolveBaseAreaContainingRect({ areas: [] }, rect, "placeable")).toBeNull();
    expect(resolveBaseAreaContainingRect({ areas: [{ id: "all", bounds: unbounded, outerRing: noRing }] }, rect, "placeable")?.id).toBe("all");
    expect(unionSceneBounds([])).toBeNull();
    expect(unionSceneBounds([unbounded, { minX: 0, maxX: 10, minY: 0, maxY: 10 }])).toEqual(unbounded);
    expect(isRectInSceneBounds(unbounded, { ...rect, x: Infinity })).toBe(false);
    expect(isRectInSceneBounds(unbounded, { ...rect, width: 0 })).toBe(false);
    expect(isPointInSceneBounds(unbounded, { x: NaN, y: 0 })).toBe(false);
    expect(clipSceneBounds(unbounded, { ...viewport, width: Infinity })).toBeNull();
  });

  it("removes touching seams while keeping per-area complete footprint requirements", () => {
    const areas = [
      { id: "left", bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, outerRing: noRing },
      { id: "right", bounds: { minX: 10, maxX: 20, minY: 0, maxY: 10 }, outerRing: noRing },
    ];
    const segments = resolveSceneBoundarySegments(areas);
    expect(segments.some((segment) => segment.coordinate === 10 && ["left", "right"].includes(segment.side))).toBe(false);
    expect(resolveBaseAreaContainingRect({ areas }, { x: 9, y: 3, width: 2, height: 2 }, "placeable")).toBeNull();
    expect(resolveSceneBoundarySegments([areas[0]!, { ...areas[0]!, id: "duplicate" }])).toHaveLength(4);
    expect(resolveSceneBoundarySegments([areas[0]!, { id: "all", bounds: unbounded }])).toEqual([]);
  });

  it("splits partially covered finite edges and preserves unbounded rays", () => {
    const segments = resolveSceneBoundarySegments([
      { id: "plane", bounds: { minX: null, maxX: null, minY: 0, maxY: null } },
      { id: "bridge", bounds: { minX: 2, maxX: 5, minY: -3, maxY: 3 } },
    ]);
    expect(segments.filter((segment) => segment.areaId === "plane")).toEqual([
      { areaId: "plane", side: "top", coordinate: 0, start: null, end: 2 },
      { areaId: "plane", side: "top", coordinate: 0, start: 5, end: null },
    ]);
    expect(clipSceneBoundarySegment({ areaId: "a", side: "left", coordinate: -100, start: null, end: null }, viewport)).toBeNull();
    expect(clipSceneBoundarySegment({ areaId: "a", side: "top", coordinate: 0, start: null, end: null }, viewport)).toEqual({ from: { x: -30, y: 0 }, to: { x: 50, y: 0 } });
  });

  it("rejects invalid configuration at registration instead of inventing boundaries", () => {
    const area = { id: "valid", bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, outerRing: noRing };
    for (const bounds of [
      { ...area.bounds, minX: Infinity }, { ...area.bounds, maxY: 0 },
      { ...area.bounds, minY: 0.5 }, { ...area.bounds, maxX: NaN },
    ]) expect(() => validateSceneSpace({ areas: [{ ...area, bounds }] })).toThrow();
    expect(() => validateSceneSpace({ areas: [area, area] })).toThrow();
    expect(() => validateSceneSpace({ areas: [{ ...area, bounds: unbounded, outerRing: { ...noRing, top: 1 } }] })).toThrow();
    expect(() => validateSceneSpace({ areas: [{ ...area, outerRing: { ...noRing, left: -1 } }] })).toThrow();
    expect(() => validateSceneSpace({ areas: [{ ...area, bounds: { ...area.bounds, maxX: Number.MAX_SAFE_INTEGER }, outerRing: { ...noRing, right: 1 } }] })).toThrow();
  });
});
