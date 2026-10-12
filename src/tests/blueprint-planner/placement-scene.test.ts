// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createPlannerPlacementRegistry } from "@/scripts/eda/placement-scene";
import { resolveBaseAreas } from "@/shared/geometry/base-areas";
import { resolveEntityPlacementAreas } from "@/shared/entity-placement-whitelist";

describe("planner placement registry", () => {
  it("isolates template geometry while retaining the real map and all area identities", () => {
    const registry = createRegistryContract();
    const source = registry.baseDefinitions.find(base => base.id === "wuling_agricultural_land")!;
    const before = structuredClone(registry.baseDefinitions);
    const projected = createPlannerPlacementRegistry(registry, source.id, { width: 1000, height: 1000 });
    const projectedBase = projected.baseDefinitions.find(base => base.id === source.id)!;
    const areas = resolveBaseAreas(projectedBase);

    expect(projected).not.toBe(registry);
    expect(registry.baseDefinitions).toEqual(before);
    expect(projected.entityDefinitions).toBe(registry.entityDefinitions);
    expect(projected.baseDefinitions.map(base => base.id)).toEqual(registry.baseDefinitions.map(base => base.id));
    expect(areas.map(area => area.id)).toEqual(resolveBaseAreas(source).map(area => area.id));
    expect(projectedBase.builtinEntities).toEqual([]);
    expect(areas.every(area => area.placeableRect.width === 1000 && area.placeableRect.height === 1000)).toBe(true);
    const childId = source.subAreas![0]!.id;
    expect(resolveEntityPlacementAreas({ placementWhitelist: [{ baseId: source.id, areaIds: [childId] }] }, projectedBase, areas)
      .map(area => area.id)).toEqual([childId]);
  });

  it("cannot grant a region device access to a disallowed source map by enlarging its geometry", () => {
    const registry = createRegistryContract();
    const projected = createPlannerPlacementRegistry(registry, "valley4_protocol_core", { width: 1000, height: 1000 });
    const base = projected.baseDefinitions.find(base => base.id === "valley4_protocol_core")!;
    const areas = resolveBaseAreas(base);
    expect(resolveEntityPlacementAreas(registry.queries.findEntityDefinition("pipe_straight_1x1")!, base, areas)).toEqual([]);
    expect(resolveEntityPlacementAreas(registry.queries.findEntityDefinition("grinder_1")!, base, areas)).toEqual(areas);
  });

  it("rejects unregistered map identities", () => {
    expect(() => createPlannerPlacementRegistry(createRegistryContract(), "unregistered-validation-land", { width: 1000, height: 1000 }))
      .toThrow("Unknown planner placement base: unregistered-validation-land");
  });
});
