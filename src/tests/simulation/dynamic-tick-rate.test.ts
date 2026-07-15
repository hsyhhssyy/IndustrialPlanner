import { describe, expect, it } from "vitest";

import { advanceDevices } from "@/simulation/runtime/stage-1-advance-devices";
import {
  createRecipeStatsState,
  createSimulationMutableRuntimeState,
  rollRecipeStatsWindow,
  type RuntimeDeviceRecipeState,
} from "@/simulation/runtime/runtime-state";
import {
  adjustReservedAmounts,
  getReservedAmount,
} from "@/simulation/runtime/runtime-slot-access";
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

  it("adapts worker dynamic tick rate only through legal switch points", () => {
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

  it("keeps normal-speed runtime exact when the buffer is exhausted", () => {
    const runtime = new SimulationWorkerRuntime();
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createEmptyTopology(),
      simulationSpeed: 1,
    });

    expect(runtime.getStatus().dynamicTickRate).toBe(20);

    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 2,
      tickNumber: 20,
      simulationSpeed: 1,
    });
    runtime.advanceToTick(20);

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

  it("normalizes recipe stats by covered simulation ticks when dynamic runtime steps are coarser", () => {
    const stats = createRecipeStatsState(20);

    for (let tickNumber = 2; tickNumber <= 2400; tickNumber += 2) {
      rollRecipeStatsWindow(
        stats,
        {
          produced: tickNumber % 20 === 0 ? { item_test: 1 } : {},
          consumed: tickNumber % 20 === 0 ? { item_input: 1 } : {},
        },
        tickNumber,
        2,
        tickNumber % 20 === 0,
      );
    }

    expect(stats.coveredStandardTicks).toBe(1200);
    expect(stats.aggregated.item_test?.producedPerMinute).toBe(60);
    expect(stats.aggregated.item_input?.consumedPerMinute).toBe(60);
  });

  it("keeps warehouse production stats stable after worker dynamic tick rate changes", () => {
    const normal = readProductionStatsAtSpeed(1);
    const dynamic = readProductionStatsAtSpeed(4);

    expect(normal.producedPerMinute).toBe(240);
    expect(dynamic.initialDynamicTickRate).toBeLessThan(20);
    expect(dynamic.producedPerMinute).toBe(240);
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

  it("does not commit partial recipe outputs when local transaction preflight fails", () => {
    const topology = createProductionOverflowTopology(1);
    const state = createSimulationMutableRuntimeState(topology);
    state.persistent.devices["device:maker"]!.channelRecipes["main"] =
      createRunningRecipe(5, 2);

    advanceDevices(topology, state, 1);

    expect(state.persistent.slots["slot:out"]).toEqual({
      itemType: null,
      count: 0,
    });
    expect(state.persistent.devices["device:maker"]!.channelRecipes["main"])
      .toMatchObject({
        progressTicks: 5,
        state: "waiting-output",
      });
  });

  it("builds the reservation aggregate once and maintains it incrementally", () => {
    const topology = createProductionOverflowTopology(10);
    const state = createSimulationMutableRuntimeState(topology);
    const recipe = createRunningRecipe(0);
    recipe.reservations = [{
      slotId: "slot:out",
      itemType: "item_test",
      amount: 2,
    }];
    state.persistent.devices["device:maker"]!.channelRecipes["main"] = recipe;

    expect(getReservedAmount(state, "slot:out")).toBe(2);
    expect(getReservedAmount(state, "slot:out")).toBe(2);
    adjustReservedAmounts(state, recipe.reservations, -1);
    expect(getReservedAmount(state, "slot:out")).toBe(0);
    adjustReservedAmounts(state, recipe.reservations, 1);
    expect(getReservedAmount(state, "slot:out")).toBe(2);
  });

  it("reports indexed hot-path and local recipe transaction timings", () => {
    const runtime = new SimulationWorkerRuntime();
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createProductionOverflowTopology(10),
      perfEnabled: true,
      simulationSpeed: 1,
    });

    for (let tickNumber = 1; tickNumber <= 7; tickNumber += 1) {
      runtime.advanceToTick(tickNumber);
    }

    const response = runtime.handleRequest({
      type: "get-perf-report",
      requestId: 2,
    });
    expect(response.type).toBe("perf-report");
    if (response.type !== "perf-report") {
      return;
    }

    const hotPaths = response.report?.entries.flatMap((entry) =>
      entry.hotPath === undefined ? [] : [entry.hotPath],
    ) ?? [];
    expect(hotPaths.length).toBeGreaterThan(0);
    expect(hotPaths.reduce((sum, details) => sum + details.recipeFinishCalls, 0))
      .toBeGreaterThan(0);
    expect(hotPaths.reduce((sum, details) => sum + details.recipeFinishChangedSlots, 0))
      .toBeGreaterThan(0);
    expect(hotPaths.every((details) => details.edgeIndexFallbackScans === 0)).toBe(true);

  });
});

function readProductionStatsAtSpeed(
  simulationSpeed: number,
): { readonly initialDynamicTickRate: number; readonly producedPerMinute: number } {
  const runtime = new SimulationWorkerRuntime();
  const loaded = runtime.handleRequest({
    type: "load-topology",
    requestId: 1,
    topology: createProductionOverflowTopology(10000),
    simulationSpeed,
  });
  runtime.advanceToTick(2400);

  const response = runtime.handleRequest({
    type: "get-tick-snapshot",
    requestId: 2,
    tickNumber: 2400,
    simulationSpeed,
  });
  if (response.type !== "tick-snapshot-result" || response.result.status.status !== "ready" || response.result.currentTick === null) {
    throw new Error("Expected production stats tick to be ready.");
  }

  return {
    initialDynamicTickRate: loaded.status.dynamicTickRate ?? 0,
    producedPerMinute: response.result.currentTick.warehouseStats?.items.item_test?.producedPerMinute ?? 0,
  };
}

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
        requiredGasDiffusion: null,
        gasDiffusionOutput: null,
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
        footprint: null,
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
        configHash: "config:test",        isProducer: true,      },
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

function createRunningRecipe(
  progressTicks: number,
  outputAmount = 1,
): RuntimeDeviceRecipeState {
  const plan: CompiledSimulationRecipePlan = {
    recipeId: "recipe:test",
    recipeType: "immediate-consume",
    durationTicks: 5,
    inputs: [],
    outputs: [{ itemId: "item_test", amount: outputAmount }],
    ingredientNodeIds: [],
    productNodeIds: ["node:out"],
    requiredGasDiffusion: null,
    gasDiffusionOutput: null,
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
