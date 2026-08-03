import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  createSimulationMutableRuntimeState,
} from "@/simulation/runtime/runtime-state";
import { advanceDevices } from "@/simulation/runtime/stage-1-advance-devices";
import { settleRecipes } from "@/simulation/runtime/stage-5-settle-recipes";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import type { CompiledSimulationTopology } from "@/simulation/types";
import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
} from "./blueprint-test-helpers";

const registry = createRegistryContract();

describe("consumption channel device mechanism", () => {
  it("compiles every consumption input to one real capacity-five slot and five leading channels", () => {
    for (const definitionId of [
      "transmuter_1_gastrans",
      "transmuter_1_liquidtrans",
      "transmuter_2_gastrans",
      "transmuter_2_solidtrans",
      "vaporizer_1",
      ] as const) {
      const topology = compilePoweredBlueprint(createBlueprint(`synthetic-${definitionId}`, [
        createEntity("device", definitionId, 0, 0),
      ]));
      const device = topology.devices["device:device"]!;
      const portId = device.portIds.find(
        (candidate) => topology.ports[candidate]?.direction === "input"
          && topology.nodes[topology.ports[candidate]!.boundNodeIds[0]!]
            ?.sourceStorageSlotGroupId === "consume_buffer",
      )!;
      const nodeId = topology.ports[portId]!.boundNodeIds[0]!;
      const slotId = topology.nodes[nodeId]!.slotIds[0]!;

      expect(topology.nodes[nodeId]?.sourceStorageSlotGroupId).toBe("consume_buffer");
      expect(topology.slots[slotId]).toMatchObject({
        sourceStorageSlotGroupId: "consume_buffer",
        capacity: 5,
        initialItemType: null,
        initialCount: 0,
      });
      expect(device.consumptionChannelCount).toBe(5);
      expect(device.recipeChannels.slice(0, 5).every(
        (channel) => channel.type === "consumption-channel",
      )).toBe(true);
      expect(device.recipeChannels.slice(5).every(
        (channel) => channel.type === "normal-channel",
      )).toBe(true);
    }
  });

  it("keeps one reserved item in the slot until exactly ten seconds complete", () => {
    const topology = compilePoweredBlueprint(createBlueprint("one-consumption-item", [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
    ]));
    const device = topology.devices["device:vaporizer"]!;
    const state = createSimulationMutableRuntimeState(topology);
    const slotId = getConsumptionSlotId(topology, device.id);
    state.tickNumber = 1;
    putItems(state, slotId, "item_gas_inert", 1);

    settleRecipes(registry, topology, state);
    expect(getRunningConsumptionRecipes(topology, state, device.id)).toHaveLength(1);
    expect(state.persistent.slots[slotId]).toMatchObject({
      itemType: "item_gas_inert",
      count: 1,
    });

    advanceDevices(registry, topology, state, 199);
    expect(state.persistent.slots[slotId]?.count).toBe(1);
    advanceDevices(registry, topology, state, 1);
    expect(state.persistent.slots[slotId]).toMatchObject({ itemType: null, count: 0 });
    expect(state.transient.recipeStatsDelta.consumed.item_gas_inert).toBe(1);
  });

  it("starts five recipes concurrently and leaves no capacity for a sixth item", () => {
    const topology = compilePoweredBlueprint(createBlueprint("five-consumption-items", [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
    ]));
    const device = topology.devices["device:vaporizer"]!;
    const state = createSimulationMutableRuntimeState(topology);
    const slotId = getConsumptionSlotId(topology, device.id);
    state.tickNumber = 1;
    putItems(state, slotId, "item_gas_inert", 5);

    settleRecipes(registry, topology, state);
    const recipes = getRunningConsumptionRecipes(topology, state, device.id);
    expect(recipes).toHaveLength(5);
    expect(new Set(recipes.map((recipe) => recipe.recipeId))).toEqual(
      new Set(["r_gas_diffuser_inert_gas_environment_basic"]),
    );
    expect(recipes.reduce((total, recipe) => total + recipe.reservations.length, 0)).toBe(5);
    expect(topology.slots[slotId]!.capacity - state.persistent.slots[slotId]!.count).toBe(0);
    expect(state.persistent.slots[slotId]?.count).toBe(5);
  });

  it("starts and completes consumption while the device is outside every power range", () => {
    const topology = compileBlueprint(createBlueprint("out-of-range-consumption", [
      createEntity("transmuter", "transmuter_1_gastrans", 0, 0),
    ]), false);
    const device = topology.devices["device:transmuter"]!;
    const state = createSimulationMutableRuntimeState(topology);
    const slotId = getConsumptionSlotId(topology, device.id);
    putItems(state, slotId, "item_liquid_xiranite", 1);

    expect(device.powerStatus).toBe("out-of-power-range");
    settleRecipes(registry, topology, state, "real", 0, topology.totalPowerDemand);
    expect(getRunningConsumptionRecipes(topology, state, device.id)).toHaveLength(1);
    advanceDevices(registry, topology, state, 200, "real", 0, topology.totalPowerDemand);
    expect(state.persistent.slots[slotId]).toMatchObject({ itemType: null, count: 0 });
  });

  it("keeps staggered arrivals on independent ten-second lifetimes", () => {
    const topology = compilePoweredBlueprint(createBlueprint("staggered-consumption", [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
    ]));
    const vaporizer = topology.devices["device:vaporizer"]!;
    const state = createSimulationMutableRuntimeState(topology);
    const slotId = getConsumptionSlotId(topology, vaporizer.id);
    state.tickNumber = 1;
    putItems(state, slotId, "item_gas_inert", 1);
    settleRecipes(registry, topology, state);
    advanceDevices(registry, topology, state, 100);

    putItems(state, slotId, "item_gas_inert", 2);
    settleRecipes(registry, topology, state);
    advanceDevices(registry, topology, state, 100);
    expect(state.persistent.slots[slotId]?.count).toBe(1);
    expect(getRunningConsumptionRecipes(topology, state, vaporizer.id)).toHaveLength(1);

    advanceDevices(registry, topology, state, 100);
    expect(state.persistent.slots[slotId]).toMatchObject({ itemType: null, count: 0 });
  });

  it("starts a normal recipe in the same settle frame, then freezes and resumes it with consumption", () => {
    const recipeId = "liquid_transmuter_1_gas_gas_xiranite_enr_1";
    const topology = compilePoweredBlueprint(createBlueprint("consumption-gated-transmuter", [
      createEntity("transmuter", "transmuter_1_gastrans", 0, 0, 0, {
        channelRecipes: { default: recipeId },
      }),
    ]));
    const device = topology.devices["device:transmuter"]!;
    const state = createSimulationMutableRuntimeState(topology);
    const slotId = getConsumptionSlotId(topology, device.id);
    const normalInputSlotId = getStorageSlotId(topology, device.id, "liquid_input_buffer");
    const normalChannel = device.recipeChannels.find((channel) => channel.type === "normal-channel")!;
    state.tickNumber = 1;
    putItems(state, slotId, "item_liquid_xiranite", 1);
    settleRecipes(registry, topology, state);
    advanceDevices(registry, topology, state, 100);

    putItems(state, normalInputSlotId, "item_liquid_xiranite_enr", 2);
    settleRecipes(registry, topology, state);
    const runningRecipe = state.persistent.devices[device.id]?.channelRecipes[normalChannel.id];
    expect(runningRecipe).toMatchObject({ recipeId, progressTicks: 0, state: "running" });

    advanceDevices(registry, topology, state, 100);
    expect(state.persistent.slots[slotId]?.count).toBe(0);
    expect(runningRecipe?.progressTicks).toBe(100);

    state.transient.activeConsumptionDeviceIds = new Set();
    advanceDevices(registry, topology, state, 20);
    expect(state.persistent.devices[device.id]?.channelRecipes[normalChannel.id]).toBe(runningRecipe);
    expect(runningRecipe?.progressTicks).toBe(100);

    putItems(state, slotId, "item_liquid_xiranite", 1);
    settleRecipes(registry, topology, state);
    advanceDevices(registry, topology, state, 20);
    expect(state.persistent.devices[device.id]?.channelRecipes[normalChannel.id]).toBe(runningRecipe);
    expect(runningRecipe?.progressTicks).toBe(120);
  });

  it("runs consumption without power and commits waiting output after power and consumption stop", () => {
    const topology = compilePoweredBlueprint(createBlueprint("powerless-consumption", [
      createEntity("transmuter", "transmuter_1_gastrans", 0, 0, 0, {
        channelRecipes: { default: "liquid_transmuter_1_gas_gas_water_1" },
        "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
        "storageSlotGroups[0].slots[0].initialCount": 1,
        "storageSlotGroups[1].slots[0].initialItemType": "item_gas_water",
        "storageSlotGroups[1].slots[0].initialCount": 50,
      }),
    ]));
    const device = topology.devices["device:transmuter"]!;
    const state = createSimulationMutableRuntimeState(topology);
    const consumptionSlotId = getConsumptionSlotId(topology, device.id);
    const outputSlotId = topology.nodes[`${device.id}/node:gas_output_buffer`]!.slotIds[0]!;
    const normalChannel = device.recipeChannels.find((channel) => channel.type === "normal-channel")!;
    putItems(state, consumptionSlotId, "item_liquid_xiranite", 1);

    settleRecipes(registry, topology, state, "real", 0, topology.totalPowerDemand);
    expect(getRunningConsumptionRecipes(topology, state, device.id)).toHaveLength(1);
    expect(state.persistent.devices[device.id]?.channelRecipes[normalChannel.id] ?? null).toBeNull();
    advanceDevices(registry, topology, state, 200, "real", 0, topology.totalPowerDemand);
    expect(state.persistent.slots[consumptionSlotId]?.count).toBe(0);

    // 先在有电且有消耗许可时把普通配方推进到 waiting-output。
    putItems(state, consumptionSlotId, "item_liquid_xiranite", 1);
    settleRecipes(registry, topology, state);
    advanceDevices(registry, topology, state, 40);
    expect(state.persistent.devices[device.id]?.channelRecipes[normalChannel.id]?.state)
      .toBe("waiting-output");

    advanceDevices(registry, topology, state, 160);
    state.transient.activeConsumptionDeviceIds = new Set();
    state.persistent.slots[outputSlotId]!.count = 49;
    settleRecipes(registry, topology, state, "real", 0, topology.totalPowerDemand);
    expect(state.persistent.devices[device.id]?.channelRecipes[normalChannel.id] ?? null).toBeNull();
    expect(state.persistent.slots[outputSlotId]?.count).toBe(50);
  });
});

function compilePoweredBlueprint(
  blueprint: ReturnType<typeof createBlueprint>,
): CompiledSimulationTopology {
  return compileBlueprint(blueprint, true);
}

function compileBlueprint(
  blueprint: ReturnType<typeof createBlueprint>,
  powered: boolean,
): CompiledSimulationTopology {
  const document = createWorldDocumentFromBlueprint(blueprint);
  return compileSimulationTopology({
    document,
    registry,
    poweredEntityIds: powered ? new Set(document.entityOrder) : new Set(),
  });
}

function getConsumptionSlotId(
  topology: CompiledSimulationTopology,
  deviceId: string,
): string {
  const device = topology.devices[deviceId]!;
  const nodeId = device.nodeIds.find(
    (candidate) => topology.nodes[candidate]?.sourceStorageSlotGroupId === "consume_buffer",
  )!;
  return topology.nodes[nodeId]!.slotIds[0]!;
}

function getStorageSlotId(
  topology: CompiledSimulationTopology,
  deviceId: string,
  storageGroupId: string,
): string {
  const device = topology.devices[deviceId]!;
  const nodeId = device.nodeIds.find(
    (candidate) => topology.nodes[candidate]?.sourceStorageSlotGroupId === storageGroupId,
  )!;
  return topology.nodes[nodeId]!.slotIds[0]!;
}

function putItems(
  state: ReturnType<typeof createSimulationMutableRuntimeState>,
  slotId: string,
  itemType: string,
  count: number,
): void {
  state.persistent.slots[slotId] = { itemType, count };
  state.transient.reservedAmountByStorageSlotId = null;
}

function getRunningConsumptionRecipes(
  topology: CompiledSimulationTopology,
  state: ReturnType<typeof createSimulationMutableRuntimeState>,
  deviceId: string,
) {
  const device = topology.devices[deviceId]!;
  const deviceState = state.persistent.devices[deviceId]!;
  return device.recipeChannels
    .filter((channel) => channel.type === "consumption-channel")
    .map((channel) => deviceState.channelRecipes[channel.id] ?? null)
    .filter((recipe): recipe is NonNullable<typeof recipe> => recipe?.state === "running");
}
