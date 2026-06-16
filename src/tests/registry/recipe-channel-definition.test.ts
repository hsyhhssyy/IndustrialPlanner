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

  it("declares water pump fluid buffer as both ingredient and product", () => {
    // AI-CORRECTION 2026-06-15: 抽水泵已改为 warehouse link 模式，不再有 recipe channel。
    // recipeChannels 为空，流体通过 warehouseItemLink 从仓库获取。
    const registry = createRegistryContract();
    expect(
      registry.entityDefinitions.find((candidate) => candidate.id === "item_port_water_pump_1")
        ?.recipeChannels,
    ).toEqual([]);
  });
});
