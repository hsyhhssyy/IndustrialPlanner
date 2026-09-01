import { describe, expect, it } from "vitest";

import type { ModuleBalancingCustomModule } from "@/app/toolbox-types";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningPort,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { createProductionPlanningModuleCandidateId } from "@/app/shell/production-planning/production-planning-candidate";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createRegistryContract } from "@/registry";

const SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "none",
};

function port(itemId: string, perMinute: number): ProductionPlanningPort {
  return { id: `${itemId}-${perMinute}`, itemId, perMinute };
}

function recipe(
  id: string,
  inputs: readonly { itemId: string; amount: number }[],
  outputs: readonly { itemId: string; amount: number }[],
): RecipeDefinition {
  return {
    id,
    nameKey: `registry.recipe.${id}.name`,
    durationSeconds: 60,
    inputs: [...inputs],
    outputs: [...outputs],
    machineId: "furnance_1",
    recipeType: "immediate-consume",
    tags: [],
  };
}

function module(
  id: string,
  inputs: readonly { itemId: string; perMinute: number }[],
  outputs: readonly { itemId: string; perMinute: number }[],
): ModuleBalancingCustomModule {
  return {
    schemaVersion: 2,
    id,
    name: id,
    color: "#4f8cff",
    iconItemIds: [outputs[0]?.itemId ?? "test_a"],
    notes: "",
    inputs,
    outputs,
    sourceType: "custom",
  };
}

function createCandidateIndex(modules: readonly ModuleBalancingCustomModule[]) {
  const registry = createRegistryContract();
  registry.recipeDefinitions = [
    recipe("test_source_a", [], [{ itemId: "test_a", amount: 10 }]),
    recipe("test_a_to_b", [{ itemId: "test_a", amount: 10 }], [{ itemId: "test_b", amount: 10 }]),
    recipe("test_b_to_c", [{ itemId: "test_b", amount: 10 }], [{ itemId: "test_c", amount: 10 }]),
    recipe("test_a_to_d", [{ itemId: "test_a", amount: 10 }], [{ itemId: "test_d", amount: 10 }]),
    recipe("test_c_to_e", [{ itemId: "test_c", amount: 10 }], [{ itemId: "test_e", amount: 10 }]),
    recipe("test_d_to_f", [{ itemId: "test_d", amount: 10 }], [{ itemId: "test_f", amount: 10 }]),
    ...registry.recipeDefinitions,
  ];
  return buildProductionPlanningIndex(registry, { modules });
}

function solve(
  modules: readonly ModuleBalancingCustomModule[],
  targets: readonly ProductionPlanningPort[],
  useModules: boolean,
  options: {
    readonly recipeChoices?: ReadonlyMap<string, string>;
    readonly supplies?: readonly ProductionPlanningPort[];
  } = {},
) {
  const index = createCandidateIndex(modules);
  return computeProductionPlan({
    targets,
    supplies: options.supplies ?? [],
    infiniteItemIds: new Set(),
    recipeChoices: options.recipeChoices ?? new Map(),
    sourceConfig: SOURCE_CONFIG,
    useModules,
  }, index);
}

function createIsolatedIndex(
  recipeDefinitions: readonly RecipeDefinition[],
  modules: readonly ModuleBalancingCustomModule[],
) {
  const registry = createRegistryContract();
  registry.recipeDefinitions = [...recipeDefinitions];
  return buildProductionPlanningIndex(registry, { modules });
}

describe("production planning unified candidates", () => {
  it("selects the resource-dominating xiranite recipe recursively", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const plan = computeProductionPlan({
      targets: [port("item_xiranite_powder", 30)],
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig: SOURCE_CONFIG,
    }, index);

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("xiranite_oven_xiranite_powder_2");
  });

  it("selects an equal-resource module when it removes an intermediate layer", () => {
    const directModule = module(
      "test_direct_c",
      [{ itemId: "test_a", perMinute: 10 }],
      [{ itemId: "test_c", perMinute: 10 }],
    );

    const plan = solve([directModule], [port("test_c", 100)], true);

    expect(plan.roots[0]?.recipeNode?.candidateId).toBe(
      createProductionPlanningModuleCandidateId("custom", directModule.id),
    );
  });

  it("rejects a shorter module when its extra output has no demand", () => {
    const wastefulModule = module(
      "test_c_with_unused_d",
      [{ itemId: "test_a", perMinute: 10 }],
      [
        { itemId: "test_c", perMinute: 10 },
        { itemId: "test_d", perMinute: 10 },
      ],
    );

    const plan = solve([wastefulModule], [port("test_c", 100)], true);

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("test_b_to_c");
    expect(plan.recipeTotals.some((total) => total.module?.id === wastefulModule.id)).toBe(false);
  });

  it("runs a multi-output module only to the quantity absorbable by both targets", () => {
    const sharedModule = module(
      "test_shared_c_d",
      [{ itemId: "test_a", perMinute: 10 }],
      [
        { itemId: "test_c", perMinute: 10 },
        { itemId: "test_d", perMinute: 10 },
      ],
    );

    const plan = solve(
      [sharedModule],
      [port("test_c", 100), port("test_d", 20)],
      true,
    );
    const moduleTotal = plan.recipeTotals.find((total) => total.module?.id === sharedModule.id);
    const systemC = plan.recipeTotals.find((total) => total.recipeId === "test_b_to_c");

    expect(moduleTotal?.deviceCount).toBe(2);
    expect(moduleTotal?.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "test_c", perMinute: 20 }),
      expect.objectContaining({ itemId: "test_d", perMinute: 20 }),
    ]));
    expect(systemC?.outputs).toContainEqual(expect.objectContaining({ itemId: "test_c", perMinute: 80 }));
    expect(plan.overflowItems).toEqual([]);
  });

  it("connects otherwise-disjoint target trees through intermediate module outputs", () => {
    const bridgeModule = module(
      "test_bridge_c_d",
      [{ itemId: "test_a", perMinute: 10 }],
      [
        { itemId: "test_c", perMinute: 10 },
        { itemId: "test_d", perMinute: 10 },
      ],
    );

    const plan = solve(
      [bridgeModule],
      [port("test_e", 20), port("test_f", 20)],
      true,
    );
    const moduleTotal = plan.recipeTotals.find((total) => total.module?.id === bridgeModule.id);

    expect(moduleTotal?.deviceCount).toBe(2);
    expect(plan.recipeTotals.some((total) => total.recipeId === "test_b_to_c")).toBe(false);
    expect(plan.recipeTotals.some((total) => total.recipeId === "test_a_to_d")).toBe(false);
    expect(plan.unresolvedPerMinute).toBe(0);
  });

  it("keeps module candidates out of automatic solving when the switch is off", () => {
    const directModule = module(
      "test_disabled_direct_c",
      [{ itemId: "test_a", perMinute: 10 }],
      [{ itemId: "test_c", perMinute: 10 }],
    );

    const plan = solve([directModule], [port("test_c", 100)], false);

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("test_b_to_c");
    expect(plan.recipeTotals.some((total) => total.module !== null)).toBe(false);
  });

  it("keeps a deeper system route when a shorter module consumes strictly more resources", () => {
    const expensiveModule = module(
      "test_expensive_direct_c",
      [
        { itemId: "item_plant_moss_1", perMinute: 10 },
        { itemId: "item_plant_moss_3", perMinute: 10 },
      ],
      [{ itemId: "test_c", perMinute: 10 }],
    );
    const index = createIsolatedIndex([
      recipe(
        "test_moss_to_b",
        [{ itemId: "item_plant_moss_1", amount: 10 }],
        [{ itemId: "test_b", amount: 10 }],
      ),
      recipe(
        "test_b_to_c",
        [{ itemId: "test_b", amount: 10 }],
        [{ itemId: "test_c", amount: 10 }],
      ),
    ], [expensiveModule]);

    const plan = computeProductionPlan({
      targets: [port("test_c", 10)],
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig: SOURCE_CONFIG,
      useModules: true,
    }, index);

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("test_b_to_c");
    expect(plan.recipeTotals.some((total) => total.module?.id === expensiveModule.id)).toBe(false);
  });

  it("uses depth only after preserving incomparable resource dimensions", () => {
    const incomparableModule = module(
      "test_incomparable_direct_c",
      [{ itemId: "item_plant_moss_3", perMinute: 10 }],
      [{ itemId: "test_c", perMinute: 10 }],
    );
    const index = createIsolatedIndex([
      recipe(
        "test_moss_to_b",
        [{ itemId: "item_plant_moss_1", amount: 10 }],
        [{ itemId: "test_b", amount: 10 }],
      ),
      recipe(
        "test_b_to_c",
        [{ itemId: "test_b", amount: 10 }],
        [{ itemId: "test_c", amount: 10 }],
      ),
    ], [incomparableModule]);

    const plan = computeProductionPlan({
      targets: [port("test_c", 10)],
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig: SOURCE_CONFIG,
      useModules: true,
    }, index);

    expect(plan.roots[0]?.recipeNode?.candidateId).toBe(
      createProductionPlanningModuleCandidateId("custom", incomparableModule.id),
    );
  });

  it("prefers a system recipe when module and system candidate are otherwise equal", () => {
    const equalModule = module(
      "test_equal_direct_c",
      [{ itemId: "item_plant_moss_1", perMinute: 10 }],
      [{ itemId: "test_c", perMinute: 10 }],
    );
    const index = createIsolatedIndex([
      recipe(
        "test_direct_c",
        [{ itemId: "item_plant_moss_1", amount: 10 }],
        [{ itemId: "test_c", amount: 10 }],
      ),
    ], [equalModule]);

    const plan = computeProductionPlan({
      targets: [port("test_c", 10)],
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig: SOURCE_CONFIG,
      useModules: true,
    }, index);

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("test_direct_c");
  });

  it("honors a manually selected module even when it creates overflow", () => {
    const wastefulModule = module(
      "test_manual_wasteful_c",
      [{ itemId: "test_a", perMinute: 10 }],
      [
        { itemId: "test_c", perMinute: 10 },
        { itemId: "test_d", perMinute: 10 },
      ],
    );
    const candidateId = createProductionPlanningModuleCandidateId("custom", wastefulModule.id);

    const plan = solve([wastefulModule], [port("test_c", 100)], true, {
      recipeChoices: new Map([["test_c", candidateId]]),
    });

    expect(plan.roots[0]?.recipeNode?.candidateId).toBe(candidateId);
    expect(plan.overflowItems).toContainEqual(expect.objectContaining({
      itemId: "test_d",
      perMinute: 100,
    }));
  });

  it("ignores a persisted module choice while module solving is disabled", () => {
    const directModule = module(
      "test_disabled_manual_c",
      [{ itemId: "test_a", perMinute: 10 }],
      [{ itemId: "test_c", perMinute: 10 }],
    );

    const plan = solve([directModule], [port("test_c", 100)], false, {
      recipeChoices: new Map([[
        "test_c",
        createProductionPlanningModuleCandidateId("custom", directModule.id),
      ]]),
    });

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("test_b_to_c");
    expect(plan.recipeTotals.some((total) => total.module !== null)).toBe(false);
  });

  it("produces the same shared plan when target input order is reversed", () => {
    const bridgeModule = module(
      "test_order_independent_bridge",
      [{ itemId: "test_a", perMinute: 10 }],
      [
        { itemId: "test_c", perMinute: 10 },
        { itemId: "test_d", perMinute: 10 },
      ],
    );

    const forward = solve(
      [bridgeModule],
      [port("test_e", 20), port("test_f", 20)],
      true,
    );
    const reversed = solve(
      [bridgeModule],
      [port("test_f", 20), port("test_e", 20)],
      true,
    );

    expect(reversed.recipeTotals).toEqual(forward.recipeTotals);
    expect(reversed.itemTotals).toEqual(forward.itemTotals);
    expect(reversed.overflowItems).toEqual(forward.overflowItems);
    expect(reversed.unresolvedPerMinute).toBe(forward.unresolvedPerMinute);
  });

  it("re-evaluates xiranite recipes against finite user supply", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const plan = computeProductionPlan({
      targets: [port("item_xiranite_powder", 30)],
      supplies: [port("item_carbon_enr", 60)],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig: SOURCE_CONFIG,
    }, index);

    expect(plan.roots[0]?.recipeNode?.recipeId).toBe("xiranite_oven_xiranite_powder_1");
  });
});
