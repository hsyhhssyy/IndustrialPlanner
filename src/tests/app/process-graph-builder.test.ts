import { describe, it, expect } from "vitest";
import {
  buildProductionPlanningIndex,
  computeProductionPlan,
  resolveProductionPlanningItemIconSrc,
  type ProductionPlanningPort,
  type ProductionPlanningSourceConfig,
} from "@/app/shell/production-planning/production-planning-model";
import { createProductionPlanningModuleCandidateId } from "@/app/shell/production-planning/production-planning-candidate";
import type { ModuleBalancingCustomModule } from "@/app/toolbox-types";
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
  supplies: ProductionPlanningPort[] = [],
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
      supplies,
      infiniteItemIds: new Set(),
      recipeChoices,
      sourceConfig,
    },
    index,
  );
}

describe("buildProcessGraph", () => {
  it("主链、原料与闭合循环不提供折叠入口，旧物品展开标记不影响图结构", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const plan = createPlan([{ id: "target", itemId: "item_plant_grass_powder_2", perMinute: 30 }]);
    const graph = buildProcessGraph(plan, index, new Map(), new Set(), key => key);
    expect(graph.nodes.some(node => node.type === "main")).toBe(true);
    expect(graph.nodes.some(node => node.type === "natural")).toBe(true);
    expect(graph.nodes.some(node => node.type === "cycle")).toBe(true);
    expect(graph.nodes.every(node => node.branch === undefined)).toBe(true);
    const staleFlags = new Set(graph.nodes.map(node => node.itemId));
    expect(buildProcessGraph(plan, index, new Map(), staleFlags, key => key)).toEqual(graph);
  });

  it.each(["item", "device"] as const)("%s 视图的同物品支线独立展开，主链同物品保持展开", displayMode => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const choices = new Map([
      ["item_xiranite_enr_powder", "liquid_transmuter_2_solid_xiranite_enr_powder_1"],
      ["item_filter_core", "tools_proc_filter_core_2"],
    ]);
    const plan = createPlanWithChoices([
      { id: "first", itemId: "item_xiranite_enr_powder", perMinute: 12 },
      { id: "second", itemId: "item_xiranite_enr_powder", perMinute: 12 },
      { id: "main", itemId: "item_filter_core", perMinute: 12 },
    ], choices);
    const collapsed = buildProcessGraph(plan, index, choices, new Set(), key => key, displayMode);
    const branches = collapsed.nodes.filter(node => node.itemId === "item_filter_core" && node.branch !== undefined);
    expect(branches).toHaveLength(2);
    expect(branches.every(node => node.branch?.expanded === false)).toBe(true);
    expect(new Set(branches.map(node => node.branch!.id)).size).toBe(2);
    const expandedId = branches[0]!.branch!.id;
    const otherId = branches[1]!.branch!.id;
    const expanded = buildProcessGraph(plan, index, choices, new Set([expandedId]), key => key, displayMode);
    expect(expanded.nodes.find(node => node.branch?.id === expandedId)?.branch?.expanded).toBe(true);
    expect(expanded.nodes.find(node => node.branch?.id === otherId)?.branch?.expanded).toBe(false);
    expect(expanded.nodes.find(node => node.type === "target" && node.itemId === "item_filter_core")?.branch).toBeUndefined();
    expect(expanded.nodes.length).toBeGreaterThan(collapsed.nodes.length);
    expect(buildProcessGraph(plan, index, choices, new Set(), key => key, displayMode)).toEqual(collapsed);
  });

  it.each(["item", "device"] as const)("%s 视图显示植物、种子及清水，闭合回路时不重复植物", displayMode => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const plantId = "item_plant_grass_2";
    const seedId = "item_plant_grass_seed_2";
    const plan = createPlanWithChoices([{ id: "target", itemId: "item_plant_grass_powder_2", perMinute: 30 }], new Map());
    const graph = buildProcessGraph(plan, index, new Map(), new Set(), key => key, displayMode);
    const plant = graph.nodes.filter(node => node.itemId === plantId);
    const seed = graph.nodes.filter(node => node.itemId === seedId);
    expect(plant).toHaveLength(1);
    expect(seed).toHaveLength(1);
    expect(seed[0]!.type).toBe("cycle");
    expect(seed[0]!.col).toBeLessThan(plant[0]!.col);
    expect(graph.nodes.some(node => node.itemId === "item_liquid_water")).toBe(true);
    if (displayMode === "device") {
      expect(graph.nodes.some(node => node.type === "device" && node.itemId === "seedcol_1")).toBe(true);
    }
  });

  it("种子作为目标时保留植物生产所需清水，外供植物不补出种子链", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const seedPlan = createPlanWithChoices([{ id: "seed", itemId: "item_plant_grass_seed_2", perMinute: 15 }], new Map());
    const seedGraph = buildProcessGraph(seedPlan, index, new Map(), new Set(), key => key);
    expect(seedGraph.nodes.filter(node => node.itemId === "item_plant_grass_seed_2")).toHaveLength(1);
    expect(seedGraph.nodes.filter(node => node.itemId === "item_plant_grass_2")).toHaveLength(1);
    expect(seedGraph.nodes.some(node => node.itemId === "item_liquid_water")).toBe(true);

    const suppliedPlan = createPlanWithChoices(
      [{ id: "target", itemId: "item_plant_grass_powder_2", perMinute: 30 }], new Map(),
      [{ id: "material", itemId: "item_plant_grass_2", perMinute: 15 }],
    );
    const suppliedGraph = buildProcessGraph(suppliedPlan, index, new Map(), new Set(), key => key);
    expect(suppliedGraph.nodes.some(node => node.itemId === "item_plant_grass_2")).toBe(true);
    expect(suppliedGraph.nodes.some(node => node.itemId === "item_plant_grass_seed_2")).toBe(false);
  });

  it("零输入农作物来源保持终端，不重复生成同一物品", () => {
    const index = buildProductionPlanningIndex(createRegistryContract());
    const plantId = "item_plant_grass_2";
    const cropRecipe = index.recipesByOutputItem.get(plantId)!.find(recipe => recipe.inputs.length === 0)!;
    expect(cropRecipe).toBeDefined();
    const choices = new Map([[plantId, cropRecipe.id]]);
    const plan = createPlanWithChoices([{ id: "target", itemId: "item_plant_grass_powder_2", perMinute: 30 }], choices);
    const graph = buildProcessGraph(plan, index, choices, new Set([plantId]), key => key);
    expect(graph.nodes.filter(node => node.itemId === plantId)).toHaveLength(1);
    expect(graph.nodes.some(node => node.itemId === "item_plant_grass_seed_2")).toBe(false);
  });

  it.each(["item", "device"] as const)("%s 视图遵循外供终端，不因配方偏好重新生成上游", (displayMode) => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const itemId = "item_xiranite_powder";
    const recipeChoices = new Map([[itemId, "xiranite_oven_xiranite_powder_1"]]);
    const plan = createPlanWithChoices(
      [{ id: "target", itemId, perMinute: 30 }], recipeChoices,
      [{ id: "material", itemId, perMinute: 30 }],
    );
    expect(plan.roots[0]!.recipeNode).toBeNull();
    const graph = buildProcessGraph(plan, index, recipeChoices, new Set([itemId]), key => key, displayMode);
    expect(graph.nodes).toEqual([expect.objectContaining({ itemId, type: "target", candidateId: undefined, recipeId: undefined })]);
    expect(graph.links).toEqual([]);
  });

  it.each([30, 60])("主链原料外供 %i/min 时与求解器保持一致，部分外供保留生产分支", (perMinute) => {
    const registry = createRegistryContract();
    const index = buildProductionPlanningIndex(registry);
    const recipeChoices = new Map([["item_xiranite_powder", "xiranite_oven_xiranite_powder_1"]]);
    const plan = createPlanWithChoices(
      [{ id: "target", itemId: "item_xiranite_powder", perMinute: 30 }], recipeChoices,
      [{ id: "material", itemId: "item_carbon_enr", perMinute }],
    );
    const solvedMaterial = plan.roots[0]!.recipeNode!.inputItems.find(node => node.itemId === "item_carbon_enr")!;
    const graph = buildProcessGraph(plan, index, recipeChoices, new Set(["item_carbon_enr"]), key => key);
    const material = graph.nodes.find(node => node.itemId === "item_carbon_enr")!;
    if (perMinute === 60) {
      expect(solvedMaterial.recipeNode).toBeNull();
      expect(material.candidateId).toBeUndefined();
      expect(graph.links.some(link => link.toCol === material.col && link.toRow === material.row)).toBe(false);
    } else {
      expect(solvedMaterial.recipeNode).not.toBeNull();
      expect(material.candidateId).toBe(solvedMaterial.recipeNode!.candidateId);
      expect(graph.links.some(link => link.toCol === material.col && link.toRow === material.row)).toBe(true);
    }
  });

  it("keeps every selected module icon item in device view", () => {
    const registry = createRegistryContract();
    const module: ModuleBalancingCustomModule = {
      schemaVersion: 2,
      id: "custom-iron",
      name: "Iron Module",
      color: "#4f8cff",
      iconItemIds: ["item_iron_nugget", "item_iron_ore"],
      notes: "",
      inputs: [{ itemId: "item_iron_ore", perMinute: 60 }],
      outputs: [{ itemId: "item_iron_nugget", perMinute: 60 }],
      sourceType: "custom",
    };
    const index = buildProductionPlanningIndex(registry, { modules: [module] });
    const candidateId = createProductionPlanningModuleCandidateId("custom", module.id);
    const plan = computeProductionPlan({
      targets: [{ id: "target", itemId: "item_iron_nugget", perMinute: 60 }],
      supplies: [],
      infiniteItemIds: new Set(),
      recipeChoices: new Map([["item_iron_nugget", candidateId]]),
      sourceConfig: {
        waterPolicy: "use-byproduct",
        acidPolicy: "use-byproduct",
        sewagePolicy: "external-supply",
        waterPurifierPolicy: "disabled",
        includeDeviceMinimumConsumption: "none",
      },
      useModules: true,
    }, index);

    const graph = buildProcessGraph(
      plan,
      index,
      new Map([["item_iron_nugget", candidateId]]),
      new Set(),
      (key) => key,
      "device",
    );
    const moduleNode = graph.nodes.find((node) => node.type === "device" && node.itemId === module.id);

    expect(moduleNode?.iconSrcs).toEqual(module.iconItemIds.map((itemId) => (
      resolveProductionPlanningItemIconSrc(itemId, index)
    )));
  });

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
    // AI-CORRECTION 2026-09-01: 赤铜采集已恢复清水输入；赤铜仍不重复为 natural 节点，但工序图必须显示其清水条件。
    const naturalNodes = graph.nodes.filter((n) => n.type === "natural");
    const copperNaturalNode = naturalNodes.find(
      (n) => n.itemId === "item_copper_ore",
    );
    expect(copperNaturalNode).toBeUndefined();

    const waterNaturalNode = naturalNodes.find(
      (n) => n.itemId === "item_liquid_water",
    );
    expect(waterNaturalNode).toMatchObject({ amount: 1 });
    expect(graph.links).toContainEqual(expect.objectContaining({
      fromCol: waterNaturalNode?.col,
      fromRow: waterNaturalNode?.row,
      toCol: copperTargetNode?.col,
      toRow: copperTargetNode?.row,
    }));
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
        expect(node.branch).toEqual({ id: expect.any(String), expanded: false });
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
      const expandId = secondaryNodes[0]!.branch!.id;
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
      // 2026-10-26：只有确实有子级的支线提供展开入口，点击后必须增加节点。
      expect(expanded.nodes.length).toBeGreaterThan(baseGraph.nodes.length);
      expect(expanded.nodes.find(node => node.branch?.id === expandId)?.branch?.expanded).toBe(true);
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
      ["item_filter_core", "tools_proc_filter_core_2"],
      ["item_copper_nugget", "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic"],
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
      plan, index, recipeChoices, new Set([uSec.branch!.id]),
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
