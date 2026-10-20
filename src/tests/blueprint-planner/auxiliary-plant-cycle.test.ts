// @vitest-environment node
// 2026-10-20：环境补料与主规划共用植物净产配平；不改变面积或搜索预算。
// 依据：.docs/common/eda/算法探索/算法探索20261020-瓶装供料修复与固定面积优化.md
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork, supplyAuxiliaryDemand } from "@/blueprint-planner/production-network";
import { materialBalance } from "@/blueprint-planner/terminals";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { DEFAULT_SEARCH_PROFILE } from "@/blueprint-planner/search-profile";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import input from "./fixtures/bottling-plant-cycle.json";

const registry = createRegistryContract();
const request = () => structuredClone(input) as BlueprintPlannerRequest;
const port = (itemId: string, perMinute: number) => ({ id: itemId, itemId, perMinute });
const plantRequest = (itemId: string, perMinute: number) => readPlanningInput(registry, {
  targets: [port(itemId, perMinute)], supplies: [], recipeChoices: {},
  sourceConfig: { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct", sewagePolicy: "external-supply",
    waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "fractional" },
});

describe("植物循环辅助扩产", () => {
  it("原始灼铜罐装请求可按实际酸气需求扩产，保留目标、来源和已有设备", () => {
    const original = request(), network = createProductionNetwork(registry, original);
    const before = network.nodes.slice(), targets = structuredClone(network.request.plan.targets);
    supplyAuxiliaryDemand(registry, network, "item_gas_acid", 6);
    expect(before.every(node => network.nodes.includes(node))).toBe(true);
    expect(network.request.plan.targets).toEqual(targets);
    expect(original).toEqual(input);
    expect(network.request.plan.infiniteItemIds).not.toContain("item_plant_grass_1");
    const balance = materialBalance(network);
    for (const itemId of ["item_plant_grass_1", "item_plant_grass_seed_1", "item_carbon_mtl", "item_xiranite_powder", "item_liquid_xiranite"]) {
      expect(balance.get(itemId), itemId).toBeCloseTo(0, 8);
    }
    expect(balance.get("item_gas_acid")).toBe(6);
    const plant = network.nodes.find(node => node.recipe?.id === "r_hydro_planter_grass_1_from_seed_1_and_water_basic")!;
    expect(plant.outputs[0]!.perMinute).toBe(21);
    supplyAuxiliaryDemand(registry, network, "item_gas_acid", 30);
    expect(network.nodes.filter(node => node.recipe?.id === "liquid_transmuter_1_gas_gas_acid_1")).toHaveLength(2);
    expect(plant.outputs[0]!.perMinute).toBe(27);
    expect(materialBalance(network).get("item_liquid_xiranite")).toBeCloseTo(0, 8);
  });

  it.each(["item_plant_grass_1", "item_plant_grass_seed_1"])("%s 跨过设备容量后仍保持两侧净产守恒", itemId => {
    const network = createProductionNetwork(registry, plantRequest(itemId, 15));
    supplyAuxiliaryDemand(registry, network, itemId, 60);
    const balance = materialBalance(network);
    expect(balance.get(itemId)).toBeCloseTo(60, 8);
    const partner = itemId === "item_plant_grass_1" ? "item_plant_grass_seed_1" : "item_plant_grass_1";
    expect(balance.get(partner)).toBeCloseTo(0, 8);
    for (const node of network.nodes.filter(entry => entry.recipe !== null)) {
      const recipe = node.recipe!, output = recipe.outputs[0]!;
      expect(node.outputs[0]!.perMinute / output.amount).toBeLessThanOrEqual(60 / recipe.durationSeconds + 1e-6);
    }
  });

  it("已有种子余量先用于扩产，足够时无需增加采种速率", () => {
    const original = plantRequest("item_plant_grass_1", 15);
    const seed = original.plan.recipes.find(recipe => recipe.recipeId === "r_seedcol_grass_seed_1_from_grass_1_basic")!;
    const seeded: BlueprintPlannerRequest = { ...original, plan: { ...original.plan,
      targets: [{ itemId: "item_plant_grass_1", perMinute: 9 }],
      recipes: original.plan.recipes.map(recipe => recipe === seed
        ? { ...recipe, cyclesPerMinute: seed.cyclesPerMinute + 6, deviceCount: (seed.cyclesPerMinute + 6) / 30,
          inputs: [{ itemId: "item_plant_grass_1", perMinute: seed.cyclesPerMinute + 6 }],
          outputs: [{ itemId: "item_plant_grass_seed_1", perMinute: seed.cyclesPerMinute + 6 }] } : recipe),
    } };
    const network = createProductionNetwork(registry, seeded);
    const picker = network.nodes.find(node => node.recipe?.id === seed.recipeId)!;
    const previous = structuredClone(picker.outputs);
    supplyAuxiliaryDemand(registry, network, "item_plant_grass_1", 12);
    expect(picker.outputs).toEqual(previous);
    expect(materialBalance(network).get("item_plant_grass_seed_1")).toBeCloseTo(0, 8);
    expect(materialBalance(network).get("item_plant_grass_1")).toBeCloseTo(12, 8);
  });

  it("采种增产回路扩容时保留对外输出与回流支路", () => {
    const network = createProductionNetwork(registry, plantRequest("item_plant_moss_3", 15));
    supplyAuxiliaryDemand(registry, network, "item_plant_moss_3", 30);
    expect(network.nodes.filter(node => node.recipe?.id === "r_planter_moss_from_moss_seed_basic")).toHaveLength(4);
    expect(materialBalance(network).get("item_plant_moss_3")).toBeCloseTo(30, 8);
  });

  it("从种子端扩产也为对面的种植机保留已有外供支路", () => {
    const network = createProductionNetwork(registry, plantRequest("item_plant_moss_3", 15));
    supplyAuxiliaryDemand(registry, network, "item_plant_moss_seed_3", 60);
    expect(network.nodes.filter(node => node.recipe?.id === "r_planter_moss_from_moss_seed_basic")).toHaveLength(4);
    expect(materialBalance(network).get("item_plant_moss_seed_3")).toBeCloseTo(60, 8);
    expect(materialBalance(network).get("item_plant_moss_3")).toBeCloseTo(0, 8);
  });

  it("完整设备准备自动补环境用量，不要求主计划预先增加酸气目标", async () => {
    const network = createProductionNetwork(registry, request());
    const placement = new PlannerPlacement(registry, 40, 7, 2);
    await prepareProductionDevices(registry, network, placement, 0, DEFAULT_SEARCH_PROFILE, {}, () => {});
    expect(network.nodes.some(node => node.purpose === "environment")).toBe(true);
    expect(network.nodes.some(node => node.purpose === "auxiliary" && node.recipe?.id === "liquid_transmuter_1_gas_gas_acid_1")).toBe(true);
    // 完整准备已将目标变为实体汇点；检查实体守恒时不能再次扣除抽象目标。
    const physicalBalance = materialBalance({ ...network,
      request: { ...network.request, plan: { ...network.request.plan, targets: [] } } });
    expect([...physicalBalance.values()].every(rate => Math.abs(rate) <= 1e-6)).toBe(true);
  });

  it("未选入主计划的合法植物回路可预览，普通转换闭环仍拒绝", () => {
    const original = request();
    const auxiliaryIds = ["r_hydro_planter_grass_1_from_seed_1_and_water_basic", "r_seedcol_grass_seed_1_from_grass_1_basic",
      "r_furnace_carbon_mtl_from_grass_1_basic", "xiranite_oven_xiranite_powder_2"];
    const rules = new PlannerSupplyRules(registry, { ...original.plan,
      recipes: original.plan.recipes.filter(recipe => !auxiliaryIds.includes(recipe.recipeId)),
      supplyPolicies: auxiliaryIds.map(recipeId => ({ itemId: registry.queries.findRecipeDefinition(recipeId)!.outputs[0]!.itemId,
        source: "production", recipeId })),
    });
    expect(rules.plantCycle("item_plant_grass_1")?.partnerItemId).toBe("item_plant_grass_seed_1");
    expect(rules.view().issues).toEqual([]);
    expect(rules.plantCycle("item_gas_copper")).toBeNull();
  });
});
