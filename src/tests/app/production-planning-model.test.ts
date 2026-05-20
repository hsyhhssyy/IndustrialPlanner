import { describe, expect, it } from "vitest";

import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  flattenProductionPlanningItemNodes as flattenNodes,
  type ProductionPlanningSourceConfig,
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

const DEFAULT_SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
};

function baseInfiniteItemIds(index: ReturnType<typeof buildProductionPlanningIndex>) {
  return new Set(index.naturalResourceItemIds);
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
    expect(root.recipeNode?.inputItems[0]?.isInfiniteSource).toBe(true);
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
});
