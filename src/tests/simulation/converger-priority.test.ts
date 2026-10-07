import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const directory = "src/tests/fixtures/blueprints/simulation/converger-priority";
const inputPorts = ["in_n", "in_e", "in_w"];
const convergerSlotPrefix = "device:log_converger:2/";
const priorities = [1, 5, 9];
const cases = priorities.flatMap((north) => priorities.flatMap((east) =>
  priorities.map((west) => ({
    scene: `${north}-${east}-${west}`,
    groups: [north, east, west],
  })),
));
const reorderedCases = [
  { scene: "1-5-1-reordered", groups: [1, 5, 1] },
  { scene: "5-1-9-reordered", groups: [5, 1, 9] },
  { scene: "9-5-1-reordered", groups: [9, 5, 1] },
];

describe.each(SIMULATION_ENGINE_MATRIX)("汇流器自定义输入优先级 [%s]", (engineKind) => {
  it.each([...cases, ...reorderedCases])("$scene 仅在最小组号内持续轮询", async ({ scene, groups }) => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile(`${directory}/${scene}.schema6.json`),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 40,
    });
    expect(report.topology.diagnostics).toEqual([]);
    expect(report.summary.runtimeDiagnosticCount).toBe(0);

    // 各路运输距离不同；预热后全部入口持续有货，再验证竞争与轮询。
    const arrivals = report.ticks
      .filter((tick) => tick.elapsedSimulationSeconds >= 10)
      .flatMap((tick) => tick.transfers.filter((transfer) =>
        transfer.targetSlotId.startsWith(convergerSlotPrefix),
      ));
    const receivedPorts = arrivals.map((transfer) => readInputPort(transfer.edgeId));
    const minimum = Math.min(...groups);
    const expectedPorts = inputPorts.filter((_, index) => groups[index] === minimum);
    expect(receivedPorts.length).toBeGreaterThanOrEqual(15);
    expect(new Set(receivedPorts)).toEqual(new Set(expectedPorts));
    const firstPortIndex = expectedPorts.indexOf(receivedPorts[0]!);
    expect(receivedPorts).toEqual(receivedPorts.map((_, index) =>
      expectedPorts[(firstPortIndex + index) % expectedPorts.length],
    ));

    // 检查实际输出物品，避免只验证入口选择而遗漏缓存/输出路径。
    const allArrivals = report.ticks.flatMap((tick) => tick.transfers.filter((transfer) =>
      transfer.targetSlotId.startsWith(convergerSlotPrefix),
    ));
    const departures = report.ticks.flatMap((tick) => tick.transfers.filter((transfer) =>
      transfer.sourceSlotId.startsWith(convergerSlotPrefix),
    ));
    expect(departures.length).toBeGreaterThanOrEqual(allArrivals.length - 1);
    expect(departures.map((transfer) => transfer.itemType)).toEqual(
      allArrivals.slice(0, departures.length).map((transfer) => transfer.itemType),
    );
  });

  it("最高优先级无货时持续使用下一优先级", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile(`${directory}/high-empty.schema6.json`),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 30,
    });
    expect(report.topology.diagnostics).toEqual([]);
    expect(report.summary.runtimeDiagnosticCount).toBe(0);
    const receivedPorts = report.ticks
      .filter((tick) => tick.elapsedSimulationSeconds >= 10)
      .flatMap((tick) => tick.transfers.filter((transfer) =>
        transfer.targetSlotId.startsWith(convergerSlotPrefix),
      ))
      .map((transfer) => readInputPort(transfer.edgeId));
    expect(receivedPorts.length).toBeGreaterThanOrEqual(10);
    expect(new Set(receivedPorts)).toEqual(new Set(["in_e"]));
  });

  it("按优先级依次耗尽有限货源后回退，保持输送畅通", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile(`${directory}/high-depleted.schema6.json`),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 40,
    });
    expect(report.topology.diagnostics).toEqual([]);
    expect(report.summary.runtimeDiagnosticCount).toBe(0);
    const receivedPorts = report.ticks.flatMap((tick) => tick.transfers.filter((transfer) =>
      transfer.targetSlotId.startsWith(convergerSlotPrefix),
    )).map((transfer) => readInputPort(transfer.edgeId));
    expect(receivedPorts.length).toBeGreaterThanOrEqual(18);
    expect(receivedPorts.slice(0, 6)).toEqual([
      "in_n", "in_n", "in_n", "in_e", "in_e", "in_e",
    ]);
    expect(new Set(receivedPorts.slice(6))).toEqual(new Set(["in_w"]));
  });
});

function readInputPort(edgeId: string): string {
  const port = inputPorts.find((candidate) =>
    edgeId.endsWith(`/port:item_input.${candidate}.input`),
  );
  expect(port, edgeId).toBeDefined();
  return port!;
}
