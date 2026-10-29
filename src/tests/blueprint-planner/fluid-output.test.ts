// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { addTerminals } from "@/blueprint-planner/terminals";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { PlannerBoundary } from "@/blueprint-planner/boundary";
import { getPlannerPorts, transportCapacity } from "@/blueprint-planner/geometry";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import separator from "./fixtures/separator-core.json";

function requestFor(itemId: string, perMinute: number): BlueprintPlannerRequest {
  const original = structuredClone(separator.request) as BlueprintPlannerRequest;
  return { plan: { ...original.plan, recipes: [], byproductItemIds: [], supplyPolicies: [], infiniteItemIds: [],
    targets: [{ itemId, perMinute }], externalSupplies: [{ itemId, perMinute }] },
  options: { ...original.options, fluidSupply: "external", warehousePortPlacement: "any", solidOutput: "warehouse",
    itemPolicies: [{ itemId, output: "external" }] } };
}

it.each(["item_liquid_sewage", "item_gas_acid"])("外接输出按单管运力拆分且出口朝外：%s", itemId => {
  const registry = createRegistryContract(), capacity = transportCapacity("pipe"), rate = capacity * 2.5;
  const request = requestFor(itemId, rate), network = createProductionNetwork(registry, request);
  addTerminals(registry, network, new PlannerPlacement(registry, 30, 8, 2));
  const outputs = network.nodes.filter(node => node.boundaryPort?.direction === "output");
  expect(outputs).toHaveLength(3);
  expect(outputs.reduce((sum, node) => sum + node.inputs[0]!.perMinute, 0)).toBe(rate);
  expect(outputs.every(node => node.inputs[0]!.perMinute <= capacity && node.definition.id === "pipe_straight_1x1")).toBe(true);
  const boundary = new PlannerBoundary(registry, network, { width: 20, height: 20 });
  boundary.arrange(0);
  for (const node of outputs) {
    const outlet = getPlannerPorts(registry, node.entity, node.definition, "output")[0]!;
    expect(outlet.outside.x < 0 || outlet.outside.x >= 20 || outlet.outside.y < 0 || outlet.outside.y >= 20).toBe(true);
  }
});

it.each(["item_liquid_sewage", "item_gas_acid"])("真实布线、交付蓝图与 Dense 验收支持流体边界输出：%s", async itemId => {
  const registry = createRegistryContract();
  const workspace: WorkspaceContract = { registry, state: createWorkspaceState(), app: null, editor: null,
    simulation: null, render: null, sync: null, audio: null, blueprintPlanner: null };
  const simulation = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  const request = requestFor(itemId, 30);
  try {
    const candidate = await createPlannerCandidate(registry, request, 0, () => {}, () => {},
      { outline: { width: 8, height: 8 }, maxEvaluations: 10_000 });
    const blueprint = candidate.execution.blueprint;
    const output = candidate.connections.find(connection => connection.direction === "output" && connection.itemId === itemId)!;
    expect(output).toBeDefined();
    expect(Object.values(blueprint.entities).every(entity => !entity.definitionId.startsWith("cheat_") && !entity.definitionId.startsWith("udpipe_loader"))).toBe(true);
    expect(candidate.execution.scene.externalEntities.some(entity => entity.id.startsWith("eda-validation-sink-"))).toBe(true);
    const report = await simulation.actions.runBlueprint(candidate.execution);
    expect(meetsProductionTargets(request, report)).toBe(true);
    expect(report.probes.find(probe => probe.id === itemId)?.perMinute).toBeGreaterThanOrEqual(30);
    const withoutReceiver = await simulation.actions.runBlueprint({ ...candidate.execution, scene: {
      ...candidate.execution.scene,
      externalEntities: candidate.execution.scene.externalEntities.filter(entity => !entity.id.startsWith("eda-validation-sink-")),
    } });
    expect(meetsProductionTargets(request, withoutReceiver)).toBe(false);
    const serialized = JSON.parse(JSON.stringify(blueprint));
    expect(serialized.entities).toEqual(blueprint.entities);
  } finally { simulation.dispose(); }
}, 60_000);
