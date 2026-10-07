// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
import { addTerminals } from "@/blueprint-planner/terminals";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import { auditPlannerSupply } from "@/blueprint-planner/supply-audit";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { PlannerBatchSession, runPlannerBatch } from "@/scripts/eda/planner-runner";
import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import yazhen from "./fixtures/yazhen-syringe.json";

it.each(["local", "shared", "trunk"] as const)("45/min 的两路普通用水参与 %s 搜索，不添加支路准入口", async topology => {
  const registry = createRegistryContract();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const before = JSON.stringify(request);
  const network = createProductionNetwork(registry, request);
  const placement = new PlannerPlacement(registry, 70, 7, 2, 1);
  await placeProduction(registry, network, placement, 0);
  addTerminals(registry, network, placement, true, 2, true, 0, topology);
  const wires = await wireProductionNetwork(registry, network, placement, () => {}, true, true, topology === "trunk");
  const water = wires.filter(wire => wire.itemIds.includes("item_liquid_water"));
  const sources = network.nodes.filter(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === "item_liquid_water"));
  expect(sources).toHaveLength(1);
  expect(sources[0]!.definition.id).toBe(topology === "local" ? "udpipe_unloader_2" : "udpipe_unloader_1");
  expect(sources[0]!.outputs).toEqual([{ itemId: "item_liquid_water", perMinute: 45 }]);
  const waterNodes = network.nodes.filter(node => water.some(wire => wire.source.entityId === node.entity.id || wire.target.entityId === node.entity.id));
  expect(waterNodes.filter(node => node.definition.id === "pipe_splitter")).toHaveLength(topology === "local" ? 0 : 1);
  expect(waterNodes.filter(node => node.definition.id === "pipe_admission")).toHaveLength(0);
  // 普通成品接收端也不按目标流量放置准入口；本任务没有工作消耗输入。
  expect(network.nodes.filter(node => registry.queries.resolveLogisticsRole(node.definition.id) === "admission")).toHaveLength(0);
  expect(water.filter(wire => network.nodes.find(node => node.entity.id === wire.target.entityId)?.purpose === "production")
    .map(wire => wire.perMinute).sort((a, b) => a - b)).toEqual([15, 30]);
  const routes = wires.map(wire => ({ source: wire.source.entityId, target: wire.target.entityId,
    sourcePort: `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`,
    targetPort: `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`,
    sourceEdge: wire.source.edge, targetEdge: wire.target.edge,
    cells: Array.from({ length: wire.minimumCells ?? 0 }, () => ({ x: 0, y: 0 })), turns: 0 }));
  expect(auditPlannerSupply(registry, network, wires, routes).operatingLimits).toEqual([]);
  expect(JSON.stringify(request)).toBe(before);
});

it("五路异量普通原料可以共用单口暗管，主管逐点分流并保持每段需求守恒", async () => {
  const registry = createRegistryContract();
  const base = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const recipe = base.plan.recipes.find(entry => entry.recipeId === "r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic")!;
  const rates = [6, 12, 18, 24, 30];
  const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan,
    targets: [{ itemId: "item_liquid_plant_grass_2", perMinute: 90 }],
    externalSupplies: [{ itemId: "item_liquid_water", perMinute: 90 }, { itemId: "item_plant_grass_powder_2", perMinute: 90 }],
    infiniteItemIds: [], recipes: rates.map(perMinute => ({ ...recipe, cyclesPerMinute: perMinute, deviceCount: perMinute / 30,
      inputs: recipe.inputs.map(flow => ({ ...flow, perMinute })), outputs: recipe.outputs.map(flow => ({ ...flow, perMinute })) })),
  } };
  const network = createProductionNetwork(registry, request);
  const placement = new PlannerPlacement(registry, 70, 7, 2, 1);
  await placeProduction(registry, network, placement, 0);
  addTerminals(registry, network, placement, true, 2, true, 0, "trunk");
  const wires = await wireProductionNetwork(registry, network, placement, () => {}, true, true, true);
  const water = wires.filter(wire => wire.itemIds.includes("item_liquid_water"));
  const sources = network.nodes.filter(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === "item_liquid_water"));
  expect(sources).toHaveLength(1);
  expect(sources[0]!.definition.id).toBe("udpipe_unloader_1");
  let cursor = sources[0]!.entity.id;
  const visited = new Set<string>();
  const consumers = new Set<string>();
  for (;;) {
    const next = water.filter(wire => wire.source.entityId === cursor);
    const continuation = next.filter(wire => network.nodes.find(node => node.entity.id === wire.target.entityId)!.definition.id === "pipe_splitter");
    for (const wire of next.filter(entry => !continuation.includes(entry))) {
      expect(network.nodes.find(node => node.entity.id === wire.target.entityId)!.purpose).toBe("production");
      consumers.add(wire.target.entityId);
    }
    if (!continuation.length) break;
    expect(continuation).toHaveLength(1);
    cursor = continuation[0]!.target.entityId;
    expect(visited.has(cursor)).toBe(false);
    visited.add(cursor);
    expect(water.filter(wire => wire.source.entityId === cursor).reduce((sum, wire) => sum + wire.perMinute, 0))
      .toBe(continuation[0]!.perMinute);
  }
  expect(visited.size).toBe(4);
  expect(consumers.size).toBe(5);
  expect(water.every(wire => (wire.minimumCells ?? 0) === 0)).toBe(true);
});

it("独立重启默认尝试单口供水，真实 Dense 达到芽针目标且保持种子不变", async () => {
  const session = new PlannerBatchSession();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  try {
    const portfolio = new PlannerSearchPortfolio(request);
    const selection = portfolio.next(3);
    expect(selection.seed).toBeUndefined();
    const result = await runPlannerBatch(request, { engineKind: "dense-v2", startVariant: 3,
      attempts: 1, localEvaluations: 50_000 }, session);
    const success = result.records.find(record => record.outcome === "success");
    expect(success).toBeDefined();
    expect(success!.measuredOutputs).toContainEqual(expect.objectContaining({ id: "item_bottled_rec_hp_5", perMinute: 6 }));
    const seed = JSON.parse(readFileSync(`${success!.artifactPath}/search-seed.json`, "utf8")) as PlannerSearchSeed;
    expect(seed.network.nodes.filter(node => node.entity.definitionId.startsWith("udpipe_unloader_"))
      .map(node => node.entity.definitionId)).toEqual(["udpipe_unloader_1"]);
    expect(seed.wires.filter(wire => wire.itemIds.includes("item_liquid_water")).some(wire =>
      seed.network.nodes.find(node => node.entity.id === wire.target.entityId)!.entity.definitionId === "pipe_splitter")).toBe(true);
    const before = JSON.stringify(seed);
    portfolio.remember(seed);
    expect(portfolio.next(7).seed).toBeUndefined();
    expect(portfolio.next(8).seed).toBeDefined();
    expect(JSON.stringify(seed)).toBe(before);
  } finally { await session.dispose(); }
}, 90_000);
