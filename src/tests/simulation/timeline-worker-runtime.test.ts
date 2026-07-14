import { afterEach, describe, expect, it, vi } from "vitest";

import { TimelineWorkerRuntime } from "@/simulation/timeline-worker-runtime";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import type {
  CompiledSimulationTopology,
  SimulationRuntimeExport,
} from "@/simulation/types";

describe("TimelineWorkerRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fills only the configured half-second checkpoint window and clears it on stop", () => {
    vi.useFakeTimers();

    const runtimeExport = createRuntimeExport();
    const timelineRuntime = new TimelineWorkerRuntime();

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
    expect(lastCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(5990);

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

    const timelineRuntime = new TimelineWorkerRuntime();
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(0),
      startTimelineTickNumber: 0,
      capacityTimelineTicks: 10,
      stepStandardTicks: 10,
    });
    vi.runAllTimers();

    const reloaded = timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 2,
      runtimeExport: createRuntimeExport(40),
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
    expect(preservedCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(30);

    const filledFutureCheckpoint = timelineRuntime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: 5,
      timelineTickNumber: 9,
    });
    if (filledFutureCheckpoint.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected checkpoint response "${filledFutureCheckpoint.type}".`);
    }
    expect(filledFutureCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(90);
  });

  it("retargets the rolling window beyond the initial five minute cache", () => {
    vi.useFakeTimers();

    const timelineRuntime = new TimelineWorkerRuntime();
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(0),
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
    expect(extendedCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(6000);
  });

  it("continues filling after retargeting backward and then forward again", () => {
    vi.useFakeTimers();

    const timelineRuntime = new TimelineWorkerRuntime();
    timelineRuntime.handleRequest({
      type: "load-timeline",
      requestId: 1,
      runtimeExport: createRuntimeExport(0),
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
    expect(refilledCheckpoint.runtimeExport?.runtimeState.tickNumber).toBe(150);
  });
});

function createRuntimeExport(tickNumber = 0): SimulationRuntimeExport {
  const workerRuntime = new SimulationWorkerRuntime();
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
    schemaVersion: 4,
    topologyId: "topology:timeline-empty",
    documentKey: "document:timeline",
    documentHash: "hash:timeline",
    registryHash: "registry:timeline",
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
