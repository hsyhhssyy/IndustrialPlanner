// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { converterStartupRoots, planConverterSupply } from "@/blueprint-planner/converter-supply";
import { configureConverterStartupInventory, prepareConverterStartups, scheduleConverterStartups } from "@/blueprint-planner/support";
import { PlannerPlacement, createPlainNode } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import type { PlannerWire } from "@/blueprint-planner/model";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { materialBalance } from "@/blueprint-planner/terminals";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
import { BlueprintExecutionClient } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import { saveSuccessfulPlanning } from "@/scripts/eda/artifacts";
import { blueprintRecognitionScene } from "@/blueprint-planner/blueprint-scene";
import { identifyBlueprintNetwork } from "@/blueprint-planner/blueprint-network";
import { assertBlueprintPreserved } from "@/blueprint-planner/blueprint-constraints";
import { withBlueprintConverterStartup } from "@/blueprint-planner/blueprint-startup";
import type { BlueprintPlannerBlueprintInput } from "@/domain/blueprint-planner";
import gas from "./fixtures/converter-startup-gas.json";

function fiveMachines(mode: "manual" | "tank"): BlueprintPlannerRequest {
  const base = gas as BlueprintPlannerRequest;
  const scale = (flow: { itemId: string; perMinute: number }) => ({ ...flow, perMinute: flow.perMinute * 5 });
  return { ...base, options: { ...base.options, converterStartup: mode }, plan: { ...base.plan,
    targets: base.plan.targets.map(scale), externalSupplies: base.plan.externalSupplies.map(scale),
    recipes: base.plan.recipes.map(recipe => ({ ...recipe, deviceCount: 5, cyclesPerMinute: recipe.cyclesPerMinute * 5,
      inputs: recipe.inputs.map(scale), outputs: recipe.outputs.map(scale), runningInputs: recipe.runningInputs.map(scale) })) } };
}

describe("供气关系决定启动根与流量", () => {
  it.each([
    { variant: 0, providers: [0, 0, 0, 0, 0], roots: [0] },
    { variant: 2, providers: [0, 0, 0, 1, 1], roots: [0] },
    { variant: 15, providers: [0, 0, 0, 3, 3], roots: [0, 3] },
  ])("五机组合 $variant 保持净产量，手动和储罐只作用于根", ({ variant, providers, roots }) => {
    const registry = createRegistryContract();
    for (const mode of ["manual", "tank"] as const) {
      const request = fiveMachines(mode), network = createProductionNetwork(registry, request);
      const plan = planConverterSupply(registry, network, variant);
      expect([...plan].sort((a, b) => a.entityId.localeCompare(b.entityId)).map(flow => flow.sourceId)).toEqual(providers.map(id => `eda-device-${id}`));
      for (const node of network.nodes) expect(plan.filter(flow => flow.sourceId === node.entity.id).reduce((sum, flow) => sum + flow.perMinute, 0))
        .toBeLessThanOrEqual(node.outputs[0]!.perMinute);
      prepareConverterStartups(registry, network, new PlannerPlacement(registry, 40, 7, 2), plan);
      // AI-REMOVED 2026-10-10:
      // Reason: materialBalance 返回扣除目标后的余量，不是设备净产量。
      // Trigger: 用户授权修正本次新增测试的错误。
      // Evidence: terminals.ts 明确扣除 plan.targets；五机净产量及目标均为 120/min。
      // Replacement: 下方分别断言余量为 0、设备净产量为 120/min。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // expect(materialBalance(network).get("item_gas_xiranite")).toBe(120);
      expect(materialBalance(network).get("item_gas_xiranite")).toBe(0);
      const netProduction = network.nodes.filter(node => node.recipe).reduce((total, node) => total
        + node.outputs.filter(flow => flow.itemId === "item_gas_xiranite").reduce((sum, flow) => sum + flow.perMinute, 0)
        - node.inputs.filter(flow => flow.itemId === "item_gas_xiranite").reduce((sum, flow) => sum + flow.perMinute, 0), 0);
      expect(netProduction).toBe(120);
      expect([...converterStartupRoots(registry, network)].sort()).toEqual(roots.map(id => `eda-device-${id}`));
      const tanks = network.nodes.filter(node => node.purpose === "startup");
      expect(tanks).toHaveLength(mode === "tank" ? roots.length : 0);
      expect(scheduleConverterStartups(registry, network, () => 20).map(entry => entry.patch.entityId)).toEqual(mode === "manual" ? roots.map(id => `eda-device-${id}`) : []);
      configureConverterStartupInventory(network, () => 30);
      for (const tank of tanks) expect(tank.entity.config["storageSlotGroups[0].slots[0].initialCount"]).toBe(9);
      const seed = capturePlannerSeed(request, network, [], [], 40, 44);
      const restored = restorePlannerSeed(registry, request, JSON.parse(JSON.stringify(seed)));
      expect([...converterStartupRoots(registry, restored.network)].sort()).toEqual(roots.map(id => `eda-device-${id}`));
      expect(restored.network.nodes.map(node => node.inputs)).toEqual(network.nodes.map(node => node.inputs));
    }
  });

  it("产能不足以供五台时转交下游，拒绝不足以维持自身的启动根", () => {
    const registry = createRegistryContract(), network = createProductionNetwork(registry, fiveMachines("manual"));
    network.nodes[0]!.outputs[0] = { ...network.nodes[0]!.outputs[0]!, perMinute: 12 };
    const plan = planConverterSupply(registry, network);
    expect(plan.filter(flow => flow.sourceId === "eda-device-0")).toHaveLength(2);
    expect(plan.find(flow => flow.entityId === "eda-device-2")!.sourceId).toBe("eda-device-1");
    network.nodes[0]!.outputs[0] = { ...network.nodes[0]!.outputs[0]!, perMinute: 5 };
    expect(() => planConverterSupply(registry, network)).toThrow("不足以维持自身耗材");
  });

  it("手动启动只选依赖图的源 SCC，互供环与独立组分别启动", () => {
    const registry = createRegistryContract(), network = createProductionNetwork(registry, fiveMachines("manual"));
    const providers = [1, 0, 0, 3, 3];
    const supplies = planConverterSupply(registry, network).map(entry => ({ ...entry,
      sourceId: `eda-device-${providers[Number(entry.entityId.split("-").at(-1))]!}` }));
    prepareConverterStartups(registry, network, new PlannerPlacement(registry, 40, 7, 2), supplies);
    expect([...converterStartupRoots(registry, network)].sort()).toEqual(["eda-device-0", "eda-device-3"]);
    expect(scheduleConverterStartups(registry, network, () => 20)).toHaveLength(2);
  });

  it("相同息壤气穿过桥接器的独立通道，不把 A、D 两个启动根合并", () => {
    const registry = createRegistryContract(), network = createProductionNetwork(registry, fiveMachines("manual"));
    const bridge = createPlainNode(registry, "pipe_connector", "crossing", "logistics");
    network.nodes.push(bridge);
    // AI-REMOVED 2026-10-10:
    // Reason: 原夹具取前两个输入口，实际均绑定 ns_buffer，没有覆盖独立通道。
    // Trigger: 用户授权修正本次新增桥接器测试。
    // Evidence: Registry 定义 N/S 共用 ns_buffer，W/E 共用 ew_buffer。
    // Replacement: 下方按库存通道选取一个入口，再验证 A、D 两个启动根。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // const ins = getPlannerPorts(registry, bridge.entity, bridge.definition, "input");
    const outs = getPlannerPorts(registry, bridge.entity, bridge.definition, "output");
    const groups = (port: PlannerWire["source"]) => bridge.definition.portStorageBindings.filter(binding =>
      binding.portGroupId === bridge.definition.portGroups[port.groupIndex]!.id).map(binding => binding.storageSlotGroupId);
    const ins = getPlannerPorts(registry, bridge.entity, bridge.definition, "input").filter((port, index, ports) =>
      ports.findIndex(other => groups(other).some(group => groups(port).includes(group))) === index);
    expect(ins).toHaveLength(2);
    expect(groups(ins[0]!).some(group => groups(ins[1]!).includes(group))).toBe(false);
    const paired = ins.map(inlet => outs.find(outlet => groups(outlet).some(group => groups(inlet).includes(group)))!);
    expect(paired[0]).not.toEqual(paired[1]);
    const port = (index: number, direction: "input" | "output") => {
      const node = network.nodes[index]!;
      return getPlannerPorts(registry, node.entity, node.definition, direction, "item_gas_xiranite",
        direction === "input" ? ["consume_buffer"] : undefined)[0]!;
    };
    const connect = (source: PlannerWire["source"], target: PlannerWire["target"]): PlannerWire => ({ source, target,
      itemIds: ["item_gas_xiranite"], perMinute: 6 });
    const wires = [connect(port(0, "output"), ins[0]!), connect(paired[0]!, port(0, "input")),
      connect(port(3, "output"), ins[1]!), connect(paired[1]!, port(3, "input")),
      connect(port(0, "output"), port(1, "input")), connect(port(0, "output"), port(2, "input")),
      connect(port(3, "output"), port(4, "input"))];
    expect([...converterStartupRoots(registry, network, wires)].sort()).toEqual(["eda-device-0", "eda-device-3"]);
  });
});

describe("五机真实启动传播", () => {
  it.each([
    { mode: "manual" as const, variant: 0, roots: 1 },
    { mode: "tank" as const, variant: 2, roots: 1 },
    { mode: "tank" as const, variant: 15, roots: 2 },
  ])("$mode / $variant：Dense 2 TPS 保持 120/min 且启动库存不持续下降", async ({ mode, variant, roots }) => {
    const registry = createRegistryContract(), request = fiveMachines(mode), started = performance.now();
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      const candidate = await createPlannerCandidate(registry, request, variant, () => undefined, () => undefined,
        { strategy: "baseline", outline: { width: 40, height: 44 }, maxEvaluations: 50_000 });
      const restored = restorePlannerSeed(registry, request, candidate.seed!);
      expect(converterStartupRoots(registry, restored.network, restored.wires).size).toBe(roots);
      expect(candidate.execution.scene.scheduledSlots).toHaveLength(mode === "manual" ? roots : 0);
      expect(candidate.supplyAudit.startupStorage).toHaveLength(mode === "tank" ? roots : 0);
      const report = await executor.run({ ...candidate.execution, observationSeconds: 600, maxWallTimeMs: 30_000 });
      expect(report.engineKind).toBe("dense-v2");
      expect(meetsProductionTargets(request, report)).toBe(true);
      expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
      const cold = structuredClone(candidate.execution);
      for (const id of cold.blueprint.entityOrder) if (cold.blueprint.entities[id]!.definitionId === "gas_storager_1") {
        cold.blueprint.entities[id]!.config["storageSlotGroups[0].slots[0].initialCount"] = 0;
      }
      const withoutStartup = await executor.run({ ...cold, scene: { ...cold.scene, scheduledSlots: [] } });
      expect(meetsProductionTargets(request, withoutStartup)).toBe(false);
      if (mode === "tank") expect(meetsOperatingLimits(candidate.supplyAudit, { ...report, probes: report.probes.map(probe =>
        probe.id.startsWith("startup-storage:output:") ? { ...probe, amount: probe.amount + 5 } : probe) })).toBe(false);
      await saveSuccessfulPlanning(registry, `自适应五机-${mode}-${variant}`, candidate.execution.blueprint, request,
        { elapsedMs: performance.now() - started, metrics: candidate.metrics, search: candidate.search, report });
    } finally { executor.dispose(); }
  }, 60_000);

  it("已识别原图在固定主体摆位重建供气，保留配方和外供，重放种子后仍保持净产率", async () => {
    const registry = createRegistryContract(), request = fiveMachines("tank"), started = performance.now();
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      const original = await createPlannerCandidate(registry, request, 15, () => undefined, () => undefined,
        { strategy: "baseline", outline: { width: 40, height: 44 }, maxEvaluations: 50_000 });
      const input: BlueprintPlannerBlueprintInput = { blueprint: original.execution.blueprint, activeActivityIds: [],
        boundaries: original.seed!.network.nodes.filter(node => node.purpose === "supply" || node.purpose === "product").map(node => ({
          entityId: node.entity.id, kind: "facility", direction: node.purpose === "supply" ? "input" : "output",
          itemId: (node.purpose === "supply" ? node.outputs : node.inputs)[0]!.itemId, portGroupId: "", portId: "",
        })) };
      const execution = blueprintRecognitionScene(registry, input);
      const baselineReport = await executor.run(execution);
      const identified = identifyBlueprintNetwork(registry, input, request.options, execution, baselineReport);
      const candidate = await createPlannerCandidate(registry, identified.request, 1, () => undefined, () => undefined,
        { originSeed: identified.candidate.seed, seed: identified.candidate.seed, targetOutline: { width: 40, height: 44 }, maxEvaluations: 15_000 });
      expect(candidate.search.supplyTopologyAttempts).toBeGreaterThan(0);
      expect(candidate.supplyAudit.startupProduction).toHaveLength(5);
      const before = identified.candidate.seed!.network.nodes.filter(node => node.recipeId === "liquid_transmuter_2_gas_gas_xiranite_1");
      for (const node of before) {
        const after = candidate.execution.blueprint.entities[node.entity.id]!;
        expect(after.position).toEqual(node.entity.position);
        expect(after.rotation).toBe(node.entity.rotation);
        expect(after.config.channelRecipes).toEqual(node.entity.config.channelRecipes);
      }
      expect(() => assertBlueprintPreserved(registry, identified.request, identified.candidate.seed!, candidate.execution.blueprint, candidate.seed)).not.toThrow();
      const altered = structuredClone(candidate.execution.blueprint);
      altered.entities[before[0]!.entity.id]!.config.channelRecipes = {};
      expect(() => assertBlueprintPreserved(registry, identified.request, identified.candidate.seed!, altered, candidate.seed)).toThrow();
      const report = await executor.run(candidate.execution);
      expect(meetsProductionTargets(identified.request, report)).toBe(true);
      expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
      const restored = restorePlannerSeed(registry, identified.request, JSON.parse(JSON.stringify(candidate.seed)));
      expect(converterStartupRoots(registry, restored.network, restored.wires).size).toBe(candidate.supplyAudit.startupStorage!.length);
      // 移除所有罐内库存后，用实际端口分析选择一次性手动启动根，验证冷态原图识别入口。
      const cold = structuredClone(candidate.execution.blueprint);
      for (const id of cold.entityOrder) if (cold.entities[id]!.definitionId === "gas_storager_1") cold.entities[id]!.config["storageSlotGroups[0].slots[0].initialCount"] = 0;
      const manualInput = { ...input, blueprint: cold };
      const manual = withBlueprintConverterStartup(registry, manualInput, { ...request.options, converterStartup: "manual" }, report.analysis!,
        blueprintRecognitionScene(registry, manualInput));
      expect(manual.scene.scheduledSlots).toHaveLength(candidate.supplyAudit.startupStorage!.length);
      const manualReport = await executor.run(manual);
      expect(meetsProductionTargets(identified.request, manualReport)).toBe(true);
      await saveSuccessfulPlanning(registry, "自适应供气-原图重建回归", candidate.execution.blueprint, identified.request,
        { elapsedMs: performance.now() - started, metrics: candidate.metrics, search: candidate.search, report });
    } finally { executor.dispose(); }
  }, 60_000);
});
