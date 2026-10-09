import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const directory = "src/tests/fixtures/blueprints/simulation/converger-mixed-input";
const convergerSlotPrefix = "device:log_converger:2/";
const cases = [
  { scene: "three-items", ports: ["in_n", "in_e", "in_w"], itemCount: 3 },
  { scene: "three-items-reordered", ports: ["in_n", "in_e", "in_w"], itemCount: 3 },
  { scene: "three-same-items", ports: ["in_n", "in_e", "in_w"], itemCount: 1 },
  { scene: "two-items", ports: ["in_e", "in_w"], itemCount: 2 },
];

describe.each(SIMULATION_ENGINE_MATRIX)("汇流器持续输入轮询 [%s]", (engineKind) => {
  it.each(cases)("$scene 在缓存腾空后仍按入口游标接收", async ({ scene, ports, itemCount }) => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile(`${directory}/${scene}.schema7.json`),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 30,
    });
    const arrivals = report.ticks.flatMap((tick) => tick.transfers.filter((transfer) =>
      transfer.targetSlotId.startsWith(convergerSlotPrefix),
    ));
    const departures = report.ticks.flatMap((tick) => tick.transfers.filter((transfer) =>
      transfer.sourceSlotId.startsWith(convergerSlotPrefix),
    ));
    const receivedPorts = arrivals.map((transfer) => {
      const port = ports.find((candidate) =>
        transfer.edgeId.endsWith(`/port:item_input.${candidate}.input`),
      );
      expect(port, transfer.edgeId).toBeDefined();
      return port!;
    });

    expect(report.topology.diagnostics).toEqual([]);
    expect(report.summary.runtimeDiagnosticCount).toBe(0);
    expect(arrivals.length).toBeGreaterThanOrEqual(12);
    expect(new Set(arrivals.map((transfer) => transfer.itemType)).size).toBe(itemCount);
    const firstPortIndex = ports.indexOf(receivedPorts[0]!);
    expect(receivedPorts).toEqual(receivedPorts.map((_, index) =>
      ports[(firstPortIndex + index) % ports.length],
    ));
    expect(departures.length).toBeGreaterThanOrEqual(arrivals.length - 1);
    expect(departures.map((transfer) => transfer.itemType)).toEqual(
      arrivals.slice(0, departures.length).map((transfer) => transfer.itemType),
    );
  });
});
