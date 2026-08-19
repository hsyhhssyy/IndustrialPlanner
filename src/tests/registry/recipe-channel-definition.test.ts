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
    expect(getDefaultChannel("grinder_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares filling machine input and output buffers explicitly", () => {
    expect(getDefaultChannel("filling_pd_mc_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares liquid filling machine input and output buffers explicitly", () => {
    expect(getDefaultChannel("liquid_filling_pd_mc_1")).toMatchObject({
      ingredientStorageGroupIds: ["item_input_buffer", "fluid_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
    });
  });

  it("declares water pump fluid buffer as the product of one manual channel", () => {
    // AI-CORRECTION 2026-06-15: 抽水泵已改为 warehouse link 模式，不再有 recipe channel。
    // recipeChannels 为空，流体通过 warehouseItemLink 从仓库获取。
    // AI-CORRECTION 2026-08-19: 上述仓库代理模式已退出，抽水泵重新使用真实生产 channel，且必须手动选择配方。
    // AI-REMOVED 2026-08-19:
    // Reason: 抽水泵不再以空 recipeChannels 表示仓库代理。
    // Trigger: 新版泵改为真实生产。
    // Evidence: water_pump_1.default 绑定 fluid_output_buffer，manualRecipeOnly=true。
    // Replacement: 下方 getDefaultChannel 断言。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const registry = createRegistryContract();
    // expect(
    //   registry.entityDefinitions.find((candidate) => candidate.id === "water_pump_1")
    //     ?.recipeChannels,
    // ).toEqual([]);
    expect(getDefaultChannel("water_pump_1")).toMatchObject({
      ingredientStorageGroupIds: [],
      productStorageGroupIds: ["fluid_output_buffer"],
      manualRecipeOnly: true,
    });
  });

  it("declares gas pump buffer as the product of one manual channel", () => {
    expect(getDefaultChannel("gas_pump_1")).toMatchObject({
      ingredientStorageGroupIds: [],
      productStorageGroupIds: ["gas_output_buffer"],
      manualRecipeOnly: true,
    });
  });

  it.each(["gas_pump_1", "water_pump_1"])(
    "%s does not expose or place warehouse item links",
    (definitionId) => {
      const registry = createRegistryContract();
      const definition = registry.entityDefinitions.find((candidate) =>
        candidate.id === definitionId,
      );

      expect(definition?.inspectors.some(
        (inspector) => inspector.type === "warehouse-item-link",
      )).toBe(false);
      expect(definition?.inspectors.some(
        (inspector) => inspector.type === "recipe-status",
      )).toBe(true);
      expect(definition?.placementDefaults).toBeUndefined();
    },
  );
});
