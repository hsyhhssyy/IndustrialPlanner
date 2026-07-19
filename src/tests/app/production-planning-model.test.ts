import { describe, expect, it } from "vitest";

import {
  buildProductionPlanningIndex,
  computeItemDefaultPerMinute,
  computeProductionPlan,
  flattenProductionPlanningItemNodes as flattenNodes,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { buildProductionPlanningTreeRows } from "@/app/shell/production-planning/production-planning-panel";
import type { ProductionPlanningPort } from "@/app/shell/production-planning/production-planning-model";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createRegistryContract } from "@/registry";
import { TOOLBOX_HIDDEN_RECIPE_TAG } from "@/shared/registry/recipe-visibility";

function port(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: itemId,
    itemId,
    perMinute,
  };
}

function infinitePort(itemId: string): ProductionPlanningPort {
  return {
    id: `${itemId}-infinite`,
    itemId,
    perMinute: 60,
    isInfinite: true,
  };
}

const DEFAULT_SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
};

// AI-CORRECTION 2026-05-22:
// 自然资源不再通过 infiniteItemIds 补齐；缺失时走 null 配方生产。
// baseInfiniteItemIds 返回空集，与 panel 的新 infiniteItemIds 构建逻辑一致。
function baseInfiniteItemIds(_index: ReturnType<typeof buildProductionPlanningIndex>) {
  return new Set<string>();
}

function makeInfiniteItemIds(
  index: ReturnType<typeof buildProductionPlanningIndex>,
  config: ProductionPlanningSourceConfig,
) {
  const ids = new Set(index.naturalResourceItemIds);
  if (config.sewagePolicy === "external-supply") {
    ids.add("item_liquid_sewage");
  }
  return ids;
}

describe("production planning model", () => {
  it("filters toolbox-hidden recipes from planning indexes and recipe choices", () => {
    const registry = createRegistryContract();
    const hiddenRecipe: RecipeDefinition = {
      id: "test_hidden_iron_nugget",
      nameKey: "recipe.test_hidden_iron_nugget",
      durationSeconds: 1,
      inputs: [],
      outputs: [{ itemId: "item_iron_nugget", amount: 999 }],
      machineId: "furnance_1",
      recipeType: "immediate-consume",
      tags: [TOOLBOX_HIDDEN_RECIPE_TAG],
    };
    registry.recipeDefinitions = [hiddenRecipe, ...registry.recipeDefinitions];

    const index = buildProductionPlanningIndex(registry);

    expect(index.recipeById.has(hiddenRecipe.id)).toBe(false);
    expect(index.recipesByOutputItem.get("item_iron_nugget")?.map((recipe) => recipe.id))
      .not.toContain(hiddenRecipe.id);

    const result = computeProductionPlan({
      targets: [port("item_iron_nugget", 60)],
      supplies: [],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map([["item_iron_nugget", hiddenRecipe.id]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    expect(result.recipeTotals.map((recipe) => recipe.recipeId)).not.toContain(hiddenRecipe.id);
  });

  it("uses provided supply before recipe production", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_iron_nugget", 60)],
      supplies: [port("item_iron_nugget", 30)],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
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
    // AI-CORRECTION 2026-05-22:
    // 自然资源不再从 infiniteItemIds 补齐；铁矿石走矿机配方生产。
    expect(root.recipeNode?.inputItems[0]?.isInfiniteSource).toBe(false);
    expect(root.recipeNode?.inputItems[0]?.recipeNode).not.toBeNull();
    expect(root.recipeNode?.inputItems[0]?.recipeNode?.recipeId).toBe("r_miner_iron_ore_basic");
  });

  it("uses recipe surplus before finite external supply", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [
        port("item_liquid_xiranite_poly", 30),
        port("item_liquid_xiranite_lowpoly", 60),
      ],
      supplies: [
        port("item_liquid_xiranite", 30),
        port("item_liquid_xiranite_lowpoly", 60),
      ],
      infiniteItemIds: makeInfiniteItemIds(index, DEFAULT_SOURCE_CONFIG),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const lowpolyRoot = result.roots.find((root) => root.itemId === "item_liquid_xiranite_lowpoly");
    expect(lowpolyRoot?.supply.surplus).toBe(30);
    expect(lowpolyRoot?.supply.manual).toBe(30);
    expect(lowpolyRoot?.producedPerMinute).toBe(0);
  });

  it("uses infinite external supply for non-natural resources", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_iron_nugget", 120)],
      supplies: [infinitePort("item_iron_nugget")],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const root = result.roots[0];
    expect(root?.isInfiniteSource).toBe(true);
    expect(root?.suppliedPerMinute).toBe(120);
    expect(root?.recipeNode).toBeNull();
  });

  it("ignores infinite external supply flags for natural resources", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_iron_ore", 60)],
      supplies: [infinitePort("item_iron_ore")],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const root = result.roots[0];
    expect(root?.isInfiniteSource).toBe(false);
    expect(root?.recipeNode?.recipeId).toBe("r_miner_iron_ore_basic");
  });

  it("does not auto-select manual-only iron enriched powder block recipe", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const autoResult = computeProductionPlan({
      targets: [port("item_iron_enr", 30)],
      supplies: [],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    expect(autoResult.roots[0]?.recipeNode).toBeNull();
    expect(autoResult.unresolvedPerMinute).toBe(30);

    const manualResult = computeProductionPlan({
      targets: [port("item_iron_enr", 30)],
      supplies: [],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map([["item_iron_enr", "r_furnace_iron_enr_from_iron_enr_powder_basic"]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    expect(manualResult.roots[0]?.recipeNode?.recipeId).toBe("r_furnace_iron_enr_from_iron_enr_powder_basic");
    expect(manualResult.unresolvedPerMinute).toBe(0);
  });

  it("uses explicit recipe choices for multi-recipe target items", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const selectedRecipeId = "r_furnace_carbon_mtl_from_grass_1_basic";
    const result = computeProductionPlan({
      targets: [port("item_carbon_mtl", 60)],
      supplies: [],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map([["item_carbon_mtl", selectedRecipeId]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    expect(result.roots[0]?.recipeNode?.recipeId).toBe(selectedRecipeId);
  });

  it("treats seed and plant growth loops as productive cycles", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_plant_moss_seed_3", 60)],
      supplies: [],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);
    const cycleNode = result.roots[0]?.recipeNode?.inputItems[0]?.recipeNode?.inputItems[0];

    expect(cycleNode?.itemId).toBe("item_plant_moss_seed_3");
    expect(cycleNode?.isCycleSource).toBe(true);
    expect(result.unresolvedPerMinute).toBe(0);
  });

  it("can switch sewage between self-produce and external supply", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const recipeChoice = new Map([[
      "item_liquid_xiranite_poly",
      "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
    ]]);

    // 自行生产: 污水走配方求解，应出现污水生产配方节点
    const selfProduceResult = computeProductionPlan({
      targets: [port("item_liquid_xiranite_poly", 30)],
      supplies: [port("item_liquid_xiranite", 30)],
      infiniteItemIds: baseInfiniteItemIds(index),
      recipeChoices: recipeChoice,
      sourceConfig: { ...DEFAULT_SOURCE_CONFIG, sewagePolicy: "self-produce" },
    }, index);

    expect(selfProduceResult.unresolvedPerMinute).toBe(0);
    const allItems = flattenNodes(selfProduceResult.roots);
    const sewageNode = allItems.find((node) => node.itemId === "item_liquid_sewage");
    expect(sewageNode?.isInfiniteSource).toBe(false);

    // 外部供应: 污水无限，节点标记为无限来源
    const externalResult = computeProductionPlan({
      targets: [port("item_liquid_xiranite_poly", 30)],
      supplies: [port("item_liquid_xiranite", 30)],
      infiniteItemIds: makeInfiniteItemIds(index, { ...DEFAULT_SOURCE_CONFIG, sewagePolicy: "external-supply" }),
      recipeChoices: recipeChoice,
      sourceConfig: { ...DEFAULT_SOURCE_CONFIG, sewagePolicy: "external-supply" },
    }, index);

    expect(externalResult.unresolvedPerMinute).toBe(0);
    const extItems = flattenNodes(externalResult.roots);
    const extSewageNode = extItems.find((node) => node.itemId === "item_liquid_sewage");
    expect(extSewageNode?.isInfiniteSource).toBe(true);
  });

  it("marks only the leftover output as byproduct and nests it under waste treatment", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_equip_script_4_2", 1)],
      supplies: [],
      infiniteItemIds: new Set(["item_liquid_sewage"]),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    expect(result.byproductItemIds.has("item_liquid_xiranite_poly")).toBe(false);
    expect(result.byproductItemIds.has("item_liquid_xiranite_lowpoly")).toBe(true);

    const rows = buildProductionPlanningTreeRows(result, "item");
    expect(rows.every((row) => !("kind" in row))).toBe(true);
    const usedWasteLiquidRow = rows.find((row) => (
      row.recipeId === "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic"
      && row.targetItemId === "item_liquid_xiranite_poly"
    ));
    const leftoverWasteLiquidRow = rows.find((row) => (
      row.recipeId === "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic"
      && row.targetItemId === "item_liquid_xiranite_lowpoly"
    ));
    const treatmentRow = rows.find((row) => (
      row.recipeId === "r_chrono_wastewater_treatment_void_inert_xiranite_waste_liquid_basic"
      && row.targetItemId === "item_liquid_xiranite_lowpoly"
    ));

    expect(usedWasteLiquidRow?.isByproduct).toBe(false);
    expect(leftoverWasteLiquidRow?.isByproduct).toBe(true);
    expect(treatmentRow?.isByproduct).toBe(true);
    expect(treatmentRow?.depth).toBe(0);
    expect(treatmentRow?.childIds).toContain(leftoverWasteLiquidRow?.id);
    expect(leftoverWasteLiquidRow?.parentIds).toEqual([treatmentRow?.id]);
  });

  it("does not mark productive pumped acid as byproduct when acid byproducts are dumped", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_equip_script_4_2", 1)],
      supplies: [],
      infiniteItemIds: new Set(["item_liquid_sewage"]),
      recipeChoices: new Map(),
      sourceConfig: { ...DEFAULT_SOURCE_CONFIG, acidPolicy: "dump-byproduct" },
    }, index);

    expect(result.byproductItemIds.has("item_liquid_acid")).toBe(true);

    const rows = buildProductionPlanningTreeRows(result, "item");
    const pumpedAcidRow = rows.find((row) => (
      row.recipeId === "r_pump_acid_basic"
      && row.targetItemId === "item_liquid_acid"
    ));
    const purifierByproductAcidRow = rows.find((row) => (
      row.recipeId === "r_liquid_purifier_acid_and_copper_enr_from_copper_basic"
      && row.targetItemId === "item_liquid_acid"
    ));
    const dumperRow = rows.find((row) => (
      row.recipeId === "r_dumper_void_liquid_acid_basic"
      && row.targetItemId === "item_liquid_acid"
    ));

    expect(pumpedAcidRow).toBeDefined();
    expect(pumpedAcidRow?.isByproduct).toBe(false);
    expect(pumpedAcidRow?.parentIds.length).toBeGreaterThan(0);
    expect(purifierByproductAcidRow?.isByproduct).toBe(true);
    expect(dumperRow?.isByproduct).toBe(true);
    expect(dumperRow?.depth).toBe(0);
    expect(dumperRow?.childIds).toContain(purifierByproductAcidRow?.id);
  });
});

describe("computeItemDefaultPerMinute", () => {
  const index = buildProductionPlanningIndex(createRegistryContract());

  it("returns 60 for item without any recipe", () => {
    expect(computeItemDefaultPerMinute("nonexistent_item", index)).toBe(60);
  });

  it("computes output from single-recipe item", () => {
    // 源石粉末 r_crusher_originium_powder_basic: durationSeconds=2, amount=1 → 30
    expect(computeItemDefaultPerMinute("item_originium_powder", index)).toBe(30);
  });

  it("prefers non-excluded recipe for items with multiple recipes", () => {
    // 铁粒有多个冶炼配方，任一均为 (1/2)*60=30
    const value = computeItemDefaultPerMinute("item_iron_nugget", index);
    expect(value).toBe(30);
  });

  it("returns finite positive for crafted item", () => {
    const value = computeItemDefaultPerMinute("item_copper_nugget", index);
    expect(value).toBeGreaterThan(0);
    expect(Number.isFinite(value)).toBe(true);
  });
});
