// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { createPlainNode } from "@/blueprint-planner/placement";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import type { PlannerNetwork, PlannerNode, PlannerWire } from "@/blueprint-planner/model";
import { auditPlannerSupply } from "@/blueprint-planner/supply-audit";
import nugget from "./fixtures/pyrrolite-nugget.json";

it("上游限速穿过桥接器被动回流岛，独立通道不串入；额外供料或出口不能伪装为单通道", () => {
  const registry = createRegistryContract(), request = structuredClone(nugget.request) as BlueprintPlannerRequest;
  const consumer = createProductionNetwork(registry, request).nodes.find(node => node.recipe && node.inputs.some(flow => flow.perMinute === 6
    && flow.storageGroupIds?.some(group => node.definition.recipeChannels.some(channel => channel.type === "consumption-channel"
      && channel.ingredientStorageGroupIds.includes(group)))))!;
  const demand = consumer.inputs.find(flow => flow.perMinute === 6 && flow.storageGroupIds?.some(group => consumer.definition.recipeChannels
    .some(channel => channel.type === "consumption-channel" && channel.ingredientStorageGroupIds.includes(group))))!;
  consumer.inputs.splice(0, consumer.inputs.length, demand); consumer.outputs.splice(0);
  const limiter = createPlainNode(registry, "pipe_admission", "limit-six", "logistics");
  const independent = createPlainNode(registry, "pipe_admission", "limit-sixty", "logistics");
  for (const [node, perMinuteLimit] of [[limiter, 6], [independent, 60]] as const) {
    const port = getPlannerPorts(registry, node.entity, node.definition, "input")[0]!;
    node.entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].admissionRule`] = { itemId: demand.itemId, limit: null, perMinuteLimit };
  }
  const first = createPlainNode(registry, "pipe_connector", "first-bridge", "logistics");
  const second = createPlainNode(registry, "pipe_connector", "second-bridge", "logistics");
  const sink = createPlainNode(registry, "udpipe_loader_1", "independent-sink", "product");
  const groups = (node: PlannerNode, port: PlannerWire["source"]) => node.definition.portStorageBindings
    .filter(binding => binding.portGroupId === node.definition.portGroups[port.groupIndex]!.id).map(binding => binding.storageSlotGroupId);
  const channels = [...new Set(getPlannerPorts(registry, first.entity, first.definition, "input").flatMap(port => groups(first, port)))];
  expect(channels).toHaveLength(2);
  const port = (node: PlannerNode, direction: "input" | "output", channel?: string, index = 0) =>
    getPlannerPorts(registry, node.entity, node.definition, direction, demand.itemId).filter(port => channel === undefined || groups(node, port).includes(channel))[index]!;
  const connect = (source: PlannerWire["source"], target: PlannerWire["target"], perMinute: number): PlannerWire => ({ source, target, perMinute, itemIds: [demand.itemId] });
  const inlet = getPlannerPorts(registry, consumer.entity, consumer.definition, "input", demand.itemId, demand.storageGroupIds)[0]!;
  const wires = [connect(port(limiter, "output"), port(first, "input", channels[0]), 6),
    connect(port(first, "output", channels[0]), port(second, "input", channels[0]), 12),
    connect(port(second, "output", channels[0]), port(first, "input", channels[0], 1), 6),
    connect(port(second, "output", channels[0], 1), inlet, 6),
    connect(port(independent, "output"), port(first, "input", channels[1]), 60),
    connect(port(first, "output", channels[1]), port(sink, "input"), 60)];
  const network: PlannerNetwork = { request, nodes: [consumer, limiter, independent, first, second, sink], slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const audit = () => auditPlannerSupply(registry, network, wires, []);
  expect(audit().operatingLimits).toEqual([{ entityId: limiter.entity.id, itemId: demand.itemId, perMinute: 6 }]);
  const bypass = connect(port(independent, "output"), port(second, "input", channels[0], 1), 6);
  wires.push(bypass);
  expect(audit).toThrow("上游准入口");
  wires.pop();
  wires.push(connect(port(first, "output", channels[0], 1), port(sink, "input"), 1));
  expect(audit).toThrow("上游准入口");
});
