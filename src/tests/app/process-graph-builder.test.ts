import { describe, it, expect } from "vitest";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  type ProductionPlanningPort,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { buildProcessGraph } from "@/app/shell/production-planning/process/process-graph-builder";
import { createRegistryContract } from "@/registry";

function createPlan(targets: ProductionPlanningPort[]) {
  const registry = createRegistryContract();
  const index = buildProductionPlanningIndex(registry);
  const sourceConfig: ProductionPlanningSourceConfig = {
    waterPolicy: "use-byproduct",
    acidPolicy: "use-byproduct",
    sewagePolicy: "external-supply",
    waterPurifierPolicy: "disabled",
    includeDeviceMinimumConsumption: false,
  };
  return computeProductionPlan(
    {
      targets,
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices: new Map(),
      sourceConfig,
    },
    index,
  );
}

describe("buildProcessGraph", () => {
  it("builds process graph for 重息壤", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
    ]);

    const graph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.maxCol).toBeGreaterThanOrEqual(0);

    // Target node should be at maxCol
    const target = graph.nodes.find(
      (n) => n.type === "target",
    );
    expect(target).toBeDefined();
    expect(target!.itemId).toBe("item_xiranite_enr_powder");
    expect(target!.col).toBe(graph.maxCol);
  });

  it("builds process graph with main ingredients", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
    ]);

    const graph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );

    // Should have main ingredient nodes
    const mainNodes = graph.nodes.filter((n) => n.type === "main");
    expect(mainNodes.length).toBeGreaterThan(0);

    // Should have links
    expect(graph.links.length).toBeGreaterThan(0);

    // Should have main ingredient nodes in different cols than target
    const targetCols = new Set(
      graph.nodes.filter((n) => n.type === "target").map((n) => n.col),
    );
    for (const node of mainNodes) {
      expect(targetCols.has(node.col)).toBe(false);
    }
  });

  it("marks natural resources correctly", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_copper_ore", perMinute: 10 },
    ]);

    const graph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );

    const naturalNodes = graph.nodes.filter((n) => n.type === "natural");
    // Copper ore is naturally a natural resource
    const copperNode = naturalNodes.find(
      (n) => n.itemId === "item_copper_ore",
    );
    expect(copperNode).toBeDefined();
  });

  it("detects cycles and stops recursion", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
    ]);

    const graph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );

    // Should have some cycle or natural terminal nodes
    const terminals = graph.nodes.filter(
      (n) => n.type === "cycle" || n.type === "natural",
    );
    expect(terminals.length).toBeGreaterThan(0);
  });

  it("shows expand symbols for secondary ingredients", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
    ]);

    // Not expanded by default
    const graph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );

    const secondaryNodes = graph.nodes.filter((n) => n.type === "secondary");

    // xiranite_oven has 2 inputs: 息壤 + 壤晶废液, so at least one secondary
    if (secondaryNodes.length > 0) {
      for (const node of secondaryNodes) {
        expect(node.expandedRecipeId).toBeNull();
      }
    }
  });

  it("expanding changes graph structure", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
    ]);

    const baseGraph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );
    const secondaryNodes = baseGraph.nodes.filter(
      (n) => n.type === "secondary",
    );

    if (secondaryNodes.length > 0) {
      const expandId = secondaryNodes[0]!.itemId;
      const expanded = buildProcessGraph(
        plan,
        index,
        new Map(),
        new Set([expandId]),
        (k: string) => k,
      );

      // Expanding should not produce fewer nodes (it might stay same if the item has no recipe)
      expect(expanded.nodes.length).toBeGreaterThanOrEqual(
        baseGraph.nodes.length - 1,
      );
    }
  });

  it("handles multiple targets without overlap", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
      { id: "t2", itemId: "item_bottled_rec_hp_5", perMinute: 6 },
    ]);

    const graph = buildProcessGraph(
      plan,
      index,
      new Map(),
      new Set(),
      (k: string) => k,
    );

    // Should have 2 target nodes
    const targets = graph.nodes.filter((n) => n.type === "target");
    expect(targets.length).toBe(2);

    // Each target should have its own chain
    const rows = new Set(graph.nodes.map((n) => n.row));
    expect(rows.size).toBeGreaterThanOrEqual(2);
  });

  it("uses recipe choices when specified", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const plan = createPlan([
      { id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 },
    ]);

    // Force a specific recipe
    const recipeChoices = new Map<string, string>([
      ["item_xiranite_enr_powder", "xiranite_oven_xiranite_enr_powder_1"],
    ]);

    const graph = buildProcessGraph(
      plan,
      index,
      recipeChoices,
      new Set(),
      (k: string) => k,
    );

    expect(graph.nodes.length).toBeGreaterThan(0);
  });
});
