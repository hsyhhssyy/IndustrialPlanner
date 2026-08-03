import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTimelinePresentationSnapshot,
  TimelineWorkerRuntime,
} from "@/simulation/timeline-worker-runtime";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import type {
  CompiledSimulationTopology,
  SimulationRuntimeExport,
} from "@/simulation/types";
import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
} from "./blueprint-test-helpers";
import { createSimulationTestRegistry } from "./simulation-test-registry";

const registry = createSimulationTestRegistry({
  itemDomains: { item_test: ItemDomainFlag.Solid },
  entityTags: { test_machine: ["Producer"] },
  recipeDefinitions: [{
    id: "recipe:test",
    nameKey: "recipe.test",
    durationSeconds: 2,
    inputs: [],
    outputs: [{ itemId: "item_test", amount: 1 }],
    machineId: "test_machine",
    recipeType: "immediate-consume",
    tags: [],
  }],
});

describe("TimelineWorkerRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills only the configured half-second checkpoint window and clears it on stop", () => {
    vi.useFakeTimers();

    const runtimeExport = createRuntimeExport();
    const timelineRuntime = new TimelineWorkerRuntime(registry);

    const loaded = timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport,
      startTimelineTickNumber: 0,
      capacityTimelineTicks: 600,
      stepStandardTicks: 10,
    });

    expect(loaded.type).toBe("timeline-loaded");
    expect(loaded.status.availableFromTimelineTickNumber).toBe(0);
    expect(loaded.status.availableToTimelineTickNumber).toBe(0);
    expect(loaded.status.stepStandardTicks).toBe(10);
    expect(loaded.status.dynamicTickRate).toBe(2);

    vi.advanceTimersToNextTimer();
    const firstYield = timelineRuntime.handleRequest({
      type: "get-timeline-status",
      requestId: 21,
    });
    expect(firstYield.type).toBe("timeline-status");
    expect(firstYield.status.availableToTimelineTickNumber).toBe(1);

    vi.runAllTimers();

    const filled = timelineRuntime.handleRequest({
      type: "get-timeline-status",
      requestId: 2,
    });
    expect(filled.type).toBe("timeline-status");
    expect(filled.status.availableFromTimelineTickNumber).toBe(0);
    expect(filled.status.availableToTimelineTickNumber).toBe(599);

    const lastCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 3,
      timelineTickNumber: 599,
    });
    if (lastCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${lastCheckpoint.type}".`);
    }
    expect(lastCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(5991);

    const presentationFrame = timelineRuntime.handleRequest({
      type: "get-timeline-presentation-frame",
      requestId: 31,
      timelineTickNumber: 599,
    });
    if (presentationFrame.type !== "timeline-presentation-frame-result") {
      throw new Error(`Unexpected presentation response "${presentationFrame.type}".`);
    }
    expect(presentationFrame.snapshot?.tickNumber).toBe(5991);

    const presentationRange = timelineRuntime.handleRequest({
      type: "get-timeline-presentation-frame-range",
      requestId: 32,
      fromTimelineTickNumber: 596,
      toTimelineTickNumber: 601,
    });
    if (presentationRange.type !== "timeline-presentation-frame-range-result") {
      throw new Error(`Unexpected presentation range response "${presentationRange.type}".`);
    }
    expect(presentationRange.frames.map((frame) => frame.timelineTickNumber)).toEqual([
      596, 597, 598, 599,
    ]);
    expect(presentationRange.frames.map((frame) => frame.snapshot.tickNumber)).toEqual([
      5961, 5971, 5981, 5991,
    ]);

    const outsideCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 4,
      timelineTickNumber: 600,
    });
    if (outsideCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${outsideCheckpoint.type}".`);
    }
    expect(outsideCheckpoint.runtimeExport).toBeNull();

    const stopped = timelineRuntime.handleRequest({
      type: "stop-timeline",
      requestId: 5,
    });
    expect(stopped.type).toBe("timeline-stopped");
    expect(stopped.status.enabled).toBe(false);
    expect(stopped.status.availableFromTimelineTickNumber).toBeNull();
    expect(stopped.status.availableToTimelineTickNumber).toBeNull();
  });

  it("preserves earlier checkpoints when reloading from a timeline rebase point", () => {
    vi.useFakeTimers();

    const timelineRuntime = new TimelineWorkerRuntime(registry);
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(1),
      startTimelineTickNumber: 0,
      capacityTimelineTicks: 10,
      stepStandardTicks: 10,
    });
    vi.runAllTimers();

    const reloaded = timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 2,
      runtimeExport: createRuntimeExport(41),
      startTimelineTickNumber: 4,
      retainedFromTimelineTickNumber: 0,
      capacityTimelineTicks: 10,
      stepStandardTicks: 10,
    });
    expect(reloaded.type).toBe("timeline-loaded");
    expect(reloaded.status.availableFromTimelineTickNumber).toBe(0);
    expect(reloaded.status.availableToTimelineTickNumber).toBe(4);

    const staleFutureCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 3,
      timelineTickNumber: 9,
    });
    if (staleFutureCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${staleFutureCheckpoint.type}".`);
    }
    expect(staleFutureCheckpoint.runtimeExport).toBeNull();

    vi.runAllTimers();

    const preservedCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 4,
      timelineTickNumber: 3,
    });
    if (preservedCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${preservedCheckpoint.type}".`);
    }
    expect(preservedCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(31);

    const filledFutureCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 5,
      timelineTickNumber: 9,
    });
    if (filledFutureCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${filledFutureCheckpoint.type}".`);
    }
    expect(filledFutureCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(91);
  });

  it("lets presentation requests pause background prediction until interaction is idle", () => {
    vi.useFakeTimers();

    const timelineRuntime = new TimelineWorkerRuntime(registry);
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(1),
      startTimelineTickNumber: 0,
      capacityTimelineTicks: 10,
      stepStandardTicks: 10,
    });
    vi.advanceTimersToNextTimer();

    const presentationFrame = timelineRuntime.handleRequest({
      type: "get-timeline-presentation-frame",
      requestId: 2,
      timelineTickNumber: 0,
    });
    expect(presentationFrame.type).toBe("timeline-presentation-frame-result");

    vi.advanceTimersByTime(249);
    const whileInteracting = timelineRuntime.handleRequest({
      type: "get-timeline-status",
      requestId: 3,
    });
    expect(whileInteracting.type).toBe("timeline-status");
    expect(whileInteracting.status.availableToTimelineTickNumber).toBe(1);

    vi.advanceTimersByTime(1);
    const afterIdle = timelineRuntime.handleRequest({
      type: "get-timeline-status",
      requestId: 4,
    });
    expect(afterIdle.type).toBe("timeline-status");
    expect(afterIdle.status.availableToTimelineTickNumber).toBe(2);
  });

  it("retargets the rolling window beyond the initial five minute cache", () => {
    vi.useFakeTimers();

    const timelineRuntime = new TimelineWorkerRuntime(registry);
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(1),
      startTimelineTickNumber: 0,
      capacityTimelineTicks: 600,
      stepStandardTicks: 10,
    });
    vi.runAllTimers();

    const retargeted = timelineRuntime.handleRequest({
      type: "retarget-timeline",
      requestId: 2,
      retainedFromTimelineTickNumber: 1,
      targetTimelineTickNumber: 600,
    });
    expect(retargeted.type).toBe("timeline-retargeted");
    expect(retargeted.status.availableFromTimelineTickNumber).toBe(1);
    expect(retargeted.status.availableToTimelineTickNumber).toBe(599);

    vi.runAllTimers();

    const status = timelineRuntime.handleRequest({
      type: "get-timeline-status",
      requestId: 3,
    });
    expect(status.type).toBe("timeline-status");
    expect(status.status.availableFromTimelineTickNumber).toBe(1);
    expect(status.status.availableToTimelineTickNumber).toBe(600);

    const droppedCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 4,
      timelineTickNumber: 0,
    });
    if (droppedCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${droppedCheckpoint.type}".`);
    }
    expect(droppedCheckpoint.runtimeExport).toBeNull();

    const extendedCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 5,
      timelineTickNumber: 600,
    });
    if (extendedCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${extendedCheckpoint.type}".`);
    }
    expect(extendedCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(6001);
  });

  it("continues filling after retargeting backward and then forward again", () => {
    vi.useFakeTimers();

    const timelineRuntime = new TimelineWorkerRuntime(registry);
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(1),
      startTimelineTickNumber: 0,
      capacityTimelineTicks: 20,
      stepStandardTicks: 10,
    });
    vi.runAllTimers();

    timelineRuntime.handleRequest({
      type: "retarget-timeline",
      requestId: 2,
      retainedFromTimelineTickNumber: 0,
      targetTimelineTickNumber: 10,
    });

    const deletedFutureCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 3,
      timelineTickNumber: 15,
    });
    if (deletedFutureCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${deletedFutureCheckpoint.type}".`);
    }
    expect(deletedFutureCheckpoint.runtimeExport).toBeNull();

    timelineRuntime.handleRequest({
      type: "retarget-timeline",
      requestId: 4,
      retainedFromTimelineTickNumber: 0,
      targetTimelineTickNumber: 15,
    });
    vi.runAllTimers();

    const refilledCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 5,
      timelineTickNumber: 15,
    });
    if (refilledCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${refilledCheckpoint.type}".`);
    }
    expect(refilledCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(151);
  });

  it("keeps a two-minute timeline seek equivalent to the exact standard tick", () => {
    vi.useFakeTimers();

    const topology = createTimelinePhaseTopology();
    const exactRuntime = new SimulationWorkerRuntime(registry);
    exactRuntime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology,
    });
    exactRuntime.createSparseTickSnapshot(1);
    const originRuntimeExport = exactRuntime.exportRuntimeState(1);
    if (originRuntimeExport === null) {
      throw new Error("Expected tick-1 runtime export.");
    }

    const timelineRuntime = new TimelineWorkerRuntime(registry);
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 2,
      runtimeExport: originRuntimeExport,
      startTimelineTickNumber: 0,
      targetTimelineTickNumber: 240,
      capacityTimelineTicks: 241,
      stepStandardTicks: 10,
    });

    for (let standardTickNumber = 2; standardTickNumber <= 2401; standardTickNumber += 1) {
      exactRuntime.createSparseTickSnapshot(standardTickNumber);
    }
    vi.runAllTimers();

    const exactRuntimeExport = exactRuntime.exportRuntimeState(2401);
    const timelineCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 3,
      timelineTickNumber: 240,
    });
    if (timelineCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${timelineCheckpoint.type}".`);
    }

    expect(timelineCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(2401);
    expect(timelineCheckpoint.runtimeExport?.snapshot).toEqual(exactRuntimeExport?.snapshot);
  });

  it("keeps consumption and gas state equal at every minute after continuous fill and a large forward retarget", () => {
    vi.useFakeTimers();

    const topology = createConsumptionTimelineTopology();
    const exactRuntime = new SimulationWorkerRuntime(registry);
    exactRuntime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology,
    });
    exactRuntime.createSparseTickSnapshot(1);
    const originRuntimeExport = exactRuntime.exportRuntimeState(1);
    if (originRuntimeExport === null) {
      throw new Error("Expected tick-1 consumption runtime export.");
    }

    const timelineRuntime = new TimelineWorkerRuntime(registry);
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 2,
      runtimeExport: originRuntimeExport,
      startTimelineTickNumber: 0,
      targetTimelineTickNumber: 240,
      capacityTimelineTicks: 241,
      stepStandardTicks: 10,
    });
    vi.runAllTimers();

    const retargeted = timelineRuntime.handleRequest({
      type: "retarget-timeline",
      requestId: 3,
      retainedFromTimelineTickNumber: 0,
      targetTimelineTickNumber: 960,
    });
    expect(retargeted.type).toBe("timeline-retargeted");
    vi.runAllTimers();

    const exactExportsByMinute = new Map<number, SimulationRuntimeExport>();
    for (let standardTickNumber = 2; standardTickNumber <= 9601; standardTickNumber += 1) {
      exactRuntime.createSparseTickSnapshot(standardTickNumber);
      if ((standardTickNumber - 1) % 1200 !== 0) {
        continue;
      }
      const minute = (standardTickNumber - 1) / 1200;
      const runtimeExport = exactRuntime.exportRuntimeState(standardTickNumber);
      if (runtimeExport === null) {
        throw new Error(`Expected exact runtime export at minute ${minute}.`);
      }
      exactExportsByMinute.set(minute, runtimeExport);
    }

    for (let minute = 1; minute <= 8; minute += 1) {
      const timelineTickNumber = minute * 120;
      const checkpoint = timelineRuntime.handleRequest({
        type: "get-timeline-checkpoint",
        requestId: 10 + minute,
        timelineTickNumber,
      });
      if (checkpoint.type !== "timeline-checkpoint-result") {
        throw new Error(`Unexpected checkpoint response "${checkpoint.type}".`);
      }
      const exactExport = exactExportsByMinute.get(minute);
      expect(checkpoint.runtimeExport?.runtimeState.persistent)
        .toEqual(exactExport?.runtimeState.persistent);
      expect(checkpoint.runtimeExport?.snapshot).toEqual(exactExport?.snapshot);
    }

    const largeSeekCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 30,
      timelineTickNumber: 960,
    });
    if (
      largeSeekCheckpoint.type !== "timeline-checkpoint-result"
      || largeSeekCheckpoint.runtimeExport === null
    ) {
      throw new Error("Expected the large forward seek checkpoint.");
    }

    const resumedRuntime = new SimulationWorkerRuntime(registry);
    resumedRuntime.importRuntimeState(largeSeekCheckpoint.runtimeExport, {
      scheduleBackgroundFill: false,
    });
    for (let standardTickNumber = 9602; standardTickNumber <= 10801; standardTickNumber += 1) {
      exactRuntime.createSparseTickSnapshot(standardTickNumber);
    }
    resumedRuntime.createSparseTickSnapshot(10801);

    expect(resumedRuntime.exportRuntimeState(10801)?.runtimeState.persistent)
      .toEqual(exactRuntime.exportRuntimeState(10801)?.runtimeState.persistent);
    expect(resumedRuntime.exportRuntimeState(10801)?.snapshot)
      .toEqual(exactRuntime.exportRuntimeState(10801)?.snapshot);
  }, 20_000);

  it("keeps render-critical device, slot, and transfer state in lightweight presentation frames", () => {
    const runtimeExport = createRuntimeExport(20);
    const topology = {
      ...runtimeExport.topology,
      devices: {
        warehouse: createPresentationTestDevice("warehouse", "warehouse", ["warehouse-node"]),
        machine: createPresentationTestDevice("machine", "machine", ["machine-node"]),
      },
      nodes: {
        "warehouse-node": createPresentationTestNode("warehouse-node", "warehouse", ["warehouse-slot"]),
        "machine-node": createPresentationTestNode("machine-node", "machine", ["machine-slot"]),
      },
    };
    const snapshot = {
      ...runtimeExport.snapshot,
      devices: {
        warehouse: createPresentationTestDeviceSnapshot("warehouse"),
        machine: createPresentationTestDeviceSnapshot("machine"),
      },
      nodes: {
        "warehouse-node": {} as never,
        "machine-node": {} as never,
      },
      slots: {
        "warehouse-slot": createPresentationTestSlotSnapshot("warehouse-slot"),
        "machine-slot": createPresentationTestSlotSnapshot("machine-slot"),
        "orphan-slot": createPresentationTestSlotSnapshot("orphan-slot"),
      },
      transfers: [{
        edgeId: "edge:presentation",
        sourceSlotId: "machine-slot",
        targetSlotId: "orphan-slot",
        itemType: "item:test",
        amount: 1,
      }],
    };

    const presentation = createTimelinePresentationSnapshot({
      ...runtimeExport,
      topology,
      snapshot,
    });

    expect(presentation).not.toBe(snapshot);
    expect(Object.keys(presentation.devices)).toEqual(["machine"]);
    expect(Object.keys(presentation.nodes)).toEqual([]);
    expect(Object.keys(presentation.slots)).toEqual(["machine-slot"]);
    expect(presentation.transfers).toEqual(snapshot.transfers);
  });

  it("preserves the exported transient presentation frame when importing a checkpoint", () => {
    const runtimeExport = createRuntimeExport(21);
    const expectedTransfer = {
      edgeId: "edge:timeline-import",
      sourceSlotId: "slot:source",
      targetSlotId: "slot:target",
      itemType: "item:test",
      amount: 1,
    };
    const checkpointExport: SimulationRuntimeExport = {
      ...runtimeExport,
      snapshot: {
        ...runtimeExport.snapshot,
        transfers: [expectedTransfer],
      },
    };
    const importedRuntime = new SimulationWorkerRuntime(registry);

    const imported = importedRuntime.importRuntimeState(checkpointExport, {
      scheduleBackgroundFill: false,
    });

    expect(imported.status.status).toBe("ready");
    expect(imported.currentTick?.tickNumber).toBe(21);
    expect(imported.currentTick?.transfers).toEqual([expectedTransfer]);
  });
});

function createPresentationTestDevice(
  id: string,
  definitionId: string,
  nodeIds: readonly string[],
): CompiledSimulationTopology["devices"][string] {
  return {
    id,
    sourceEntityId: id,
    definitionId,
    position: null,
    rotation: null,
    footprint: null,
    powerStatus: "no-power-needed",
    powerDemand: 0,
    requiresPower: false,
    transportClass: "non-graph",
    transportComponentId: null,
    nodeIds,
    recipeChannels: [],
    portIds: [],
    routing: {},
    configHash: "",
  };
}

function createPresentationTestNode(
  id: string,
  deviceId: string,
  slotIds: readonly string[],
): CompiledSimulationTopology["nodes"][string] {
  return {
    id,
    deviceId,
    sourceStorageSlotGroupId: null,
    viewRole: "input-view",
    slotIds,
    inputPortIds: [],
    outputPortIds: [],
    groupOrder: 0,
  };
}

function createPresentationTestDeviceSnapshot(deviceId: string) {
  return {
    deviceId,
    block: false,
    recipe: null,
    channelRecipes: {},
    admissionCounters: {},
    // AI-REMOVED 2026-07-23:
    // Reason: 展示快照测试不再构造已删除的分钟计量字段。
    // Trigger: 消耗机制迁移到真实槽位和 consumption channel。
    // Evidence: RuntimeDeviceSnapshot 已删除 meteredConsumption。
    // Replacement: channelRecipes + slots。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // meteredConsumption: null,
  };
}

function createPresentationTestSlotSnapshot(slotId: string) {
  return {
    slotId,
    itemType: null,
    count: 0,
    reserved: 0,
    ignoreStock: false,
  };
}

function createRuntimeExport(tickNumber = 1): SimulationRuntimeExport {
  const workerRuntime = new SimulationWorkerRuntime(registry);
  const loaded = workerRuntime.handleRequest({
    type: "load-topology",
    requestId: 1,
    topology: createEmptyTopology(),
  });
  if (loaded.type !== "topology-loaded") {
    throw new Error(`Unexpected load response "${loaded.type}".`);
  }

  workerRuntime.createSparseTickSnapshot(tickNumber);
  const runtimeExport = workerRuntime.exportRuntimeState(tickNumber);
  if (runtimeExport === null) {
    throw new Error("Expected initial runtime export.");
  }

  return runtimeExport;
}

function createEmptyTopology(): CompiledSimulationTopology {
  return {
    schemaVersion: 5,
    topologyId: "topology:timeline-empty",
    documentKey: "document:timeline",
    documentHash: "hash:timeline",
    registryHash: "registry:timeline",
    standardTickRate: 20,
    totalPowerDemand: 0,
    activeActivityIds: [],
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

function createConsumptionTimelineTopology(): CompiledSimulationTopology {
  const blueprint = createBlueprint("timeline-consumption-gas", [
    createEntity("xiranite-oven", "xiranite_oven_1", 2, 0, 0, {
      channelRecipes: {
        default: "xiranite_oven_xiranite_powder_2",
      },
      "storageSlotGroups[0].slots[0].initialItemType": "item_carbon_mtl",
      "storageSlotGroups[0].slots[0].initialCount": 50,
      "storageSlotGroups[1].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[1].slots[0].initialCount": 50,
    }),
    createEntity("gas-source", "gas_storager_1", -4, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_gas_inert",
      "storageSlotGroups[0].slots[0].initialCount": 50,
    }),
    createEntity("gas-pipe", "pipe_straight_1x1", -1, 1),
    createEntity("gas-diffuser", "vaporizer_1", 0, 0),
    createEntity("power", "power_diffuser_1", 3, 5),
  ]);
  const document = createWorldDocumentFromBlueprint(blueprint);
  return compileSimulationTopology({
    document,
    registry,
    poweredEntityIds: new Set(document.entityOrder),
  });
}

function createTimelinePhaseTopology(): CompiledSimulationTopology {
  return {
    ...createEmptyTopology(),
    topologyId: "topology:timeline-phase",
    devices: {
      "device:maker": {
        id: "device:maker",
        sourceEntityId: "maker",
        definitionId: "test_machine",
        position: null,
        rotation: null,
        footprint: null,
        powerStatus: "no-power-needed",
        powerDemand: 0,
      requiresPower: false,
        transportClass: "anchor",
        transportComponentId: null,
        nodeIds: ["node:out"],
        recipeChannels: [{
          id: "main",
          type: "normal-channel",
          ingredientNodeIds: [],
          productNodeIds: ["node:out"],
          manualRecipeOnly: false,
          defaultRecipeId: null,
        }],
        portIds: [],
        routing: {},
        configHash: "config:timeline-phase",
      },
    },
    nodes: {
      "node:out": {
        id: "node:out",
        deviceId: "device:maker",
        sourceStorageSlotGroupId: "output",
        viewRole: "output-view",
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
        capacity: 1000,
        domain: ItemDomainFlag.Solid,
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
