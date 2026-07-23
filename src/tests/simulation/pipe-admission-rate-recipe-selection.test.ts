import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

describe("pipe admission rate-aware recipe selection", () => {
  it("selects the one-item recipe when only one item remains in the ten-second allowance", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("pipe-admission-rate-recipe-selection", [
        createEntity("source", "liquid_storager_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
          "storageSlotGroups[0].slots[0].initialCount": 4,
        }),
        createEntity("admission", "pipe_admission", 3, 1, 0, {
          "portGroups[0].ports[0].acceptRule": {
            base: { kind: "item", itemId: "item_liquid_water" },
            exclude: [],
          },
          "portGroups[0].ports[0].admissionRule": {
            itemId: "item_liquid_water",
            limit: null,
            perMinuteLimit: 18,
          },
        }),
        createEntity("sink", "liquid_storager_1", 4, 0),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 41,
    });

    expect(getTick(report, 1).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:source")
      && transfer.targetSlotId.includes("device:admission"),
    )).toHaveLength(2);
    expect(getDevice(report, 1, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        perMinuteLimit: 18,
        rateWindowCount: 2,
      });
    expect(getDevice(report, 1, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer-2");
    expect(getTick(report, 21).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(2);
    expect(getDevice(report, 21, "admission").admissionCounters?.["fluid_input:in_w"])
      .toMatchObject({
        perMinuteLimit: 18,
        rateWindowCount: 3,
      });
    expect(getDevice(report, 21, "admission").channelRecipes.default?.recipeId)
      .toBe("pipe_admission:dynamic-pipe-transfer");
    expect(getDevice(report, 21, "admission").channelRecipes.default?.recipeId)
      .not.toBe("pipe_admission:dynamic-pipe-transfer-2");
    expect(getTick(report, 41).transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:admission")
      && transfer.targetSlotId.includes("device:sink"),
    )).toHaveLength(1);
  });
});
