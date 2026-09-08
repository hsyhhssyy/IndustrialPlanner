import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  resolveSimulationMillisecondsAtFirstTick,
} from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const OUTPUT_ITEM_ID = "item_liquid_xiranite";
const OUTPUT_ACCEPT_RULE = {
  base: { kind: "item", itemId: OUTPUT_ITEM_ID },
  exclude: [],
} as const;

// AI-REMOVED 2026-09-08:
// Reason: 反应池双出口轮询与并行出货是所有生产求解器共同的 Host 行为。
// Trigger: 用户确认下一类测试接入 Host 行为矩阵。
// Evidence: 用例只通过 runBlueprintSimulation 公共入口观察输出传输。
// Replacement: 下方 SIMULATION_ENGINE_MATRIX 参数化 describe。
// Risk: Dense 可能暴露反应配方推进或出口轮询差异。
// Human Review: Required
//
// Original code:
// describe("反应池双液体出口轮询", () => {
describe.each(SIMULATION_ENGINE_MATRIX)("反应池双液体出口轮询 [%s]", (engineKind) => {
  it.each([
    {
      definitionId: "mix_pool_1",
      recipeId: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic",
      powerX: 16,
    },
    {
      definitionId: "mix_pool_2",
      recipeId: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
      powerX: 17,
    },
  ])(
    "$definitionId alternates isolated products across two independently configured pipes",
    async ({ definitionId, recipeId, powerX }) => {
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint(`${definitionId}-dual-fluid-output-routing`, [
          createEntity("pool", definitionId, 10, 10, 0, {
            channelRecipes: { ch1: recipeId },
            "storageSlotGroups[0].slots[0].initialItemType": "item_xiranite_powder",
            "storageSlotGroups[0].slots[0].initialCount": 10,
            "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_water",
            "storageSlotGroups[0].slots[1].initialCount": 10,
            "portGroups[2].ports[0].acceptRule": OUTPUT_ACCEPT_RULE,
            "portGroups[3].ports[0].acceptRule": OUTPUT_ACCEPT_RULE,
          }),
          createEntity("power", "power_diffuser_1", powerX, 10),

          createEntity("pipe-a-1", "pipe_straight_1x1", 9, 11, 180),
          createEntity("pipe-a-turn", "pipe_turn_cw_1x1", 8, 11),
          createEntity("pipe-a-2", "pipe_straight_1x1", 8, 10, 270),
          createEntity("sink-a", "liquid_storager_1", 7, 7, 90),

          createEntity("pipe-b-1", "pipe_straight_1x1", 9, 13, 180),
          createEntity("pipe-b-turn", "pipe_turn_ccw_1x1", 8, 13, 90),
          createEntity("pipe-b-2", "pipe_straight_1x1", 8, 14, 90),
          createEntity("sink-b", "liquid_storager_1", 7, 15, 270),
        ]),
        registry: createRegistryContract(),
        engineKind,
        maxDurationSeconds: 12.5,
        // AI-REMOVED 2026-09-08:
        // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 250。
        // Trigger: 双液体出口测试接入求解器矩阵。
        // Evidence: 12.5 秒足以覆盖 12000ms 相位下的第六次输出。
        // Replacement: maxDurationSeconds: 12.5。
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // maxTickNumber: 250,
      });
      const outputTransfers = report.ticks.flatMap((tick) => tick.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:pool/")
          && transfer.itemType === OUTPUT_ITEM_ID,
        )
        .map((transfer) => ({
          elapsedMilliseconds: resolveSimulationMillisecondsAtFirstTick(
            report.topology.standardTickRate,
            tick.tickNumber,
          ),
          portId: transfer.edgeId.includes("fluid_output_a.out_w_1")
            ? "out_w_1"
            : "out_w_3",
        })));

      expect(report.topology.diagnostics).toEqual([]);
      expect(outputTransfers).toEqual([
        { elapsedMilliseconds: 2_000, portId: "out_w_1" },
        { elapsedMilliseconds: 4_000, portId: "out_w_3" },
        { elapsedMilliseconds: 6_000, portId: "out_w_1" },
        { elapsedMilliseconds: 8_000, portId: "out_w_3" },
        { elapsedMilliseconds: 10_000, portId: "out_w_1" },
        { elapsedMilliseconds: 12_000, portId: "out_w_3" },
      ]);
      // AI-REMOVED 2026-09-08:
      // Reason: 输出轮询节奏绑定 Legacy tick 坐标。
      // Trigger: 双液体出口测试接入求解器矩阵。
      // Evidence: 两引擎共同业务契约是每 2000ms 轮换出口，而不是相同采样 tick 编号。
      // Replacement: elapsedMilliseconds 断言。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // expect(outputTransfers).toEqual([
      //   { tickNumber: 41, portId: "out_w_1" },
      //   { tickNumber: 81, portId: "out_w_3" },
      //   { tickNumber: 121, portId: "out_w_1" },
      //   { tickNumber: 161, portId: "out_w_3" },
      //   { tickNumber: 201, portId: "out_w_1" },
      //   { tickNumber: 241, portId: "out_w_3" },
      // ]);
    },
  );

  it.each([
    { definitionId: "mix_pool_1", powerX: 16 },
    { definitionId: "mix_pool_2", powerX: 17 },
  ])(
    "$definitionId sends buffered products through both pipes in the same tick",
    async ({ definitionId, powerX }) => {
      const report = await runBlueprintSimulation({
        blueprint: createBlueprint(`${definitionId}-parallel-fluid-output-routing`, [
          createEntity("pool", definitionId, 10, 10, 0, {
            "storageSlotGroups[0].slots[0].initialItemType": OUTPUT_ITEM_ID,
            "storageSlotGroups[0].slots[0].initialCount": 4,
            "portGroups[2].ports[0].acceptRule": OUTPUT_ACCEPT_RULE,
            "portGroups[3].ports[0].acceptRule": OUTPUT_ACCEPT_RULE,
          }),
          createEntity("power", "power_diffuser_1", powerX, 10),
          createEntity("pipe-a", "pipe_straight_1x1", 9, 11, 180),
          createEntity("pipe-b", "pipe_straight_1x1", 9, 13, 180),
        ]),
        registry: createRegistryContract(),
        engineKind,
        maxDurationSeconds: 1,
        // AI-REMOVED 2026-09-08:
        // Reason: 观察窗口按业务时间表达，不绑定 Legacy tick 20。
        // Trigger: 双液体出口测试接入求解器矩阵。
        // Evidence: 1 秒窗口足以观察缓冲产物的首次并行输出。
        // Replacement: maxDurationSeconds: 1。
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // maxTickNumber: 20,
      });
      const firstOutputTick = report.ticks.find((tick) => tick.transfers.some((transfer) =>
        transfer.sourceSlotId.includes("device:pool/")
        && transfer.itemType === OUTPUT_ITEM_ID,
      ));
      const movedPortIds = [...new Set(firstOutputTick?.transfers
        .filter((transfer) =>
          transfer.sourceSlotId.includes("device:pool/")
          && transfer.itemType === OUTPUT_ITEM_ID,
        )
        .map((transfer) => transfer.edgeId.includes("fluid_output_a.out_w_1")
          ? "out_w_1"
          : "out_w_3") ?? [])].sort();

      expect(report.topology.diagnostics).toEqual([]);
      expect(firstOutputTick).toBeDefined();
      expect(movedPortIds).toEqual(["out_w_1", "out_w_3"]);
    },
  );
});
