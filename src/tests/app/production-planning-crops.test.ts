import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { CROP_RECIPES } from "@/registry/crop-definitions";
import { createDefaultRegionalSettingsAsset, resolveRegionalResourceSettings } from "@/app/regional-settings";
import { buildProductionPlanningIndex, computeProductionPlan, isRecipeExcludedFromProductionPlanningAuto,
  type ProductionPlanningPort, type ProductionPlanningSourceConfig } from "@/app/shell/production-planning/production-planning-model";
import { buildProductionPlanningTreeRows } from "@/app/shell/production-planning/production-planning-panel";
import { createProductionPlanningModule } from "@/app/shell/production-planning/production-planning-module";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { lookupText } from "@/shared/i18n";

// 2026-10-19：农作物属于规划一级原料，地区库存仍由真实田块收获供给。
// 规则：.docs/common/产线规划自动配方规则.md
const config: ProductionPlanningSourceConfig = { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply", waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "fractional" };
const port = (itemId: string, perMinute: number): ProductionPlanningPort => ({ id: itemId, itemId, perMinute });
const registry = createRegistryContract();
const index = buildProductionPlanningIndex(registry);
const sources = registry.recipeDefinitions.filter(recipe => recipe.tags.includes("农作物采集"));
const compute = (targets: ProductionPlanningPort[], choices: [string, string][] = [], supplies: ProductionPlanningPort[] = []) =>
  computeProductionPlan({ targets, supplies, recipeChoices: new Map(choices), infiniteItemIds: new Set(), sourceConfig: config }, index);

describe("农作物一级原料与田块数量", () => {
  it("完整覆盖新旧田块的 24 种收获产物，不把种子、加工品或作物库存变为自然资源", () => {
    const harvestIds = new Set(CROP_RECIPES.flatMap(recipe => recipe.outputs.map(output => output.itemId)));
    expect(harvestIds.size).toBe(24);
    expect(index.cropItemIds).toEqual(harvestIds);
    expect(new Set(sources.flatMap(recipe => recipe.outputs.map(output => output.itemId)))).toEqual(harvestIds);
    const regional = resolveRegionalResourceSettings(createDefaultRegionalSettingsAsset(), "武陵", registry.itemDefinitions);
    for (const itemId of harvestIds) {
      expect(index.rawResourceItemIds.has(itemId)).toBe(true);
      expect(index.naturalResourceItemIds.has(itemId)).toBe(false);
      expect(registry.queries.findItemDefinition(itemId)!.tags).not.toContain("自然资源");
      expect(regional.some(resource => resource.itemId === itemId)).toBe(false);
    }
    expect(index.cropItemIds.has("item_corp_bean_seed_1")).toBe(false);
    expect(index.cropItemIds.has("item_Ingredient_flour_1")).toBe(false);
    expect(sources).toHaveLength(22);
    expect(sources.every(recipe => registry.queries.findEntityDefinition(recipe.machineId)!.uiGroup !== "hidden")).toBe(true);
    expect(CROP_RECIPES.every(recipe => !index.recipeById.has(recipe.id))).toBe(true);
  });

  it.each([
    ["soil_grass_1", 3664], ["soil_moss_1", 3634], ["soil_moss_3", 334],
    ["soil_sp_1", 43234], ["soil_sp_3", 43294], ["soil_corp_bean_1", 28834],
    ["soil_corp_cabbage_1", 28834],
  ])("%s 按完整种植周期 %i 秒计算", (machineId, seconds) => {
    const matching = sources.filter(recipe => recipe.machineId === machineId);
    expect(matching.length).toBeGreaterThan(0);
    for (const recipe of matching) expect(recipe.durationSeconds).toBe(seconds);
  });

  it.each(sources.map(recipe => [recipe.id, recipe] as const))("%s 可选为零输入来源并显示正确田块数", (recipeId, recipe) => {
    const target = recipe.outputs[0]!;
    const plan = compute([port(target.itemId, target.amount)], [[target.itemId, recipeId]]);
    expect(plan.unresolvedPerMinute).toBe(0);
    expect(plan.recipeTotals).toHaveLength(1);
    expect(plan.recipeTotals[0]).toMatchObject({ recipeId, inputs: [], cyclesPerMinute: 1 });
    expect(plan.recipeTotals[0]!.deviceCount).toBeCloseTo(recipe.durationSeconds / 60, 4);
    expect(buildProductionPlanningTreeRows(plan, "device").some(row => row.recipeId === recipeId)).toBe(true);
  });

  it("每分钟 1 个作物不因周期率提前舍入而少产，有限外供减少对应田块需求", () => {
    const plan = compute([port("item_corp_bean_1", 1)]);
    const total = plan.recipeTotals[0]!;
    expect(total.outputs.find(output => output.itemId === "item_corp_bean_1")!.perMinute).toBe(1);
    expect(total.cyclesPerMinute).toBeCloseTo(1 / 30, 12);
    expect(total.deviceCount).toBeCloseTo(28834 / 1800, 4);
    const supplied = compute([port("item_corp_bean_1", 30)], [], [port("item_corp_bean_1", 15)]);
    expect(supplied.roots[0]!.suppliedPerMinute).toBe(15);
    expect(supplied.recipeTotals[0]!.deviceCount).toBeCloseTo(28834 / 120, 4);
  });

  it("普通田块育种供给优质作物，并保留普通收获与副产物的完整边界", () => {
    const refined = compute([port("item_corp_cabbage_2", 30)]);
    expect(refined.recipeTotals[0]!.recipeId).toBe("r_soil_corp_cabbage_1_harvest_refined_cycle");
    expect(refined.recipeTotals[0]!.deviceCount).toBeCloseTo(28834 / 60, 4);
    expect(refined.overflowItems).toContainEqual(expect.objectContaining({ itemId: "item_corp_cabbage_1", perMinute: 30 }));
    const targets = [port("item_corp_bean_1", 30), port("item_byproduct_bean_1", 3)];
    const plan = compute(targets);
    expect(plan.recipeTotals).toHaveLength(1);
    const module = createProductionPlanningModule({ index, plan, targets, translate: key => lookupText("zh-CN", key) ?? key });
    expect(module.inputs).toEqual(expect.arrayContaining([
      { itemId: "item_corp_bean_1", perMinute: 30 }, { itemId: "item_byproduct_bean_1", perMinute: 3 },
    ]));
  });

  it("只有农作物标签也满足自动选料硬约束，不依赖自然资源或阶段配方", () => {
    const cropIndex = buildProductionPlanningIndex({ ...registry, recipeDefinitions: registry.recipeDefinitions
      .filter(recipe => !recipe.outputs.some(output => output.itemId === "item_corp_sugarcane_1")) });
    const sugar = registry.queries.findRecipeDefinition("grinder_Ingredient_sugar_1")!;
    expect(cropIndex.recipesByOutputItem.has("item_corp_sugarcane_1")).toBe(false);
    expect(isRecipeExcludedFromProductionPlanningAuto(sugar, cropIndex)).toBe(false);
  });

  it.each(["item_Ingredient_flour_1", "item_Ingredient_sugar_1", "item_Ingredient_oil_1"])("%s 的正式与批量规划共用田块来源，EDA 转换保留外供", itemId => {
    const request = readPlanningInput(registry, { targets: [port(itemId, 30)], supplies: [], recipeChoices: {},
      sourceConfig: config, useModules: false, sourceBaseId: "wuling_protocol_core" });
    expect(request.plan.unresolvedPerMinute).toBe(0);
    const cropRecipes = request.plan.recipes.filter(recipe => registry.queries.findRecipeDefinition(recipe.recipeId)!.tags.includes("农作物采集"));
    expect(cropRecipes.length).toBeGreaterThan(0);
    const network = createProductionNetwork(registry, request);
    expect(network.nodes.length).toBeGreaterThan(0);
    expect(network.nodes.every(node => !node.definition.stateMachine)).toBe(true);
    for (const crop of cropRecipes) for (const output of crop.outputs) {
      expect(network.request.plan.externalSupplies).toContainEqual(expect.objectContaining({ itemId: output.itemId, perMinute: output.perMinute }));
    }
    const rules = new PlannerSupplyRules(registry, request.plan);
    expect(rules.resolve("item_corp_bean_1").policy).toEqual({ itemId: "item_corp_bean_1", source: "external" });
  });
});
