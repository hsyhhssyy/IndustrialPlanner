import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PLANNING_SPECIAL_INFINITE_ITEM_IDS,
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningPort,
} from "@/app/shell/production-planning/production-planning-model";
import { buildProductionFlowGraph, createSankeyLayout } from "@/app/shell/production-planning/flow";
import { createRegistryContract } from "@/registry";

function port(itemId: string, perMinute: number): ProductionPlanningPort {
  return {
    id: itemId,
    itemId,
    perMinute,
  };
}

function createInfiniteItemIds(index: ReturnType<typeof buildProductionPlanningIndex>, extra: string[] = []) {
  return new Set([
    ...index.naturalResourceItemIds,
    ...PRODUCTION_PLANNING_SPECIAL_INFINITE_ITEM_IDS,
    ...extra,
  ]);
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
      infiniteItemIds: createInfiniteItemIds(index, ["item_liquid_sewage"]),
      recipeChoices: new Map([[
        "item_liquid_xiranite_poly",
        "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic",
      ]]),
    }, index);

    const graph = buildProductionFlowGraph(result, index, t, "device");
    const byproduct = graph.nodes.find((node) => node.itemId === "item_liquid_xiranite_lowpoly");
    const byproductLink = graph.links.find((link) => link.target === byproduct?.id);

    expect(byproduct?.tone).toBe("byproduct");
    expect(byproductLink?.source.startsWith("recipe:")).toBe(true);
    expect(byproductLink?.value).toBeGreaterThan(0);
  });

  it("turns productive cycles into real feedback links in device mode", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_plant_moss_seed_3", 60)],
      supplies: [],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map(),
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
  });

  it("collapses recipes in item mode to show item-to-item flow", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const result = computeProductionPlan({
      targets: [port("item_iron_nugget", 60)],
      supplies: [],
      infiniteItemIds: createInfiniteItemIds(index),
      recipeChoices: new Map(),
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
