import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";

function requireEntity(id: string) {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${id}`);
  }
  return definition;
}

describe("resource device power definitions", () => {
  it("仅供电桩将 idle 展示为 running", () => {
    expect(requireEntity("power_diffuser_1").isIdleAsRunning).toBe(true);
    expect(ENTITY_DEFINITIONS
      .filter((definition) => definition.isIdleAsRunning === true)
      .map((definition) => definition.id))
      .toEqual(["power_diffuser_1"]);
  });

  it.each([
    ["dumper_1", 10],
    ["miner_2", 5],
    ["miner_3", 10],
  ] as const)("keeps %s aligned with unpacked power demand", (entityId, powerDemand) => {
    expect(requireEntity(entityId)).toMatchObject({
      requiresPower: true,
      powerDemand,
    });
  });
});
