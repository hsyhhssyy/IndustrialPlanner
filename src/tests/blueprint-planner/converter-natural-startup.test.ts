// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { createProductionNetwork, createRecipeNode, validatePlannerRequest } from "@/blueprint-planner/production-network";
import { planConverterSupply, converterStartupRoots } from "@/blueprint-planner/converter-supply";
import { prepareConverterStartups, scheduleConverterStartups, assertConverterAutomaticStartup } from "@/blueprint-planner/support";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import type { PlannerNetwork, PlannerWire } from "@/blueprint-planner/model";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
import { BlueprintExecutionClient } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import natural from "./fixtures/converter-natural-startup.json";

describe.each(["generated", "recognized"] as const)("外接直管供料（%s）", boundaryKind => {
  const registry = createRegistryContract();
  const recipe = registry.queries.findRecipeDefinition("liquid_transmuter_2_gas_gas_copper_enr_1")!;
  const cyclesPerMinute = 60 / recipe.durationSeconds;
  const converter = createRecipeNode(registry, recipe, "converter", cyclesPerMinute, "production");
  const solidDemand = converter.inputs.find(flow => flow.itemId === "item_copper_enr")!;
  const gasDemand = converter.inputs.find(flow => flow.itemId === "item_gas_xiranite")!;
  const warehouse = createPlainNode(registry, "unloader_1", "warehouse", "supply");
  const pipe = createPlainNode(registry, "pipe_straight_1x1", "inlet", "supply");
  const inlet = getPlannerPorts(registry, pipe.entity, pipe.definition, "input")[0]!;
  const source = boundaryKind === "generated" ? { ...pipe, external: true }
    : { ...pipe, boundaryPort: { direction: inlet.direction, groupIndex: inlet.groupIndex, portIndex: inlet.portIndex } };
  warehouse.outputs.push({ itemId: solidDemand.itemId, perMinute: solidDemand.perMinute });
  source.outputs.push({ itemId: gasDemand.itemId, perMinute: gasDemand.perMinute,
    ...(boundaryKind === "recognized" ? { storageGroupIds: [] } : {}) });
  const base = natural as BlueprintPlannerRequest;
  const network: PlannerNetwork = {
    request: {
      ...base,
      options: { ...base.options, fluidSupply: "external", converterStartup: "reject" },
      plan: {
        ...base.plan,
        targets: converter.outputs,
        externalSupplies: [...warehouse.outputs, ...source.outputs],
        recipes: [{ recipeId: recipe.id, cyclesPerMinute, deviceCount: 1,
          inputs: [solidDemand], outputs: converter.outputs, runningInputs: [gasDemand] }],
      },
    },
    nodes: [warehouse, source, converter], slotLinks: [], initialSlots: [], preferredGasCount: 0,
  };
  const connect = (supply: typeof pipe, demand: typeof gasDemand): PlannerWire => ({
    source: getPlannerPorts(registry, supply.entity, supply.definition, "output", demand.itemId)[0]!,
    target: getPlannerPorts(registry, converter.entity, converter.definition, "input", demand.itemId, demand.storageGroupIds)[0]!,
    itemIds: [demand.itemId], perMinute: demand.perMinute,
  });
  const warehouseWire = connect(warehouse, solidDemand);
  const gasWire = connect(source, gasDemand);

  it("允许仓库与外接直管分别接通原料口和耗材口时自动启动", () => {
    expect(() => assertConverterAutomaticStartup(registry, network, [warehouseWire, gasWire])).not.toThrow();
  });

  it("息壤气仍声明为外供时，断开实际耗材线路必须拒绝启动", () => {
    expect(() => assertConverterAutomaticStartup(registry, network, [warehouseWire]))
      .toThrow("当前拓扑无法从正常原料输入自动启动全部转换机。");
  });
});

describe("内生来源自动启动", () => {
  it("同时保留同物料的所有已选配方，不依赖配方顺序，首台可由不同设备产物启动", () => {
    const registry = createRegistryContract();
    for (const reverse of [false, true]) {
      const request = structuredClone(natural) as BlueprintPlannerRequest;
      if (reverse) (request.plan.recipes as unknown[]).reverse();
      expect(() => validatePlannerRequest(registry, request)).not.toThrow();
      expect(new PlannerSupplyRules(registry, request.plan).startupReachability().available.has("item_gas_xiranite")).toBe(true);
      const network = createProductionNetwork(registry, request);
      const supplies = planConverterSupply(registry, network);
      const converter = network.nodes.find(node => node.recipe?.id === "liquid_transmuter_2_gas_gas_xiranite_1")!;
      const starter = network.nodes.find(node => node.recipe?.id === "liquid_transmuter_1_gas_gas_xiranite_1")!;
      expect(supplies.find(flow => flow.entityId === converter.entity.id)?.sourceId).toBe(starter.entity.id);
      prepareConverterStartups(registry, network, new PlannerPlacement(registry, 40, 1, 1), supplies);
      expect(converterStartupRoots(registry, network).size).toBe(0);
      expect(network.nodes.some(node => node.purpose === "startup")).toBe(false);
      expect(scheduleConverterStartups(registry, network, () => 30)).toEqual([]);
    }
  });
  it("前两档同时接受自然启动及额外启动；普通配方上游也被封闭依赖时不能冒充启动器", () => {
    const registry = createRegistryContract();
    for (const mode of ["manual", "tank"] as const) {
      const request = { ...structuredClone(natural), options: { ...natural.options, converterStartup: mode } } as BlueprintPlannerRequest;
      const network = createProductionNetwork(registry, request);
      expect(planConverterSupply(registry, network, 0).some(flow => flow.sourceId === flow.entityId)).toBe(false);
      expect(planConverterSupply(registry, network, 3).some(flow => flow.sourceId === flow.entityId)).toBe(true);
    }
    const request = structuredClone(natural) as BlueprintPlannerRequest;
    const closed = { ...request.plan, recipes: request.plan.recipes.filter(recipe => !recipe.recipeId.startsWith("r_mix_pool_")),
      supplyPolicies: [{ itemId: "item_liquid_xiranite", source: "production" as const, recipeId: "liquid_transmuter_1_liquid_liquid_xiranite_1" }] };
    expect(new PlannerSupplyRules(registry, closed).startupReachability().available.has("item_gas_xiranite")).toBe(false);
  });
  it("真实生成蓝图在零启动库存、无定时补料的 Dense 场景中自动启动并达产", async () => {
    const registry = createRegistryContract(), request = structuredClone(natural) as BlueprintPlannerRequest;
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      const candidate = await createPlannerCandidate(registry, request, 0, () => undefined, () => undefined, { maxEvaluations: 50_000 });
      expect(candidate.execution.scene.scheduledSlots).toEqual([]);
      expect(Object.values(candidate.execution.blueprint.entities).some(entity => entity.definitionId === "gas_storager_1" || entity.definitionId === "liquid_storager_1")).toBe(false);
      const network = restorePlannerSeed(registry, request, candidate.seed!).network;
      const restored = { ...network };
      const starter = restored.nodes.find(node => node.recipe?.id === "liquid_transmuter_1_gas_gas_xiranite_1")!;
      const source = restored.nodes.find(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === "item_liquid_water"))!;
      const group = source.definition.storageSlotGroups[0]!;
      const before = source.outputs.length;
      const originalRequest = restored.request;
      restored.request = { ...restored.request, plan: { ...restored.request.plan,
        externalSupplies: [...restored.request.plan.externalSupplies, { itemId: "item_liquid_xiranite", perMinute: 6 }] } };
      source.outputs.push({ itemId: "item_liquid_xiranite", perMinute: 6 });
      restored.initialSlots.push({ entityId: source.entity.id, storageGroupId: group.id, slotId: group.slots[0]!.id,
        itemType: "item_liquid_xiranite", count: 1, ignoreStock: false });
      expect(() => assertConverterAutomaticStartup(registry, restored, candidate.seed!.wires)).not.toThrow();
      restored.request = originalRequest;
      source.outputs.splice(before);
      restored.initialSlots.splice(-1, 1);
      const consumption = starter.definition.recipeChannels.find(channel => channel.type === "consumption-channel")!;
      const stock = starter.definition.storageSlotGroups.find(group => consumption.ingredientStorageGroupIds.includes(group.id))!;
      restored.initialSlots.push({ entityId: starter.entity.id, storageGroupId: stock.id, slotId: stock.slots[0]!.id,
        itemType: "item_liquid_xiranite", count: 1, ignoreStock: false });
      expect(() => assertConverterAutomaticStartup(registry, restored, candidate.seed!.wires)).toThrow("启动库存");
      const report = await executor.run({ ...candidate.execution, maxWallTimeMs: 30_000 });
      expect(meetsProductionTargets(request, report)).toBe(true);
      expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
    } finally { executor.dispose(); }
  }, 60_000);
});
