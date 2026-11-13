import { describe, expect, it } from "vitest";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { SceneAreaDefinition } from "@/domain/shared/scene-space";
import { createRegistryContract } from "@/registry";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { expandSceneBounds, isRectInSceneBounds } from "@/shared/geometry/scene-space";
import { resolveOuterRingEdgeSnap, rotateOuterRingEdgeSnappedPlacement, snapPlacementToOuterRingEdge } from "@/editor/placement-snapping";
import { clampViewportCenterToBaseWarningBounds } from "@/editor/viewport-settings";

const registry = createRegistryContract();
const base = registry.baseDefinitions.find((candidate) => candidate.id === "wuling_protocol_core")!;
const definition = registry.queries.findEntityDefinition("water_pump_1")!;
const noRing = { top: 0, right: 0, bottom: 0, left: 0 };
function withAreas(areas: readonly SceneAreaDefinition[]): BaseDefinition {
  return { ...base, areas };
}

describe("scene space placement and camera boundaries", () => {
  it("preserves finite outer-edge snapping and complete rotated footprints", () => {
    for (const [edge, position] of [
      ["top", { x: 20, y: -9 }], ["right", { x: 88, y: 20 }],
      ["bottom", { x: 20, y: 88 }], ["left", { x: -9, y: 20 }],
    ] as const) {
      const snapped = resolveOuterRingEdgeSnap({ definition, space: base, allowedAreaIds: base.areas.map((area) => area.id), position, rotation: 0 });
      expect(snapped?.edge).toBe(edge);
      const footprint = getRotatedGridFootprint(definition.footprint, snapped!.rotation);
      expect(isRectInSceneBounds(expandSceneBounds(base.areas[0]!.bounds, base.areas[0]!.outerRing), {
        ...snapped!.position, ...footprint,
      })).toBe(true);
    }
    expect(clampViewportCenterToBaseWarningBounds({ baseDefinition: base, center: { x: -1000, y: 1000 } })).toEqual({ x: -12, y: 92 });
  });

  it("allows negative tangential positions on a ray without creating infinite-side corners", () => {
    const halfPlane = withAreas([{
      id: base.id, bounds: { minX: null, maxX: null, minY: 0, maxY: null }, outerRing: { ...noRing, top: 10 },
    }]);
    const snapped = resolveOuterRingEdgeSnap({ definition, space: halfPlane, allowedAreaIds: halfPlane.areas.map((area) => area.id), position: { x: -10000, y: -9 }, rotation: 0 })!;
    expect(snapped.position).toEqual({ x: -10000, y: -10 });
    expect(rotateOuterRingEdgeSnappedPlacement({ definition, space: halfPlane, allowedAreaIds: halfPlane.areas.map((area) => area.id), ...snapped, angle: 90 })).toBeNull();
    expect(clampViewportCenterToBaseWarningBounds({ baseDefinition: halfPlane, center: { x: -10000, y: -10000 } })).toEqual({ x: -10000, y: -12 });
    expect(clampViewportCenterToBaseWarningBounds({ baseDefinition: halfPlane, center: { x: 10000, y: 10000 } })).toEqual({ x: 10000, y: 10000 });
  });

  it("does not snap or clamp a fully unbounded space", () => {
    const unlimited = withAreas([{ id: base.id, bounds: { minX: null, maxX: null, minY: null, maxY: null }, outerRing: noRing }]);
    const position = { x: -300000, y: 200000 };
    expect(resolveOuterRingEdgeSnap({ definition, space: unlimited, allowedAreaIds: unlimited.areas.map((area) => area.id), position, rotation: 270 })).toBeNull();
    expect(snapPlacementToOuterRingEdge({ definition, space: unlimited, allowedAreaIds: unlimited.areas.map((area) => area.id), position, rotation: 270 })).toEqual({ position, rotation: 270 });
    expect(clampViewportCenterToBaseWarningBounds({ baseDefinition: unlimited, center: position })).toEqual(position);
  });

  it("does not snap to a shared outer seam", () => {
    const adjacent = withAreas([
      { id: "left", bounds: { minX: -20, maxX: -10, minY: 0, maxY: 10 }, outerRing: { top: 10, right: 10, bottom: 10, left: 10 } },
      { id: "right", bounds: { minX: 10, maxX: 20, minY: 0, maxY: 10 }, outerRing: { top: 10, right: 10, bottom: 10, left: 10 } },
    ]);
    expect(resolveOuterRingEdgeSnap({ definition, space: adjacent, allowedAreaIds: adjacent.areas.map((area) => area.id), position: { x: -1, y: 5 }, rotation: 0 })).toBeNull();
  });

  it("retains shared outer boundaries for every eligible area identity", () => {
    const overlapping = withAreas([
      { ...base.areas[0]!, id: "excluded" }, { ...base.areas[0]!, id: "allowed" },
    ]);
    const restricted = { ...definition, placementWhitelist: [{ baseId: base.id, areaIds: ["allowed"] }] };
    expect(resolveOuterRingEdgeSnap({ definition: restricted, space: overlapping, allowedAreaIds: ["allowed"], position: { x: 20, y: -9 }, rotation: 0 })?.edge).toBe("top");
  });
});
