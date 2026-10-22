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
    // AI-REMOVED 2026-10-21:
    // Reason: 默认副产物输出应创建暗管入口，不预先固化计算器自动添加的废水处理机。
    // Trigger: 系统针剂蓝图对比暴露输出选项被自动处置配方覆盖。
    // Evidence: Windows probe124；readPlanningInput 默认 byproducts=output。
    // Replacement: 下方断言生产配方保留，处置选择由 byproduct-disposal-policy.test.ts 覆盖。
    // Risk: Low；属于明确的策略行为修正，尚未执行 Vitest。Human Review: Required。
    // Original code:
    // expect(network.nodes.map((node) => node.recipe?.id)).toEqual([
    //   "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic",
    //   "r_chrono_wastewater_treatment_void_wastewater_basic",
    // ]);
    expect(network.nodes.map((node) => node.recipe?.id)).toEqual([
      "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic",
    ]);
    expect(normalized.plan.infiniteItemIds).toEqual(expect.arrayContaining(["item_copper_ore", "item_liquid_water", "item_gas_inert"]));
    expect(network.nodes[0]!.inputs.find((flow) => flow.itemId === "item_liquid_water")?.perMinute).toBe(30);
    expect(JSON.stringify(request)).toBe(original);
  });

  // AI-CORRECTION 2026-10-21：用户要求累计预算不取整；接受任意正安全整数，继续拒绝无效预算。
  it("将旧规划输入迁移到默认轮数，接受精确尾额并拒绝非正安全整数", () => {
    const registry = createRegistryContract();
    const request = readPlanningInput(registry, plant);
    expect(request.options.evaluationsPerRound).toBe(50_000);
    // AI-REMOVED 2026-10-21:
    // Reason: 整千限制已因完整累计预算需求取消。
    // Trigger: 用户要求精确跑满 50M。Evidence: v52 针剂被取整丢弃 8641 次。
    // Replacement: 下方有效尾额与非法输入断言。Risk: Low。Human Review: Required
    // Original code:
    // expect(() => createProductionNetwork(registry, {
    //   ...request, options: { ...request.options, evaluationsPerRound: 1_500 },
    // })).toThrow("每轮计算次数必须是大于零的 1000 整数倍");
    for (const evaluationsPerRound of [1, 1500, 8641]) {
      expect(() => createProductionNetwork(registry, { ...request, options: { ...request.options, evaluationsPerRound } })).not.toThrow();
    }
    for (const evaluationsPerRound of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createProductionNetwork(registry, { ...request, options: { ...request.options, evaluationsPerRound } })).toThrow("正安全整数");
    }
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
