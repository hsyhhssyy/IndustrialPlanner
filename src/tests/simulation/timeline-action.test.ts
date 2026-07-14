import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import {
  SimulationActionImpl,
  type SimulationWorkerBridge,
  type TimelineWorkerBridge,
} from "@/simulation/action-impl";
import { createTickSnapshot } from "@/simulation/runtime/create-tick-snapshot";
import { createSimulationMutableRuntimeState } from "@/simulation/runtime/runtime-state";
import { createSimulationStateReadWrite } from "@/simulation/state-impl";
import { createSimulationDocumentHash } from "@/simulation/topology-compiler";
import type {
  CompiledSimulationTopology,
  SimulationRuntimeExport,
  SimulationRuntimeStatus,
} from "@/simulation/types";

describe("simulation timeline actions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts timeline prediction from the previous half-second boundary", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(37).snapshot;
    state.currentPlaybackTickNumber = 37.8;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    action.disableTimeline();

    expect(bridge.exportRuntimeState).toHaveBeenCalledWith(30);
    expect(timelineBridge.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({
      startTimelineTickNumber: 3,
      runtimeExport: expect.objectContaining({
        runtimeState: expect.objectContaining({ tickNumber: 30 }),
      }),
    }));
  });

  it("retries timeline prediction startup when the first runtime export is unavailable", async () => {
    vi.useFakeTimers();

    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;

    let exportCalls = 0;
    const bridge = createSimulationBridge({
      exportRuntimeState: vi.fn(async (tickNumber?: number) => {
        const exportTickNumber = tickNumber ?? 0;
        exportCalls += 1;
        if (exportCalls === 1) {
          return {
            type: "runtime-state-exported" as const,
            requestId: exportTickNumber,
            runtimeExport: null,
            status: createRuntimeStatus(exportTickNumber),
          };
        }

        return {
          type: "runtime-state-exported" as const,
          requestId: exportTickNumber,
          runtimeExport: createRuntimeExport(exportTickNumber),
          status: createRuntimeStatus(exportTickNumber),
        };
      }),
    });
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    expect(timelineBridge.loadTimeline).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(timelineBridge.loadTimeline).toHaveBeenCalledTimes(1);
    action.disableTimeline();
  });

  it("falls back to the latest exportable aligned checkpoint", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = null;
    state.currentPlaybackTickNumber = 608;

    const bridge = createSimulationBridge({
      exportRuntimeState: vi.fn(async (tickNumber?: number) => {
        const exportTickNumber = tickNumber ?? 0;
        if (exportTickNumber === 590) {
          return {
            type: "runtime-state-exported" as const,
            requestId: exportTickNumber,
            runtimeExport: createRuntimeExport(exportTickNumber),
            status: createRuntimeStatus(595),
          };
        }

        return {
          type: "runtime-state-exported" as const,
          requestId: exportTickNumber,
          runtimeExport: null,
          status: createRuntimeStatus(595),
        };
      }),
    });
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    action.disableTimeline();

    expect(bridge.exportRuntimeState).toHaveBeenCalledWith(600);
    expect(bridge.exportRuntimeState).toHaveBeenCalledWith(590);
    expect(timelineBridge.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({
      startTimelineTickNumber: 59,
      runtimeExport: expect.objectContaining({
        runtimeState: expect.objectContaining({ tickNumber: 590 }),
      }),
    }));
  });

  it("preserves the visible timeline prefix when restarting an existing timeline", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(120).snapshot;
    state.currentPlaybackTickNumber = 120;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    await action.patchRuntimeSlot({
      entityId: "entity:timeline-test",
      storageGroupId: "main",
      slotId: "slot",
      itemType: null,
      count: 0,
      ignoreStock: false,
    });
    action.disableTimeline();

    expect(timelineBridge.loadTimeline).toHaveBeenNthCalledWith(1, expect.objectContaining({
      startTimelineTickNumber: 12,
      retainedFromTimelineTickNumber: 12,
    }));
    expect(timelineBridge.loadTimeline).toHaveBeenNthCalledWith(2, expect.objectContaining({
      startTimelineTickNumber: 12,
      retainedFromTimelineTickNumber: 0,
    }));
  });

  it("retargets timeline prediction when playback scrolls beyond the default half-window anchor", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    await action.syncToTick(3020, 3020);
    await flushMicrotasks(2);

    expect(state.timeline.windowStartTickNumber).toBeGreaterThan(0);
    expect(timelineBridge.retargetTimeline).toHaveBeenCalledWith({
      retainedFromTimelineTickNumber: 0,
      targetTimelineTickNumber: 6601,
    });
    action.disableTimeline();
  });

  it("keeps a forward seek between half and edge positions as the playback anchor", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    await expect(action.seekTimelineToTick(420)).resolves.toBe(true);

    expect(state.timeline.cursorTickNumber).toBe(420);
    expect(state.timeline.windowStartTickNumber).toBe(0);

    await action.syncToTick(4210, 4210);
    await flushMicrotasks(2);

    expect(state.timeline.cursorTickNumber).toBe(421);
    expect(state.timeline.windowStartTickNumber).toBe(1);
    expect(timelineBridge.retargetTimeline).toHaveBeenLastCalledWith({
      retainedFromTimelineTickNumber: 0,
      targetTimelineTickNumber: 6600,
    });
    action.disableTimeline();
  });

  it("clears the custom playback anchor when seeking backward", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    await expect(action.seekTimelineToTick(420)).resolves.toBe(true);
    await expect(action.seekTimelineToTick(200)).resolves.toBe(true);

    expect(state.timeline.cursorTickNumber).toBe(200);
    expect(state.timeline.windowStartTickNumber).toBe(0);

    await action.syncToTick(2010, 2010);
    expect(state.timeline.windowStartTickNumber).toBe(0);

    await action.syncToTick(3010, 3010);
    expect(state.timeline.windowStartTickNumber).toBe(1);
    action.disableTimeline();
  });

  it("anchors a seek beyond the right edge drag threshold at the edge position", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    await expect(action.seekTimelineToTick(580)).resolves.toBe(true);

    expect(state.timeline.cursorTickNumber).toBe(580);
    expect(state.timeline.windowStartTickNumber).toBe(41);

    await action.syncToTick(5810, 5810);
    await flushMicrotasks(2);

    expect(state.timeline.cursorTickNumber).toBe(581);
    expect(state.timeline.windowStartTickNumber).toBe(42);
    expect(timelineBridge.retargetTimeline).toHaveBeenLastCalledWith({
      retainedFromTimelineTickNumber: 0,
      targetTimelineTickNumber: 6641,
    });
    action.disableTimeline();
  });

  it("keeps at most ten visible windows of timeline history while playback retargets", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    await action.syncToTick(66_000, 66_000);
    await flushMicrotasks(2);

    expect(state.timeline.windowStartTickNumber).toBe(6300);
    expect(timelineBridge.retargetTimeline).toHaveBeenLastCalledWith({
      retainedFromTimelineTickNumber: 300,
      targetTimelineTickNumber: 12899,
    });
    action.disableTimeline();
  });

  it("scrolls the timeline window left when seeking inside the left edge history band", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    state.timeline.availableFromTickNumber = 1000;
    state.timeline.availableToTickNumber = 2199;
    state.timeline.cursorTickNumber = 1700;
    state.timeline.windowStartTickNumber = 1600;

    await expect(action.seekTimelineToTick(1620)).resolves.toBe(true);

    expect(state.timeline.cursorTickNumber).toBe(1620);
    expect(state.timeline.windowStartTickNumber).toBe(1560);

    await action.syncToTick(16_300, 16_300);

    expect(state.timeline.cursorTickNumber).toBe(1630);
    expect(state.timeline.windowStartTickNumber).toBe(1560);
    action.disableTimeline();
  });

  it("allows the cursor to move below the left edge anchor at the retained history limit", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge();
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    state.timeline.availableFromTickNumber = 1000;
    state.timeline.availableToTickNumber = 1599;
    state.timeline.cursorTickNumber = 1100;
    state.timeline.windowStartTickNumber = 1000;

    await expect(action.seekTimelineToTick(1020)).resolves.toBe(true);

    expect(state.timeline.cursorTickNumber).toBe(1020);
    expect(state.timeline.windowStartTickNumber).toBe(1000);
    action.disableTimeline();
  });

  it("reloads timeline prediction when playback rolls back outside the retained history range", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(0).snapshot;
    state.currentPlaybackTickNumber = 0;

    const bridge = createSimulationBridge({
      getTickSnapshot: vi.fn(async (tickNumber: number) => ({
        type: "tick-snapshot-result" as const,
        requestId: tickNumber,
        result: {
          status: {
            status: "not-found" as const,
            reason: "cleared" as const,
            requestedTickNumber: tickNumber,
            retainedFromTick: 0,
            latestTickNumber: 0,
            bufferSize: 1,
          },
          currentTick: null,
        },
        status: createRuntimeStatus(0),
      })),
    });
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    state.timeline.availableFromTickNumber = 500;
    state.timeline.availableToTickNumber = 1099;
    state.timeline.windowStartTickNumber = 500;
    await action.advancePlaybackByDeltaMs(305_000);
    await flushMicrotasks(2);

    expect(state.timeline.cursorTickNumber).toBe(0);
    expect(timelineBridge.loadTimeline).toHaveBeenCalledTimes(2);
    action.disableTimeline();
  });

  it("jumps forward to the first retained aligned checkpoint when the previous boundary was cleared", async () => {
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "start";
    state.currentSnapshot = createRuntimeExport(449).snapshot;
    state.currentPlaybackTickNumber = 450;

    const bridge = createSimulationBridge({
      exportRuntimeState: vi.fn(async (tickNumber?: number) => {
        const exportTickNumber = tickNumber ?? 0;
        if (exportTickNumber === 450) {
          return {
            type: "runtime-state-exported" as const,
            requestId: exportTickNumber,
            runtimeExport: createRuntimeExport(exportTickNumber),
            status: {
              ...createRuntimeStatus(627),
              retainedFromTick: 449,
            },
          };
        }

        return {
          type: "runtime-state-exported" as const,
          requestId: exportTickNumber,
          runtimeExport: null,
          status: {
            ...createRuntimeStatus(627),
            retainedFromTick: 449,
          },
        };
      }),
    });
    const timelineBridge = createTimelineBridge();
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();
    action.disableTimeline();

    expect(bridge.exportRuntimeState).toHaveBeenCalledWith(440);
    expect(bridge.exportRuntimeState).toHaveBeenCalledWith(450);
    expect(timelineBridge.loadTimeline).toHaveBeenCalledWith(expect.objectContaining({
      startTimelineTickNumber: 45,
      runtimeExport: expect.objectContaining({
        runtimeState: expect.objectContaining({ tickNumber: 450 }),
      }),
    }));
  });

  it("serializes timeline seeks so the latest dragged tick wins", async () => {
    const firstImport = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["importRuntimeState"]>>>();
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "pause";
    state.currentSnapshot = createRuntimeExport(0).snapshot;

    const bridge = createSimulationBridge({
      importRuntimeState: vi.fn((runtimeExport: SimulationRuntimeExport) => {
        if (runtimeExport.runtimeState.tickNumber === 10) {
          return firstImport.promise;
        }

        return Promise.resolve(createImportResponse(runtimeExport));
      }),
    });
    const timelineBridge = createTimelineBridge({
      getTimelineCheckpoint: vi.fn(async (timelineTickNumber: number) => ({
        type: "timeline-checkpoint-result" as const,
        requestId: timelineTickNumber,
        timelineTickNumber,
        runtimeExport: createRuntimeExport(timelineTickNumber * 10),
        status: createTimelineStatus(0, timelineTickNumber),
      })),
    });
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });

    await action.enableTimeline();

    const firstSeek = action.seekTimelineToTick(1);
    await flushMicrotasks(3);
    expect(bridge.importRuntimeState).toHaveBeenCalledTimes(1);

    const secondSeek = action.seekTimelineToTick(2);
    await flushMicrotasks(3);
    expect(bridge.importRuntimeState).toHaveBeenCalledTimes(1);

    firstImport.resolve(createImportResponse(createRuntimeExport(10)));

    await expect(firstSeek).resolves.toBe(false);
    await expect(secondSeek).resolves.toBe(true);

    expect(bridge.importRuntimeState).toHaveBeenCalledTimes(2);
    expect(bridge.importRuntimeState).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeState: expect.objectContaining({ tickNumber: 20 }),
    }));
    expect(state.currentPlaybackTickNumber).toBe(20);
    expect(state.timeline.cursorTickNumber).toBe(2);
    action.disableTimeline();
  });

  it("restores the compiled document metadata when seeking to a timeline checkpoint", async () => {
    const documentBefore = createWorldDocument();
    const documentAfter = {
      ...documentBefore,
      documentKey: "document:after-timeline-edit",
    };
    const runtimeExportBefore = createRuntimeExport(
      0,
      createSimulationDocumentHash(documentBefore),
    );
    const state = createSimulationStateReadWrite();
    state.hasStarted = true;
    state.runningState = "pause";
    state.currentSnapshot = runtimeExportBefore.snapshot;

    const bridge = createSimulationBridge({
      exportRuntimeState: vi.fn(async (tickNumber?: number) => ({
        type: "runtime-state-exported" as const,
        requestId: tickNumber ?? 0,
        runtimeExport: runtimeExportBefore,
        status: createRuntimeStatus(tickNumber ?? 0),
      })),
    });
    const timelineBridge = createTimelineBridge({
      getTimelineCheckpoint: vi.fn(async (timelineTickNumber: number) => ({
        type: "timeline-checkpoint-result" as const,
        requestId: timelineTickNumber,
        timelineTickNumber,
        runtimeExport: runtimeExportBefore,
        status: createTimelineStatus(0, timelineTickNumber),
      })),
    });
    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge,
      createTimelineBridge: () => timelineBridge,
    });
    const internals = action as unknown as {
      compiledDocument: WorldDocument | null;
      compiledActivitySignature: string | null;
    };
    internals.compiledDocument = documentBefore;
    internals.compiledActivitySignature = "[]";

    await action.enableTimeline();
    internals.compiledDocument = documentAfter;
    internals.compiledActivitySignature = "[\"after\"]";

    await expect(action.seekTimelineToTick(0)).resolves.toBe(true);

    expect(internals.compiledDocument?.documentKey).toBe(documentBefore.documentKey);
    expect(internals.compiledActivitySignature).toBe("[]");
    action.disableTimeline();
  });
});

function createSimulationBridge(
  overrides: Partial<SimulationWorkerBridge> = {},
): SimulationWorkerBridge {
  return {
    loadTopology: vi.fn(async () => ({
      type: "topology-loaded" as const,
      requestId: 1,
      result: { status: "started" as const, topologyId: "topology:timeline-test", diagnostics: [] },
      status: createRuntimeStatus(0),
    })),
    getTickSnapshot: vi.fn(async (tickNumber: number) => ({
      type: "tick-snapshot-result" as const,
      requestId: tickNumber,
      result: {
        status: {
          status: "ready" as const,
          retainedFromTick: tickNumber,
          latestTickNumber: tickNumber,
          bufferSize: 1,
        },
        currentTick: createRuntimeExport(tickNumber).snapshot,
      },
      status: createRuntimeStatus(tickNumber),
    })),
    setSimulationSpeed: vi.fn(async () => ({
      type: "simulation-speed-set" as const,
      requestId: 1,
      status: createRuntimeStatus(0),
    })),
    setPowerMode: vi.fn(async () => ({
      type: "power-mode-set" as const,
      requestId: 1,
      status: createRuntimeStatus(0),
    })),
    setPowerConsumptionOverride: vi.fn(async () => ({
      type: "power-consumption-override-set" as const,
      requestId: 1,
      status: createRuntimeStatus(0),
    })),
    patchRuntimeSlot: vi.fn(async () => ({
      type: "runtime-slot-patched" as const,
      requestId: 1,
      status: createRuntimeStatus(0),
    })),
    resetAdmissionCounter: vi.fn(async () => ({
      type: "admission-counter-reset" as const,
      requestId: 1,
      status: createRuntimeStatus(0),
    })),
    getPerfReport: vi.fn(async () => ({
      type: "perf-report" as const,
      requestId: 1,
      report: null,
      status: createRuntimeStatus(0),
    })),
    exportRuntimeState: vi.fn(async (tickNumber?: number) => {
      const exportTickNumber = tickNumber ?? 0;
      return {
        type: "runtime-state-exported" as const,
        requestId: exportTickNumber,
        runtimeExport: createRuntimeExport(exportTickNumber),
        status: createRuntimeStatus(exportTickNumber),
      };
    }),
    importRuntimeState: vi.fn(async (runtimeExport: SimulationRuntimeExport) =>
      createImportResponse(runtimeExport)),
    dispose: vi.fn(),
    ...overrides,
  };
}

function createTimelineBridge(
  overrides: Partial<TimelineWorkerBridge> = {},
): TimelineWorkerBridge {
  return {
    loadTimeline: vi.fn(async (options) => ({
      type: "timeline-loaded" as const,
      requestId: 1,
      status: createTimelineStatus(
        options.startTimelineTickNumber,
        options.startTimelineTickNumber,
      ),
    })),
    getTimelineStatus: vi.fn(async () => ({
      type: "timeline-status" as const,
      requestId: 1,
      status: createTimelineStatus(0, 0),
    })),
    retargetTimeline: vi.fn(async (options) => ({
      type: "timeline-retargeted" as const,
      requestId: 1,
      status: createTimelineStatus(
        options.retainedFromTimelineTickNumber,
        options.targetTimelineTickNumber,
      ),
    })),
    getTimelineCheckpoint: vi.fn(async (timelineTickNumber: number) => ({
      type: "timeline-checkpoint-result" as const,
      requestId: timelineTickNumber,
      timelineTickNumber,
      runtimeExport: createRuntimeExport(timelineTickNumber * 10),
      status: createTimelineStatus(0, timelineTickNumber),
    })),
    stopTimeline: vi.fn(async () => ({
      type: "timeline-stopped" as const,
      requestId: 1,
      status: createTimelineStatus(null, null),
    })),
    dispose: vi.fn(),
    ...overrides,
  };
}

function createImportResponse(runtimeExport: SimulationRuntimeExport): Awaited<ReturnType<SimulationWorkerBridge["importRuntimeState"]>> {
  const tickNumber = runtimeExport.runtimeState.tickNumber;
  return {
    type: "runtime-state-imported" as const,
    requestId: tickNumber,
    result: {
      status: {
        status: "ready" as const,
        retainedFromTick: tickNumber,
        latestTickNumber: tickNumber,
        bufferSize: 1,
      },
      currentTick: runtimeExport.snapshot,
    },
    status: createRuntimeStatus(tickNumber),
  };
}

function createRuntimeStatus(tickNumber: number): SimulationRuntimeStatus {
  return {
    mode: "running",
    topologyId: "topology:timeline-test",
    documentHash: "hash:timeline-test",
    retainedFromTick: tickNumber,
    latestTickNumber: tickNumber,
    bufferSize: 1,
    maxBufferSize: 180,
    dynamicTickRate: 20,
    error: null,
  };
}

function createTimelineStatus(
  fromTickNumber: number | null,
  toTickNumber: number | null,
): Awaited<ReturnType<TimelineWorkerBridge["getTimelineStatus"]>>["status"] {
  return {
    enabled: fromTickNumber !== null && toTickNumber !== null,
    startTimelineTickNumber: fromTickNumber,
    availableFromTimelineTickNumber: fromTickNumber,
    availableToTimelineTickNumber: toTickNumber,
    capacityTimelineTicks: 600,
    stepStandardTicks: 10,
  };
}

function createRuntimeExport(
  tickNumber: number,
  documentHash = "hash:timeline-test",
): SimulationRuntimeExport {
  const topology = createEmptyTopology(documentHash);
  const runtimeState = createSimulationMutableRuntimeState(topology);
  runtimeState.tickNumber = tickNumber;
  runtimeState.lastAdvancedTickNumber = tickNumber;
  const snapshot = createTickSnapshot(topology, runtimeState, false, 0);
  return {
    topology,
    runtimeState,
    snapshot,
    powerMode: "real",
    powerConsumptionOverride: undefined,
  };
}

function createEmptyTopology(documentHash = "hash:timeline-test"): CompiledSimulationTopology {
  return {
    schemaVersion: 4,
    topologyId: "topology:timeline-test",
    documentKey: "document:timeline-test",
    documentHash,
    registryHash: "registry:timeline-test",
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

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
  };
}

async function flushMicrotasks(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
