import { describe, expect, it } from "vitest";

import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningPort,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { createProductionPlanningModule } from "@/app/shell/production-planning/production-planning-module";
import { createRegistryContract } from "@/registry";
import { lookupText } from "@/shared/i18n";

const SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};

function port(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: itemId,
    itemId,
    perMinute,
  };
}

describe("production planning module conversion", () => {
  it("converts natural-resource gathering into module input demand", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const targets = [port("item_iron_nugget", 60)];
    const plan = computeProductionPlan({
      targets,
      supplies: [port("item_iron_ore", 20)],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig: SOURCE_CONFIG,
    }, index);

    const module = createProductionPlanningModule({
      index,
      plan,
      targets,
      translate: (key) => lookupText("zh-CN", key) ?? key,
    });

    expect(module.inputs).toContainEqual({
      itemId: "item_iron_ore",
      perMinute: 60,
    });
  });

  it("uses actual external consumption and includes targets plus every overflow output", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const targets = [port("item_liquid_xiranite_poly", 30)];
    const plan = computeProductionPlan({
      targets,
      supplies: [port("item_liquid_xiranite", 100)],
      infiniteItemIds: new Set(["item_liquid_sewage"]),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
      sourceConfig: SOURCE_CONFIG,
    }, index);

    const module = createProductionPlanningModule({
      index,
      plan,
      targets,
      translate: (key) => lookupText("zh-CN", key) ?? key,
    });

    expect(module.name).toBe("未命名模块");
    expect(module.notes).toBe("产线规划自动生成模块，目标：壤晶废液 x30/min");
    expect(module.inputs).toEqual([
      { itemId: "item_liquid_xiranite", perMinute: 30 },
      { itemId: "item_liquid_sewage", perMinute: 30 },
    ]);
    expect(module.outputs).toEqual(expect.arrayContaining([
      { itemId: "item_liquid_xiranite_poly", perMinute: 30 },
      { itemId: "item_liquid_xiranite_lowpoly", perMinute: 30 },
    ]));
    expect(module.outputs).toHaveLength(2);
    expect(module.iconId).toBe("item_liquid_xiranite_poly");
  });
});
