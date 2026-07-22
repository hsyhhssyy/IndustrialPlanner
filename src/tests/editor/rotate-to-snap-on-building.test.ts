import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createRegistryContract } from "@/registry";
import {
  type BuildingShapeEntry,
  isEntitySnappedToBuildingShape,
} from "@/editor/rotate-to-snap-on-building";

describe("RotateToSnapOnBuilding geometry", () => {
  const registry = createRegistryContract();
  const loaderDefinition = requireDefinition("loader_1");
  const sourceDefinition = requireDefinition("log_hongs_bus_source");

  it("accepts one full grid edge on an irregular or disconnected target union", () => {
    const targetEntries = [
      target("left-top", 0, 0),
      target("left-bottom", 0, 4),
      target("right-island", 20, 8),
    ];

    expect(isSnapped(entity("loader", "loader_1", 20, 7, 0), targetEntries)).toBe(true);
  });

  it("counts a sealed hole wall as target boundary when the device fits inside", () => {
    const ring = [
      target("top-left", 0, 0),
      target("top-middle", 4, 0),
      target("top-right", 8, 0),
      target("middle-left", 0, 4),
      target("middle-right", 8, 4),
      target("bottom-left", 0, 8),
      target("bottom-middle", 4, 8),
      target("bottom-right", 8, 8),
    ];

    expect(isSnapped(entity("loader", "loader_1", 4, 4, 180), ring)).toBe(true);
  });

  it("rejects a hole-wall candidate whose footprint overlaps the target union", () => {
    const ring = [
      target("top-left", 0, 0),
      target("top-middle", 4, 0),
      target("middle-left", 0, 4),
      target("middle-right", 8, 4),
    ];

    expect(isSnapped(entity("loader", "loader_1", 3, 4, 180), ring)).toBe(false);
  });

  it("does not count corner-only contact as one grid of boundary contact", () => {
    const targetEntries = [target("source", 0, 0)];

    expect(isSnapped(entity("loader", "loader_1", 4, -1, 0), targetEntries)).toBe(false);
  });

  function isSnapped(
    candidate: WorldEntity,
    targetEntries: readonly BuildingShapeEntry[],
  ): boolean {
    return isEntitySnappedToBuildingShape({
      entity: candidate,
      definition: loaderDefinition,
      targetEntries,
    });
  }

  function target(id: string, x: number, y: number): BuildingShapeEntry {
    return {
      entity: entity(id, sourceDefinition.id, x, y, 0),
      definition: sourceDefinition,
    };
  }

  function requireDefinition(id: string): EntityDefinition {
    const definition = registry.entityDefinitions.find((candidate) => candidate.id === id);
    if (definition === undefined) {
      throw new Error(`Missing entity definition: ${id}`);
    }
    return definition;
  }
});

function entity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"],
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation,
    config: {},
    tags: [],
  };
}
