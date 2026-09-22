// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork, normalizePlannerSources, supplyAuxiliaryDemand } from "@/blueprint-planner/production-network";
import { PlanningBudgetExhausted } from "@/blueprint-planner/model";
import { readPlanningInput } from "@/scripts/eda/planning-input";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import plant from "./fixtures/plant-preload.json";
import nugget from "./fixtures/pyrrolite-nugget.json";

describe("EDA 配方输入与工作线程", () => {
  it("沿用界面指定配方，将采矿、采水、采气边界转为外供", () => {
    const registry = createRegistryContract();
    const request = readPlanningInput(registry, {
      targets: [{ id: "target", itemId: "item_copper_nugget", perMinute: 30 }],
      recipeChoices: { item_copper_nugget: "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic" },
    });
    expect(request.options.evaluationsPerRound).toBe(50_000);
    const original = JSON.stringify(request);
    expect(request.plan.recipes.some((entry) => entry.recipeId === "r_miner_copper_ore_basic")).toBe(true);
    const normalized = normalizePlannerSources(registry, request);
    const network = createProductionNetwork(registry, request);
    expect(network.nodes.map((node) => node.recipe?.id)).toEqual([
      "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic",
      "r_chrono_wastewater_treatment_void_wastewater_basic",
    ]);
    expect(normalized.plan.infiniteItemIds).toEqual(expect.arrayContaining(["item_copper_ore", "item_liquid_water", "item_gas_inert"]));
    expect(network.nodes[0]!.inputs.find((flow) => flow.itemId === "item_liquid_water")?.perMinute).toBe(30);
    expect(JSON.stringify(request)).toBe(original);
  });

  it("将旧规划输入迁移到默认轮数，并拒绝非 1000 整数倍的每轮计算次数", () => {
    const registry = createRegistryContract();
    const request = readPlanningInput(registry, plant);
    expect(request.options.evaluationsPerRound).toBe(50_000);
    expect(() => createProductionNetwork(registry, {
      ...request, options: { ...request.options, evaluationsPerRound: 1_500 },
    })).toThrow("每轮计算次数必须是大于零的 1000 整数倍");
  });

  it("补算气体环境时保持已选气体生产配方", () => {
    const registry = createRegistryContract();
    const request = readPlanningInput(registry, nugget);
    const network = createProductionNetwork(registry, request);
    const added = supplyAuxiliaryDemand(registry, network, "item_gas_acid", 6);
    expect(added.filter((node) => node.outputs.some((output) => output.itemId === "item_gas_acid")).map((node) => node.recipe?.id))
      .toEqual(["liquid_transmuter_1_gas_gas_acid_1"]);
  });

  it("在真实 Worker 生成候选，并报告独立线程与预算耗尽", async () => {
    const registry = createRegistryContract(), client = new NodePlannerClient();
    try {
      const request = readPlanningInput(registry, plant);
      const candidate = await client.build(request, 0, 30_000);
      expect(client.threadId).toBeGreaterThan(0);
      expect(candidate.metrics.productionDeviceCount).toBe(3);
      expect(candidate.search.evaluationLimit).toBe(request.options.evaluationsPerRound);
      await expect(client.build(request, 1, .001)).rejects.toBeInstanceOf(PlanningBudgetExhausted);
    } finally { await client.dispose(); }
  }, 60_000);
});
