import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";

function createEntity(options: {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  rotation: WorldEntity["rotation"];
}): WorldEntity {
  return {
    id: options.id,
    definitionId: options.definitionId,
    position: { x: options.x, y: options.y },
    rotation: options.rotation,
    config: {},
    tags: [],
  };
}

function createDefinition(
  id: string,
  footprint: EntityDefinition["footprint"],
): EntityDefinition {
  return {
    id,
    footprint,
  } as EntityDefinition;
}

describe("resolveEntityGridGeometry", () => {
  it("uses rotated device footprints instead of anchor-point spans", () => {
    const entities = [
      createEntity({
        id: "first",
        definitionId: "wide",
        x: 2,
        y: 3,
        rotation: 0,
      }),
      createEntity({
        id: "second",
        definitionId: "tall-after-rotation",
        x: 7,
        y: 6,
        rotation: 90,
      }),
    ];
    const entityDefinitionMap = new Map<string, EntityDefinition>([
      ["wide", createDefinition("wide", { width: 3, height: 2 })],
      ["tall-after-rotation", createDefinition("tall-after-rotation", { width: 4, height: 2 })],
    ]);

    expect(resolveEntityGridGeometry({ entities, entityDefinitionMap })?.boundingBox).toEqual({
      left: 2,
      top: 3,
      width: 7,
      height: 7,
    });
  });

  it("ignores entities whose definitions are unavailable", () => {
    const knownEntity = createEntity({
      id: "known",
      definitionId: "known-definition",
      x: 4,
      y: 5,
      rotation: 0,
    });
    const unknownEntity = createEntity({
      id: "unknown",
      definitionId: "missing-definition",
      x: 100,
      y: 100,
      rotation: 0,
    });
    const entityDefinitionMap = new Map<string, EntityDefinition>([
      ["known-definition", createDefinition("known-definition", { width: 2, height: 3 })],
    ]);

    const geometry = resolveEntityGridGeometry({
      entities: [knownEntity, unknownEntity],
      entityDefinitionMap,
    });

    expect(geometry?.entries.map(({ entity }) => entity.id)).toEqual(["known"]);
    expect(geometry?.boundingBox).toEqual({
      left: 4,
      top: 5,
      width: 2,
      height: 3,
    });
  });

  it("returns null when no entity has a registered definition", () => {
    const entity = createEntity({
      id: "unknown",
      definitionId: "missing-definition",
      x: 1,
      y: 2,
      rotation: 0,
    });

    expect(resolveEntityGridGeometry({
      entities: [entity],
      entityDefinitionMap: new Map(),
    })).toBeNull();
  });
});
