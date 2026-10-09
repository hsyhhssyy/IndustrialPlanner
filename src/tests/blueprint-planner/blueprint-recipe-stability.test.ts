// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { SimulationBlueprintRunRequest } from "@/domain/simulation";
import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { assertBlueprintRecognition, blueprintMaterialGraph } from "@/blueprint-planner/blueprint-analysis";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

const directory = "src/tests/fixtures/blueprints/blueprint-planner/recipe-stability/";
const ordinaryRecipe = "liquid_purifier_gas_copper_enr_1";
const enhancedRecipe = "liquid_purifier_gas_copper_enr_2";
const reactorRecipes = ["r_mix_pool_liquid_plant_grass_1_from_powder_and_water_basic",
  "r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic"];
const gasPatch: SimulationRuntimeSlotPatch = { entityId: "gas-diffuser", storageGroupId: "consume_buffer",
  slotId: "consume_slot", itemType: "item_gas_inert", count: 5, ignoreStock: false };

function setup(path = `${directory}gas-purifier.schema7.json`) {
  const registry = createRegistryContract();
  const workspace: WorkspaceContract = { state: createWorkspaceState(), registry,
    app: null, audio: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  const host = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  const blueprint = loadBlueprintFromFile(path);
  const request: SimulationBlueprintRunRequest = { blueprint, engine: { kind: "dense-v2", ticksPerSecond: 2 },
    scene: { externalEntities: [], externalSlotLinks: [], initialSlots: [], powerMode: "infinite" },
    probes: [], warmupSeconds: 8, observationSeconds: 12, inventorySampleCount: 5, maxWallTimeMs: 10_000,
    activeActivityIds: [], collectAnalysis: true };
  return { registry, host, request, input: { blueprint, boundaries: [], activeActivityIds: [] } };
}

describe("蓝图配方稳定性以正式观察期的设备整体组合为准", () => {
  it("配方在真实生产通道之间交换，整体组合相同且允许暂时空闲", async () => {
    const env = setup(`${directory}multichannel-auto.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 0, observationSeconds: 16,
        scene: { ...env.request.scene, scheduledSlots: [{ simulationSeconds: 3, patch: {
          entityId: "source-1", storageGroupId: "infinite_output_buffer", slotId: "infinite_output_slot_1",
          itemType: "item_plant_grass_powder_1", count: 50, ignoreStock: false } }] } });
      expect(report.status).toBe("completed");
      const channels = report.analysis!.channels.filter(channel => channel.entityId === "reactor");
      expect(channels.find(channel => channel.channelId === "ch1")!.observedRecipeIds).toEqual(reactorRecipes);
      expect(channels.find(channel => channel.channelId === "ch2")!.observedRecipeIds).toEqual([...reactorRecipes].reverse());
      const combinations = report.analysis!.recipeCombinations.filter(row => row.entityId === "reactor");
      expect(combinations.map(row => row.recipeIds)).toEqual([[], reactorRecipes, [reactorRecipes[1]]]);
      expect(combinations.find(row => row.recipeIds.length === 2)!.windowSampleCounts.every(count => count > 0)).toBe(true);
      expect(combinations.reduce((sum, row) => sum + row.windowSampleCounts.reduce((total, count) => total + count, 0), 0)).toBe(33);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).not.toThrow();
    } finally { env.host.dispose(); }
  });

  it("自动设备运行一套已知配方时，保留共享库存的三个全程空闲通道", async () => {
    const env = setup(`${directory}multichannel-idle.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint(env.request);
      expect(report.status).toBe("completed");
      const channels = report.analysis!.channels.filter(channel => channel.entityId === "reactor");
      expect(channels.map(channel => channel.observedRecipeIds)).toEqual([[reactorRecipes[0]], [], [], []]);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).not.toThrow();
    } finally { env.host.dispose(); }
  });

  it("完整组合已在观察期出现，后续单独运行组合中的一个配方也接受", async () => {
    const env = setup(`${directory}multichannel-auto.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 0, observationSeconds: 16 });
      expect(report.status).toBe("completed");
      const combinations = report.analysis!.recipeCombinations.filter(row => row.entityId === "reactor");
      expect(combinations.find(row => row.recipeIds.length === 2)!.windowSampleCounts).toEqual([4, 0, 0, 0]);
      expect(combinations.find(row => row.recipeIds.length === 1)!.recipeIds).toEqual([reactorRecipes[1]]);
      // AI-REMOVED 2026-10-08:
      // Reason: 用户明确允许完整组合中的单个配方独立出现，不要求每个窗口出现完整组合。
      // Trigger: 用户确认组合观测契约并补充单配方接受规则。
      // Evidence: 本场景观察初期实际运行 A+B，后续只运行其中的 B。
      // Replacement: 下方接受子组合的断言。
      // Risk: Low；设备出口产率和库存稳态仍须单独验收。
      // Human Review: Required
      // Original code:
      // expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).not.toThrow();
    } finally { env.host.dispose(); }
  });

  it("全程空闲的自动生产设备没有完整组合证据，仍拒绝未知配方", async () => {
    const env = setup(`${directory}multichannel-idle.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, scene: { ...env.request.scene,
        initialSlots: [{ entityId: "reactor", storageGroupId: "shared_input_buffer", slotId: "input_slot_1",
          itemType: "item_plant_grass_powder_1", count: 0, ignoreStock: false }] } });
      expect(report.status).toBe("completed");
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("无法确定设备");
    } finally { env.host.dispose(); }
  });

  it("多通道设备串行运行 A 和 B，也不能把历史合集当作完整组合", async () => {
    const env = setup(`${directory}multichannel-idle.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 0, observationSeconds: 16,
        scene: { ...env.request.scene, scheduledSlots: [{ simulationSeconds: 8, patch: {
          entityId: "reactor", storageGroupId: "shared_input_buffer", slotId: "input_slot_1",
          itemType: "item_plant_grass_powder_2", count: 50, ignoreStock: false } }] } });
      expect(report.status).toBe("completed");
      const combinations = report.analysis!.recipeCombinations.filter(row => row.entityId === "reactor");
      expect(combinations.map(row => row.recipeIds)).toEqual([[], ...reactorRecipes.map(id => [id])]);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
    } finally { env.host.dispose(); }
  });

  it("实际出现完整 A+B 后又运行组合外的 C，仍拒绝", async () => {
    const env = setup(`${directory}multichannel-auto.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 0, observationSeconds: 16,
        scene: { ...env.request.scene, scheduledSlots: [{ simulationSeconds: 8, patch: {
          entityId: "reactor", storageGroupId: "shared_input_buffer", slotId: "input_slot_2",
          itemType: "item_xiranite_powder", count: 50, ignoreStock: false } }] } });
      expect(report.status).toBe("completed");
      const combinations = report.analysis!.recipeCombinations.filter(row => row.entityId === "reactor");
      expect(combinations.some(row => row.recipeIds.join() === reactorRecipes.join())).toBe(true);
      expect(combinations.some(row => row.recipeIds.includes("r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic"))).toBe(true);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
    } finally { env.host.dispose(); }
  });

  it("旧分析报告缺少同时运行的组合证据时要求重新识别", async () => {
    const env = setup(`${directory}multichannel-idle.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint(env.request);
      expect(report.status).toBe("completed");
      const legacy = structuredClone(report);
      Reflect.deleteProperty(legacy.analysis!, "recipeCombinations");
      expect(() => assertBlueprintRecognition(env.registry, env.input, legacy)).toThrow("请重新识别蓝图");
    } finally { env.host.dispose(); }
  });

  it("手动配置明确的空闲配方可以保留，未配置的手动通道保持关闭", async () => {
    const env = setup(`${directory}multichannel-manual.schema7.json`);
    try {
      const report = await env.host.actions.runBlueprint(env.request);
      expect(report.status).toBe("completed");
      expect(report.analysis!.channels.filter(channel => channel.entityId === "reactor")
        .every(channel => channel.manual && channel.observedRecipeIds.length === 0)).toBe(true);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).not.toThrow();
    } finally { env.host.dispose(); }
  });

  it("预热确实运行普通配方，随后稳定运行增强配方；两个静态候选不阻止识别", async () => {
    const env = setup();
    const scene = { ...env.request.scene, scheduledSlots: [3, 11].map(simulationSeconds => ({ simulationSeconds, patch: gasPatch })) };
    try {
      const startup = await env.host.actions.runBlueprint({ ...env.request, scene, warmupSeconds: 0, observationSeconds: 20 });
      expect(startup.status).toBe("completed");
      expect(startup.analysis!.channels.find(channel => channel.entityId === "purifier")!.observedRecipeIds)
        .toEqual([ordinaryRecipe, enhancedRecipe]);
      const report = await env.host.actions.runBlueprint({ ...env.request, scene });
      expect(report.status).toBe("completed");
      expect(report.analysis!.channels.find(channel => channel.entityId === "purifier")!.observedRecipeIds)
        .toEqual([enhancedRecipe]);
      expect(report.analysis!.recipeCombinations.filter(row => row.entityId === "purifier").map(row => row.recipeIds))
        .toEqual([[enhancedRecipe]]);
      const gasCombination = report.analysis!.recipeCombinations.find(row => row.entityId === "gas-diffuser")!;
      expect(gasCombination.recipeIds).toEqual(Array.from({ length: 5 }, () => "r_gas_diffuser_inert_gas_environment_basic"));
      expect(gasCombination.windowSampleCounts).toEqual([7, 6, 6, 6]);
      const graph = blueprintMaterialGraph(env.registry, env.input.blueprint, report.analysis!, []);
      expect(graph.possibleRecipes.get("purifier/default")).toEqual(new Set([ordinaryRecipe, enhancedRecipe]));
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).not.toThrow();
    } finally { env.host.dispose(); }
  });

  it("零预热时不会漏掉观察初期的配方切换", async () => {
    const env = setup();
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 0, observationSeconds: 20,
        scene: { ...env.request.scene, scheduledSlots: [3, 11].map(simulationSeconds => ({ simulationSeconds, patch: gasPatch })) } });
      expect(report.status).toBe("completed");
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
    } finally { env.host.dispose(); }
  });

  it("旧配方在首个观察 tick 结束，仍保留观察起点的半 tick 运行证据", async () => {
    const env = setup();
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 2, observationSeconds: 8,
        scene: { ...env.request.scene, scheduledSlots: [{ simulationSeconds: 1.5, patch: gasPatch }] } });
      expect(report.status).toBe("completed");
      expect(report.analysis!.channels.find(channel => channel.entityId === "purifier")!.observedRecipeIds)
        .toEqual([ordinaryRecipe, enhancedRecipe]);
      expect(report.analysis!.recipeCombinations.find(row => row.entityId === "purifier"
        && row.recipeIds.includes(ordinaryRecipe))!.windowSampleCounts).toEqual([1, 0, 0, 0]);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
    } finally { env.host.dispose(); }
  });

  it("无气体环境时稳定运行普通配方，不因静态增强候选而被拒绝", async () => {
    const env = setup();
    try {
      const report = await env.host.actions.runBlueprint(env.request);
      expect(report.status).toBe("completed");
      expect(report.analysis!.channels.find(channel => channel.entityId === "purifier")!.observedRecipeIds)
        .toEqual([ordinaryRecipe]);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).not.toThrow();
    } finally { env.host.dispose(); }
  });

  it("正式观察期内震荡供气导致两种消耗配方交替时拒绝识别", async () => {
    const env = setup();
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, observationSeconds: 32,
        scene: { ...env.request.scene, scheduledSlots: [0, 16, 32].map(simulationSeconds => ({ simulationSeconds,
          patch: { ...gasPatch, count: 1 } })) } });
      expect(report.status).toBe("completed");
      expect(new Set(report.analysis!.channels.find(channel => channel.entityId === "purifier")!.observedRecipeIds))
        .toEqual(new Set([ordinaryRecipe, enhancedRecipe]));
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
    } finally { env.host.dispose(); }
  });

  it("交替输入原料时，即使产物相同也拒绝两个实际配方", async () => {
    const env = setup(`${directory}alternating-ingredients.schema7.json`);
    const patch: SimulationRuntimeSlotPatch = { entityId: "furnace", storageGroupId: "item_input_buffer",
      slotId: "input_item_slot_1", itemType: "item_plant_moss_2", count: 50, ignoreStock: false };
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, observationSeconds: 32,
        scene: { ...env.request.scene, scheduledSlots: [10, 20, 30].map((simulationSeconds, index) => ({ simulationSeconds,
          patch: { ...patch, itemType: index % 2 === 0 ? "item_plant_moss_2" : "item_plant_moss_1" } })) } });
      expect(report.status).toBe("completed");
      expect(report.analysis!.channels.find(channel => channel.entityId === "furnace")!.observedRecipeIds)
        .toEqual(["r_furnace_carbon_mtl_from_moss_1_basic", "r_furnace_carbon_mtl_from_moss_2_basic"]);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("观察期内配方未稳定");
    } finally { env.host.dispose(); }
  });

  it("预热中已传送的另一种物品仍保留证据，不能被观察期覆盖", async () => {
    const env = setup(`${directory}prewarm-material-history.schema7.json`);
    const group = env.registry.queries.findEntityDefinition("storager_1")!.storageSlotGroups[0]!;
    const patch: SimulationRuntimeSlotPatch = { entityId: "source-storage", storageGroupId: group.id,
      slotId: group.slots[0]!.id, itemType: "item_iron_ore", count: 1, ignoreStock: false };
    try {
      const report = await env.host.actions.runBlueprint({ ...env.request, warmupSeconds: 12, observationSeconds: 8,
        scene: { ...env.request.scene, initialSlots: [patch],
          scheduledSlots: [{ simulationSeconds: 8, patch: { ...patch, itemType: "item_copper_ore", count: 6 } }] } });
      expect(report.status).toBe("completed");
      const early = report.analysis!.transfers.filter(transfer => transfer.itemId === "item_iron_ore");
      expect(early.length).toBeGreaterThan(0);
      expect(early.every(transfer => transfer.totalAmount > 0 && transfer.windowAmounts.every(amount => amount === 0))).toBe(true);
      expect(report.analysis!.transfers.some(transfer => transfer.itemId === "item_copper_ore"
        && transfer.windowAmounts.some(amount => amount > 0))).toBe(true);
      expect(() => assertBlueprintRecognition(env.registry, env.input, report)).toThrow("疑似混带");
    } finally { env.host.dispose(); }
  });
});
