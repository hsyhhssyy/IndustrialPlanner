// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { buildProductionPlanningIndex, computeProductionPlan,
  type ProductionPlanningRequest } from "@/app/shell/production-planning/production-planning-model";
import { createBlueprintPlannerPlan } from "@/app/shell/production-planning/blueprint-planner-adapter";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { materialBalance } from "@/blueprint-planner/terminals";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { DEFAULT_SEARCH_PROFILE } from "@/blueprint-planner/search-profile";
import originalRequest from "../blueprint-planner/fixtures/bottling-running-consumption.json";

const registry = createRegistryContract();
const activeActivityIds = ["activity-limited-formula-1", "activity-limited-formula-2"];
const index = buildProductionPlanningIndex(registry, { activeActivityIds, includeInactiveActivityContent: false });
const port = (itemId: string, perMinute: number) => ({ id: itemId, itemId, perMinute });
const request = (): ProductionPlanningRequest => ({
  targets: [port("item_glass_bottle_filled_liquid_copper", 30)], supplies: [], infiniteItemIds: new Set(["item_liquid_sewage"]),
  // 2026-10-20：沿用原失败案例的显式配方，避免默认选择改走另一条转换循环。
  recipeChoices: new Map(originalRequest.plan.recipes.flatMap(entry => {
    const recipe = registry.queries.findRecipeDefinition(entry.recipeId)!;
    return (recipe.primaryOutputs ?? recipe.outputs.map(output => output.itemId))
      .map(itemId => [itemId, recipe.id] as const);
  })), sourceConfig: { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct",
    sewagePolicy: "external-supply", waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "fractional" },
});

describe("EDA 物理设备耗材配平", () => {
  it("以整台耗材重新求解完整上游，不改变普通规划设置或目标", async () => {
    const input = request(), snapshot = structuredClone(input);
    const fractional = computeProductionPlan(input, index);
    const running = (recipes: typeof fractional.recipeTotals) => recipes.find(entry =>
      entry.recipeId === "liquid_transmuter_1_liquid_liquid_copper_1")!.deviceMinimumConsumptionInputs[0]!.perMinute;
    expect(running(fractional.recipeTotals)).toBe(3);
    const plan = createBlueprintPlannerPlan({ request: input, index, activeActivityIds, sourceBaseId: "wuling_protocol_core", name: "整台耗材" });
    expect(plan.recipes.find(entry => entry.recipeId === "liquid_transmuter_1_liquid_liquid_copper_1")!.runningInputs[0]!.perMinute).toBe(6);
    expect(plan.recipes.find(entry => entry.recipeId === "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic")!.cyclesPerMinute).toBe(6);
    expect(input).toEqual(snapshot);
    expect(plan.targets).toEqual([{ itemId: "item_glass_bottle_filled_liquid_copper", perMinute: 30 }]);
    expect(plan.activeActivityIds).toEqual(activeActivityIds);
    const network = createProductionNetwork(registry, { plan, options: { warehousePortPlacement: "continuous",
      solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight", solidOutput: "stash",
      byproducts: "output", plantStartup: "preload", evaluationsPerRound: 20_000_000 } });
    // 2026-10-20：原料入口创建后才检查实体守恒；准备前外供气体的 -6/min 是待接入流量。
    await prepareProductionDevices(registry, network, new PlannerPlacement(registry, 40, 7, 2),
      0, DEFAULT_SEARCH_PROFILE, {}, () => {});
    for (const itemId of ["item_liquid_xiranite", "item_gas_xiranite", "item_plant_grass_1", "item_plant_grass_seed_1"]) {
      expect(materialBalance(network).get(itemId), itemId).toBeCloseTo(0, 8);
    }
    expect(network.request.plan.infiniteItemIds).not.toContain("item_liquid_xiranite");
  });

  it("网页与批量入口共用取整转换，保留显式配方、有限和无限外供", () => {
    const input: ProductionPlanningRequest = { ...request(),
      supplies: [port("item_plant_grass_1", 2), { ...port("item_copper_nugget", 60), isInfinite: true }],
      recipeChoices: new Map(request().recipeChoices),
      infiniteItemIds: new Set(),
    };
    const plan = createBlueprintPlannerPlan({ request: input, index, activeActivityIds, sourceBaseId: "wuling_protocol_core", name: "同一请求" });
    const batch = readPlanningInput(registry, { ...input, recipeChoices: Object.fromEntries(input.recipeChoices),
      activeActivityIds, sourceBaseId: "wuling_protocol_core", name: "同一请求", useModules: false });
    expect(batch.plan).toEqual(plan);
    expect(plan.externalSupplies).toEqual(input.supplies.map(({ itemId, perMinute }) => ({ itemId, perMinute })));
    expect(plan.infiniteItemIds).toContain("item_copper_nugget");
    expect(plan.recipes.some(recipe => recipe.recipeId === input.recipeChoices.get("item_liquid_xiranite"))).toBe(true);
  });
});
