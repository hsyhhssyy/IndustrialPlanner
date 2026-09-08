import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
// AI-REMOVED 2026-09-08:
// Reason: 净水节点公共行为改按累计仿真秒数与首次业务事件定位，不再绑定 Legacy 20 TPS。
// Trigger: water purifier node 测试纳入全引擎矩阵。
// Evidence: 收集、转化和手动产出均以秒或每分钟速率定义。
// Replacement: maxDurationSeconds、findFirstTick 与 getLastTick。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
  WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY,
  WATER_PURIFIER_NODE_ENTITY_ID,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
  WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY,
  WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
  WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
} from "@/shared/water-purifier-node";
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

// AI-REMOVED 2026-09-08:
// Reason: COMPLETION_TICK=21 只表示 Legacy 中首次一秒配方完成帧。
// Trigger: water purifier node 测试纳入全引擎矩阵。
// Evidence: Dense 对应完成帧为 tick 3，二者都应通过业务事件定位。
// Replacement: 各用例的 findFirstTick 产出条件。
// Risk: Low
// Human Review: Required
//
// Original code:
// const COMPLETION_TICK = STANDARD_TICK_RATE_PER_SECOND + 1;

describe.each(SIMULATION_ENGINE_MATRIX)("净水节点 runtime [%s]", (engineKind) => {
  it("input-derived mode immediately frees all three 2-drop input slots and later stores sewage in the 500 buffer", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-input-derived", [
        createWaterPurifierNode({
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[0].initialCount": 2,
          "storageSlotGroups[1].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[1].slots[0].initialCount": 2,
          "storageSlotGroups[2].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[2].slots[0].initialCount": 2,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxDurationSeconds: 2,
      engineKind,
      registry: createRegistryContract(),
    });

    const intakeStarted = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.channelRecipes.intake_1?.recipeId
        === "r_water_purifier_node_collect_sewage_basic"
    );
    const sewageCollected = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.slotItems.some((slot) =>
        slot.storageGroupId === WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID
        && slot.slotId === "slot_1"
        && slot.itemType === "item_liquid_sewage"
        && slot.count === 6
      ) === true
    );
    expect(getDevice(report, intakeStarted.tickNumber, "water-node").channelRecipes).toMatchObject({
      intake_1: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
      intake_2: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
      intake_3: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
    });
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_1", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_2", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_3", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, sewageCollected.tickNumber, "water-node", WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: "item_liquid_sewage",
        count: 6,
      });
    expect(sewageCollected.elapsedSimulationSeconds - intakeStarted.elapsedSimulationSeconds)
      .toBeCloseTo(1);
  });

  it("converts 30 sewage in the internal buffer to 1 xiranite waste liquid", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-byproduct", [
        createWaterPurifierNode({
          "storageSlotGroups[3].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[3].slots[0].initialCount": 30,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxDurationSeconds: 2,
      engineKind,
      registry: createRegistryContract(),
    });

    const outputProduced = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.slotItems.some((slot) =>
        slot.storageGroupId === WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID
        && slot.slotId === "slot_1"
        && slot.itemType === WATER_PURIFIER_OUTPUT_ITEM_ID
        && slot.count === 1
      ) === true
    );
    expect(findSlot(report, outputProduced.tickNumber, "water-node", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: WATER_PURIFIER_OUTPUT_ITEM_ID,
        count: 1,
      });
  });

  it("manual mode produces the configured per-minute output without sewage input", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-manual-output", [
        createWaterPurifierNode({
          [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: "manual-rate",
          [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]: 60,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxDurationSeconds: 2,
      engineKind,
      registry: createRegistryContract(),
    });

    const outputProduced = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.slotItems.some((slot) =>
        slot.storageGroupId === WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID
        && slot.slotId === "slot_1"
        && slot.itemType === WATER_PURIFIER_OUTPUT_ITEM_ID
        && slot.count === 1
      ) === true
    );
    expect(findSlot(report, outputProduced.tickNumber, "water-node", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID, "slot_1"))
      .toMatchObject({
        itemType: WATER_PURIFIER_OUTPUT_ITEM_ID,
        count: 1,
      });
  });

  it("manual mode keeps sewage intake running but disables automatic byproduct output", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("water-purifier-node-manual-disables-input", [
        createWaterPurifierNode({
          [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: "manual-rate",
          [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]: 0,
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[0].slots[0].initialCount": 2,
          "storageSlotGroups[3].slots[0].initialItemType": "item_liquid_sewage",
          "storageSlotGroups[3].slots[0].initialCount": 30,
        }),
        createEntity("power", "power_diffuser_1", 28, -5),
      ]),
      maxDurationSeconds: 1,
      engineKind,
      registry: createRegistryContract(),
    });

    const intakeStarted = findFirstTick(report, (tick) =>
      tick.devices["water-node"]?.channelRecipes.intake_1?.recipeId
        === "r_water_purifier_node_collect_sewage_basic"
    );
    const finalTick = getLastTick(report).tickNumber;
    expect(getDevice(report, intakeStarted.tickNumber, "water-node").channelRecipes).toMatchObject({
      intake_1: { recipeId: "r_water_purifier_node_collect_sewage_basic" },
    });
    expect(getDevice(report, finalTick, "water-node").channelRecipes).not.toHaveProperty("byproduct");
    expect(findSlot(report, intakeStarted.tickNumber, "water-node", "input_buffer_1", "slot_1")).toMatchObject({
      count: 0,
    });
    expect(findSlot(report, finalTick, "water-node", WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID, "slot_1")).toMatchObject({
      itemType: "item_liquid_sewage",
      count: 30,
    });
  });
});

function createWaterPurifierNode(config: Record<string, unknown>) {
  return createEntity("water-node", WATER_PURIFIER_NODE_ENTITY_ID, 0, -5, 0, {
    [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
    ...config,
  });
}
