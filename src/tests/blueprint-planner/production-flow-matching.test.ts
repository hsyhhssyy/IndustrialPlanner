// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import bottling from "./fixtures/bottling-plant-cycle.json";

it("最低生产台数只保留一台余量负荷，配方总产量和环境设施台数守恒", () => {
  const registry = createRegistryContract();
  const request = structuredClone(bottling) as BlueprintPlannerRequest;
  const original = structuredClone(request);
  const network = createProductionNetwork(registry, request);
  let partialGroups = 0;
  for (const plan of network.request.plan.recipes) {
    const recipe = registry.queries.findRecipeDefinition(plan.recipeId)!;
    const nodes = network.nodes.filter(node => node.recipe?.id === recipe.id);
    const count = Math.ceil(plan.deviceCount - 1e-6), capacity = 60 / recipe.durationSeconds;
    expect(nodes).toHaveLength(count);
    const rates = nodes.map(node => node.outputs[0]!.perMinute / recipe.outputs[0]!.amount);
    expect(rates.reduce((sum, rate) => sum + rate, 0)).toBeCloseTo(recipe.environmentOutput ? count * capacity : plan.cyclesPerMinute);
    expect(rates.every(rate => rate > 0 && rate <= capacity + 1e-6)).toBe(true);
    if (!recipe.environmentOutput && count === Math.ceil(plan.cyclesPerMinute / capacity - 1e-6)) {
      expect(rates.filter(rate => rate < capacity - 1e-6).length).toBeLessThanOrEqual(1);
      if (count > 1 && rates.some(rate => rate < capacity - 1e-6)) partialGroups++;
    }
  }
  expect(partialGroups).toBeGreaterThan(0);
  expect(request).toEqual(original);
});

it("显式增加的并行设备保留正负荷和总产量", () => {
  const registry = createRegistryContract();
  const original = structuredClone(bottling) as BlueprintPlannerRequest;
  const selected = original.plan.recipes.find(plan => registry.queries.findRecipeDefinition(plan.recipeId)?.machineId === "shaper_1_gas")!;
  const request = { ...original, plan: { ...original.plan, recipes: original.plan.recipes.map(plan => plan === selected
    ? { ...plan, deviceCount: Math.ceil(plan.deviceCount) + 1 } : plan) } };
  const network = createProductionNetwork(registry, request);
  const nodes = network.nodes.filter(node => node.recipe?.id === selected.recipeId);
  const rates = nodes.map(node => node.outputs[0]!.perMinute / node.recipe!.outputs[0]!.amount);
  expect(nodes).toHaveLength(Math.ceil(selected.deviceCount) + 1);
  expect(rates.every(rate => rate > 0)).toBe(true);
  expect(rates.reduce((sum, rate) => sum + rate, 0)).toBeCloseTo(selected.cyclesPerMinute);
});

it.each([false, true])("供需容量能整条匹配时不因距离或小需求先分配而拆线，保留指定来源=%s", async dedicated => {
  const registry = createRegistryContract();
  const sources = [30, 30, 15].map((rate, index) => {
    const node = createPlainNode(registry, "furnance_1", `source-${index}`, "production");
    node.entity.position = { x: 0, y: index * 10 };
    node.outputs.push({ itemId: "item_copper_nugget", perMinute: rate });
    return node;
  });
  const consumers = [30, 15, 30].map((rate, index) => {
    const node = createPlainNode(registry, "shaper_1", `consumer-${index}`, "production");
    node.entity.position = { x: 8, y: index * 10 };
    node.inputs.push({ itemId: "item_copper_nugget", perMinute: rate,
      ...(dedicated && index === 0 ? { sourceEntityIds: ["source-1"] } : {}) });
    return node;
  });
  const network: PlannerNetwork = { request: structuredClone(bottling) as BlueprintPlannerRequest,
    nodes: [...sources, ...consumers], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const wires = await wireProductionNetwork(registry, network, new PlannerPlacement(registry, 40, 0, 0, 1), undefined, true);
  expect(network.nodes).toHaveLength(6);
  expect(wires).toHaveLength(3);
  for (const wire of wires) {
    expect(sources.find(node => node.entity.id === wire.source.entityId)!.outputs[0]!.perMinute).toBe(wire.perMinute);
    expect(consumers.find(node => node.entity.id === wire.target.entityId)!.inputs[0]!.perMinute).toBe(wire.perMinute);
  }
  if (dedicated) expect(wires.find(wire => wire.target.entityId === "consumer-0")!.source.entityId).toBe("source-1");
});
