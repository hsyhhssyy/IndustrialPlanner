import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology/compiler";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { runBlueprintSimulation } from "./blueprint-runner";

const directory = "src/tests/fixtures/blueprints/simulation/default-port-priorities";
const cases = [
  ["stash-splitter-last", [9, 9, 1, 9, 9, 5]],
  ["stash-belt-last", [1, 1, 9, 9, 9, 5]],
  ["stash-custom", [5, 5, 5, 2, 5, 5]],
  ["stash-rotated", [9, 9, 1, 9, 9, 5]],
  ["solid-converger-splitter-last", [9, 9, 1, 5]],
  ["solid-converger-line-last", [1, 1, 9, 5]],
  ["fluid-converger-splitter-last", [9, 9, 1, 5]],
  ["fluid-converger-line-last", [1, 1, 9, 5]],
  ["inlet-pipe-last", [1, 9]],
  ["outlet-converger", [9, 5]],
] as const;

describe("拓扑默认端口组合规则", () => {
  it.each(cases)("%s 的端口与调度表一致且不改写输入蓝图", async (name, expected) => {
    const blueprint = loadBlueprintFromFile(`${directory}/${name}.schema7.json`);
    const document = createWorldDocumentFromBlueprint(blueprint);
    const before = JSON.stringify({ blueprint, document });
    const registry = createRegistryContract();
    const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", poweredEntityIds: new Set() });
    const device = topology.devices["device:target"]!;
    const ports = device.portIds.map((id) => topology.ports[id]!);
    expect(ports.map((port) => port.priorityGroup)).toEqual(expected);
    expect(ports.map((port) => device.routing[`${port.portGroupId}.${port.portDefinitionId}`]!.priorityGroup)).toEqual(expected);
    const report = await runBlueprintSimulation({ blueprint, registry, engineKind: "dense-v2", maxTickNumber: 2 });
    expect(report.topology.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(report.execution.totalTicksCaptured).toBeGreaterThan(0);
    expect(JSON.stringify({ blueprint, document })).toBe(before);
  });
});
