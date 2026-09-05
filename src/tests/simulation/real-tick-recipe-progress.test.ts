import { describe, expect, it } from "vitest";

import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import type { SimulationState } from "@/domain/simulation/types/simulation-types";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { resolvePresentedRecipeProgressSeconds } from "@/shared/simulation-recipe-progress";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

describe("ST2-RQ-024 real tick recipe progress", () => {
  it.each([
    { tickRate: 20, tickNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { tickRate: 10, tickNumbers: [1, 3, 5, 7, 9] },
    { tickRate: 4, tickNumbers: [1, 6] },
    { tickRate: 2, tickNumbers: [1] },
  ])("keeps only real Legacy ticks at $tickRate TPS", ({ tickRate, tickNumbers }) => {
    const registry = createRegistryContract();
    const topology = compileSimulationTopology({
      document: createWorldDocument({ baseId: "wuling_protocol_core" }),
      registry,
      poweredEntityIds: new Set(),
      simulationMode: "single-base",
    });
    const runtime = new SimulationWorkerRuntime(registry);
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology,
      simulationSpeed: 1,
    });
    runtime.setFixedDynamicTickRate(tickRate);
    expect(runtime.exportRuntimeState(0)?.snapshot.tickRate).toBe(tickRate);
    runtime.advanceToTick(10);

    const response = runtime.handleRequest({
      type: "get-tick-snapshot-range",
      requestId: 2,
      fromTickNumber: 1,
      toTickNumber: 10,
      generation: 0,
      simulationSpeed: 1,
    });
    if (response.type !== "tick-snapshot-range-result") {
      throw new Error(`Unexpected response ${response.type}.`);
    }

    expect(response.result.snapshots.map((snapshot) => snapshot.tickNumber))
      .toEqual(tickNumbers);
    expect(response.result.snapshots.every((snapshot) => snapshot.tickRate === tickRate))
      .toBe(true);
  });

  it("publishes only real Legacy ticks with their interval timing", () => {
    const registry = createRegistryContract();
    const topology = compileSimulationTopology({
      document: createWorldDocument({ baseId: "wuling_protocol_core" }),
      registry,
      poweredEntityIds: new Set(),
      simulationMode: "single-base",
    });
    const runtime = new SimulationWorkerRuntime(registry);
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology,
      simulationSpeed: 4,
    });

    runtime.advanceToTick(20);
    const response = runtime.handleRequest({
      type: "get-tick-snapshot-range",
      requestId: 2,
      fromTickNumber: 1,
      toTickNumber: 20,
      generation: 0,
      simulationSpeed: 4,
    });
    if (response.type !== "tick-snapshot-range-result") {
      throw new Error(`Unexpected response ${response.type}.`);
    }

    expect(response.result.snapshots.map((snapshot) => snapshot.tickNumber))
      .toEqual([1, 6, 11]);
    expect(response.result.snapshots.map((snapshot) => snapshot.tickRate))
      .toEqual([4, 4, 2]);
    expect(response.result.snapshots.every((snapshot) => snapshot.standardTickRate === 20))
      .toBe(true);
  });

  it("interpolates only progressing recipes and clamps to one real-tick interval", () => {
    const channelStatus = {
      channelId: "main",
      recipeId: "recipe:test",
      progressSeconds: 2,
      desiredSeconds: 10,
      isProgressing: true,
      state: "running" as const,
    };
    const documentStatus = {
      tickNumber: 11,
      standardTickRate: 20,
      tickRate: 4,
      totalPowerDemand: 0,
      currentPowerGeneration: 0,
      isPowerOutage: false,
    };
    const simulationState = createRunningSimulationState();

    expect(resolvePresentedRecipeProgressSeconds({
      channelStatus,
      documentStatus,
      simulationState,
      elapsedWallSeconds: 0.1,
    })).toBeCloseTo(2.2);
    expect(resolvePresentedRecipeProgressSeconds({
      channelStatus,
      documentStatus,
      simulationState,
      elapsedWallSeconds: 10,
    })).toBeCloseTo(2.25);
    expect(resolvePresentedRecipeProgressSeconds({
      channelStatus: { ...channelStatus, isProgressing: false },
      documentStatus,
      simulationState,
      elapsedWallSeconds: 0.1,
    })).toBe(2);
    expect(resolvePresentedRecipeProgressSeconds({
      channelStatus,
      documentStatus,
      simulationState: { ...simulationState, runningState: "pause" },
      elapsedWallSeconds: 0.1,
    })).toBe(2);
    expect(resolvePresentedRecipeProgressSeconds({
      channelStatus: { ...channelStatus, progressSeconds: 9.9 },
      documentStatus,
      simulationState,
      elapsedWallSeconds: 10,
    })).toBe(10);
  });

  it("keeps every registry recipe duration on the half-second phase", () => {
    const registry = createRegistryContract();
    expect(registry.recipeDefinitions.filter((recipe) => (
      recipe.durationSeconds <= 0
      || !Number.isSafeInteger(recipe.durationSeconds / 0.5)
    )).map((recipe) => ({
      recipeId: recipe.id,
      durationSeconds: recipe.durationSeconds,
    }))).toEqual([]);
  });

  it("rejects recipe durations that are not exact half-second multiples", () => {
    const baseRegistry = createRegistryContract();
    const recipeDefinitions = baseRegistry.recipeDefinitions.map((recipe) =>
      recipe.id === "r_crusher_originium_powder_basic"
        ? { ...recipe, durationSeconds: 0.25 }
        : recipe);
    const registry = {
      ...baseRegistry,
      recipeDefinitions,
      queries: createRegistryQuery({
        entityDefinitions: baseRegistry.entityDefinitions,
        itemDefinitions: baseRegistry.itemDefinitions,
        recipeDefinitions,
      }),
    };
    const document = createWorldDocument({ baseId: "wuling_protocol_core" });
    const grinder: WorldEntity = {
      id: "grinder",
      definitionId: "grinder_1",
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    };
    document.entities = { grinder };
    document.entityOrder = [grinder.id];

    const topology = compileSimulationTopology({
      document,
      registry,
      poweredEntityIds: new Set(),
      simulationMode: "single-base",
    });

    expect(topology.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "invalid-recipe-duration-phase",
      definitionId: "grinder_1",
    }));
  });
});

function createRunningSimulationState(): SimulationState {
  return {
    runningState: "start",
    simulationMode: "single-base",
    simulationSpeed: 2,
    statistics: {
      tickPerSecond: 0,
      targetTickPerSecond: 0,
      baseBatteryJoules: 0,
      baseBatteryCapacity: 0,
    },
    bufferSize: 0,
    timeline: {
      enabled: false,
      readiness: "idle",
      tickDurationSeconds: 0.5,
      rulerDurationSeconds: 300,
      windowStartTickNumber: 0,
      cursorTickNumber: 0,
      availableFromTickNumber: 0,
      availableToTickNumber: 0,
      marks: [],
      isSeeking: false,
    },
  };
}
