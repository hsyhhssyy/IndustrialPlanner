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
  it("runs the inert-gas xiranite recipe at sustained 2s output speed while gas is supplied", async () => {
    const finalTick = 30 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const report = await runBlueprintSimulation({
      blueprint: createGasDiffusionXiraniteBlueprint("sustained-gas", 6),
      registry: createRegistryContract(),
      maxTickNumber: finalTick,
    });

    expect(report.topology.diagnostics).toEqual([]);
    const consumedGasTransfers = report.ticks.flatMap((tick) => tick.transfers.filter((transfer) =>
      transfer.sourceSlotId.includes("device:gas-source")
      && transfer.targetSlotId.includes("device:gas-pipe")
      && transfer.itemType === "item_gas_inert"
    ));
    expect(consumedGasTransfers).toHaveLength(6);
    expect(getDevice(report, finalTick, "gas-diffuser").meteredConsumption).toEqual({
      currentWindowCount: 6,
      currentWindowItemId: "item_gas_inert",
      previousWindowCount: 0,
      previousWindowItemId: null,
    });
    expect(getDevice(report, finalTick, "gas-diffuser").slotItems.every((slot) => slot.count === 0))
      .toBe(true);
    expect(getDevice(report, finalTick, "xiranite-oven").channelRecipes["default"]).toMatchObject({
      recipeId: XIRANITE_IN_INERT_GAS_RECIPE_ID,
    });
    expect(findSlot(report, finalTick, "xiranite-oven", "item_output_buffer", "output_item_slot_1").count)
      .toBeGreaterThan(0);
  });

  it("keeps a qualified environment for the next full minute, then freezes gas-dependent recipes", async () => {
    const afterGasEndsTick = 122 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const finalTick = 130 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const report = await runBlueprintSimulation({
      blueprint: createGasDiffusionXiraniteBlueprint("stopped-gas", 6),
      registry: createRegistryContract(),
      maxTickNumber: finalTick,
    });

    const outputAfterGasEnds = findSlot(
      report,
      afterGasEndsTick,
      "xiranite-oven",
      "item_output_buffer",
      "output_item_slot_1",
    ).count;
    const outputFinal = findSlot(
      report,
      finalTick,
      "xiranite-oven",
      "item_output_buffer",
      "output_item_slot_1",
    ).count;
    const recipeAfterGasEnds = getDevice(report, afterGasEndsTick, "xiranite-oven").channelRecipes["default"];
    const recipeFinal = getDevice(report, finalTick, "xiranite-oven").channelRecipes["default"];

    expect(getDevice(report, 60 * STANDARD_TICK_RATE_PER_SECOND, "gas-diffuser").meteredConsumption)
      .toEqual({
        currentWindowCount: 6,
        currentWindowItemId: "item_gas_inert",
        previousWindowCount: 0,
        previousWindowItemId: null,
      });
    expect(getDevice(report, 60 * STANDARD_TICK_RATE_PER_SECOND + 1, "gas-diffuser").meteredConsumption)
      .toEqual({
        currentWindowCount: 0,
        currentWindowItemId: null,
        previousWindowCount: 6,
        previousWindowItemId: "item_gas_inert",
      });
    expect(outputAfterGasEnds).toBeGreaterThan(0);
    expect(outputFinal).toBe(outputAfterGasEnds);
    expect(recipeFinal?.progressSeconds ?? null).toBe(recipeAfterGasEnds?.progressSeconds ?? null);
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

function createGasDiffusionXiraniteBlueprint(
  name: string,
  gasCount: number,
): BlueprintDocument {
  return createBlueprint(name, [
    createEntity("gas-source", "gas_storager_1", -4, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_gas_inert",
      "storageSlotGroups[0].slots[0].initialCount": gasCount,
    }),
    createEntity("gas-pipe", "pipe_straight_1x1", -1, 1),
    createEntity("gas-diffuser", "vaporizer_1", 0, 0),
    createEntity("xiranite-oven", "xiranite_oven_1", 2, 0, 0, {
      channelRecipes: {
        default: XIRANITE_IN_INERT_GAS_RECIPE_ID,
      },
      "storageSlotGroups[0].slots[0].initialItemType": "item_carbon_mtl",
      "storageSlotGroups[0].slots[0].initialCount": 20,
      "storageSlotGroups[1].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[1].slots[0].initialCount": 20,
    }),
    createEntity("power", "power_diffuser_1", 3, 5),
  ]);
}

function createConvergerLockBlueprint(): BlueprintDocument {
  return createBlueprint("gas-liquid-converger-lock", [
    createEntity("gas-source", "gas_storager_1", 1, -1, 180, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_gas_inert",
      "storageSlotGroups[0].slots[0].initialCount": 2,
    }),
    createEntity("liquid-source", "liquid_storager_1", -4, -1, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": 2,
    }),
    createEntity("liquid-delay-pipe", "pipe_straight_1x1", -1, 0),
    createEntity("converger", "pipe_converger", 0, 0),
    createEntity("locked-pipe", "pipe_straight_1x1", 0, 1, 90),
  ]);
}
