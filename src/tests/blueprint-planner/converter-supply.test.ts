// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { converterConsumers, converterStartupRoots, planConverterSupply } from "@/blueprint-planner/converter-supply";
import { configureConverterStartupInventory, prepareConverterStartups, scheduleConverterStartups, converterStartupTimes, converterInputArrivalTimes } from "@/blueprint-planner/support";
import { PlannerPlacement, createPlainNode } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import type { PlannerWire } from "@/blueprint-planner/model";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { materialBalance } from "@/blueprint-planner/terminals";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
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
import identifiedBaseline from "./fixtures/converter-rebuild-baseline.json";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";

function fiveMachines(mode: "manual" | "tank"): BlueprintPlannerRequest {
  const base = gas as BlueprintPlannerRequest;
  const scale = (flow: { itemId: string; perMinute: number }) => ({ ...flow, perMinute: flow.perMinute * 5 });
  return { ...base, options: { ...base.options, converterStartup: mode }, plan: { ...base.plan,
    targets: base.plan.targets.map(scale), externalSupplies: base.plan.externalSupplies.map(scale),
    recipes: base.plan.recipes.map(recipe => ({ ...recipe, deviceCount: 5, cyclesPerMinute: recipe.cyclesPerMinute * 5,
      inputs: recipe.inputs.map(scale), outputs: recipe.outputs.map(scale), runningInputs: recipe.runningInputs.map(scale) })) } };
}

it("一次补料只等待普通原料，储罐库存估时仍覆盖完整工作耗材回流", () => {
  const registry = createRegistryContract(), base = gas as BlueprintPlannerRequest;
  const network = createProductionNetwork(registry, { ...base, options: { ...base.options, converterStartup: "manual" } });
  const consumer = converterConsumers(registry, network)[0]!;
  const ordinary = consumer.node.inputs.find(flow => flow.itemId !== consumer.input.itemId)!;
  const source = createPlainNode(registry, "unloader_1", "arrival-source", "supply");
  network.nodes.push(source);
  const wires: PlannerWire[] = [
    { source: getPlannerPorts(registry, source.entity, source.definition, "output")[0]!,
      target: getPlannerPorts(registry, consumer.node.entity, consumer.node.definition, "input", ordinary.itemId, ordinary.storageGroupIds)[0]!,
      itemIds: [ordinary.itemId], perMinute: ordinary.perMinute },
    { source: getPlannerPorts(registry, consumer.node.entity, consumer.node.definition, "output", consumer.input.itemId)[0]!,
      target: getPlannerPorts(registry, consumer.node.entity, consumer.node.definition, "input", consumer.input.itemId, consumer.input.storageGroupIds)[0]!,
      itemIds: [consumer.input.itemId], perMinute: consumer.input.perMinute },
  ];
  const id = consumer.node.entity.id;
  const short = converterInputArrivalTimes(registry, network, wires, [10, 30], 0).get(id)!;
  expect(converterInputArrivalTimes(registry, network, wires, [10, 300], 0).get(id)).toBe(short);
  expect(converterInputArrivalTimes(registry, network, wires, [30, 30], 0).get(id)).toBe(short + 20);
  expect(converterStartupTimes(network, wires, [10, 300], 0).get(id)!
    - converterStartupTimes(network, wires, [10, 30], 0).get(id)!).toBe(270);
});

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
        { strategy: "baseline", outline: { width: 40, height: 44 }, maxEvaluations: 50_000,
          // AI-CORRECTION 2026-10-11：显式指定被测供料组合及原固定初排；派发编号不再承载策略。
          attemptStrategy: { ...plannerAttemptStrategy(variant), converterSeed: variant, placementSeed: variant,
            boundarySeed: variant, layoutSeed: variant, conduitTopology: variant === 15 ? "trunk" : "shared" } });
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

});

describe("原图供气重建与冷态识别", () => {
  it("储罐原图在固定识别窗口内达到 120/min，识别不改变原图与外供边界", async () => {
    const registry = createRegistryContract();
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      const input = structuredClone(identifiedBaseline) as BlueprintPlannerBlueprintInput;
      const before = structuredClone(input);
      const execution = blueprintRecognitionScene(registry, input);
      expect(execution.warmupSeconds).toBe(360);
      expect(execution.observationSeconds).toBe(600);
      const report = await executor.run(execution);
      expect(report.engineKind).toBe("dense-v2");
      expect(report.probes.find(probe => probe.id === "item_gas_xiranite")?.perMinute).toBe(120);
      expect(report.probes.find(probe => probe.id === "input:item_xiranite_powder")?.perMinute).toBe(150);
      const identified = identifyBlueprintNetwork(registry, input, fiveMachines("tank").options, execution, report);
      expect(identified.request.plan.targets).toEqual([{ itemId: "item_gas_xiranite", perMinute: 120 }]);
      expect(identified.request.blueprintSource?.boundaries).toEqual(before.boundaries);
      expect(input).toEqual(before);
    } finally { executor.dispose(); }
  }, 30_000);

  it("按原图识别尺寸重建储罐供气，保持五台主体、配方、产率与种子恢复", async () => {
    const registry = createRegistryContract();
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      const input = structuredClone(identifiedBaseline) as BlueprintPlannerBlueprintInput;
      const execution = blueprintRecognitionScene(registry, input);
      const baselineReport = await executor.run(execution);
      const identified = identifyBlueprintNetwork(registry, input, fiveMachines("tank").options, execution, baselineReport);
      const seed = identified.candidate.seed!;
      // 2026-10-27：本例只验证同尺寸供气重建；尺寸来自识别结果，扩缩面积由蓝图优化测试覆盖。
      const outline = { width: seed.width, height: seed.height };
      const candidate = await createPlannerCandidate(registry, identified.request, 1, () => undefined, () => undefined,
        { originSeed: seed, seed, targetOutline: outline, maxEvaluations: 15_000,
          attemptStrategy: { ...plannerAttemptStrategy(1), reduce: false, layoutSeed: 1, converterSeed: 1 } });
      expect(candidate.search.outline).toEqual(outline);
      expect(candidate.search.supplyTopologyAttempts).toBeGreaterThan(0);
      expect(candidate.supplyAudit.startupProduction).toHaveLength(5);
      expect(candidate.supplyAudit.startupStorage?.length).toBeGreaterThan(0);
      const before = seed.network.nodes.filter(node => node.recipeId === "liquid_transmuter_2_gas_gas_xiranite_1");
      expect(before).toHaveLength(5);
      for (const node of before) {
        const after = candidate.execution.blueprint.entities[node.entity.id]!;
        expect(after.position).toEqual(node.entity.position);
        expect(after.rotation).toBe(node.entity.rotation);
        expect(after.config.channelRecipes).toEqual(node.entity.config.channelRecipes);
      }
      expect(() => assertBlueprintPreserved(registry, identified.request, seed, candidate.execution.blueprint, candidate.seed)).not.toThrow();
      const altered = structuredClone(candidate.execution.blueprint);
      altered.entities[before[0]!.entity.id]!.config.channelRecipes = {};
      expect(() => assertBlueprintPreserved(registry, identified.request, seed, altered, candidate.seed)).toThrow();
      const report = await executor.run(candidate.execution);
      expect(meetsProductionTargets(identified.request, report)).toBe(true);
      expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
      const serialized = JSON.parse(JSON.stringify(candidate.seed)) as NonNullable<typeof candidate.seed>;
      const restored = restorePlannerSeed(registry, identified.request, serialized);
      expect(capturePlannerSeed(identified.request, restored.network, restored.wires, serialized.routes, serialized.width, serialized.height)).toEqual(serialized);
      expect(converterStartupRoots(registry, restored.network, restored.wires).size).toBe(candidate.supplyAudit.startupStorage!.length);
      expect(() => assertBlueprintPreserved(registry, identified.request, seed, candidate.execution.blueprint, serialized)).not.toThrow();
    } finally { executor.dispose(); }
  }, 30_000);

  it("独立冷态原图无需储罐，一次向启动根补料 5 单位后达到净产率且不修改原图", async () => {
    const registry = createRegistryContract();
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      const input: BlueprintPlannerBlueprintInput = {
        blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/converter-startup/manual-gas.schema7.json"),
        activeActivityIds: [], boundaries: [
          { entityId: "eda-source-1", kind: "facility", direction: "input", itemId: "item_xiranite_powder", portGroupId: "", portId: "" },
          { entityId: "eda-output-2", kind: "facility", direction: "output", itemId: "item_gas_xiranite", portGroupId: "", portId: "" },
        ],
      };
      const before = structuredClone(input);
      expect(Object.values(input.blueprint.entities).some(entity => entity.definitionId === "gas_storager_1")).toBe(false);
      const execution = blueprintRecognitionScene(registry, input);
      const coldReport = await executor.run(execution);
      expect(coldReport.probes.find(probe => probe.id === "item_gas_xiranite")?.amount).toBe(0);
      const manual = withBlueprintConverterStartup(registry, input, { ...(gas as BlueprintPlannerRequest).options, converterStartup: "manual" }, coldReport.analysis!, execution);
      expect(manual.warmupSeconds).toBe(360);
      expect(manual.observationSeconds).toBe(600);
      expect(manual.scene.scheduledSlots).toHaveLength(1);
      const startup = manual.scene.scheduledSlots![0]!;
      expect(startup.simulationSeconds).toBeGreaterThan(0);
      expect(startup.simulationSeconds).toBeLessThan(manual.warmupSeconds);
      // 2026-10-27：使用已独立验产的冷态夹具，保留单次、有限补料约束，不借增加补料量达标。
      expect(startup.patch).toEqual({ entityId: "eda-device-0", storageGroupId: "consume_buffer", slotId: "consume_slot",
        itemType: "item_gas_xiranite", count: 5, ignoreStock: false });
      const report = await executor.run(manual);
      expect(report.engineKind).toBe("dense-v2");
      expect(report.probes.find(probe => probe.id === "item_gas_xiranite")?.perMinute).toBe(24);
      expect(report.probes.find(probe => probe.id === "input:item_xiranite_powder")?.perMinute).toBe(30);
      expect(() => identifyBlueprintNetwork(registry, input, { ...(gas as BlueprintPlannerRequest).options, converterStartup: "manual" }, manual, report)).not.toThrow();
      expect(input).toEqual(before);
    } finally { executor.dispose(); }
  }, 30_000);
});
