import { describe, expect, it, vi } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import {
  SimulationActionImpl,
  type SimulationWorkerBridge,
} from "@/simulation/action-impl";
import { createSimulationStateReadWrite } from "@/simulation/state-impl";
import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
} from "@/simulation/types";

describe("simulation playback backpressure", () => {
  it("consumes a partial range prefix when x16 playback crosses beyond hot queue capacity", async () => {
    const firstRangeResponse = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>>>();
    const secondRangeResponse = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>>>();
    const getTickSnapshotRange = vi.fn()
      .mockReturnValueOnce(firstRangeResponse.promise)
      .mockReturnValueOnce(secondRangeResponse.promise);
    const acknowledgePresentedTick = vi.fn(async (tickNumber: number, generation: number) =>
      createAcknowledgedResponse(tickNumber, generation));
    const state = createSimulationStateReadWrite();
    state.runningState = "start";
    state.simulationSpeed = 16;
    state.currentPlaybackTickNumber = 0;
    state.currentSnapshot = createTickSnapshot(0);

    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: {
        getTickSnapshotRange,
        acknowledgePresentedTick,
      } as unknown as SimulationWorkerBridge,
    });

    await action.advancePlaybackByDeltaMs(100);
    // AI-CORRECTION 2026-09-04: 公开游标每帧最多跨过一个真实 tick 区间，墙钟欠账保留在私有目标中逐帧消费。
    // AI-CORRECTION 2026-09-04: 上一行已被实现审计否定；真实 tick 区间只钳制 progress 展示，播放游标仍按本帧墙钟目标推进。
    expect(state.currentPlaybackTickNumber).toBe(32);
    expect(getTickSnapshotRange).toHaveBeenLastCalledWith(1, 20, 0, 16);

    firstRangeResponse.resolve(createPartialRangeResponse(1, 20, 17, 0));
    await Promise.resolve();
    await Promise.resolve();

    await action.advancePlaybackByDeltaMs(0);
    // AI-REMOVED 2026-09-04:
    // Reason: 播放游标无需逐真实 tick 追赶；范围响应应直接发布目标之前最新的真实快照。
    // Trigger: 回放边界审计确认单区间限制属于 progress 展示层。
    // Evidence: 单次 advancePlaybackByDeltaMs(0) 已从稀疏范围选中 tick 17。
    // Replacement: 上方单次 advancePlaybackByDeltaMs(0)。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // for (let frame = 1; frame < 17; frame += 1) {
    //   await action.advancePlaybackByDeltaMs(0);
    // }

    expect(state.currentSnapshot?.tickNumber).toBe(17);
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(acknowledgePresentedTick).toHaveBeenCalledWith(17, 0);
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await action.advancePlaybackByDeltaMs(0);
    expect(getTickSnapshotRange).toHaveBeenLastCalledWith(18, 37, 0, 16);

    secondRangeResponse.resolve(createRangeResponse(18, 37, 0));
    await Promise.resolve();
    await Promise.resolve();
    await action.advancePlaybackByDeltaMs(0);
    // AI-REMOVED 2026-09-04:
    // Reason: 第二段范围同样应一次选择不晚于墙钟目标的最新真实快照。
    // Trigger: 回放边界审计确认播放游标不受单真实 tick 区间限制。
    // Evidence: 第二段响应包含 tick 18..37，目标 tick 32 可直接发布。
    // Replacement: 上方单次 advancePlaybackByDeltaMs(0)。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // for (let frame = 1; frame < 15; frame += 1) {
    //   await action.advancePlaybackByDeltaMs(0);
    // }

    expect(state.currentSnapshot?.tickNumber).toBe(32);
    expect(acknowledgePresentedTick).toHaveBeenCalledWith(32, 0);
  });

  it("keeps one range prefetch in flight and consumes the hot queue in tick order", async () => {
    const rangeResponse = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>>>();
    const getTickSnapshotRange = vi.fn().mockReturnValue(rangeResponse.promise);
    const acknowledgePresentedTick = vi.fn(async (tickNumber: number, generation: number) =>
      createAcknowledgedResponse(tickNumber, generation));
    const state = createSimulationStateReadWrite();
    state.runningState = "start";
    state.currentPlaybackTickNumber = 0;
    state.currentSnapshot = createTickSnapshot(0);

    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: {
        getTickSnapshotRange,
        acknowledgePresentedTick,
      } as unknown as SimulationWorkerBridge,
    });

    const firstAdvance = action.advancePlaybackByDeltaMs(50);
    expect(getTickSnapshotRange).toHaveBeenCalledTimes(1);
    expect(getTickSnapshotRange).toHaveBeenLastCalledWith(1, 20, 0, 1);

    const overlappingAdvances = Array.from(
      { length: 120 },
      () => action.advancePlaybackByDeltaMs(50),
    );
    // inFlight 期间位置被回退到整数边界之下，不丢 tick，不无限增长
    // AI-CORRECTION 2026-07-15: 播放目标按墙钟单调推进；单请求约束只限制 Worker 并发，不再回退游标。
    // AI-CORRECTION 2026-07-15: 私有墙钟目标继续累计，公开游标单调停在待拉取边界；恢复后逐 tick 消费，避免快照跳跃。
    // AI-CORRECTION 2026-07-17: 单请求约束现在保护范围预取；热队列未返回前公开游标仍停在下一边界。
    expect(getTickSnapshotRange).toHaveBeenCalledTimes(1);
    expect(state.currentPlaybackTickNumber).toBe(1);

    rangeResponse.resolve(createRangeResponse(1, 20, 0));
    await firstAdvance;
    await Promise.all(overlappingAdvances);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.currentPlaybackTickNumber).toBe(1);

    await action.advancePlaybackByDeltaMs(50);
    expect(state.currentPlaybackTickNumber).toBe(1);
    expect(state.currentSnapshot?.tickNumber).toBe(1);
    expect(acknowledgePresentedTick).toHaveBeenCalledWith(1, 0);
  });

  it("counts wall time while waiting so measured TPS falls to zero", async () => {
    const response = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>>>();
    const getTickSnapshotRange = vi.fn().mockReturnValue(response.promise);
    const state = createSimulationStateReadWrite();
    state.runningState = "start";
    state.currentPlaybackTickNumber = 0;
    state.currentSnapshot = createTickSnapshot(0);

    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: { getTickSnapshotRange } as unknown as SimulationWorkerBridge,
    });

    const firstAdvance = action.advancePlaybackByDeltaMs(50);
    const waitingAdvances = Array.from(
      { length: 20 },
      () => action.advancePlaybackByDeltaMs(50),
    );

    expect(getTickSnapshotRange).toHaveBeenCalledTimes(1);
    expect(state.statistics.tickPerSecond).toBe(0);
    expect(state.statistics.targetTickPerSecond).toBe(20);

    response.resolve(createNotReadyRangeResponse(1, 20, 0));
    await firstAdvance;
    await Promise.all(waitingAdvances);
  });

  it("discards an old range response after the playback position is synchronized", async () => {
    const staleRangeResponse = createDeferred<Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>>>();
    const getTickSnapshotRange = vi.fn()
      .mockReturnValueOnce(staleRangeResponse.promise)
      .mockResolvedValueOnce(createNotReadyRangeResponse(6, 25, 1));
    const state = createSimulationStateReadWrite();
    state.runningState = "start";
    state.currentPlaybackTickNumber = 0;
    state.currentSnapshot = createTickSnapshot(0);

    const action = new SimulationActionImpl({
      workspace: {} as WorkspaceContract,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: {
        getTickSnapshot: vi.fn(async (tickNumber: number) => createTickResponse(tickNumber)),
        getTickSnapshotRange,
      } as unknown as SimulationWorkerBridge,
    });

    await action.advancePlaybackByDeltaMs(50);
    expect(getTickSnapshotRange).toHaveBeenLastCalledWith(1, 20, 0, 1);

    await action.syncToTick(5, 5);
    staleRangeResponse.resolve(createRangeResponse(1, 20, 0));
    await Promise.resolve();
    await Promise.resolve();

    await action.advancePlaybackByDeltaMs(50);
    expect(state.currentSnapshot?.tickNumber).toBe(5);
    expect(getTickSnapshotRange).toHaveBeenLastCalledWith(6, 25, 1, 1);
  });
});

function createNotReadyRangeResponse(
  fromTickNumber: number,
  toTickNumber: number,
  generation: number,
): Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>> {
  return {
    type: "tick-snapshot-range-result",
    requestId: fromTickNumber,
    result: {
      generation,
      fromTickNumber,
      toTickNumber,
      status: {
        status: "not-ready",
        requestedTickNumber: fromTickNumber,
        retainedFromTick: 0,
        latestTickNumber: 0,
        bufferSize: 1,
      },
      snapshots: [],
    },
    status: createRuntimeStatus(0, 1),
  };
}

function createRangeResponse(
  fromTickNumber: number,
  toTickNumber: number,
  generation: number,
): Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>> {
  return {
    type: "tick-snapshot-range-result",
    requestId: fromTickNumber,
    result: {
      generation,
      fromTickNumber,
      toTickNumber,
      status: {
        status: "ready",
        retainedFromTick: 0,
        latestTickNumber: toTickNumber,
        bufferSize: toTickNumber + 1,
      },
      snapshots: Array.from(
        { length: toTickNumber - fromTickNumber + 1 },
        (_, index) => createTickSnapshot(fromTickNumber + index),
      ),
    },
    status: createRuntimeStatus(toTickNumber, toTickNumber + 1),
  };
}

function createPartialRangeResponse(
  fromTickNumber: number,
  toTickNumber: number,
  availableToTickNumber: number,
  generation: number,
): Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshotRange"]>> {
  return {
    type: "tick-snapshot-range-result",
    requestId: fromTickNumber,
    result: {
      generation,
      fromTickNumber,
      toTickNumber,
      status: {
        status: "ready",
        retainedFromTick: 0,
        latestTickNumber: availableToTickNumber,
        bufferSize: availableToTickNumber + 1,
      },
      snapshots: Array.from(
        { length: availableToTickNumber - fromTickNumber + 1 },
        (_, index) => createTickSnapshot(fromTickNumber + index),
      ),
    },
    status: createRuntimeStatus(availableToTickNumber, availableToTickNumber + 1),
  };
}

function createAcknowledgedResponse(
  tickNumber: number,
  generation: number,
): Awaited<ReturnType<SimulationWorkerBridge["acknowledgePresentedTick"]>> {
  return {
    type: "presented-tick-acknowledged",
    requestId: tickNumber,
    generation,
    acknowledgedTickNumber: tickNumber,
    status: createRuntimeStatus(tickNumber, 20),
  };
}

function createTickResponse(
  tickNumber: number,
): Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshot"]>> {
  return {
    type: "tick-snapshot-result",
    requestId: tickNumber,
    result: {
      status: {
        status: "ready",
        retainedFromTick: tickNumber,
        latestTickNumber: tickNumber,
        bufferSize: 1,
      },
      currentTick: createTickSnapshot(tickNumber),
    },
    status: createRuntimeStatus(tickNumber, 1),
  };
}

function createRuntimeStatus(latestTickNumber: number, bufferSize: number) {
  return {
    mode: "running" as const,
    topologyId: "topology:test",
    documentHash: "document:test",
    retainedFromTick: 0,
    latestTickNumber,
    bufferSize,
    maxBufferSize: 180,
    dynamicTickRate: 20,
    error: null,
  };
}

function createTickSnapshot(tickNumber: number): RuntimeTickSnapshot {
  return {
    topologyId: "topology:test",
    documentHash: "document:test",
    tickNumber,
    standardTickRate: 20,
    tickRate: 20,
    status: tickNumber === 0 ? "initial" : "running",
    totalPowerDemand: 0,
    currentPowerGeneration: 0,
    isPowerOutage: false,
    baseBatteryJoules: 0,
    baseBatteryCapacity: 0,
    slots: {},
    devices: {},
    nodes: {},
    transfers: [],
    routingCursors: {},
    transportComponentDomain: {},
    diagnostics: [],
    gasDiffusions: [],
    warehouseStats: null,
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
