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
import {
  createBlueprint,
  createEntity,
  findFirstTick,
  findSlot,
  getDevice,
  getLastTick,
} from "./blueprint-test-helpers";
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

describe.each(SIMULATION_ENGINE_MATRIX)("cheat infinite device simulation [%s]", (engineKind) => {
  it("destroys strict-domain inputs while retaining a 50-item infinite output slot", async () => {
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
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint(
        "cheat-infinite-device",
        DEVICE_CASES.map((deviceCase, index) => createEntity(
          deviceCase.entityId,
          deviceCase.definitionId,
          index * 3,
          0,
          0,
          {
            "storageSlotGroups[0].slots[0].initialItemType": deviceCase.itemId,
            "storageSlotGroups[0].slots[0].initialCount": 8,
            "storageSlotGroups[1].slots[0].initialItemType": deviceCase.itemId,
          },
        )),
      ),
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
      expect(findSlot(
        report,
        finalTick,
        deviceCase.entityId,
        "destroy_buffer",
        "destroy_slot_1",
      ).count).toBe(0);
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
