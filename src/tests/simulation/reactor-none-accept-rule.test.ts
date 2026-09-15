import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/reactor-none-accept-rule/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   getDevice,
//   getLastTick,
// } from "./blueprint-test-helpers";
import { getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)(
  "reactor output port acceptRule: none blocks output [%s]",
  (engineKind) => {
  // AI-REMOVED 2026-09-08:
  // Reason: TICK_COUNT=1 在两个引擎中代表不同仿真时长。
  // Trigger: reactor none accept rule 纳入全引擎矩阵。
  // Evidence: 用例验证首个 0.5 秒观察窗口内不存在任何物流边。
  // Replacement: maxDurationSeconds: 0.5 与 getLastTick。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const TICK_COUNT = 1;

  it("blocks all transfer when no output port config is set", async () => {
    const registry = createRegistryContract();

    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/reactor-none-accept-rule/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint("reactor-none-blocks-output", [
    //         createEntity("reactor", "mix_pool_2", 0, 0, 0, {
    //           channelRecipes: {
    //             ch1: "r_chrono_mix_pool_xiranite_waste_liquids_from_liquid_xiranite_and_wastewater_basic_large",
    //             ch2: "r_mix_pool_liquid_xiranite_from_xiranite_powder_and_water_basic_large",
    //           },
    //           "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_xiranite",
    //           "storageSlotGroups[0].slots[0].initialCount": 2,
    //           "storageSlotGroups[0].slots[1].initialItemType": "item_liquid_sewage",
    //           "storageSlotGroups[0].slots[1].initialCount": 2,
    //           "storageSlotGroups[0].slots[2].initialItemType": "item_xiranite_powder",
    //           "storageSlotGroups[0].slots[2].initialCount": 2,
    //           "storageSlotGroups[0].slots[3].initialItemType": "item_liquid_water",
    //           "storageSlotGroups[0].slots[3].initialCount": 2,
    //         }),
    //         createEntity("power", "power_diffuser_1", 6, 0),
    //       ])
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/reactor-none-accept-rule/scene-01-reactor-none-blocks-output-3a071dc4.schema6.json"),
      maxDurationSeconds: 0.5,
      engineKind,
      registry,
    });

    // 没有任何物流传输 — 输出端口 acceptRule=none，边未建立
    expect(report.summary.totalTransferCount).toBe(0);
    expect(report.summary.transportComponentThroughput.length).toBe(0);

    const reactorTick = getDevice(report, getLastTick(report).tickNumber, "reactor");
    expect(reactorTick).toBeDefined();
  });
  },
);
