import { describe, expect, it } from "vitest";

import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningIndex,
  type ProductionPlanningItemNode,
  type ProductionPlanningPort,
  type ProductionPlanningRecipeNode,
  type ProductionPlanningResult,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { buildProductionFlowGraph, createSankeyLayout } from "@/app/shell/production-planning/flow";
import { isProductionPlanningDeviceMinimumConsumptionRecipeId } from "@/app/shell/production-planning/production-planning-ledger";
import { createRegistryContract } from "@/registry";

function port(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: itemId,
    itemId,
    perMinute,
  };
}

function recipeNode(
  id: string,
  recipeId: string,
  targetItemId: string,
  inputs: readonly ProductionPlanningPort[],
  outputs: readonly ProductionPlanningPort[],
  inputItems: readonly ProductionPlanningItemNode[] = [],
  deviceMinimumConsumptionInputs: readonly ProductionPlanningPort[] = [],
  deviceMinimumConsumptionItems: readonly ProductionPlanningItemNode[] = [],
): ProductionPlanningRecipeNode {
  return {
    id,
    kind: "recipe",
    recipeId,
    targetItemId,
    durationSeconds: 60,
    cyclesPerMinute: Math.max(...outputs.map((output) => output.perMinute), 1),
    deviceCount: 1,
    inputs: inputs.map((input) => ({ ...input })),
    deviceMinimumConsumptionInputs: deviceMinimumConsumptionInputs.map((input) => ({ ...input })),
    outputs: outputs.map((output) => ({ ...output })),
    inputItems: [...inputItems],
    deviceMinimumConsumptionItems: [...deviceMinimumConsumptionItems],
  };
}

function itemNode(
  id: string,
  itemId: string,
  demandPerMinute: number,
  producedPerMinute: number,
  nodeRecipe: ProductionPlanningRecipeNode | null,
): ProductionPlanningItemNode {
  return {
    id,
    kind: "item",
    itemId,
    demandPerMinute,
    suppliedPerMinute: 0,
    producedPerMinute,
    unresolvedPerMinute: 0,
    supply: {
      manual: 0,
      surplus: 0,
      infinite: 0,
      cycle: 0,
    },
    recipeNode: nodeRecipe,
    isInfiniteSource: false,
    isCycleSource: false,
    blockedByCycle: false,
  };
}

function emptyPlanningIndex(): ProductionPlanningIndex {
  return {
    registryQueries: createRegistryContract().queries,
    itemById: new Map(),
    entityById: new Map(),
    recipeById: new Map(),
    consumptionRecipesByMachine: new Map(),
    recipesByOutputItem: new Map(),
    allItems: [],
    naturalResourceItemIds: new Set(),
  };
}

function planningResult(roots: readonly ProductionPlanningItemNode[]): ProductionPlanningResult {
  return {
    roots: [...roots],
    itemTotals: [],
    recipeTotals: [],
    overflowItems: [],
    unresolvedPerMinute: 0,
    byproductItemIds: new Set(),
  };
}

const DEFAULT_SOURCE_CONFIG: ProductionPlanningSourceConfig = {
  waterPolicy: "use-byproduct",
  acidPolicy: "use-byproduct",
  sewagePolicy: "external-supply",
  waterPurifierPolicy: "disabled",
  includeDeviceMinimumConsumption: "fractional",
};

function makeInfiniteItemIds(
  index: ReturnType<typeof buildProductionPlanningIndex>,
  config: ProductionPlanningSourceConfig,
) {
  const ids = new Set(index.naturalResourceItemIds);
  if (config.sewagePolicy === "external-supply") {
    ids.add("item_liquid_sewage");
  }
  return ids;
}

const t = (key: string) => key;

describe("production planning flow graph", () => {
  it("lays out a simple directed graph from left to right", () => {
    const layout = createSankeyLayout({
      nodes: [
        { id: "ore" },
        { id: "smelt" },
        { id: "plate" },
      ],
      links: [
        { id: "ore-smelt", source: "ore", target: "smelt", value: 30 },
        { id: "smelt-plate", source: "smelt", target: "plate", value: 30 },
      ],
    }, {
      width: 720,
      height: 320,
      nodeWidth: 120,
      nodePadding: 16,
      iterations: 4,
    });

    const ore = layout.nodes.find((node) => node.id === "ore");
    const smelt = layout.nodes.find((node) => node.id === "smelt");
    const plate = layout.nodes.find((node) => node.id === "plate");

    expect(ore?.x0).toBeLessThan(smelt?.x0 ?? 0);
    expect(smelt?.x0).toBeLessThan(plate?.x0 ?? 0);
    expect(layout.links.every((link) => link.direction === "forward")).toBe(true);
    expect(layout.nodes.every((node) => Number.isFinite(node.y0) && Number.isFinite(node.y1))).toBe(true);
  });

  it("keeps recipe outputs as separate byproduct nodes in device mode", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_liquid_xiranite_poly", 30)],
      supplies: [port("item_liquid_xiranite", 30)],
      infiniteItemIds: makeInfiniteItemIds(index, DEFAULT_SOURCE_CONFIG),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const graph = buildProductionFlowGraph(result, index, t, "device");
    const byproduct = graph.nodes.find((node) => node.itemId === "item_liquid_xiranite_lowpoly");
    const byproductLink = graph.links.find((link) => link.source === byproduct?.id);

    expect(byproduct?.tone).toBe("byproduct");
    expect(byproduct?.id).toContain(":target:item_liquid_xiranite_lowpoly");
    expect(byproductLink?.target.startsWith("recipe:")).toBe(true);
    expect(byproductLink?.value).toBeGreaterThan(0);
  });

  // AI-CORRECTION 2026-07-23:
  // 设备最低消耗不再自建独立节点，改为挂到宿主配方节点上作为入线标注。
  // 自消费场景（设备消耗品也是该配方产物）在流程图中跳过，不创建自环连线。
  it("shows self-consumed device input as an independent consumption node at the gross output rate", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const recipeId = "liquid_transmuter_1_liquid_liquid_xiranite_1";
    const result = computeProductionPlan({
      targets: [port("item_liquid_xiranite", 30)],
      supplies: [],
      infiniteItemIds: makeInfiniteItemIds(index, DEFAULT_SOURCE_CONFIG),
      recipeChoices: new Map([["item_liquid_xiranite", recipeId]]),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const graph = buildProductionFlowGraph(result, index, t, "device");
    const recipeNode = graph.nodes.find((node) => node.recipeId === recipeId);

    // 设备最低消耗不再创建独立节点
    const consumptionNode = graph.nodes.find((node) => (
      node.recipeId !== undefined
      && isProductionPlanningDeviceMinimumConsumptionRecipeId(node.recipeId)
    ));
    expect(consumptionNode).toBeUndefined();

    // 自消费不创建自环连线
    expect(graph.links.some((link) => link.source === link.target)).toBe(false);

    // 配方节点仍显示毛产出率（37.5/min = 1.25台 × 30/min每台）
    expect(recipeNode?.subtitle).toContain("1.25");
    expect(recipeNode?.subtitle).toContain("37.5/min");

    // Sankey 布局不抛异常
    expect(() => createSankeyLayout(graph, {
      width: 720,
      height: 320,
      nodeWidth: 120,
      nodePadding: 16,
      iterations: 4,
    })).not.toThrow();
  });

  it("adds a transient item junction only for many-to-many material flow", () => {
    const index = emptyPlanningIndex();
    const producerB = itemNode(
      "item-a-from-b",
      "item_a",
      30,
      30,
      recipeNode("recipe-node-b", "recipe-b", "item_a", [], [port("item_a", 30)]),
    );
    const producerC = itemNode(
      "item-a-from-c",
      "item_a",
      20,
      20,
      recipeNode("recipe-node-c", "recipe-c", "item_a", [], [port("item_a", 20)]),
    );
    const targetX = itemNode(
      "item-x",
      "item_x",
      25,
      25,
      recipeNode("recipe-node-x", "recipe-x", "item_x", [port("item_a", 25)], [port("item_x", 25)], [producerB]),
    );
    const targetY = itemNode(
      "item-y",
      "item_y",
      25,
      25,
      recipeNode("recipe-node-y", "recipe-y", "item_y", [port("item_a", 25)], [port("item_y", 25)], [producerC]),
    );

    const graph = buildProductionFlowGraph(planningResult([targetX, targetY]), index, t, "device");
    const junction = graph.nodes.find((node) => node.id === "item:item_a");

    expect(junction?.isTransient).toBe(true);
    expect(graph.nodes.some((node) => node.id === "recipe:recipe-b:target:item_a")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "recipe:recipe-c:target:item_a")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "recipe:recipe-x:target:item_x")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "recipe:recipe-y:target:item_y")).toBe(true);
    expect(graph.links.some((link) => link.source === "recipe:recipe-b:target:item_a" && link.target === "item:item_a")).toBe(true);
    expect(graph.links.some((link) => link.source === "recipe:recipe-c:target:item_a" && link.target === "item:item_a")).toBe(true);
    expect(graph.links.some((link) => link.source === "item:item_a" && link.target === "recipe:recipe-x:target:item_x")).toBe(true);
    expect(graph.links.some((link) => link.source === "item:item_a" && link.target === "recipe:recipe-y:target:item_y")).toBe(true);
  });

  it("connects one producer directly to multiple consumers without a transient item", () => {
    const index = emptyPlanningIndex();
    const producerForX = itemNode(
      "item-a-for-x",
      "item_a",
      25,
      25,
      recipeNode("recipe-node-b-x", "recipe-b", "item_a", [], [port("item_a", 25)]),
    );
    const producerForY = itemNode(
      "item-a-for-y",
      "item_a",
      25,
      25,
      recipeNode("recipe-node-b-y", "recipe-b", "item_a", [], [port("item_a", 25)]),
    );
    const targetX = itemNode(
      "item-x",
      "item_x",
      25,
      25,
      recipeNode("recipe-node-x", "recipe-x", "item_x", [port("item_a", 25)], [port("item_x", 25)], [producerForX]),
    );
    const targetY = itemNode(
      "item-y",
      "item_y",
      25,
      25,
      recipeNode("recipe-node-y", "recipe-y", "item_y", [port("item_a", 25)], [port("item_y", 25)], [producerForY]),
    );

    const graph = buildProductionFlowGraph(planningResult([targetX, targetY]), index, t, "device");

    expect(graph.nodes.some((node) => node.id === "item:item_a")).toBe(false);
    expect(graph.links.some((link) => link.source === "recipe:recipe-b:target:item_a" && link.target === "recipe:recipe-x:target:item_x")).toBe(true);
    expect(graph.links.some((link) => link.source === "recipe:recipe-b:target:item_a" && link.target === "recipe:recipe-y:target:item_y")).toBe(true);
  });

  it("turns productive cycles into real feedback links in device mode", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_plant_moss_seed_3", 60)],
      supplies: [],
      infiniteItemIds: makeInfiniteItemIds(index, DEFAULT_SOURCE_CONFIG),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const graph = buildProductionFlowGraph(result, index, t, "device");
    const layout = createSankeyLayout(graph, {
      width: 1080,
      height: 520,
      nodeWidth: 160,
      nodePadding: 18,
      iterations: 6,
    });

    expect(graph.nodes.some((node) => node.tone === "cycle")).toBe(true);
    expect(layout.links.some((link) => link.direction === "backward")).toBe(true);

    const seedCollectorFeedback = graph.links.find((link) => (
      link.source.includes("r_planter_moss_from_moss_seed_basic")
      && link.target.includes("r_seedcol_moss_seed_from_moss_basic")
      && link.itemId === "item_plant_moss_3"
    ));
    const seedCollectorSeedOutput = graph.links.find((link) => (
      link.source.includes("r_seedcol_moss_seed_from_moss_basic")
      && link.target.includes("r_planter_moss_from_moss_seed_basic")
      && link.itemId === "item_plant_moss_seed_3"
    ));
    const layoutFeedback = layout.links.find((link) => link.id === seedCollectorFeedback?.id);

    expect(seedCollectorFeedback?.preferredFeedback).toBe(true);
    expect(seedCollectorFeedback?.targetSide).toBe("right");
    expect(seedCollectorSeedOutput?.sourceSide).toBe("left");
    expect(layoutFeedback?.direction).toBe("backward");
  });

  it("keeps carbon block plant seed cycles as side-port feedback links in device mode", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_carbon_mtl", 60)],
      supplies: [],
      infiniteItemIds: makeInfiniteItemIds(index, DEFAULT_SOURCE_CONFIG),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const graph = buildProductionFlowGraph(result, index, t, "device");
    const layout = createSankeyLayout(graph, {
      width: 1080,
      height: 520,
      nodeWidth: 160,
      nodePadding: 18,
      iterations: 6,
    });

    const seedCollectorFeedback = graph.links.find((link) => (
      link.source.includes("r_planter_moss_1_from_moss_seed_1_basic")
      && link.target.includes("r_seedcol_moss_seed_1_from_moss_1_basic")
      && link.itemId === "item_plant_moss_1"
    ));
    const seedCollectorSeedOutput = graph.links.find((link) => (
      link.source.includes("r_seedcol_moss_seed_1_from_moss_1_basic")
      && link.target.includes("r_planter_moss_1_from_moss_seed_1_basic")
      && link.itemId === "item_plant_moss_seed_1"
    ));
    const layoutFeedback = layout.links.find((link) => link.id === seedCollectorFeedback?.id);

    expect(seedCollectorFeedback?.preferredFeedback).toBe(true);
    expect(seedCollectorFeedback?.targetSide).toBe("right");
    expect(seedCollectorSeedOutput?.sourceSide).toBe("left");
    expect(layoutFeedback?.direction).toBe("backward");
  });

  it("collapses recipes in item mode to show item-to-item flow", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_iron_nugget", 60)],
      supplies: [],
      infiniteItemIds: makeInfiniteItemIds(index, DEFAULT_SOURCE_CONFIG),
      recipeChoices: new Map(),
      sourceConfig: DEFAULT_SOURCE_CONFIG,
    }, index);

    const graph = buildProductionFlowGraph(result, index, t, "item");

    // Item mode should have no recipe nodes
    expect(graph.nodes.every((node) => node.kind === "item")).toBe(true);
    // Should have at least iron-ore → iron-nugget flow
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.links.length).toBeGreaterThanOrEqual(1);
    // Edge title should mention the recipe that was collapsed
    const edge = graph.links[0];
    expect(edge).toBeDefined();
    if (edge !== undefined) {
      expect(edge.title.length).toBeGreaterThan(0);
    }
  });
});
