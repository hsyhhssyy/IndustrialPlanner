import { describe, expect, it, vi } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import {
  SimulationActionImpl,
  type SimulationWorkerBridge,
} from "@/simulation/action-impl";
import { createSimulationStateReadWrite } from "@/simulation/state-impl";
import type { CompiledSimulationTopology } from "@/simulation/types";

describe("simulation playback backpressure", () => {
  it("keeps one tick request in flight and retries the same tick after not-ready", async () => {
    const firstResponse = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshot"]>>>();
    const secondResponse = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshot"]>>>();
    const getTickSnapshot = vi.fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const state = createSimulationStateReadWrite();
    state.runningState = "start";
    state.currentPlaybackTickNumber = 0;

    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: { getTickSnapshot } as unknown as SimulationWorkerBridge,
    });

    const firstAdvance = action.advancePlaybackByDeltaMs(50);
    expect(getTickSnapshot).toHaveBeenCalledTimes(1);
    expect(getTickSnapshot).toHaveBeenLastCalledWith(1, 1);

    const overlappingAdvances = Array.from(
      { length: 120 },
      () => action.advancePlaybackByDeltaMs(50),
    );
    expect(getTickSnapshot).toHaveBeenCalledTimes(1);
    expect(state.currentPlaybackTickNumber).toBe(1);

    firstResponse.resolve(createNotReadyResponse(1));
    await firstAdvance;
    await Promise.all(overlappingAdvances);
    expect(state.currentPlaybackTickNumber).toBe(0);

    const retryAdvance = action.advancePlaybackByDeltaMs(50);
    expect(getTickSnapshot).toHaveBeenCalledTimes(2);
    expect(getTickSnapshot).toHaveBeenLastCalledWith(1, 1);

    secondResponse.resolve(createNotReadyResponse(1));
    await retryAdvance;
    expect(state.currentPlaybackTickNumber).toBe(0);
  });

  it("counts wall time while waiting so measured TPS falls to zero", async () => {
    const response = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshot"]>>>();
    const getTickSnapshot = vi.fn().mockReturnValue(response.promise);
    const state = createSimulationStateReadWrite();
    state.runningState = "start";
    state.currentPlaybackTickNumber = 0;

    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: { getTickSnapshot } as unknown as SimulationWorkerBridge,
    });

    const firstAdvance = action.advancePlaybackByDeltaMs(50);
    const waitingAdvances = Array.from(
      { length: 20 },
      () => action.advancePlaybackByDeltaMs(50),
    );

    expect(getTickSnapshot).toHaveBeenCalledTimes(1);
    expect(state.statistics.tickPerSecond).toBe(0);
    expect(state.statistics.targetTickPerSecond).toBe(20);

    response.resolve(createNotReadyResponse(1));
    await firstAdvance;
    await Promise.all(waitingAdvances);
  });
});

function createNotReadyResponse(
  requestedTickNumber: number,
): Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshot"]>> {
  return {
    type: "tick-snapshot-result",
    requestId: requestedTickNumber,
    result: {
      status: {
        status: "not-ready",
        requestedTickNumber,
        retainedFromTick: 0,
        latestTickNumber: 0,
        bufferSize: 1,
      },
      currentTick: null,
    },
    status: {
      mode: "running",
      topologyId: "topology:test",
      documentHash: "document:test",
      retainedFromTick: 0,
      latestTickNumber: 0,
      bufferSize: 1,
      maxBufferSize: 180,
      dynamicTickRate: 20,
      error: null,
    },
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
