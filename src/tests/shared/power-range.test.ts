import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  areGridRectsIntersecting,
  resolveEntityGridRect,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

describe("power range geometry", () => {
  it("centers a 12x12 power range around a 2x2 power pole", () => {
    expect(resolvePowerRangeGridRect({
      entity: createEntity({
        id: "pole",
        definitionId: "item_port_power_diffuser_1",
        position: { x: 10, y: 20 },
      }),
      definition: createDefinition({
        id: "item_port_power_diffuser_1",
        footprint: { width: 2, height: 2 },
        powerRange: 12,
      }),
    })).toEqual({
      x: 5,
      y: 15,
      width: 12,
      height: 12,
    });
  });

  it("uses rotated footprints when resolving entity occupancy", () => {
    expect(resolveEntityGridRect({
      entity: createEntity({
        id: "device",
        definitionId: "item_port_unloader_1",
        position: { x: 3, y: 4 },
        rotation: 90,
      }),
      definition: createDefinition({
        id: "item_port_unloader_1",
        footprint: { width: 3, height: 2 },
      }),
    })).toEqual({
      x: 3,
      y: 4,
      width: 2,
      height: 3,
    });
  });

  it("treats touching edges as outside and occupied overlap as inside", () => {
    expect(areGridRectsIntersecting(
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 2, y: 0, width: 2, height: 2 },
    )).toBe(false);
    expect(areGridRectsIntersecting(
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 1, y: 1, width: 2, height: 2 },
    )).toBe(true);
  });
});

function createEntity(options: {
  id: string;
  definitionId: string;
  position: WorldEntity["position"];
  rotation?: WorldEntity["rotation"];
}): WorldEntity {
  return {
    id: options.id,
    definitionId: options.definitionId,
    position: options.position,
    rotation: options.rotation ?? 0,
    config: {},
    tags: [],
  };
}

function createDefinition(options: {
  id: string;
  footprint: EntityDefinition["footprint"];
  powerRange?: number;
}): EntityDefinition {
  return {
    id: options.id,
    nameKey: `${options.id}.name`,
    spriteId: options.id,
    footprint: options.footprint,
    uiGroup: "resourcePower",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    powerRange: options.powerRange,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
    links: [],
  };
}
