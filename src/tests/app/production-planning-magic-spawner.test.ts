import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  isRecipeExcludedFromProductionPlanningAuto,
  type ProductionPlanningPort,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { createBlueprintPlannerPlan } from "@/app/shell/production-planning/blueprint-planner-adapter";
import { MAGIC_SPAWNER_RANGE_DEVICE_IDS } from "@/shared/magic-spawner-range";

// 2026-11-25：明晦炉在产线规划中是环境设备，只保留 1 个区域占位，按 100% 1:1 转化，
// 不计设备台数与环境设备的息壤气消耗。
const config: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};

const port = (itemId: string, perMinute: number): ProductionPlanningPort => ({ id: itemId, itemId, perMinute });
const registry = createRegistryContract();
const index = buildProductionPlanningIndex(registry);

function compute(targetItemId: string, perMinute: number) {
  return computeProductionPlan({
    targets: [port(targetItemId, perMinute)],
    supplies: [],
    recipeChoices: new Map(),
    infiniteItemIds: new Set(["item_copper_nugget", "item_xiranite_powder"]),
    sourceConfig: config,
  }, index);
}

describe("产线规划明晦炉环境转化", () => {
  it.each([
    ["item_copper_ming", MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming, "item_copper_nugget"],
    ["item_xiranite_ming", MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming, "item_xiranite_powder"],
    ["item_copper_hui", MAGIC_SPAWNER_RANGE_DEVICE_IDS.hui, "item_copper_nugget"],
    ["item_copper_enr_heng", MAGIC_SPAWNER_RANGE_DEVICE_IDS.heng, "item_copper_nugget"],
  ])("%s 由 %s 占位并按 1:1 转化", (targetItemId, rangeDeviceId, inputItemId) => {
    const plan = compute(targetItemId, 30);
    expect(plan.unresolvedPerMinute).toBe(0);
    expect(plan.recipeTotals).toHaveLength(1);
    const total = plan.recipeTotals[0]!;
    expect(total.candidateSourceType).toBe("environment-range");
    expect(total.environmentRange?.deviceId).toBe(rangeDeviceId);
    expect(total.environmentRange?.ownerDeviceIds).toEqual(["magic_spawner_1", "magic_spawner_2"]);
    expect(total.recipeId).toMatch(/^r_magic_spawner_range_/);
    expect(total.deviceCount).toBe(1);
    expect(total.durationSeconds).toBe(10);
    expect(total.inputs.find((input) => input.itemId === inputItemId)?.perMinute).toBeCloseTo(30);
    expect(total.outputs.find((output) => output.itemId === targetItemId)?.perMinute).toBeCloseTo(30);
    // 环境设备不计运行耗材，也不产生息壤气需求。
    expect(total.deviceMinimumConsumptionInputs).toHaveLength(0);
    expect(plan.itemTotals.some((item) => item.itemId === "item_gas_xiranite")).toBe(false);
  });

  it("同一区域的多条转化需求各保留 1 个占位节点", () => {
    const plan = computeProductionPlan({
      targets: [port("item_copper_ming", 30), port("item_copper_hui", 30)],
      supplies: [],
      recipeChoices: new Map(),
      infiniteItemIds: new Set(["item_copper_nugget"]),
      sourceConfig: config,
    }, index);
    expect(plan.recipeTotals).toHaveLength(2);
    expect(plan.recipeTotals.every((total) => total.candidateSourceType === "environment-range")).toBe(true);
    expect(plan.recipeTotals.every((total) => total.deviceCount === 1)).toBe(true);
    expect(plan.unresolvedPerMinute).toBe(0);
  });

  it("以明/晦产物为输入的配方不再被自动候选排除", () => {
    const recipe = registry.queries.findRecipeDefinition("magic_balancer_1_copper_enr")!;
    expect(isRecipeExcludedFromProductionPlanningAuto(recipe, index)).toBe(false);

    const plan = computeProductionPlan({
      targets: [port("item_copper_enr", 30)],
      supplies: [],
      recipeChoices: new Map([["item_copper_enr", "recipe:magic_balancer_1_copper_enr"]]),
      infiniteItemIds: new Set(["item_copper_nugget"]),
      sourceConfig: config,
    }, index);
    expect(plan.unresolvedPerMinute).toBe(0);
    const environmentTotals = plan.recipeTotals
      .filter((total) => total.candidateSourceType === "environment-range");
    expect(environmentTotals.map((total) => total.environmentRange!.deviceId).sort())
      .toEqual([MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming, MAGIC_SPAWNER_RANGE_DEVICE_IDS.hui].sort());
    expect(environmentTotals.every((total) => total.deviceCount === 1)).toBe(true);
    expect(plan.recipeTotals.some((total) => total.recipeId === "magic_balancer_1_copper_enr"))
      .toBe(true);
  });

  it("含环境转化的产线禁止导出 EDA", () => {
    const request = {
      targets: [port("item_copper_ming", 30)],
      supplies: [],
      infiniteItemIds: new Set(["item_copper_nugget"]),
      recipeChoices: new Map<string, string>(),
      sourceConfig: config,
    };
    expect(() => createBlueprintPlannerPlan({
      request,
      index,
      activeActivityIds: [],
      sourceBaseId: "test-base",
      name: "明晦炉环境转化",
    })).toThrow(/EDA 暂不支持导出/);
  });
});
