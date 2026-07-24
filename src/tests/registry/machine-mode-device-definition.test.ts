import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";

function requireEntity(id: string) {
  const definition = ENTITY_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Missing entity definition: ${id}`);
  }
  return definition;
}

describe("machine-mode entity definitions", () => {
  it("uses derived ids instead of unpublished building-only ids", () => {
    const entityIds = new Set(ENTITY_DEFINITIONS.map((definition) => definition.id));

    expect(entityIds).not.toContain("transmuter_1");
    expect(entityIds).not.toContain("transmuter_2");
    expect(entityIds).not.toContain("liquid_purifier_1_vari_gas");
    expect([...entityIds]).toEqual(expect.arrayContaining([
      "transmuter_1_gastrans",
      "transmuter_1_liquidtrans",
      "transmuter_2_gastrans",
      "transmuter_2_solidtrans",
      "liquid_purifier_1_gas",
    ]));
  });

  it("keeps each transmuter mode limited to its unpacked craft-group flow", () => {
    expectModeFlow("transmuter_1_gastrans", {
      portGroupIds: ["liquid_input", "gas_output", "consume_input"],
      ingredientStorageGroupIds: ["liquid_input_buffer"],
      productStorageGroupIds: ["gas_output_buffer"],
      variantGroupTag: "alter:transmuter_1",
    });
    expectModeFlow("transmuter_1_liquidtrans", {
      portGroupIds: ["gas_input", "liquid_output", "consume_input"],
      ingredientStorageGroupIds: ["gas_input_buffer"],
      productStorageGroupIds: ["liquid_output_buffer"],
      variantGroupTag: "alter:transmuter_1",
    });
    expectModeFlow("transmuter_2_gastrans", {
      portGroupIds: ["item_input", "gas_output", "consume_input"],
      ingredientStorageGroupIds: ["item_input_buffer"],
      productStorageGroupIds: ["gas_output_buffer"],
      variantGroupTag: "alter:transmuter_2",
    });
    expectModeFlow("transmuter_2_solidtrans", {
      portGroupIds: ["gas_input", "item_output", "consume_input"],
      ingredientStorageGroupIds: ["gas_input_buffer"],
      productStorageGroupIds: ["item_output_buffer"],
      variantGroupTag: "alter:transmuter_2",
    });

    for (const entityId of ["transmuter_1_gastrans", "transmuter_1_liquidtrans"] as const) {
      const definition = requireEntity(entityId);
      expect(definition.portGroups.find((group) => group.id === "consume_input")?.ports)
        .toMatchObject([{
          acceptRule: {
            base: { kind: "item", itemId: "item_liquid_xiranite" },
            exclude: [],
          },
        }]);
    }
    for (const entityId of ["transmuter_2_gastrans", "transmuter_2_solidtrans"] as const) {
      const definition = requireEntity(entityId);
      expect(definition.portGroups.find((group) => group.id === "consume_input")?.ports)
        .toMatchObject([{
          acceptRule: {
            base: { kind: "item", itemId: "item_gas_xiranite" },
            exclude: [],
          },
        }]);
    }

    for (const entityId of [
      "transmuter_1_gastrans",
      "transmuter_1_liquidtrans",
      "transmuter_2_gastrans",
      "transmuter_2_solidtrans",
    ] as const) {
      const definition = requireEntity(entityId);
      expect(definition.storageSlotGroups.find((group) => group.id === "consume_buffer"))
        .toMatchObject({
          slots: [{ id: "consume_slot", capacity: 5, itemFilter: "whitelist" }],
        });
      expect(definition.portStorageBindings.some((binding) => binding.portGroupId === "consume_input"))
        .toBe(true);
      expect(definition.recipeChannels.filter((channel) => channel.type === "consumption-channel"))
        .toHaveLength(5);
      expect(definition.inspectors).toContainEqual({
        type: INSPECTOR_TYPE.meteredConsumption,
      });
    }
  });

  it("uses a hidden real capacity-five input buffer and five consumption channels for vaporizer", () => {
    const definition = requireEntity("vaporizer_1");

    expect(definition.storageSlotGroups).toMatchObject([{
      id: "consume_buffer",
      slots: [{
        id: "consume_slot",
        capacity: 5,
        itemFilter: "whitelist",
        itemFilterIds: [
          "item_gas_acid",
          "item_gas_inert",
          "item_gas_water",
          "item_gas_xiranite",
        ],
      }],
    }]);
    expect(definition.portStorageBindings).toContainEqual({
      id: "bind_gas_input",
      portGroupId: "gas_input",
      storageSlotGroupId: "consume_buffer",
    });
    expect(definition.recipeChannels.filter((channel) => channel.type === "consumption-channel"))
      .toHaveLength(5);
    expect(definition.inspectors).toContainEqual({
      type: INSPECTOR_TYPE.slotConfig,
      slotGroupIds: [],
    });
    expect(definition.inspectors).toContainEqual({
      type: INSPECTOR_TYPE.meteredConsumption,
    });
  });

  it("includes the water-driven miner's unpacked per-round water consumption", () => {
    expect(RECIPE_DEFINITIONS.find((recipe) => recipe.id === "r_miner_copper_ore_basic"))
      .toMatchObject({
        durationSeconds: 3,
        // 水驱矿机采矿配方刻意不消耗水，防止产线规划中错误地将采矿用水计入水消耗统计
        inputs: [],
        outputs: [{ itemId: "item_copper_ore", amount: 1 }],
        machineId: "miner_4",
      });
  });

  it("defines the gas purifier as the gas mode of the existing purifier", () => {
    const definition = requireEntity("liquid_purifier_1_gas");
    const gasInput = definition.portGroups.find((portGroup) => portGroup.id === "gas_input");
    const gasOutput = definition.portGroups.find((portGroup) => portGroup.id === "gas_output");

    expect(definition.tags).toContain("alter:liquid_purifier_1");
    expect(gasInput?.ports.map((port) => port.id)).toEqual(["in_e_2"]);
    expect(gasOutput?.ports.map((port) => port.id)).toEqual(["out_w_1", "out_w_3"]);
    expect(gasInput?.ports.every((port) => port.acceptRule.base.kind === "gas")).toBe(true);
    expect(gasOutput?.ports.every((port) => port.acceptRule.base.kind === "gas")).toBe(true);
  });

  it("routes every affected recipe to its derived machine-mode id", () => {
    const expectedMachineIdByRecipePrefix = [
      ["liquid_transmuter_1_gas_", "transmuter_1_gastrans"],
      ["liquid_transmuter_1_liquid_", "transmuter_1_liquidtrans"],
      ["liquid_transmuter_2_gas_", "transmuter_2_gastrans"],
      ["liquid_transmuter_2_solid_", "transmuter_2_solidtrans"],
      ["liquid_purifier_gas_", "liquid_purifier_1_gas"],
    ] as const;

    for (const [recipePrefix, expectedMachineId] of expectedMachineIdByRecipePrefix) {
      const recipes = RECIPE_DEFINITIONS.filter((recipe) => recipe.id.startsWith(recipePrefix));
      expect(recipes.length).toBeGreaterThan(0);
      expect(new Set(recipes.map((recipe) => recipe.machineId))).toEqual(
        new Set([expectedMachineId]),
      );
    }
  });
});

function expectModeFlow(
  entityId: string,
  expected: {
    readonly portGroupIds: readonly string[];
    readonly ingredientStorageGroupIds: readonly string[];
    readonly productStorageGroupIds: readonly string[];
    readonly variantGroupTag: string;
  },
): void {
  const definition = requireEntity(entityId);

  expect(definition.portGroups.map((portGroup) => portGroup.id)).toEqual(expected.portGroupIds);
  expect(definition.recipeChannels).toHaveLength(6);
  expect(definition.recipeChannels.find((channel) => channel.type === "normal-channel"))
    .toMatchObject({
    ingredientStorageGroupIds: expected.ingredientStorageGroupIds,
    productStorageGroupIds: expected.productStorageGroupIds,
  });
  expect(definition.tags).toContain(expected.variantGroupTag);
}
