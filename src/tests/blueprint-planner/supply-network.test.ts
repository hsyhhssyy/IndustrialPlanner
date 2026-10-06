// @vitest-environment node

import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { createRecipeNode } from "@/blueprint-planner/production-network";
import { itemLogisticsKind } from "@/blueprint-planner/geometry";
import type { PlannerNetwork } from "@/blueprint-planner/model";
import { createPlainNode, PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
import { addTerminals } from "@/blueprint-planner/terminals";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import { auditPlannerSupply } from "@/blueprint-planner/supply-audit";
import nugget from "./fixtures/pyrrolite-nugget.json";
import ore from "./fixtures/pyrrolite-ore.json";

it.each([{ input: nugget, sources: 4, separate: false }, { input: ore, sources: 5, separate: false },
  { input: nugget, sources: 5, separate: true }, { input: ore, sources: 6, separate: true }])("供料按容量共享，运行消耗全部经过准入口，非等量支路明确限速 ($sources 个来源，分组 $separate)", async ({ input, sources, separate }) => {
  const registry = createRegistryContract();
  const request = structuredClone(input.request) as BlueprintPlannerRequest;
  const before = JSON.stringify(request);
  const network = createProductionNetwork(registry, request);
  const placement = new PlannerPlacement(registry, 40, 7, 2, 1, 1);
  await placeProduction(registry, network, placement, 0);
  addTerminals(registry, network, placement, separate);
  const wires = await wireProductionNetwork(registry, network, placement);
  expect(network.nodes.filter(node => node.purpose === "supply" && node.definition.id.startsWith("udpipe_unloader_")).length).toBe(sources);
  let consumptionInputs = 0;
  for (const node of network.nodes) for (const demand of node.inputs) {
    if (!demand.storageGroupIds || !node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
      && channel.ingredientStorageGroupIds.some(group => demand.storageGroupIds!.includes(group)))) continue;
    consumptionInputs++;
    const incoming = wires.filter(wire => wire.target.entityId === node.entity.id && node.definition.portStorageBindings.some(binding =>
      binding.portGroupId === node.definition.portGroups[wire.target.groupIndex]!.id && demand.storageGroupIds!.includes(binding.storageSlotGroupId)));
    expect(incoming).toHaveLength(1);
    // AI-REMOVED 2026-10-02:
    // Reason: 等流量分支现在可共用上游准入口，消费设备的直接前驱可能是分流器。
    // Trigger: 用户要求按真实分流份额选择准入口位置。
    // Evidence: 下方供料审计和三／四／五路拓扑用例。
    // Replacement: 下方沿完整供料图审计准入口及份额。
    // Risk: 测试路由格数使用最低合法长度，真实布线仍由候选集成测试覆盖。
    // Human Review: Required
    // Original code:
    // const limiter = network.nodes.find(entry => entry.entity.id === incoming[0]!.source.entityId)!;
    // expect(limiter.definition.id).toBe("pipe_admission");
    // expect(Object.values(limiter.entity.config)).toContainEqual({ itemId: demand.itemId, limit: null, perMinuteLimit: 6 });
    expect(incoming[0]!.perMinute).toBe(demand.perMinute);
  }
  expect(consumptionInputs).toBe(6);
  for (const wire of wires.filter(wire => (wire.minimumCells ?? 0) > 0)) {
    const node = network.nodes.find(entry => entry.entity.id === wire.target.entityId)!;
    const rule = Object.values(node.entity.config).find(value => value && typeof value === "object" && "perMinuteLimit" in value) as { perMinuteLimit: number };
    expect(wire.minimumCells).toBe(Math.ceil(rule.perMinuteLimit / 6));
  }
  const routes = wires.map(wire => ({ source: wire.source.entityId, target: wire.target.entityId,
    sourcePort: `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`,
    targetPort: `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`,
    sourceEdge: wire.source.edge, targetEdge: wire.target.edge, minimumCells: wire.minimumCells ?? 0,
    cells: Array.from({ length: wire.minimumCells ?? 0 }, () => ({ x: 0, y: 0 })), turns: 0 }));
  expect(auditPlannerSupply(registry, network, wires, routes).operatingLimits.length).toBeGreaterThan(0);
  expect(JSON.stringify(request)).toBe(before);
});

it.each([{ count: 3, shared: true }, { count: 4, shared: true }, { count: 5, shared: false }])("按分流树实际份额决定工作消耗准入口位置（$count 路）", async ({ count, shared }) => {
    const registry = createRegistryContract();
    const request = structuredClone(nugget.request) as BlueprintPlannerRequest;
    const example = createProductionNetwork(registry, request).nodes.find(node => node.recipe !== null && node.inputs.some(input =>
      input.perMinute === 6 && itemLogisticsKind(registry, input.itemId) === "pipe"
      && input.storageGroupIds?.some(id => node.definition.recipeChannels.some(channel =>
        channel.type === "consumption-channel" && channel.ingredientStorageGroupIds.includes(id)))))!;
    const demand = example.inputs.find(input => input.perMinute === 6 && itemLogisticsKind(registry, input.itemId) === "pipe"
      && input.storageGroupIds?.some(id => example.definition.recipeChannels.some(channel =>
        channel.type === "consumption-channel" && channel.ingredientStorageGroupIds.includes(id))))!;
    const source = createPlainNode(registry, "udpipe_unloader_1", "shared-source", "supply");
    source.outputs.push({ itemId: demand.itemId, perMinute: count * 6 });
    const consumers = Array.from({ length: count }, (_, index) => {
      const node = createRecipeNode(registry, example.recipe!, `operating-${index}`, 1, "production");
      node.inputs.splice(0, node.inputs.length, { ...demand });
      node.outputs.splice(0);
      return node;
    });
    const network: PlannerNetwork = { request, nodes: [source, ...consumers], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
    const placement = new PlannerPlacement(registry, 80, 8, 0, 1);
    for (const node of network.nodes) placement.placeAnywhere(node);
    const wires = await wireProductionNetwork(registry, network, placement);
    const admissions = network.nodes.filter(node => node.definition.id === "pipe_admission");
    expect(admissions).toHaveLength(shared ? 1 : count);
    expect(admissions.map(node => Object.values(node.entity.config).find(value => value && typeof value === "object"
      && "perMinuteLimit" in value))).toEqual(shared
      ? [{ itemId: demand.itemId, limit: null, perMinuteLimit: count * 6 }]
      : Array.from({ length: count }, () => ({ itemId: demand.itemId, limit: null, perMinuteLimit: 6 })));
    for (const consumer of consumers) {
      const incoming = wires.filter(wire => wire.target.entityId === consumer.entity.id);
      expect(incoming).toHaveLength(1);
      expect(incoming[0]!.perMinute).toBe(6);
      expect(network.nodes.find(node => node.entity.id === incoming[0]!.source.entityId)!.definition.id)
        .toBe(shared ? "pipe_splitter" : "pipe_admission");
    }
    if (!shared) {
      const buffered = wires.filter(wire => wire.target.entityId.startsWith("eda-limiter-")
        && wire.source.entityId.startsWith("eda-split-"));
      expect(buffered.length).toBeGreaterThan(0);
      expect(buffered.every(wire => wire.minimumCells === 1)).toBe(true);
    }
    const routes = wires.map(wire => ({ source: wire.source.entityId, target: wire.target.entityId,
      sourcePort: `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}`,
      targetPort: `${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`,
      sourceEdge: wire.source.edge, targetEdge: wire.target.edge, minimumCells: wire.minimumCells ?? 0,
      cells: Array.from({ length: wire.minimumCells ?? 0 }, () => ({ x: 0, y: 0 })), turns: 0 }));
    const audit = auditPlannerSupply(registry, network, wires, routes);
    expect(audit.operatingLimits).toHaveLength(shared ? 1 : count);
    expect(audit.operatingLimits.map(limit => limit.perMinute)).toEqual(shared
      ? [count * 6] : Array.from({ length: count }, () => 6));
    if (shared) {
      const leaf = wires.findIndex(wire => wire.target.entityId === consumers[0]!.entity.id);
      const incorrect = wires.map((wire, index) => index === leaf ? { ...wire, perMinute: wire.perMinute + 1 } : wire);
      expect(() => auditPlannerSupply(registry, network, incorrect, routes)).toThrow("上游准入口");
    }
  });
