import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { runBlueprintSimulation } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
} from "./blueprint-test-helpers";

const XIRANITE_IN_INERT_GAS_RECIPE_ID =
  "xiranite_oven_xiranite_powder_2";

describe("gas diffusion simulation", () => {
  it("starts all five gas recipes from a full buffer and blocks a sixth gas", async () => {
    const finalTick = 1;
    const report = await runBlueprintSimulation({
      blueprint: createPrefilledGasDiffusionBlueprint("five-gases", 5, false),
      registry: createRegistryContract(),
      maxTickNumber: finalTick,
    });

    expect(report.topology.diagnostics).toEqual([]);
    const diffuser = getDevice(report, finalTick, "gas-diffuser");
    expect(diffuser.slotItems.find((slot) =>
      slot.storageGroupId === "consume_buffer" && slot.slotId === "consume_slot"
    )).toMatchObject({
      itemType: "item_gas_inert",
      count: 5,
      reserved: 5,
    });
    expect(Object.values(diffuser.channelRecipes).filter((recipe) =>
      recipe?.recipeId === "r_gas_diffuser_inert_gas_environment_basic"
      && recipe.state === "running"
    )).toHaveLength(5);
  });

  it("runs a covered device for exactly ten seconds from one gas, then freezes it", async () => {
    const finalTick = 12 * STANDARD_TICK_RATE_PER_SECOND;
    const report = await runBlueprintSimulation({
      // 故意把依赖环境的烤炉排在气体散布机之前，覆盖同帧启动与设备顺序无关。
      blueprint: createPrefilledGasDiffusionBlueprint("one-gas-ten-seconds", 1, true),
      registry: createRegistryContract(),
      maxTickNumber: finalTick,
    });

    const activeTicks = report.ticks.filter((tick) =>
      Object.values(tick.devices["gas-diffuser"]!.channelRecipes).some((recipe) =>
        recipe?.recipeId === "r_gas_diffuser_inert_gas_environment_basic"
        && recipe.state === "running"
      )
    );
    expect(activeTicks).toHaveLength(10 * STANDARD_TICK_RATE_PER_SECOND);

    const firstActiveTick = activeTicks[0]!.tickNumber;
    const firstFrozenTick = activeTicks.at(-1)!.tickNumber + 1;
    const outputAtFirstFrozenTick = findSlot(
      report,
      firstFrozenTick,
      "xiranite-oven",
      "item_output_buffer",
      "output_item_slot_1",
    ).count;
    const outputAtFinalTick = findSlot(
      report,
      finalTick,
      "xiranite-oven",
      "item_output_buffer",
      "output_item_slot_1",
    ).count;

    expect(firstActiveTick).toBeLessThanOrEqual(1);
    expect(getDevice(report, firstFrozenTick - 1, "xiranite-oven").channelRecipes.default)
      .not.toBeNull();
    expect(getDevice(report, firstFrozenTick, "xiranite-oven").channelRecipes.default)
      .toBeNull();
    expect(getDevice(report, finalTick, "xiranite-oven").channelRecipes.default)
      .toBeNull();
    expect(outputAtFirstFrozenTick).toBe(5);
    expect(outputAtFinalTick).toBe(outputAtFirstFrozenTick);
  });

  it("keeps a pipe converger from passing both liquid and gas into the same locked pipe", async () => {
    const finalTick = 100;
    const report = await runBlueprintSimulation({
      blueprint: createConvergerLockBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: finalTick,
    });

    const transfersToConverger = report.ticks.flatMap((tick) =>
      tick.transfers.filter((transfer) =>
        transfer.targetSlotId.includes("device:converger")
        && (transfer.itemType === "item_liquid_water" || transfer.itemType === "item_gas_inert")
      ),
    );
    const transfersToPipe = report.ticks.flatMap((tick) =>
      tick.transfers.filter((transfer) =>
        transfer.targetSlotId.includes("device:locked-pipe")
        && (transfer.itemType === "item_liquid_water" || transfer.itemType === "item_gas_inert")
      ),
    );
    const convergerItemTypes = new Set(transfersToConverger.map((transfer) => transfer.itemType));
    const pipeItemTypes = new Set(transfersToPipe.map((transfer) => transfer.itemType));

    expect(convergerItemTypes).toEqual(new Set(["item_liquid_water", "item_gas_inert"]));
    expect(pipeItemTypes.size).toBe(1);
    expect([...pipeItemTypes]).toEqual(["item_gas_inert"]);
    expect(transfersToPipe.some((transfer) => transfer.itemType === "item_liquid_water")).toBe(false);
    expect(getDevice(report, finalTick, "locked-pipe").slotItems.some((slot) =>
      slot.itemType === "item_gas_inert" && slot.count > 0
    )).toBe(true);
    expect(getDevice(report, finalTick, "converger").slotItems.some((slot) =>
      slot.itemType === "item_liquid_water" && slot.count > 0
    )).toBe(true);
  });
});

function createPrefilledGasDiffusionBlueprint(
  name: string,
  gasCount: number,
  includeCoveredOven: boolean,
): BlueprintDocument {
  const coveredOven = createEntity("xiranite-oven", "xiranite_oven_1", 2, 0, 0, {
      channelRecipes: {
        default: XIRANITE_IN_INERT_GAS_RECIPE_ID,
      },
      "storageSlotGroups[0].slots[0].initialItemType": "item_carbon_mtl",
      "storageSlotGroups[0].slots[0].initialCount": 20,
      "storageSlotGroups[1].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[1].slots[0].initialCount": 20,
    });
  return createBlueprint(name, [
    ...(includeCoveredOven ? [coveredOven] : []),
    createEntity("gas-diffuser", "vaporizer_1", 0, 0, 180, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_gas_inert",
      "storageSlotGroups[0].slots[0].initialCount": gasCount,
    }),
    createEntity("power", "power_diffuser_1", 3, 5),
  ]);
}

function createConvergerLockBlueprint(): BlueprintDocument {
  return createBlueprint("gas-liquid-converger-lock", [
    createEntity("gas-source", "gas_storager_1", 1, -1, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_gas_inert",
      "storageSlotGroups[0].slots[0].initialCount": 2,
    }),
    createEntity("liquid-source", "liquid_storager_1", -4, -1, 180, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": 2,
    }),
    createEntity("liquid-delay-pipe", "pipe_straight_1x1", -1, 0),
    createEntity("converger", "pipe_converger", 0, 0),
    createEntity("locked-pipe", "pipe_straight_1x1", 0, 1, 90),
  ]);
}
