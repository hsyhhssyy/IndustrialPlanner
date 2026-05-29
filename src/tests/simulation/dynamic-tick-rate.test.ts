import { describe, expect, it } from "vitest";

import { advanceDevices } from "@/simulation/runtime/stage-1-advance-devices";
import { createSimulationMutableRuntimeState } from "@/simulation/runtime/runtime-state";
import {
  isDynamicTickRateCompatibleWithTransferUnits,
} from "@/simulation/tick-rate";
import type {
  CompiledSimulationRecipePlan,
  CompiledSimulationTopology,
} from "@/simulation/types";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";

describe("REQ-080: dynamic simulation tick rate", () => {
  it("keeps only phase-safe dynamic tick rates for the current belt and pipe transfer units", () => {
    const transferUnitTicks = [20, 10];

    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 20, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 10, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 4, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 2, transferUnitTicks })).toBe(true);
    expect(isDynamicTickRateCompatibleWithTransferUnits({ dynamicTickRate: 5, transferUnitTicks })).toBe(false);
  });

  it("lowers and restores worker dynamic tick rate only through legal switch points", () => {
    const runtime = new SimulationWorkerRuntime();
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      simulationSpeed: 4,
    });

    expect(runtime.getStatus().dynamicTickRate).toBe(10);

    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 2,
      tickNumber: 20,
      simulationSpeed: 4,
    });
    runtime.advanceToTick(20);

    expect(runtime.getStatus().dynamicTickRate).toBe(4);

    runtime.handleRequest({
      type: "set-simulation-speed",
      requestId: 3,
      simulationSpeed: 1,
    });
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 4,
      tickNumber: 40,
      simulationSpeed: 1,
    });
    runtime.advanceToTick(40);

    expect(runtime.getStatus().dynamicTickRate).toBe(20);
  });

  it("exposes the current dynamic tick rate through runtime status", () => {
    const runtime = new SimulationWorkerRuntime();
    expect(runtime.getStatus().dynamicTickRate).toBeNull();

    const loaded = runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      simulationSpeed: 4,
    });

    expect(loaded.status.dynamicTickRate).toBe(10);
  });

  it("carries production overflow across successful output writes", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.devices["device:maker"]!.channelRecipes["main"] = createRunningRecipe(3);

    advanceDevices(topology, state, 7);

    expect(state.persistent.slots["slot:out"]).toMatchObject({
      itemType: "item_test",
      count: 2,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toMatchObject({
      recipeId: "recipe:test",
      progressTicks: 0,
      state: "running",
    });
  });

  it("pins production progress at 100 percent and discards overflow when output is blocked", () => {
    const topology = createProductionOverflowTopology(1);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.devices["device:maker"]!.channelRecipes["main"] = createRunningRecipe(3);

    advanceDevices(topology, state, 9);

    expect(state.persistent.slots["slot:out"]).toMatchObject({
      itemType: "item_test",
      count: 1,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"]).toMatchObject({
      recipeId: "recipe:test",
      progressTicks: 5,
      state: "waiting-output",
    });
  });
});

function createEmptyTopology(): CompiledSimulationTopology {
  return {
    schemaVersion: 4,
    topologyId: "topology:empty",
    documentKey: "document:test",
    documentHash: "hash:test",
    registryHash: "registry:test",
    standardTickRate: 20,
    totalPowerDemand: 0,
    itemCatalog: {},
    recipeCatalog: {},
    devices: {},
    nodes: {},
    slots: {},
    ports: {},
    links: {},
    physicalConnections: {},
    transferEdges: {},
    ordering: {
      deviceOrder: [],
      nodeOrder: [],
      slotOrder: [],
      portOrder: [],
      physicalConnectionOrder: [],
      edgeOrder: [],
    },
    transportComponents: {},
    diagnostics: [],
  };
}

function createProductionOverflowTopology(
  outputCapacity: number,
): CompiledSimulationTopology {
  return {
    ...createEmptyTopology(),
    topologyId: `topology:production-overflow:${outputCapacity}`,
    itemCatalog: {
      item_test: {
        id: "item_test",
        domain: "solid",
        tags: [],
      },
    },
    recipeCatalog: {
      "recipe:test": {
        id: "recipe:test",
        nameKey: "recipe.test",
        durationTicks: 5,
        inputs: [],
        outputs: [{ itemId: "item_test", amount: 1 }],
        machineId: "test_machine",
        recipeType: "immediate-consume",
        powerOutput: 0,
        tags: [],
      },
    },
    devices: {
      "device:maker": {
        id: "device:maker",
        sourceEntityId: "maker",
        definitionId: "test_machine",
        position: null,
        rotation: null,
        tags: [],
        powerStatus: "in-power-range",
        powerDemand: 1,
        requiresPower: true,
        transportClass: "anchor",
        transportComponentId: null,
        nodeIds: ["node:out"],
        recipeChannels: [{
          id: "main",
          ingredientNodeIds: [],
          productNodeIds: ["node:out"],
          manualRecipeOnly: false,
          defaultRecipeId: null,
        }],
        portIds: [],
        routing: {},
        configHash: "config:test",
      },
    },
    nodes: {
      "node:out": {
        id: "node:out",
        deviceId: "device:maker",
        sourceStorageSlotGroupId: "output",
        viewRole: "input-view",
        slotIds: ["slot:out"],
        inputPortIds: [],
        outputPortIds: [],
        groupOrder: 0,
      },
    },
    slots: {
      "slot:out": {
        id: "slot:out",
        nodeId: "node:out",
        sourceStorageSlotGroupId: "output",
        sourceSlotId: "slot_1",
        capacity: outputCapacity,
        domain: "solid",
        lock: null,
        initialItemType: null,
        initialCount: 0,
        ignoreStock: false,
        submitMode: "never",
        submitIntervalTicks: null,
      },
    },
    ordering: {
      deviceOrder: ["device:maker"],
      nodeOrder: ["node:out"],
      slotOrder: ["slot:out"],
      portOrder: [],
      physicalConnectionOrder: [],
      edgeOrder: [],
    },
  };
}

function createRunningRecipe(progressTicks: number) {
  const plan: CompiledSimulationRecipePlan = {
    recipeId: "recipe:test",
    recipeType: "immediate-consume",
    durationTicks: 5,
    inputs: [],
    outputs: [{ itemId: "item_test", amount: 1 }],
    ingredientNodeIds: [],
    productNodeIds: ["node:out"],
  };

  return {
    runId: "recipe-run:seed",
    recipeId: "recipe:test",
    recipeType: "immediate-consume" as const,
    progressTicks,
    durationTicks: 5,
    state: "running" as const,
    plan,
    reservations: [],
    inputItems: [],
  };
}
