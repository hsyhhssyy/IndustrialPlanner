// @vitest-environment node
// 2026-10-21：共享植物需求先合并，再计算回流与净产出的离散设备下限。
// 定位依据：.docs/common/eda/算法探索/算法探索20261021-系统胶囊蓝图与生产网络搜索空间.md
import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import {
  buildProductionPlanningIndex, computeProductionPlan, flattenProductionPlanningRecipeNodes,
  type ProductionPlanningPort, type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { buildProductionPlanningLedgerRows } from "@/app/shell/production-planning/production-planning-ledger";
import { createBlueprintPlannerPlan } from "@/app/shell/production-planning/blueprint-planner-adapter";
import { createProductionNetwork } from "@/blueprint-planner/production-network";

const registry = createRegistryContract(), index = buildProductionPlanningIndex(registry);
const plant = "item_plant_moss_3", seed = "item_plant_moss_seed_3";
const plantRecipe = "r_planter_moss_from_moss_seed_basic";
const sourceConfig: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct", acidPolicy: "use-byproduct", sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "fractional",
};
const ports = (values: readonly (readonly [string, number])[]): ProductionPlanningPort[] =>
  values.map(([itemId, perMinute], position) => ({ id: `port-${position}`, itemId, perMinute }));
const scenarios = [
  { name: "40 与 20 的净需求共享四台", targets: [[plant, 40], [plant, 20]], supplies: [], cycles: 120, devices: 4 },
  { name: "小需求仍保留独立回流与外供设备", targets: [[plant, 5], [plant, 10]], supplies: [], cycles: 30, devices: 2 },
  { name: "植物与种子成品共享回路", targets: [[plant, 15], [seed, 15]], supplies: [], cycles: 45, devices: 2 },
  { name: "有限种子外供不算内部回流", targets: [[plant, 40], [plant, 20]], supplies: [[seed, 45]], cycles: 75, devices: 3 },
  { name: "有限植物外供只抵扣实际需求", targets: [[plant, 40], [plant, 20]], supplies: [[plant, 30]], cycles: 60, devices: 2 },
] satisfies { name: string; targets: [string, number][]; supplies: [string, number][]; cycles: number; devices: number }[];

describe("共享植物产能聚合", () => {
  for (const mode of ["none", "fractional", "ceil"] as const) {
    it.each(scenarios)(`${mode}：$name，需求顺序不改变产能和 EDA 导出`, scenario => {
      for (const reverse of [false, true]) {
        const request = {
          targets: ports(reverse ? [...scenario.targets].reverse() : scenario.targets),
          supplies: ports(scenario.supplies), infiniteItemIds: new Set(["item_liquid_sewage"]),
          recipeChoices: new Map<string, string>(), sourceConfig: { ...sourceConfig, includeDeviceMinimumConsumption: mode },
        };
        const plan = computeProductionPlan(request, index);
        expect(plan.unresolvedPerMinute).toBe(0);
        const total = plan.recipeTotals.find(recipe => recipe.recipeId === plantRecipe)!;
        expect(total).toMatchObject({ cyclesPerMinute: scenario.cycles, deviceCount: scenario.devices });
        expect(total.inputs).toContainEqual(expect.objectContaining({ itemId: seed, perMinute: scenario.cycles }));
        expect(total.outputs).toContainEqual(expect.objectContaining({ itemId: plant, perMinute: scenario.cycles }));
        const branches = flattenProductionPlanningRecipeNodes(plan.roots).filter(node => node.recipeId === plantRecipe);
        expect(branches.reduce((sum, node) => sum + node.deviceCount, 0)).toBeCloseTo(scenario.devices, 4);
        const ledger = buildProductionPlanningLedgerRows(plan).filter(row => row.recipeId === plantRecipe);
        expect(ledger).not.toHaveLength(0);
        for (const row of ledger) expect(row.recipeNode.deviceCount).toBe(scenario.devices);
        const exported = createBlueprintPlannerPlan({ request, index, sourceBaseId: "valley4_protocol_core", activeActivityIds: [], name: scenario.name });
        expect(exported.recipes.find(recipe => recipe.recipeId === plantRecipe))
          .toMatchObject({ cyclesPerMinute: scenario.cycles, deviceCount: scenario.devices });
      }
    });
  }

  it.each(["item_bottled_food_3", "item_bottled_rec_hp_3"])("%s 的 6/min 完整生产链使用 45 台生产设备", itemId => {
    const request = { targets: ports([[itemId, 6]]), supplies: [], infiniteItemIds: new Set(["item_liquid_sewage"]),
      recipeChoices: new Map<string, string>(), sourceConfig };
    const plan = createBlueprintPlannerPlan({ request, index, sourceBaseId: "valley4_protocol_core", activeActivityIds: [], name: itemId });
    expect(plan.unresolvedPerMinute).toBe(0);
    expect(plan.recipes.find(recipe => recipe.recipeId === plantRecipe)).toMatchObject({ cyclesPerMinute: 120, deviceCount: 4 });
    const network = createProductionNetwork(registry, { plan, options: {
      warehouseBus: "straight", warehousePortPlacement: "continuous", solidSupply: "warehouse", fluidSupply: "conduit",
      solidOutput: "stash", byproducts: "output", plantStartup: "preload", converterStartup: "reject", evaluationsPerRound: 20_000_000,
    } });
    expect(network.nodes.filter(node => node.purpose === "production")).toHaveLength(45);
    expect(network.nodes.filter(node => node.recipe?.id === plantRecipe)).toHaveLength(4);
  });
});
