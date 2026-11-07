// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { WorldEntity } from "@/domain/document/world-document";
import { createRegistryContract } from "@/registry";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { getPlannerPorts } from "@/blueprint-planner/geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerWire } from "@/blueprint-planner/model";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import fixture from "./fixtures/endpoint-axis-access.json";

// 2026-11-05：封闭入口、打开旁路及垂直穿越预留轴，分别覆盖源/目标和四种旋转。
it.each(fixture.cases)("端点接入与真实 Router 一致：$name", async scenario => {
  const registry = createRegistryContract();
  const entities = structuredClone(scenario.entities) as WorldEntity[];
  const network: PlannerNetwork = { request: fixture.request as BlueprintPlannerRequest,
    nodes: entities.map(entity => ({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)!,
      recipe: null, purpose: "logistics", inputs: [], outputs: [] })),
    slotLinks: [], initialSlots: [], preferredGasCount: 0 };
  const port = (identity: (string | number)[], direction: "input" | "output") => {
    const node = network.nodes.find(node => node.entity.id === identity[0])!;
    return getPlannerPorts(registry, node.entity, node.definition, direction)
      .find(port => port.groupIndex === identity[1] && port.portIndex === identity[2])!;
  };
  const wires: PlannerWire[] = scenario.wires.map(wire => ({ ...wire,
    source: port(wire.source, "output"), target: port(wire.target, "input") }));
  const statistics: PlannerSearchStatistics = { strategy: "compact", seed: 0, evaluationLimit: 0, evaluations: 0,
    acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: scenario.outline };
  const search = new CompactLayoutSearch(registry, network, wires, statistics, undefined, undefined,
    new Set(entities.map(entity => entity.id)));
  expect(await search.advance(0, () => {})).toBe(scenario.reachable);
  expect(statistics.remainingConflicts).toEqual({ geometry: 0, power: 0, boundary: 0,
    connections: scenario.reachable ? 0 : 1 });
  const router = new PlannerRouter(registry, entities, wires.flatMap(wire => [wire.source, wire.target]),
    { minimumX: 0, minimumY: 0, maximumX: scenario.outline.width - 1, maximumY: scenario.outline.height - 1, escapeLength: 0 });
  const connection = router.connect(wires[0]!.source, wires[0]!.target, () => {});
  if (scenario.reachable) await expect(connection).resolves.toBeGreaterThan(0);
  else await expect(connection).rejects.toBeInstanceOf(PlannerCandidateError);
  expect(entities).toEqual(scenario.entities);
});
