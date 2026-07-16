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
      expect(requireEntity(entityId).meteredConsumption).toEqual({
        inputPortGroupId: "consume_input",
        itemIds: ["item_liquid_water"],
        windowSeconds: 60,
        startThreshold: 6,
        acceptanceLimit: 30,
        gasDiffusionRange: null,
      });
    }
    for (const entityId of ["transmuter_2_gastrans", "transmuter_2_solidtrans"] as const) {
      expect(requireEntity(entityId).meteredConsumption).toEqual({
        inputPortGroupId: "consume_input",
        itemIds: ["item_gas_inert"],
        windowSeconds: 60,
        startThreshold: 6,
        acceptanceLimit: 30,
        gasDiffusionRange: null,
      });
    }

    for (const entityId of [
      "transmuter_1_gastrans",
      "transmuter_1_liquidtrans",
      "transmuter_2_gastrans",
      "transmuter_2_solidtrans",
    ] as const) {
      const definition = requireEntity(entityId);
      expect(definition.storageSlotGroups.some((group) => group.id === "consume_buffer")).toBe(false);
      expect(definition.portStorageBindings.some((binding) => binding.portGroupId === "consume_input"))
        .toBe(false);
      expect(definition.inspectors).toContainEqual({
        type: INSPECTOR_TYPE.meteredConsumption,
      });
    }
  });

  it("keeps vaporizer metered input internal instead of exposing a configurable storage slot", () => {
    const definition = requireEntity("vaporizer_1");

    expect(definition.storageSlotGroups).toEqual([]);
    expect(definition.portStorageBindings).toEqual([]);
    expect(definition.inspectors.some((inspector) => inspector.type === INSPECTOR_TYPE.slotConfig)).toBe(false);
    expect(definition.inspectors).toContainEqual({
      type: INSPECTOR_TYPE.meteredConsumption,
    });
  });

  it("defines the gas purifier as the gas mode of the existing purifier", () => {
    const definition = requireEntity("liquid_purifier_1_gas");
    const gasInput = definition.portGroups.find((portGroup) => portGroup.id === "gas_input");
    const gasOutput = definition.portGroups.find((portGroup) => portGroup.id === "gas_output");

    expect(definition.tags).toContain("alter:item_port_liquid_purifier_1");
    expect(gasInput?.ports.map((port) => port.id)).toEqual(["in_w_2"]);
    expect(gasOutput?.ports.map((port) => port.id)).toEqual(["out_e_1", "out_e_3"]);
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
  expect(definition.recipeChannels).toHaveLength(1);
  expect(definition.recipeChannels[0]).toMatchObject({
    ingredientStorageGroupIds: expected.ingredientStorageGroupIds,
    productStorageGroupIds: expected.productStorageGroupIds,
  });
  expect(definition.tags).toContain(expected.variantGroupTag);
}
