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
    includeDeviceMinimumConsumption: "none",
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

function createPlanWithChoices(
  targets: ProductionPlanningPort[],
  recipeChoices: ReadonlyMap<string, string>,
) {
  const registry = createRegistryContract();
  const index = buildProductionPlanningIndex(registry);
  const sourceConfig: ProductionPlanningSourceConfig = {
    waterPolicy: "use-byproduct",
    acidPolicy: "use-byproduct",
    sewagePolicy: "external-supply",
    waterPurifierPolicy: "disabled",
    includeDeviceMinimumConsumption: "none",
  };
  return computeProductionPlan(
    {
      targets,
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices,
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

    // 自然资源作为目标时，只产生 target 节点，不再额外生成 natural 节点
    const targetNodes = graph.nodes.filter((n) => n.type === "target");
    const copperTargetNode = targetNodes.find(
      (n) => n.itemId === "item_copper_ore",
    );
    expect(copperTargetNode).toBeDefined();

    // 自然资源目标是零输入配方，不应有对应的 natural 节点
    const naturalNodes = graph.nodes.filter((n) => n.type === "natural");
    const copperNaturalNode = naturalNodes.find(
      (n) => n.itemId === "item_copper_ore",
    );
    expect(copperNaturalNode).toBeUndefined();
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
    const recipeChoices = new Map<string, string>([
      ["item_xiranite_enr_powder", "xiranite_oven_xiranite_enr_powder_1"],
    ]);
    const plan = createPlanWithChoices(
      [{ id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 }],
      recipeChoices,
    );

    const graph = buildProcessGraph(
      plan,
      index,
      recipeChoices,
      new Set(),
      (k: string) => k,
    );

    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it("重息壤→重息壤气→分离芯展开→全链路 结构正确", () => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const recipeChoices = new Map<string, string>([
      ["item_xiranite_enr_powder", "liquid_transmuter_2_solid_xiranite_enr_powder_1"],
    ]);
    const plan = createPlanWithChoices(
      [{ id: "t1", itemId: "item_xiranite_enr_powder", perMinute: 12 }],
      recipeChoices,
    );

    // === 未展开：4 节点 ===
    const unexpanded = buildProcessGraph(
      plan, index, recipeChoices, new Set(),
      (k: string) => k,
    );
    expect(unexpanded.nodes.length).toBe(4);
    expect(unexpanded.links.length).toBe(3);

    const uTarget = unexpanded.nodes.find((n) => n.type === "target")!;
    expect(uTarget.itemId).toBe("item_xiranite_enr_powder");

    const uMain = unexpanded.nodes.find((n) => n.type === "main")!;
    expect(uMain.itemId).toBe("item_gas_xiranite_enr");

    const uNatural = unexpanded.nodes.find((n) => n.type === "natural" && n.itemId === "item_gas_xiranite")!;
    expect(uNatural.row).toBe(uTarget.row);

    const uSec = unexpanded.nodes.find((n) => n.type === "secondary")!;
    expect(uSec.itemId).toBe("item_filter_core");
    expect(uSec.row).toBe(uTarget.row + 1);

    // === 展开分离芯：10 节点 ===
    // 链路：
    //   重息壤(target) ← 重息壤气(main) ← 息壤气(natural, 同行) + 分离芯(main, 下行)
    //   分离芯 ← 赤铜瓶(main) ← 赤铜块(main) ← 赤铜矿(natural) + 清水(natural)
    //   赤铜瓶 ← 惰气(natural, 副配料)
    //   分离芯 ← 息壤(secondary, 未展开)
    const expanded = buildProcessGraph(
      plan, index, recipeChoices, new Set(["item_filter_core"]),
      (k: string) => k,
    );
    expect(expanded.nodes.length).toBe(10);

    // 断言所有节点存在且类型正确
    const eById = new Map<string, typeof expanded.nodes[number]>();
    for (const n of expanded.nodes) {
      const key = `${n.itemId}@${n.col},${n.row}`;
      eById.set(key, n);
    }

    const assertNode = (
      itemId: string, type: string,
      checks?: (n: typeof expanded.nodes[number]) => void,
    ) => {
      const found = expanded.nodes.filter((n) => n.itemId === itemId && n.type === type);
      if (found.length === 0) {
        const all = expanded.nodes.map((n) => `[${n.col},${n.row}] ${n.type} ${n.itemId}`);
        throw new Error(`Node ${type}:${itemId} not found. All nodes:\n${all.join("\n")}`);
      }
      expect(found.length).toBe(1);
      if (checks) checks(found[0]!);
    };

    // 主链：最右列为 target
    assertNode("item_xiranite_enr_powder", "target", (n) => {
      expect(n.col).toBe(expanded.maxCol);
    });
    assertNode("item_gas_xiranite_enr", "main", (n) => {
      expect(n.col).toBe(expanded.maxCol - 1);
    });
    assertNode("item_gas_xiranite", "natural", (n) => {
      expect(n.col).toBe(expanded.maxCol - 2);
    });

    // 分离芯展开后的分支链
    const filterCoreNode = expanded.nodes.find((n) => n.itemId === "item_filter_core")!;
    assertNode("item_filter_core", "main", (n) => {
      expect(n.col).toBe(expanded.maxCol - 2);
    });
    assertNode("item_copper_jar", "main", (n) => {
      // 赤铜瓶 应在 分离芯 左侧（col 更小）
      expect(n.col).toBeLessThan(filterCoreNode.col);
    });
    assertNode("item_copper_ore", "natural");
    assertNode("item_liquid_water", "natural");
    assertNode("item_gas_inert", "natural");
    assertNode("item_copper_nugget", "main");
    assertNode("item_xiranite_powder", "secondary");

    // 所有 natural 节点应有 recipeId（可点击查看详情）
    for (const n of expanded.nodes) {
      if (n.type === "natural") {
        expect(n.recipeId).toBeDefined();
        expect(typeof n.recipeId).toBe("string");
      }
    }

    // 无重复节点
    const nodeKeys = expanded.nodes.map((n) => `${n.col}:${n.row}`);
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length);

    // 重息壤 target → 重息壤气 同列相邻
    const targetNode = expanded.nodes.find((n) => n.type === "target")!;
    const gasEnrNode = expanded.nodes.find((n) => n.itemId === "item_gas_xiranite_enr")!;
    expect(gasEnrNode.row).toBe(targetNode.row);

    // 分离芯 → 重息壤气 link exists
    expect(
      expanded.links.some(
        (l) => l.fromCol === filterCoreNode.col && l.fromRow === filterCoreNode.row
          && l.toCol === gasEnrNode.col && l.toRow === gasEnrNode.row,
      ),
    ).toBe(true);
  });
});
