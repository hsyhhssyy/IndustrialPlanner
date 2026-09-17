import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-08:
// Reason: 观察窗口改为仿真秒数，测试不再绑定 Legacy 20 TPS。
// Trigger: cheat infinite device 纳入全引擎矩阵。
// Evidence: 用例只关心首次运行和三秒后的稳定槽位状态。
// Replacement: maxDurationSeconds、findFirstTick 与 getLastTick。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/cheat-infinite-device/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   findFirstTick,
//   findSlot,
//   getDevice,
//   getLastTick,
// } from "./blueprint-test-helpers";
import { findFirstTick, findSlot, getDevice, getLastTick } from "./blueprint-test-helpers";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

const DEVICE_CASES = [
  {
    entityId: "solid",
    definitionId: "cheat_infinite_solid",
    itemId: "item_iron_ore",
    recipeId: "r_cheat_infinite_solid_void_any_internal",
  },
  {
    entityId: "liquid",
    definitionId: "cheat_infinite_liquid",
    itemId: "item_liquid_water",
    recipeId: "r_cheat_infinite_liquid_void_any_internal",
  },
  {
    entityId: "gas",
    definitionId: "cheat_infinite_gas",
    itemId: "item_gas_inert",
    recipeId: "r_cheat_infinite_gas_void_any_internal",
  },
] as const;

const DESTROY_BUFFER_IDS = [
  "destroy_buffer",
  "destroy_buffer_e",
  "destroy_buffer_s",
  "destroy_buffer_w",
] as const;

describe.each(SIMULATION_ENGINE_MATRIX)("cheat infinite device simulation [%s]", (engineKind) => {
  it("destroys four isolated strict-domain inputs in parallel while retaining a 50-item infinite output slot", async () => {
    // AI-REMOVED 2026-09-08:
    // Reason: finalTick 的 45 只表示约两秒后的观察点，无法跨引擎复用。
    // Trigger: cheat infinite device 纳入全引擎矩阵。
    // Evidence: 断言目标是业务状态，不依赖精确 tick 相位。
    // Replacement: maxDurationSeconds: 3 与报告最后一帧。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // const finalTick = (2 * STANDARD_TICK_RATE_PER_SECOND) + 5;
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/cheat-infinite-device/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint(
    //         "cheat-infinite-device",
    //         DEVICE_CASES.map((deviceCase, index) => createEntity(
    //           deviceCase.entityId,
    //           deviceCase.definitionId,
    //           index * 3,
    //           0,
    //           0,
    //           {
    //             "storageSlotGroups[0].slots[0].initialItemType": deviceCase.itemId,
    //             "storageSlotGroups[0].slots[0].initialCount": 8,
    //             "storageSlotGroups[1].slots[0].initialItemType": deviceCase.itemId,
    //           },
    //         )),
    //       )
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/cheat-infinite-device/scene-01-cheat-infinite-device-34fe6490.schema6.json"),
      maxDurationSeconds: 3,
      engineKind,
      registry: createRegistryContract(),
    });

    const finalTick = getLastTick(report).tickNumber;
    for (const deviceCase of DEVICE_CASES) {
      const started = findFirstTick(report, (tick) =>
        Object.values(tick.devices[deviceCase.entityId]?.channelRecipes ?? {})
          .some((recipe) => recipe?.recipeId === deviceCase.recipeId)
      );
      for (const channelId of ["void_1", "void_2", "void_3", "void_4"]) {
        expect(getDevice(report, started.tickNumber, deviceCase.entityId).channelRecipes[channelId]?.recipeId)
          .toBe(deviceCase.recipeId);
      }
      for (const bufferId of DESTROY_BUFFER_IDS) {
        expect(findSlot(
          report,
          finalTick,
          deviceCase.entityId,
          bufferId,
          "destroy_slot_1",
        ).count).toBe(0);
      }
      expect(findSlot(
        report,
        finalTick,
        deviceCase.entityId,
        "infinite_output_buffer",
        "infinite_output_slot_1",
      )).toMatchObject({
        itemType: deviceCase.itemId,
        count: 50,
        ignoreStock: true,
      });
    }
  });
});
