// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { addTerminals } from "@/blueprint-planner/terminals";

const request: BlueprintPlannerRequest = {
  plan: {
    name: "", sourceBaseId: "wuling_protocol_core",
    targets: [{ itemId: "item_gas_xiranite", perMinute: 12 }],
    externalSupplies: [{ itemId: "item_xiranite_powder", perMinute: 14.4 }, { itemId: "item_liquid_water", perMinute: 14.4 }],
    infiniteItemIds: ["item_xiranite_powder", "item_liquid_water"],
    byproductItemIds: [], containsModules: false, unresolvedPerMinute: 0, activeActivityIds: [],
    recipes: [
      {
        recipeId: "liquid_transmuter_1_gas_gas_xiranite_1", cyclesPerMinute: 12, deviceCount: 0.4,
        inputs: [{ itemId: "item_liquid_xiranite", perMinute: 14.4 }],
        outputs: [{ itemId: "item_gas_xiranite", perMinute: 12 }],
        runningInputs: [{ itemId: "item_liquid_xiranite", perMinute: 2.4 }],
      },
      {
        recipeId: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic", cyclesPerMinute: 14.4, deviceCount: 0.48,
        inputs: [{ itemId: "item_xiranite_powder", perMinute: 14.4 }, { itemId: "item_liquid_water", perMinute: 14.4 }],
        outputs: [{ itemId: "item_liquid_xiranite", perMinute: 14.4 }], runningInputs: [],
      },
    ],
  },
  options: {
    warehousePortPlacement: "any", solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight", solidOutput: "auto",
    byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 1000,
  },
};

function sourceError(input: BlueprintPlannerRequest): string {
  const registry = createRegistryContract();
  const network = createProductionNetwork(registry, input);
  const placement = new PlannerPlacement(registry, 32, 7, 2, 1, 1);
  try {
    addTerminals(registry, network, placement);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("预期缺少物料来源");
}

it("小数台数导致的整台运行消耗差额提示取整并重新生成 EDA 任务", () => {
  expect(sourceError(request)).toBe("原规划缺少物料来源：item_liquid_xiranite，3.60/min。设备按整台放置后，运行消耗高于原规划；请在产线规划将「设备最低消耗」设为「取整计算」，重新生成并启动 EDA 任务。");
});

it("原规划本身缺料时保留通用来源错误", () => {
  const input: BlueprintPlannerRequest = { ...request, plan: { ...request.plan,
    recipes: request.plan.recipes.map(recipe => recipe.recipeId.startsWith("r_mix_pool")
      ? { ...recipe, cyclesPerMinute: 12, deviceCount: 0.4,
        inputs: recipe.inputs.map(flow => ({ ...flow, perMinute: 12 })),
        outputs: [{ itemId: "item_liquid_xiranite", perMinute: 12 }] }
      : recipe),
  } };
  expect(sourceError(input)).toBe("原规划缺少物料来源：item_liquid_xiranite，6.00/min");
});
