// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { materialCycleStartupInputs, prepareMaterialCycleStartups, connectMaterialCycleStartups } from "@/blueprint-planner/support";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import { materialBalance } from "@/blueprint-planner/terminals";
import { capturePlannerSeed, restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { meetsOperatingLimits, meetsProductionTargets } from "@/blueprint-planner/verification";
import { BlueprintExecutionClient } from "@/simulation/blueprint";
import { createDenseBlueprintEngine } from "@/simulation/dense/blueprint-engine";
import type { PlannerWire } from "@/blueprint-planner/model";
import copper from "./fixtures/material-cycle-startup.json";
import plant from "./fixtures/plant-preload.json";
import workingSupply from "./fixtures/converter-startup-gas.json";

describe("普通物料循环启动", () => {
  it("赫铜原料槽预置有限一组，保持回流物料平衡，序列化后仍可交付", () => {
    const registry = createRegistryContract(), request = structuredClone(copper.request) as BlueprintPlannerRequest;
    const network = createProductionNetwork(registry, request), before = materialBalance(network);
    const inputs = materialCycleStartupInputs(registry, network);
    expect(inputs.map(entry => [entry.consumer.recipe!.id, entry.input.itemId])).toEqual([
      ["liquid_transmuter_2_gas_gas_copper_enr_1", "item_copper_enr"],
    ]);
    expect(prepareMaterialCycleStartups(registry, network, new PlannerPlacement(registry, 50, 1, 1))).toEqual([]);
    const consumer = inputs[0]!.consumer;
    const groupIndex = consumer.definition.storageSlotGroups.findIndex(group => inputs[0]!.input.storageGroupIds!.includes(group.id));
    const prefix = `storageSlotGroups[${groupIndex}].slots[0]`;
    expect(consumer.entity.config[`${prefix}.initialItemType`]).toBe("item_copper_enr");
    expect(consumer.entity.config[`${prefix}.initialCount`]).toBe(50);
    expect(consumer.entity.config[`${prefix}.ignoreStock`]).toBe(false);
    expect(network.nodes.filter(node => Object.keys(node.entity.config).some(key => key.endsWith(".initialCount")))).toHaveLength(1);
    expect(network.nodes.some(node => node.purpose === "startup")).toBe(false);
    expect(network.initialSlots).toEqual([]);
    expect(materialBalance(network)).toEqual(before);
    expect(network.request.plan.externalSupplies.some(flow => flow.itemId === "item_copper_enr")).toBe(false);
    const seed = capturePlannerSeed(request, network, [], [], 50, 50);
    const restored = restorePlannerSeed(registry, request, JSON.parse(JSON.stringify(seed))).network;
    expect(restored.nodes.find(node => node.entity.id === consumer.entity.id)!.entity.config).toEqual(consumer.entity.config);
    expect(materialCycleStartupInputs(registry, restored).map(entry => entry.input.itemId)).toEqual(["item_copper_enr"]);
  });

  it("仓库启动受准入口总量 29 限制，并连接普通原料槽的空闲端口", () => {
    const registry = createRegistryContract(), base = structuredClone(copper.request) as BlueprintPlannerRequest;
    const request = { ...base, options: { ...base.options, plantStartup: "warehouse" as const } };
    const network = createProductionNetwork(registry, request), before = materialBalance(network);
    const startups = prepareMaterialCycleStartups(registry, network, new PlannerPlacement(registry, 50, 1, 1));
    expect(startups).toHaveLength(1);
    const startup = startups[0]!;
    expect(startup.itemId).toBe("item_copper_enr");
    expect(startup.consumer.entity.config).not.toHaveProperty("storageSlotGroups[0].slots[0].initialCount");
    expect(Object.values(startup.admission.entity.config)).toContainEqual({ itemId: "item_copper_enr", limit: 29, perMinuteLimit: null });
    expect(network.slotLinks).toHaveLength(1);
    const ports = getPlannerPorts(registry, startup.consumer.entity, startup.consumer.definition, "input", startup.itemId, startup.storageGroupIds);
    expect(ports.length).toBeGreaterThan(1);
    const returnPort = getPlannerPorts(registry, network.nodes[0]!.entity, network.nodes[0]!.definition, "output", startup.itemId)[0]!;
    const wires: PlannerWire[] = [{ source: returnPort, target: ports[0]!, itemIds: [startup.itemId], perMinute: 30 }];
    connectMaterialCycleStartups(registry, startups, wires);
    expect(wires).toHaveLength(3);
    expect(wires[1]!.source.entityId).toBe(startup.source.entity.id);
    expect(wires[1]!.target.entityId).toBe(startup.admission.entity.id);
    expect(wires[2]!.source.entityId).toBe(startup.admission.entity.id);
    expect(wires[2]!.target).toEqual(ports[1]);
    expect(materialBalance(network)).toEqual(before);
    const restored = restorePlannerSeed(registry, request, JSON.parse(JSON.stringify(capturePlannerSeed(request, network, wires, [], 50, 50))));
    expect(restored.wires).toHaveLength(3);
    expect(restored.network.nodes.find(node => node.entity.id === startup.admission.entity.id)!.entity.config).toEqual(startup.admission.entity.config);
  });

  it("已有正常赫铜输入时不增加启动料，转换机运行耗材闭环不由此设置预置", () => {
    const registry = createRegistryContract(), base = structuredClone(copper.request) as BlueprintPlannerRequest;
    const request = { ...base, plan: { ...base.plan, externalSupplies: [...base.plan.externalSupplies, { itemId: "item_copper_enr", perMinute: 30 }] } };
    expect(materialCycleStartupInputs(registry, createProductionNetwork(registry, request))).toEqual([]);
    const workingRequest = { ...workingSupply, options: { ...workingSupply.options, converterStartup: "manual" } } as BlueprintPlannerRequest;
    expect(materialCycleStartupInputs(registry, createProductionNetwork(registry, workingRequest))).toEqual([]);
  });

  it.each(["preload", "warehouse"] as const)("植物循环保持原来的 %s 启动行为", mode => {
    const registry = createRegistryContract(), base = structuredClone(plant.request) as BlueprintPlannerRequest;
    const request = { ...base, options: { ...base.options, plantStartup: mode } };
    const network = createProductionNetwork(registry, request);
    expect(materialCycleStartupInputs(registry, network).map(entry => [entry.consumer.definition.id, entry.input.itemId]))
      .toEqual([["seedcol_1", "item_plant_moss_3"]]);
    const startups = prepareMaterialCycleStartups(registry, network, new PlannerPlacement(registry, 50, 1, 1));
    if (mode === "preload") {
      const picker = network.nodes.find(node => node.definition.id === "seedcol_1")!;
      expect(Object.entries(picker.entity.config)).toContainEqual(["storageSlotGroups[0].slots[0].initialCount", 50]);
      expect(startups).toEqual([]);
    } else {
      expect(startups).toHaveLength(1);
      expect(Object.values(startups[0]!.admission.entity.config)).toContainEqual({ itemId: "item_plant_moss_3", limit: 29, perMinuteLimit: null });
    }
  });

  it.each(["preload", "warehouse"] as const)("真实生成的 %s 蓝图仅靠有限赫铜启动并持续回流产水", async mode => {
    const registry = createRegistryContract(), base = structuredClone(copper.request) as BlueprintPlannerRequest;
    const request = { ...base, options: { ...base.options, plantStartup: mode } };
    const candidate = await createPlannerCandidate(registry, request, 0, () => undefined, () => undefined,
      { maxEvaluations: 50_000, outline: { width: 36, height: 36 } });
    const executor = new BlueprintExecutionClient(registry, "dense-v2", "runtime", options => createDenseBlueprintEngine(registry, options), 2);
    try {
      expect(candidate.execution.scene.scheduledSlots).toEqual([]);
      expect(candidate.execution.scene.externalEntities.some(entity => Object.values(entity.config).includes("item_copper_enr"))).toBe(false);
      // 600 秒预热超过一组赫铜的单程耗用时间；再观察 300 秒，排除仅消耗启动料的假达产。
      const execution = { ...candidate.execution, warmupSeconds: 600, observationSeconds: 300, maxWallTimeMs: 30_000 };
      if (mode === "warehouse") {
        const admission = candidate.seed!.network.nodes.find(node => node.entity.id.startsWith("eda-startup-admission-"))!;
        execution.probes = [...execution.probes, { id: "startup-copper", itemId: "item_copper_enr", direction: "output", entityIds: [admission.entity.id] }];
      }
      const report = await executor.run(execution);
      expect(meetsProductionTargets(request, report)).toBe(true);
      expect(meetsOperatingLimits(candidate.supplyAudit, report)).toBe(true);
      expect(report.probes.find(probe => probe.id === "item_liquid_sewage")!.amount).toBe(150);
      if (mode === "warehouse") expect(report.probes.find(probe => probe.id === "startup-copper")!.amount).toBe(0);
      if (mode === "preload") {
        const withoutStartup = structuredClone(execution);
        for (const entity of Object.values(withoutStartup.blueprint.entities)) for (const key of Object.keys(entity.config)) {
          if (key.endsWith(".initialItemType") && entity.config[key] === "item_copper_enr") {
            entity.config[key.replace(".initialItemType", ".initialCount")] = 0;
          }
        }
        const stopped = await executor.run(withoutStartup);
        expect(stopped.probes.find(probe => probe.id === "item_liquid_sewage")!.amount).toBe(0);
      }
    } finally { executor.dispose(); }
  }, 60_000);
});
