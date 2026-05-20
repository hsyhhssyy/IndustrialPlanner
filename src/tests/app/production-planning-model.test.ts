import { describe, expect, it } from "vitest";

import {
  buildProductionPlanningIndex,
  computeProductionPlan,
} from "@/app/shell/production-planning/production-planning-model";
import type { ProductionPlanningPort } from "@/app/shell/production-planning/production-planning-model";
import { createRegistryContract } from "@/registry";

function port(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: itemId,
    itemId,
    perMinute,
  };
}

function createInfiniteItemIds(index: ReturnType<typeof buildProductionPlanningIndex>, extra: string[] = []) {
  return new Set([...index.naturalResourceItemIds, ...extra]);
}

describe("production planning model", () => {
  it("uses provided supply before recipe production", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_iron_nugget", 60)],
      supplies: [port("item_iron_nugget", 30)],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map(),
    }, index);

    const root = result.roots[0];
    expect(root).toBeDefined();
    if (root === undefined) {
      throw new Error("Expected production root");
    }
    expect(root.suppliedPerMinute).toBe(30);
    expect(root.producedPerMinute).toBe(30);
    expect(root.recipeNode?.inputs).toEqual([
      expect.objectContaining({ itemId: "item_iron_ore", perMinute: 30 }),
    ]);
    expect(root.recipeNode?.inputItems[0]?.isInfiniteSource).toBe(true);
  });

  it("does not auto-select manual-only iron enriched powder block recipe", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const autoResult = computeProductionPlan({
      targets: [port("item_iron_enr", 30)],
      supplies: [],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map(),
    }, index);

    expect(autoResult.roots[0]?.recipeNode).toBeNull();
    expect(autoResult.unresolvedPerMinute).toBe(30);

    const manualResult = computeProductionPlan({
      targets: [port("item_iron_enr", 30)],
      supplies: [],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map([["item_iron_enr", "r_furnace_iron_enr_from_iron_enr_powder_basic"]]),
    }, index);

    expect(manualResult.roots[0]?.recipeNode?.recipeId).toBe("r_furnace_iron_enr_from_iron_enr_powder_basic");
    expect(manualResult.unresolvedPerMinute).toBe(0);
  });

  it("treats seed and plant growth loops as productive cycles", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_plant_moss_seed_3", 60)],
      supplies: [],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map(),
    }, index);
    const cycleNode = result.roots[0]?.recipeNode?.inputItems[0]?.recipeNode?.inputItems[0];

    expect(cycleNode?.itemId).toBe("item_plant_moss_seed_3");
    expect(cycleNode?.isCycleSource).toBe(true);
    expect(result.unresolvedPerMinute).toBe(0);
  });

  it("can switch sewage between line-produced and infinite supply", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const lineResult = computeProductionPlan({
      targets: [port("item_liquid_xiranite_poly", 30)],
      supplies: [port("item_liquid_xiranite", 30)],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
    }, index);

    expect(lineResult.unresolvedPerMinute).toBeGreaterThan(0);

    const infiniteResult = computeProductionPlan({
      targets: [port("item_liquid_xiranite_poly", 30)],
      supplies: [port("item_liquid_xiranite", 30)],
      infiniteItemIds: createInfiniteItemIds(index, ["item_liquid_sewage"]),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
    }, index);

    expect(infiniteResult.unresolvedPerMinute).toBe(0);
  });
});
