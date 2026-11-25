import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import {
  buildProductionPlanningIndex,
  computeItemDefaultPerMinute,
  computeProductionPlan,
  type ProductionPlanningPort,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { createBlueprintPlannerPlan } from "@/app/shell/production-planning/blueprint-planner-adapter";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

// 2026-11-25：同设备、同原料、同时长的互斥概率配方必须按期望产出规划，
// 不能把单分支满速值当作设备产能。规则见 .agents/skills/unpack-data-analysis/references/probability-recipes.md。
const config: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};

const port = (itemId: string, perMinute: number): ProductionPlanningPort => ({ id: itemId, itemId, perMinute });

const CLEAR_RECIPE_ID = "gas_reactor_gas_copper_bright_clear_1";
const TURBID_RECIPE_ID = "gas_reactor_gas_copper_bright_turbid_1";
const CLEAR_ITEM_ID = "item_gas_copper_bright_clear";
const TURBID_ITEM_ID = "item_gas_copper_bright_turbid";
const COPPER_INPUT_ID = "item_gas_copper_enr_heng";
const XIRANITE_INPUT_ID = "item_gas_xiranite_enr_heng";
const GROUP_CANDIDATE_ID = `probability:${CLEAR_RECIPE_ID}`;

const registry = createRegistryContract();
const index = buildProductionPlanningIndex(registry);

function compute(
  targets: readonly ProductionPlanningPort[],
  choices: readonly (readonly [string, string])[] = [],
) {
  return computeProductionPlan({
    targets,
    supplies: [],
    recipeChoices: new Map(choices),
    infiniteItemIds: new Set([COPPER_INPUT_ID, XIRANITE_INPUT_ID]),
    sourceConfig: config,
  }, index);
}

function outputOf(total: { outputs: readonly { itemId: string; perMinute: number }[] }, itemId: string) {
  return total.outputs.find((output) => output.itemId === itemId)?.perMinute ?? 0;
}

describe("产线规划概率配方", () => {
  it("同原料概率配方合并为唯一期望候选，成员不再单独成为候选", () => {
    const clearCandidates = index.candidatesByOutputItem.get(CLEAR_ITEM_ID) ?? [];
    const turbidCandidates = index.candidatesByOutputItem.get(TURBID_ITEM_ID) ?? [];
    expect(clearCandidates.map((candidate) => candidate.id)).toContain(GROUP_CANDIDATE_ID);
    expect(turbidCandidates.map((candidate) => candidate.id)).toContain(GROUP_CANDIDATE_ID);
    expect(clearCandidates.some((candidate) => candidate.id === `recipe:${CLEAR_RECIPE_ID}`)).toBe(false);
    expect(turbidCandidates.some((candidate) => candidate.id === `recipe:${TURBID_RECIPE_ID}`)).toBe(false);
    const group = index.candidateById.get(GROUP_CANDIDATE_ID)!;
    expect(group.probabilityGroup?.branches).toEqual([
      { recipeId: CLEAR_RECIPE_ID, share: 0.5 },
      { recipeId: TURBID_RECIPE_ID, share: 0.5 },
    ]);
    expect(outputOf(group, CLEAR_ITEM_ID)).toBeCloseTo(30);
    expect(outputOf(group, TURBID_ITEM_ID)).toBeCloseTo(30);
  });

  it("要求 30/min 清型时按 1 台计算，并同时产出 30/min 浊型副产物", () => {
    const plan = compute([port(CLEAR_ITEM_ID, 30)]);
    expect(plan.unresolvedPerMinute).toBe(0);
    expect(plan.recipeTotals).toHaveLength(1);
    const total = plan.recipeTotals[0]!;
    expect(total.candidateId).toBe(GROUP_CANDIDATE_ID);
    expect(total.cyclesPerMinute).toBeCloseTo(30);
    expect(total.deviceCount).toBeCloseTo(1);
    expect(outputOf(total, CLEAR_ITEM_ID)).toBeCloseTo(30);
    expect(outputOf(total, TURBID_ITEM_ID)).toBeCloseTo(30);
    for (const inputId of [COPPER_INPUT_ID, XIRANITE_INPUT_ID]) {
      expect(total.inputs.find((input) => input.itemId === inputId)?.perMinute).toBeCloseTo(30);
    }
    expect(plan.byproductItemIds.has(TURBID_ITEM_ID)).toBe(true);
    const turbidTotal = plan.itemTotals.find((item) => item.itemId === TURBID_ITEM_ID)!;
    expect(turbidTotal.producedPerMinute).toBeCloseTo(30);
    expect(turbidTotal.isByproduct).toBe(true);
  });

  it("要求 60/min 清型时按 2 台计算", () => {
    const plan = compute([port(CLEAR_ITEM_ID, 60)]);
    expect(plan.recipeTotals[0]!.cyclesPerMinute).toBeCloseTo(60);
    expect(plan.recipeTotals[0]!.deviceCount).toBeCloseTo(2);
    expect(outputOf(plan.recipeTotals[0]!, CLEAR_ITEM_ID)).toBeCloseTo(60);
    expect(outputOf(plan.recipeTotals[0]!, TURBID_ITEM_ID)).toBeCloseTo(60);
  });

  it("同时要求清型与浊型时共享同一台设备，不重复增建", () => {
    const plan = compute([port(CLEAR_ITEM_ID, 30), port(TURBID_ITEM_ID, 30)]);
    expect(plan.recipeTotals).toHaveLength(1);
    expect(plan.recipeTotals[0]!.candidateId).toBe(GROUP_CANDIDATE_ID);
    expect(plan.recipeTotals[0]!.deviceCount).toBeCloseTo(1);
    expect(plan.unresolvedPerMinute).toBe(0);
  });

  it("旧持久化的分支配方选择继续命中概率组", () => {
    const plan = compute(
      [port(CLEAR_ITEM_ID, 30)],
      [[CLEAR_ITEM_ID, `recipe:${TURBID_RECIPE_ID}`]],
    );
    expect(plan.recipeTotals[0]!.candidateId).toBe(GROUP_CANDIDATE_ID);
    expect(plan.recipeTotals[0]!.deviceCount).toBeCloseTo(1);
  });

  it("默认吞吐与 EDA 导出使用同一份期望份额", () => {
    expect(computeItemDefaultPerMinute(CLEAR_ITEM_ID, index)).toBeCloseTo(30);
    const request = {
      targets: [port(CLEAR_ITEM_ID, 30)],
      supplies: [],
      infiniteItemIds: new Set([COPPER_INPUT_ID, XIRANITE_INPUT_ID]),
      recipeChoices: new Map<string, string>(),
      sourceConfig: config,
    };
    const plan = createBlueprintPlannerPlan({
      request,
      index,
      activeActivityIds: [],
      sourceBaseId: "test-base",
      name: "概率组导出",
    });
    const branches = plan.recipes.filter((recipe) =>
      recipe.recipeId === CLEAR_RECIPE_ID || recipe.recipeId === TURBID_RECIPE_ID);
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch.cyclesPerMinute).toBeCloseTo(15);
      expect(branch.deviceCount).toBeCloseTo(0.5);
      expect(branch.inputs.find((input) => input.itemId === COPPER_INPUT_ID)?.perMinute).toBeCloseTo(15);
      expect(branch.inputs.find((input) => input.itemId === XIRANITE_INPUT_ID)?.perMinute).toBeCloseTo(15);
      expect(branch.outputs).toHaveLength(1);
      expect(branch.outputs[0]!.perMinute).toBeCloseTo(30);
    }
    expect(branches.map((branch) => branch.recipeId).sort())
      .toEqual([CLEAR_RECIPE_ID, TURBID_RECIPE_ID].sort());
  });
});

describe("产线规划概率配方分组边界", () => {
  function createIndex(extraRecipes: readonly RecipeDefinition[]) {
    const custom = createRegistryContract();
    custom.recipeDefinitions = [...extraRecipes, ...custom.recipeDefinitions];
    return buildProductionPlanningIndex(custom);
  }

  it("概率不等时按权重折算期望产出", () => {
    const custom = createIndex([
      {
        id: "test_probability_a", nameKey: "recipe.test_probability_a", durationSeconds: 2,
        inputs: [{ itemId: "item_gas_copper_enr_heng", amount: 1 }],
        outputs: [{ itemId: "item_gas_copper_bright_clear", amount: 2 }],
        machineId: "gas_reactor_1", recipeType: "immediate-consume", tags: [], probability: 0.25,
      },
      {
        id: "test_probability_b", nameKey: "recipe.test_probability_b", durationSeconds: 2,
        inputs: [{ itemId: "item_gas_copper_enr_heng", amount: 1 }],
        outputs: [{ itemId: "item_gas_copper_bright_turbid", amount: 2 }],
        machineId: "gas_reactor_1", recipeType: "immediate-consume", tags: [], probability: 0.75,
      },
    ]);
    const group = Array.from(custom.candidateById.values())
      .find((candidate) => candidate.probabilityGroup?.branches.some((branch) => branch.recipeId === "test_probability_a"));
    expect(group?.probabilityGroup?.branches).toEqual([
      { recipeId: "test_probability_a", share: 0.25 },
      { recipeId: "test_probability_b", share: 0.75 },
    ]);
    expect(outputOf(group!, "item_gas_copper_bright_clear")).toBeCloseTo(15);
    expect(outputOf(group!, "item_gas_copper_bright_turbid")).toBeCloseTo(45);
  });

  it("单条概率配方没有同组分支时仍按满速运行", () => {
    const custom = createIndex([{
      id: "test_single_probability", nameKey: "recipe.test_single_probability", durationSeconds: 2,
      inputs: [{ itemId: "item_gas_copper_enr_heng", amount: 1 }],
      outputs: [{ itemId: "item_gas_copper_bright_clear", amount: 2 }],
      machineId: "gas_reactor_1", recipeType: "immediate-consume", tags: [], probability: 0.3,
    }]);
    const candidate = custom.candidateById.get("recipe:test_single_probability");
    expect(candidate?.probabilityGroup).toBeNull();
    expect(outputOf(candidate!, "item_gas_copper_bright_clear")).toBeCloseTo(60);
  });

  it("原料不同不合并为概率组", () => {
    const custom = createIndex([
      {
        id: "test_progress_a", nameKey: "recipe.test_progress_a", durationSeconds: 2,
        inputs: [{ itemId: "item_gas_copper_enr_heng", amount: 1 }],
        outputs: [{ itemId: "item_gas_copper_bright_clear", amount: 2 }],
        machineId: "gas_reactor_1", recipeType: "immediate-consume", tags: [], probability: 0.5,
      },
      {
        id: "test_progress_b", nameKey: "recipe.test_progress_b", durationSeconds: 2,
        inputs: [{ itemId: "item_gas_copper_enr_heng", amount: 2 }],
        outputs: [{ itemId: "item_gas_copper_bright_turbid", amount: 2 }],
        machineId: "gas_reactor_1", recipeType: "immediate-consume", tags: [], probability: 0.5,
      },
    ]);
    expect(Array.from(custom.candidateById.values())
      .some((candidate) => candidate.probabilityGroup?.branches.some((branch) => branch.recipeId === "test_progress_a")))
      .toBe(false);
    expect(custom.candidateById.get("recipe:test_progress_a")?.probabilityGroup ?? null).toBeNull();
    expect(custom.candidateById.get("recipe:test_progress_b")?.probabilityGroup ?? null).toBeNull();
  });
});
