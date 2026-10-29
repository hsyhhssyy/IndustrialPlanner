// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildProductionPlanningIndex, computeProductionPlan, type ProductionPlanningRequest } from "@/app/shell/production-planning/production-planning-model";
import { createBlueprintPlannerPlan } from "@/app/shell/production-planning/blueprint-planner-adapter";
import { createBlueprintPlannerHost } from "@/blueprint-planner/blueprint-planner-host";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import type { BlueprintPlannerProductionPlan, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";
import { assertPlannerTaskCycles } from "@/shared/planner-cycle";
import plant from "../blueprint-planner/fixtures/plant-preload.json";

const registry = createRegistryContract();
const index = buildProductionPlanningIndex(registry);
const port = (itemId: string, perMinute: number) => ({ id: itemId, itemId, perMinute });
const choices = new Map([
  ["item_gas_copper", "liquid_transmuter_2_gas_gas_copper_1"],
  ["item_copper_nugget", "liquid_transmuter_2_solid_copper_nugget_1"],
]);
const request = (): ProductionPlanningRequest => ({
  targets: [port("item_gas_copper", 60)], supplies: [{ ...port("item_gas_xiranite", 60), isInfinite: true }],
  infiniteItemIds: new Set(), recipeChoices: new Map(choices),
  sourceConfig: { waterPolicy: "use-byproduct", acidPolicy: "use-byproduct", sewagePolicy: "external-supply",
    waterPurifierPolicy: "disabled", includeDeviceMinimumConsumption: "none" },
});

// 历史任务没有错误标志，甚至声明缺口为零；执行端必须依据配方事实自行拒绝。
function legacyTask(): BlueprintPlannerRequest {
  const input = request(), result = computeProductionPlan(input, index);
  const plan: BlueprintPlannerProductionPlan = {
    name: "旧赤铜循环任务", sourceBaseId: "wuling_protocol_core", targets: input.targets,
    externalSupplies: input.supplies, infiniteItemIds: ["item_gas_xiranite"],
    byproductItemIds: [], containsModules: false, unresolvedPerMinute: 0, activeActivityIds: [],
    recipes: result.recipeTotals.map(entry => ({ recipeId: entry.recipeId!, cyclesPerMinute: entry.cyclesPerMinute,
      deviceCount: entry.deviceCount, inputs: entry.inputs, outputs: entry.outputs, runningInputs: entry.deviceMinimumConsumptionInputs })),
  };
  return { plan, options: { warehousePortPlacement: "any", solidSupply: "warehouse", fluidSupply: "conduit",
    warehouseBus: "straight", solidOutput: "auto", byproducts: "destroy", plantStartup: "preload", evaluationsPerRound: 1 } };
}

describe("产线循环与 EDA 准入", () => {
  it("灼铜块默认使用赤铜矿路线，保留分离芯和息壤气外供", () => {
    const input: ProductionPlanningRequest = { ...request(), targets: [port("item_copper_enr2", 30)],
      supplies: ["item_filter_core", "item_gas_xiranite"].map(itemId => ({ ...port(itemId, 60), isInfinite: true })),
      recipeChoices: new Map([
        ["item_copper_enr2", "liquid_transmuter_2_solid_copper_enr2_1"],
        ["item_gas_copper_enr2", "gas_reactor_gas_copper_enr2_1"],
      ]),
    };
    const result = computeProductionPlan(input, index);
    expect(result.cycleIssues).toEqual([]);
    expect(result.unresolvedPerMinute).toBe(0);
    expect(result.recipeTotals.map(entry => entry.recipeId)).toContain("r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic");
    const plan = createBlueprintPlannerPlan({ request: input, index, activeActivityIds: [], sourceBaseId: "wuling_protocol_core", name: "" });
    expect(plan.externalSupplies.map(flow => flow.itemId)).toEqual(["item_filter_core", "item_gas_xiranite"]);
    expect(() => assertPlannerTaskCycles(registry, plan)).not.toThrow();
  });
  it("手选互转回路标记错误，阻止从计算器导出 EDA", () => {
    const input = request(), result = computeProductionPlan(input, index);
    expect(result.cycleIssues[0]?.shortfalls).toEqual([{ itemId: "item_gas_copper", perMinute: 60 }]);
    expect(result.unresolvedPerMinute).toBe(60);
    expect(() => createBlueprintPlannerPlan({ request: input, index, activeActivityIds: [], sourceBaseId: "wuling_protocol_core", name: "" }))
      .toThrow("错误循环");
  });
  it.each([60, 120])("有限赤铜块外供 %s/min 按实际缺口判断", supplied => {
    const input = request();
    input.supplies = [...input.supplies, port("item_copper_nugget", supplied)];
    const result = computeProductionPlan(input, index);
    expect(result.cycleIssues).toHaveLength(supplied === 120 ? 0 : 1);
    if (supplied === 60) expect(result.cycleIssues[0]?.shortfalls).toEqual([{ itemId: "item_gas_copper", perMinute: 30 }]);
  });
  it("现有植物增殖回流继续正常计算并进入 EDA", () => {
    const input = { ...request(), targets: [port("item_plant_grass_powder_2", 30)], supplies: [], recipeChoices: new Map() };
    const result = computeProductionPlan(input, index);
    expect(result.cycleIssues).toEqual([]);
    expect(result.unresolvedPerMinute).toBe(0);
    const plan = createBlueprintPlannerPlan({ request: input, index, activeActivityIds: [], sourceBaseId: "wuling_protocol_core", name: "" });
    expect(() => createProductionNetwork(registry, { ...legacyTask(), plan })).not.toThrow();
    expect(() => createProductionNetwork(registry, plant.request as BlueprintPlannerRequest)).not.toThrow();
  });
  it.each([6, 30, 48])("正净产耗材自循环按整台配平 %s/min，不误判为错误循环", perMinute => {
    const input: ProductionPlanningRequest = { ...request(), targets: [port("item_liquid_xiranite", perMinute)],
      recipeChoices: new Map([["item_liquid_xiranite", "liquid_transmuter_1_liquid_liquid_xiranite_1"]]),
      sourceConfig: { ...request().sourceConfig, includeDeviceMinimumConsumption: "ceil" },
    };
    const result = computeProductionPlan(input, index);
    expect(result.cycleIssues).toEqual([]);
    const recipe = result.recipeTotals.find(entry => entry.recipeId === "liquid_transmuter_1_liquid_liquid_xiranite_1")!;
    expect(recipe.outputs[0]!.perMinute - recipe.deviceMinimumConsumptionInputs[0]!.perMinute).toBe(perMinute);
    const plan = createBlueprintPlannerPlan({ request: input, index, activeActivityIds: [], sourceBaseId: "wuling_protocol_core", name: "" });
    expect(() => createProductionNetwork(registry, { ...legacyTask(), plan,
      options: { ...legacyTask().options, converterStartup: "manual" } })).not.toThrow();
  });
  it("执行端依据 Registry 拒绝伪造流量和零缺口标记的循环任务", () => {
    let task = legacyTask();
    task = { ...task, plan: { ...task.plan, recipes: task.plan.recipes.map(entry => ({ ...entry, inputs: [], outputs: [] })) } };
    expect(() => createProductionNetwork(registry, task)).toThrow(/错误循环.*气态赤铜.*60\.00\/min/);
  });
  it("旧错误任务可以保存和下载，但开始和继续执行均在搜索前拒绝", async () => {
    const workspace: WorkspaceContract = { state: createWorkspaceState(), registry, app: null, audio: null,
      editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
    const host = createBlueprintPlannerHost(workspace, { storage: { load: async () => [], save: async () => {}, delete: async () => {} } });
    try {
      await host.whenSettled();
      const task = legacyTask();
      expect(() => host.actions.start(task)).toThrow("错误循环");
      const id = await host.actions.createProductionTask(task);
      expect(host.queries.exportTask(id).request).toEqual(expect.objectContaining({ plan: task.plan }));
      expect(() => host.actions.continuePlanning(id, 1)).toThrow("错误循环");
      expect(host.state.activeTaskId).toBeNull();
      expect(host.queries.getTask(id)?.evaluatedProposals).toBe(0);
    } finally { host.dispose(); await host.whenSettled(); }
  });
});
