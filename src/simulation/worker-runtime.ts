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

    try {
      this.fillSnapshotWindow();
      return {
        status: "started",
        topologyId: topology.topologyId,
        diagnostics: topology.diagnostics,
      };
    } catch (error) {
      this.mode = "error";
      this.error = error instanceof Error ? error.message : String(error);
      return {
        status: "failed",
        topologyId: topology.topologyId,
        diagnostics: topology.diagnostics,
        error: this.error,
      };
    }
  }

  private getTickSnapshot(tickNumber: number): SimulationTickSnapshotResult {
    if (this.topology === null || this.runtimeState === null) {
      return {
        status: createNotFoundStatus(tickNumber, "missing-topology", null, null, 0),
        currentTick: null,
      };
    }

    if (this.latestTickNumber === null || tickNumber > this.latestTickNumber) {
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
    this.fillSnapshotWindow();

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

  private fillSnapshotWindow(): void {
    if (this.topology === null || this.runtimeState === null) {
      return;
    }

    while (this.tickSnapshots.size < MAX_RETAINED_TICKS) {
      const currentTick = this.createNextTickSnapshot(this.nextTickNumber);
      this.tickSnapshots.set(this.nextTickNumber, currentTick);
      this.tickRuntimeStates.set(this.nextTickNumber, cloneSimulationMutableRuntimeState(this.runtimeState));
      this.latestTickNumber = this.nextTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? this.nextTickNumber,
        this.nextTickNumber,
      );
      this.nextTickNumber += 1;
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