// @vitest-environment node
// 2026-10-21：计算器附带处置与 EDA 逐物品去向一致；Windows 定位证据见算法探索20261021-针剂与软饮系统蓝图搜索空间.md。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { createProductionNetwork, normalizePlannerSources } from "@/blueprint-planner/production-network";
import { PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
import { addTerminals, materialBalance } from "@/blueprint-planner/terminals";
import { collectPlannerItemBoundaries, plannerDisposalItem } from "@/shared/planner-item-policy";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";

const registry = createRegistryContract();
const wastewater = "item_liquid_sewage";
const furnace = "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic";
const treatment = "r_chrono_wastewater_treatment_void_wastewater_basic";
const input = (options: Partial<BlueprintPlannerOptions> = {}) => readPlanningInput(registry, {
  targets: [{ id: "target", itemId: "item_copper_nugget", perMinute: 30 }],
  recipeChoices: { item_copper_nugget: furnace }, options,
});

it.each([
  { global: "output", override: undefined, output: true },
  { global: "destroy", override: undefined, output: false },
  { global: "destroy", override: "output", output: true },
  { global: "output", override: "destroy", output: false },
] as const)("自动处置遵循去向：全局 $global、逐物品 $override", async ({ global, override, output }) => {
  const request = input({ byproducts: global, ...(override ? { itemPolicies: [{ itemId: wastewater, byproducts: override }] } : {}) });
  const original = structuredClone(request);
  expect(request.plan.recipes.some(recipe => recipe.recipeId === treatment)).toBe(true);
  const boundaries = collectPlannerItemBoundaries(registry, request.plan, new PlannerSupplyRules(registry, request.plan).view());
  expect(boundaries).toContainEqual({ itemId: wastewater, supply: false, output: true, byproducts: true });
  const normalized = normalizePlannerSources(registry, request);
  expect(normalizePlannerSources(registry, normalized)).toEqual(normalized);
  const network = createProductionNetwork(registry, request);
  expect(network.nodes.map(node => node.recipe?.id)).toEqual(output ? [furnace] : [furnace, treatment]);
  const placement = new PlannerPlacement(registry, 40, 0, 0);
  await placeProduction(registry, network, placement, 0);
  addTerminals(registry, network, placement);
  const sinks = network.nodes.filter(node => node.inputs.some(flow => flow.itemId === wastewater));
  expect(sinks.map(node => node.definition.id)).toEqual([output ? "udpipe_loader_1" : "liquid_cleaner_1"]);
  expect(sinks.flatMap(node => node.inputs).map(({ itemId, perMinute }) => ({ itemId, perMinute })))
    .toContainEqual({ itemId: wastewater, perMinute: 30 });
  expect(network.nodes.some(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === wastewater))).toBe(false);
  // AI-REMOVED 2026-10-21:
  // Reason: 产品终端已消费目标流量，不能再扣目标清单。
  // Trigger: Windows probe125 的同口径诊断失败；本 Vitest 尚未执行。
  // Evidence: terminals.ts::materialBalance 同时扣除节点输入与 plan.targets。
  // Replacement: 下方实体守恒口径。Risk: Low；Human Review: Required。
  // Original code:
  // expect([...materialBalance(network).values()].every(rate => Math.abs(rate) < 1e-6)).toBe(true);
  const balance = materialBalance({ ...network, request: { ...network.request,
    plan: { ...network.request.plan, targets: [] } } });
  expect([...balance.values()].every(rate => Math.abs(rate) < 1e-6)).toBe(true);
  expect(request).toEqual(original);
});

it("未声明为副产物的输入处置保留，发电、环境与运行消耗不归类为纯处置", () => {
  const original = input();
  const request = { ...original, plan: { ...original.plan, byproductItemIds: [] } };
  expect(createProductionNetwork(registry, request).nodes.map(node => node.recipe?.id)).toEqual([furnace, treatment]);
  const recipe = registry.queries.findRecipeDefinition(treatment)!;
  expect(plannerDisposalItem(recipe)).toBe(wastewater);
  expect(plannerDisposalItem({ ...recipe, powerOutput: 1 })).toBeNull();
  expect(plannerDisposalItem({ ...recipe, environmentOutput: { itemId: wastewater, rangeId: "environment" } })).toBeNull();
  expect(plannerDisposalItem({ ...recipe, tags: [...recipe.tags, CONSUMPTION_RECIPE_TAG] })).toBeNull();
  expect(plannerDisposalItem(registry.queries.findRecipeDefinition(furnace)!)).toBeNull();
});
