import { describe, expect, it } from "vitest";

import { PLACEMENT_BEHAVIOR_TYPE } from "@/domain/registry/types/entity-placement-behavior";
import { createRegistryContract } from "@/registry";
import { WATER_PURIFIER_NODE_ENTITY_ID } from "@/shared/water-purifier-node";

describe("placement behavior definitions", () => {
  it("declares outer-ring edge snapping on water edge devices", () => {
    const registry = createRegistryContract();
    const behavior = { type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge };

    expect(
      registry.entityDefinitions.find((candidate) => candidate.id === "item_port_water_pump_1")
        ?.placementBehaviors,
    ).toEqual(expect.arrayContaining([behavior]));
    expect(
      registry.entityDefinitions.find((candidate) => candidate.id === WATER_PURIFIER_NODE_ENTITY_ID)
        ?.placementBehaviors,
    ).toEqual(expect.arrayContaining([behavior]));
  });
});
