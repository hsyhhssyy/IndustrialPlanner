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
