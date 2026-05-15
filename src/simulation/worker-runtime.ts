import type {
  CompiledSimulationTopology,
  RuntimeTickSnapshot,
  SimulationTickPullStatus,
  SimulationTickSnapshotResult,
  SimulationRuntimeStatus,
  SimulationStartResult,
  SimulationTopologyMigration,
} from "./types";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

import { createTickSnapshot } from "./runtime/create-tick-snapshot";
import { advanceDevices } from "./runtime/stage-1-advance-devices";
import { buildSolveGraph } from "./runtime/stage-2-build-solve-graph";
import { solveTransferGraph } from "./runtime/stage-3-layered-reverse-solve";
import { rotateRoutingCursors } from "./runtime/stage-4-rotate-routing-cursors";
import { settleRecipes } from "./runtime/stage-5-settle-recipes";
import { maintainTransportComponentDomains } from "./runtime/runtime-slot-access";
import {
  cloneSimulationMutableRuntimeState,
  createMigratedSimulationMutableRuntimeState,
  createSimulationMutableRuntimeState,
  type SimulationMutableRuntimeState,
} from "./runtime/runtime-state";

const MAX_RETAINED_TICKS = 180;

export class SimulationWorkerRuntime {
  private topology: CompiledSimulationTopology | null = null;
  private runtimeState: SimulationMutableRuntimeState | null = null;
  private tickSnapshots = new Map<number, RuntimeTickSnapshot>();
  private tickRuntimeStates = new Map<number, SimulationMutableRuntimeState>();
  private nextTickNumber = 0;
  private retainedFromTick: number | null = null;
  private latestTickNumber: number | null = null;
  private mode: SimulationRuntimeStatus["mode"] = "idle";
  private error: string | null = null;

  // 停止线：Worker 自主推进到该 tick 后暂停，等待外部拉取更新停止线。
  // 初始值 = 0 + MAX_RETAINED_TICKS，外部每次请求 tick N 时更新为 N + MAX_RETAINED_TICKS。
  private stopLineTick = 0;
  // 后台填充定时器 ID，用于取消和防重入。
  private fillTimerId: ReturnType<typeof setTimeout> | null = null;

  public handleRequest(request: SimulationWorkerRequest): SimulationWorkerResponse {
    switch (request.type) {
      case "load-topology":
        return {
          type: "topology-loaded",
          requestId: request.requestId,
          result: this.loadTopology(request.topology, request.migration),
          status: this.getStatus(),
        };
      case "get-tick-snapshot":
        return {
          type: "tick-snapshot-result",
          requestId: request.requestId,
          result: this.getTickSnapshot(request.tickNumber),
          status: this.getStatus(),
        };
    }
  }

  public getStatus(): SimulationRuntimeStatus {
    return {
      mode: this.mode,
      topologyId: this.topology?.topologyId ?? null,
      documentHash: this.topology?.documentHash ?? null,
      retainedFromTick: this.retainedFromTick,
      latestTickNumber: this.latestTickNumber,
      bufferSize: this.tickSnapshots.size,
      maxBufferSize: MAX_RETAINED_TICKS,
      error: this.error,
    };
  }

  private loadTopology(
    topology: CompiledSimulationTopology,
    migration?: SimulationTopologyMigration,
  ): SimulationStartResult {
    // 取消任何正在进行的后台填充
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    const previousTopology = this.topology;
    const previousBaseState = migration === undefined
      ? null
      : this.tickRuntimeStates.get(migration.baseTickNumber) ?? null;
    const nextRuntimeState = previousTopology !== null && previousBaseState !== null && migration !== undefined
      ? createMigratedSimulationMutableRuntimeState({
          previousTopology,
          previousState: previousBaseState,
          topology,
          resetDeviceIds: migration.resetDeviceIds,
        })
      : createSimulationMutableRuntimeState(topology);
    if (previousBaseState === null && migration !== undefined) {
      nextRuntimeState.tickNumber = Math.max(0, Math.trunc(migration.baseTickNumber));
    }

    this.topology = topology;
    this.runtimeState = nextRuntimeState;
    this.tickSnapshots.clear();
    this.tickRuntimeStates.clear();
    this.nextTickNumber = this.runtimeState.tickNumber;
    this.retainedFromTick = null;
    this.latestTickNumber = null;
    this.mode = "running";
    this.error = null;

    // 启动停止线：初始预热到 0 + MAX_RETAINED_TICKS。
    // Worker 在后台自主推进，外部拉取时更新停止线，互不阻塞。
    this.stopLineTick = this.nextTickNumber + MAX_RETAINED_TICKS;
    this.scheduleBackgroundFill();

    return {
      status: "started",
      topologyId: topology.topologyId,
      diagnostics: topology.diagnostics,
    };
  }

  private getTickSnapshot(tickNumber: number): SimulationTickSnapshotResult {
    if (this.topology === null || this.runtimeState === null) {
      return {
        status: createNotFoundStatus(tickNumber, "missing-topology", null, null, 0),
        currentTick: null,
      };
    }

    // 始终更新停止线：外部请求 tick N → Worker 需要跑到 N + MAX_RETAINED_TICKS。
    // 即使当前 tick 未就绪也更新，确保 Worker 知道目标位置。
    this.stopLineTick = Math.max(this.stopLineTick, tickNumber + MAX_RETAINED_TICKS);

    if (this.latestTickNumber === null || tickNumber > this.latestTickNumber) {
      // 未就绪：立即返回，不等。Worker 在后台继续推进。
      this.scheduleBackgroundFill();
      return {
        status: {
          status: "not-ready",
          requestedTickNumber: tickNumber,
          retainedFromTick: this.retainedFromTick,
          latestTickNumber: this.latestTickNumber,
          bufferSize: this.tickSnapshots.size,
        },
        currentTick: null,
      };
    }

    if (this.retainedFromTick !== null && tickNumber < this.retainedFromTick) {
      return {
        status: createNotFoundStatus(
          tickNumber,
          "cleared",
          this.retainedFromTick,
          this.latestTickNumber,
          this.tickSnapshots.size,
        ),
        currentTick: null,
      };
    }

    const currentTick = this.tickSnapshots.get(tickNumber);
    if (currentTick === undefined) {
      return {
        status: createNotFoundStatus(
          tickNumber,
          "unknown",
          this.retainedFromTick,
          this.latestTickNumber,
          this.tickSnapshots.size,
        ),
        currentTick: null,
      };
    }

    for (const retainedTickNumber of [...this.tickSnapshots.keys()]) {
      if (retainedTickNumber < tickNumber) {
        this.tickSnapshots.delete(retainedTickNumber);
        this.tickRuntimeStates.delete(retainedTickNumber);
      }
    }
    this.retainedFromTick = tickNumber;

    // 消费后缓冲区有空位，通知后台填充继续推进到停止线
    this.scheduleBackgroundFill();

    return {
      status: {
        status: "ready",
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber ?? tickNumber,
        bufferSize: this.tickSnapshots.size,
      },
      currentTick,
    };
  }

  /**
   * 后台自主填充循环：每次 setTimeout(0) 推进一个 tick，到停止线自动停。
   * 与外部 getTickSnapshot 完全解耦 — 外部拉取不触发推进，只更新停止线。
   */
  private scheduleBackgroundFill(): void {
    // 已有定时器在排队
    if (this.fillTimerId !== null) return;
    // 已达停止线，无需推进
    if (this.nextTickNumber > this.stopLineTick) return;
    // 未初始化
    if (this.topology === null || this.runtimeState === null) return;

    this.fillTimerId = setTimeout(() => this.fillOneTick(), 0);
  }

  /**
   * 同步推进到目标 tick（Local 模式专用）。
   * 在没有事件循环的环境（测试/CLI）中，setTimeout 无法触发后台填充，
   * 需要调用方在 getTickSnapshot 前显式推进。
   * Browser 模式（Web Worker）不应调用此方法，依赖 setTimeout 解耦推进。
   */
  public advanceToTick(targetTickNumber: number): void {
    if (this.topology === null || this.runtimeState === null) return;

    // 更新停止线，确保推进目标被覆盖
    this.stopLineTick = Math.max(this.stopLineTick, targetTickNumber + MAX_RETAINED_TICKS);

    while (this.nextTickNumber <= targetTickNumber) {
      try {
        const currentTick = this.createNextTickSnapshot(this.nextTickNumber);
        this.tickSnapshots.set(this.nextTickNumber, currentTick);
        this.tickRuntimeStates.set(
          this.nextTickNumber,
          cloneSimulationMutableRuntimeState(this.runtimeState),
        );
        this.latestTickNumber = this.nextTickNumber;
        this.retainedFromTick = Math.min(
          this.retainedFromTick ?? this.nextTickNumber,
          this.nextTickNumber,
        );
        this.nextTickNumber += 1;
      } catch (error) {
        this.mode = "error";
        this.error = error instanceof Error ? error.message : String(error);
        return;
      }
    }
  }

  private fillOneTick(): void {
    this.fillTimerId = null;

    if (this.topology === null || this.runtimeState === null) return;

    // 检查是否已达停止线
    if (this.nextTickNumber > this.stopLineTick) return;

    try {
      const currentTick = this.createNextTickSnapshot(this.nextTickNumber);
      this.tickSnapshots.set(this.nextTickNumber, currentTick);
      this.tickRuntimeStates.set(
        this.nextTickNumber,
        cloneSimulationMutableRuntimeState(this.runtimeState),
      );
      this.latestTickNumber = this.nextTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? this.nextTickNumber,
        this.nextTickNumber,
      );
      this.nextTickNumber += 1;
    } catch (error) {
      this.mode = "error";
      this.error = error instanceof Error ? error.message : String(error);
      return; // 出错后停止填充
    }

    // 未到停止线则继续调度下一 tick
    if (this.nextTickNumber <= this.stopLineTick) {
      this.fillTimerId = setTimeout(() => this.fillOneTick(), 0);
    }
  }

  private createNextTickSnapshot(tickNumber: number): RuntimeTickSnapshot {
    if (this.topology === null || this.runtimeState === null) {
      throw new Error("Simulation runtime is not initialized.");
    }

    if (tickNumber < this.runtimeState.tickNumber) {
      throw new Error(`Cannot rewind simulation runtime from tick ${this.runtimeState.tickNumber} to ${tickNumber}.`);
    }

    const shouldAdvance = tickNumber > this.runtimeState.tickNumber;
    this.runtimeState.tickNumber = tickNumber;

    if (shouldAdvance) {
      advanceDevices(this.topology, this.runtimeState);
      buildSolveGraph(this.topology, this.runtimeState);
      solveTransferGraph(this.topology, this.runtimeState);
      rotateRoutingCursors(this.topology, this.runtimeState);
      settleRecipes(this.topology, this.runtimeState);
      maintainTransportComponentDomains(this.topology, this.runtimeState);
      return createTickSnapshot(this.topology, this.runtimeState);
    }

    buildSolveGraph(this.topology, this.runtimeState);
    return createTickSnapshot(this.topology, this.runtimeState);
  }
}

function createNotFoundStatus(
  requestedTickNumber: number,
  reason: Extract<SimulationTickPullStatus, { readonly status: "not-found" }> ["reason"],
  retainedFromTick: number | null,
  latestTickNumber: number | null,
  bufferSize: number,
): Extract<SimulationTickPullStatus, { readonly status: "not-found" }> {
  return {
    status: "not-found",
    reason,
    requestedTickNumber,
    retainedFromTick,
    latestTickNumber,
    bufferSize,
  };
}