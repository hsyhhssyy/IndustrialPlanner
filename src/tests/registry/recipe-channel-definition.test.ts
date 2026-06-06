import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";

function getDefaultChannel(entityId: string) {
  const registry = createRegistryContract();
  const entity = registry.entityDefinitions.find((candidate) => candidate.id === entityId);
  const channel = entity?.recipeChannels.find((candidate) => candidate.id === "default");

  if (entity === undefined || channel === undefined) {
    throw new Error(`Missing default channel for ${entityId}`);
  }

  return channel;
}

describe("recipe channel definitions", () => {
  it("declares grinder input and output buffers explicitly", () => {
    expect(getDefaultChannel("item_port_grinder_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares filling machine input and output buffers explicitly", () => {
    expect(getDefaultChannel("item_port_filling_pd_mc_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares liquid filling machine input and output buffers explicitly", () => {
    expect(getDefaultChannel("item_port_liquid_filling_pd_mc_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer", "fluid_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });
});
