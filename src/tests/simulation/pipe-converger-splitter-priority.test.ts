import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

// 管道汇流器（rot 270，出东）：北入口接多出口管道分流器 a-split，西入口接直管 b-1；
// 两路惰气各 6/min，汇流器下游准入口 6/min，必须由优先级决定哪一路独占出口。
// 前约 40 s 高优先级一路尚未到货时允许低优先级回退，因此只断言 45 s 之后的稳态。
const directory = "src/tests/fixtures/blueprints/simulation/pipe-converger-splitter-priority";
const convergerSlotPrefix = "device:conv/";
const cases = [
  // 默认组合规则：最后放置的上游为直管时，紧贴分流器的入口优先。
  { scene: "default-line-placed-last", winner: "a-split", loser: "b-1" },
  { scene: "default-splitter-placed-last", winner: "b-1", loser: "a-split" },
  // 自定义优先级：分流器侧 1，直管侧 9。
  { scene: "custom-splitter-side-high", winner: "a-split", loser: "b-1" },
] as const;

describe.each(SIMULATION_ENGINE_MATRIX)("管道汇流器上游为分流器时的输入优先级 [%s]", (engineKind) => {
  it.each(cases)("$scene 持续只接收 $winner", async ({ scene, winner, loser }) => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile(`${directory}/${scene}.schema7.json`),
      registry: createRegistryContract(),
      engineKind,
      maxDurationSeconds: 120,
    });
    expect(report.topology.diagnostics).toEqual([]);
    expect(report.summary.runtimeDiagnosticCount).toBe(0);

    const arrivals = report.ticks
      .filter((tick) => tick.elapsedSimulationSeconds >= 45)
      .flatMap((tick) => tick.transfers.filter((transfer) =>
        transfer.targetSlotId.startsWith(convergerSlotPrefix),
      ));
    const fromWinner = arrivals.filter((transfer) => transfer.sourceSlotId.includes(`device:${winner}/`));
    const fromLoser = arrivals.filter((transfer) => transfer.sourceSlotId.includes(`device:${loser}/`));
    expect(fromWinner.length).toBeGreaterThanOrEqual(6);
    expect(fromLoser).toEqual([]);
  });
});
