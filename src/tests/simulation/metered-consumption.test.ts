import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  computeActiveGasDiffusions,
  isDeviceInRequiredGasDiffusion,
} from "@/simulation/runtime/gas-diffusion";
import {
  canAcceptMeteredConsumptionItem,
  recordMeteredConsumptionItem,
} from "@/simulation/runtime/metered-consumption";
import {
  createSimulationMutableRuntimeState,
  normalizeAdmissionMinuteCountersForCurrentWindow,
  readAdmissionMinuteCounterForCurrentWindow,
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

describe("metered device consumption", () => {
  it("compiles every metered input to an internal synthetic sink", () => {
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
      const portId = device.meteredConsumption!.inputPortId;
      const nodeId = topology.ports[portId]!.boundNodeIds[0]!;
      const slotId = topology.nodes[nodeId]!.slotIds[0]!;

      expect(topology.nodes[nodeId]?.sourceStorageSlotGroupId).toBe("synthetic-input");
      expect(topology.slots[slotId]).toMatchObject({
        sourceStorageSlotGroupId: "synthetic-input",
        domain: "any",
        initialItemType: null,
        initialCount: 0,
      });
    }
  });

  it("destroys at most 30 items per fixed minute and preserves the count across a short outage", () => {
    const topology = compilePoweredBlueprint(createBlueprint("metered-vaporizer", [
      createEntity("source", "gas_storager_1", -4, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_gas_inert",
        "storageSlotGroups[0].slots[0].initialCount": 6,
      }),
      createEntity("pipe", "pipe_straight_1x1", -1, 1),
      createEntity("vaporizer", "vaporizer_1", 0, 0),
    ]));
    const device = topology.devices["device:vaporizer"]!;
    const portId = device.meteredConsumption!.inputPortId;
    const state = createSimulationMutableRuntimeState(topology);
    state.tickNumber = 1;
    expect(topology.ports[portId]?.boundNodeIds).toEqual([
      "device:vaporizer/node:synthetic-input",
    ]);
    expect(Object.values(topology.transferEdges)).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetPortId: portId }),
    ]));

    consume(topology, state, portId, "item_gas_inert", 5);
    expect(state.persistent.meteredConsumptions[device.id]).toMatchObject({
      currentItemId: "item_gas_inert",
      authorizedUntilTick: null,
      activeEffectItemId: null,
    });

    state.transient.isPowerOutage = true;
    expect(canAcceptMeteredConsumptionItem(topology, state, portId, "item_gas_inert")).toBe(false);
    expect(readAdmissionMinuteCounterForCurrentWindow(topology, state, portId).count).toBe(5);

    state.transient.isPowerOutage = false;
    consume(topology, state, portId, "item_gas_inert", 25);
    expect(readAdmissionMinuteCounterForCurrentWindow(topology, state, portId).count).toBe(30);
    expect(canAcceptMeteredConsumptionItem(topology, state, portId, "item_gas_inert")).toBe(false);
    const sinkSlotId = topology.nodes[topology.ports[portId]!.boundNodeIds[0]!]!.slotIds[0]!;
    expect(topology.slots[sinkSlotId]?.sourceStorageSlotGroupId).toBe("synthetic-input");
    expect(state.persistent.slots[sinkSlotId]).toMatchObject({ itemType: null, count: 0 });
    expect(state.transient.recipeStatsDelta.consumed.item_gas_inert).toBe(30);
  });

  it("locks each window to one gas and changes the environment only at the next qualified boundary", () => {
    const topology = compilePoweredBlueprint(createBlueprint("metered-vaporizer-gas", [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
      createEntity("consumer", "item_port_xiranite_oven_1", 5, 0),
    ]));
    const device = topology.devices["device:vaporizer"]!;
    const consumer = topology.devices["device:consumer"]!;
    const portId = device.meteredConsumption!.inputPortId;
    const state = createSimulationMutableRuntimeState(topology);
    state.tickNumber = 1;

    consume(topology, state, portId, "item_gas_inert", 6);
    expect(canAcceptMeteredConsumptionItem(topology, state, portId, "item_gas_acid")).toBe(false);
    const firstGasDiffusions = computeActiveGasDiffusions(topology, state);
    expect(firstGasDiffusions).toMatchObject([
      { sourceDeviceId: device.id, gasItemId: "item_gas_inert" },
    ]);
    expect(computeActiveGasDiffusions(topology, state)).toBe(firstGasDiffusions);
    expect(isDeviceInRequiredGasDiffusion({
      topology,
      state,
      device: consumer,
      requiredGasDiffusion: "item_gas_inert",
    })).toBe(true);

    state.tickNumber = 1200;
    normalizeAdmissionMinuteCountersForCurrentWindow(topology, state);
    consume(topology, state, portId, "item_gas_acid", 6);
    expect(state.persistent.meteredConsumptions[device.id]).toMatchObject({
      previousWindowCount: 6,
      previousWindowItemId: "item_gas_inert",
      currentItemId: "item_gas_acid",
      activeEffectItemId: "item_gas_inert",
      authorizedUntilTick: 2400,
    });

    state.transient.isPowerOutage = true;
    expect(computeActiveGasDiffusions(topology, state)).toEqual([]);
    expect(isDeviceInRequiredGasDiffusion({
      topology,
      state,
      device: consumer,
      requiredGasDiffusion: "item_gas_inert",
    })).toBe(false);
    state.transient.isPowerOutage = false;

    state.tickNumber = 2400;
    normalizeAdmissionMinuteCountersForCurrentWindow(topology, state);
    expect(computeActiveGasDiffusions(topology, state)).toMatchObject([
      { sourceDeviceId: device.id, gasItemId: "item_gas_acid" },
    ]);
    expect(isDeviceInRequiredGasDiffusion({
      topology,
      state,
      device: consumer,
      requiredGasDiffusion: "item_gas_inert",
    })).toBe(false);
    expect(isDeviceInRequiredGasDiffusion({
      topology,
      state,
      device: consumer,
      requiredGasDiffusion: "item_gas_acid",
    })).toBe(true);
  });

  it("rebuilds gas coverage when the topology identity and source position change", () => {
    const topology = compilePoweredBlueprint(createBlueprint("gas-position-before", [
      createEntity("vaporizer", "vaporizer_1", 0, 0),
      createEntity("consumer", "item_port_xiranite_oven_1", 5, 0),
    ]));
    const state = createSimulationMutableRuntimeState(topology);
    const vaporizer = topology.devices["device:vaporizer"]!;
    const portId = vaporizer.meteredConsumption!.inputPortId;
    state.tickNumber = 1;
    consume(topology, state, portId, "item_gas_inert", 6);

    expect(isDeviceInRequiredGasDiffusion({
      topology,
      state,
      device: topology.devices["device:consumer"]!,
      requiredGasDiffusion: "item_gas_inert",
    })).toBe(true);

    const movedTopology = compilePoweredBlueprint(createBlueprint("gas-position-after", [
      createEntity("vaporizer", "vaporizer_1", 100, 100),
      createEntity("consumer", "item_port_xiranite_oven_1", 5, 0),
    ]));
    expect(isDeviceInRequiredGasDiffusion({
      topology: movedTopology,
      state,
      device: movedTopology.devices["device:consumer"]!,
      requiredGasDiffusion: "item_gas_inert",
    })).toBe(false);
  });

  it("freezes and resumes a transmuter recipe without replacing its running recipe", () => {
    const recipeId = "liquid_transmuter_1_gas_gas_water_1";
    const topology = compilePoweredBlueprint(createBlueprint("metered-transmuter", [
      createEntity("transmuter", "transmuter_1_gastrans", 0, 0, 0, {
        channelRecipes: { default: recipeId },
        "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
        "storageSlotGroups[0].slots[0].initialCount": 2,
      }),
    ]));
    const device = topology.devices["device:transmuter"]!;
    const portId = device.meteredConsumption!.inputPortId;
    const state = createSimulationMutableRuntimeState(topology);
    state.tickNumber = 1;
    const channelId = device.recipeChannels[0]!.id;

    settleRecipes(topology, state);
    expect(state.persistent.devices[device.id]?.channelRecipes[channelId]).toBeUndefined();

    consume(topology, state, portId, "item_liquid_water", 6);
    settleRecipes(topology, state);
    const runningRecipe = state.persistent.devices[device.id]?.channelRecipes[channelId];
    expect(runningRecipe).toMatchObject({ recipeId, progressTicks: 0, state: "running" });

    state.tickNumber = 2400;
    normalizeAdmissionMinuteCountersForCurrentWindow(topology, state);
    advanceDevices(topology, state, 20);
    expect(state.persistent.devices[device.id]?.channelRecipes[channelId]).toBe(runningRecipe);
    expect(runningRecipe?.progressTicks).toBe(0);

    consume(topology, state, portId, "item_liquid_water", 6);
    advanceDevices(topology, state, 20);
    expect(state.persistent.devices[device.id]?.channelRecipes[channelId]).toBe(runningRecipe);
    expect(runningRecipe?.progressTicks).toBe(20);
  });
});

function compilePoweredBlueprint(
  blueprint: ReturnType<typeof createBlueprint>,
): CompiledSimulationTopology {
  const document = createWorldDocumentFromBlueprint(blueprint);
  return compileSimulationTopology({
    document,
    registry: createRegistryContract(),
    poweredEntityIds: new Set(document.entityOrder),
  });
}

function consume(
  topology: CompiledSimulationTopology,
  state: ReturnType<typeof createSimulationMutableRuntimeState>,
  portId: string,
  itemType: string,
  amount: number,
): void {
  for (let index = 0; index < amount; index += 1) {
    expect(canAcceptMeteredConsumptionItem(topology, state, portId, itemType)).toBe(true);
    expect(recordMeteredConsumptionItem(topology, state, portId, itemType)).toBe(true);
  }
}
