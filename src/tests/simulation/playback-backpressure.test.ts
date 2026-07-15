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
  it("keeps one tick request in flight without skipping presentation ticks", async () => {
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
    expect(getTickSnapshot).toHaveBeenLastCalledWith(1, 1, undefined);

    const overlappingAdvances = Array.from(
      { length: 120 },
      () => action.advancePlaybackByDeltaMs(50),
    );
    // inFlight 期间位置被回退到整数边界之下，不丢 tick，不无限增长
    // AI-CORRECTION 2026-07-15: 播放目标按墙钟单调推进；单请求约束只限制 Worker 并发，不再回退游标。
    // AI-CORRECTION 2026-07-15: 私有墙钟目标继续累计，公开游标单调停在待拉取边界；恢复后逐 tick 消费，避免快照跳跃。
    expect(getTickSnapshot).toHaveBeenCalledTimes(1);
    expect(state.currentPlaybackTickNumber).toBe(1);

    firstResponse.resolve(createNotReadyResponse(1));
    await firstAdvance;
    await Promise.all(overlappingAdvances);
    expect(state.currentPlaybackTickNumber).toBe(1);

    const retryAdvance = action.advancePlaybackByDeltaMs(50);
    expect(getTickSnapshot).toHaveBeenCalledTimes(2);
    expect(getTickSnapshot).toHaveBeenLastCalledWith(1, 1, undefined);

    secondResponse.resolve(createNotReadyResponse(1));
    await retryAdvance;
    expect(state.currentPlaybackTickNumber).toBe(1);
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
