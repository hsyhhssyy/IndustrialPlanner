import type {
  CompiledSimulationTopology,
  GetSimulationTickSnapshotResult,
  SimulationRuntimeStatus,
  SimulationStartResult,
  SimulationTickSnapshot,
} from "@/domain/types/simulation";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

import { advanceDevices } from "./runtime/advance-devices";
import { breakCycles } from "./runtime/break-cycles";
import { buildSolveGraph } from "./runtime/build-solve-graph";
import { createTickSnapshot } from "./runtime/create-tick-snapshot";
import { moveItems } from "./runtime/move-items";
import { resetTickState } from "./runtime/reset-tick-state";
import {
  createSimulationMutableRuntimeState,
  type SimulationMutableRuntimeState,
} from "./runtime/runtime-state";
import { settleRecipes } from "./runtime/settle-recipes";
import { solveTransferGraph } from "./runtime/solve-transfer-graph";

const MAX_RETAINED_TICKS = 180;

export class SimulationWorkerRuntime {
  private topology: CompiledSimulationTopology | null = null;
  private runtimeState: SimulationMutableRuntimeState | null = null;
  private snapshots = new Map<number, SimulationTickSnapshot>();
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
          result: this.loadTopology(request.topology),
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
      bufferSize: this.snapshots.size,
      maxBufferSize: MAX_RETAINED_TICKS,
      error: this.error,
    };
  }

  private loadTopology(topology: CompiledSimulationTopology): SimulationStartResult {
    this.topology = topology;
    this.runtimeState = createSimulationMutableRuntimeState(topology);
    this.snapshots.clear();
    this.nextTickNumber = 0;
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

  private getTickSnapshot(tickNumber: number): GetSimulationTickSnapshotResult {
    if (this.topology === null || this.runtimeState === null) {
      return {
        status: "not-found",
        reason: "missing-topology",
        requestedTickNumber: tickNumber,
        retainedFromTick: null,
        latestTickNumber: null,
        bufferSize: 0,
      };
    }

    if (this.latestTickNumber === null || tickNumber > this.latestTickNumber) {
      return {
        status: "not-ready",
        requestedTickNumber: tickNumber,
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber,
        bufferSize: this.snapshots.size,
      };
    }

    if (this.retainedFromTick !== null && tickNumber < this.retainedFromTick) {
      return {
        status: "not-found",
        reason: "cleared",
        requestedTickNumber: tickNumber,
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber,
        bufferSize: this.snapshots.size,
      };
    }

    const snapshot = this.snapshots.get(tickNumber);
    if (snapshot === undefined) {
      return {
        status: "not-found",
        reason: "unknown",
        requestedTickNumber: tickNumber,
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber,
        bufferSize: this.snapshots.size,
      };
    }

    for (const retainedTickNumber of [...this.snapshots.keys()]) {
      if (retainedTickNumber < tickNumber) {
        this.snapshots.delete(retainedTickNumber);
      }
    }
    this.retainedFromTick = tickNumber;
    this.fillSnapshotWindow();

    return {
      status: "ready",
      snapshot,
      retainedFromTick: this.retainedFromTick,
      latestTickNumber: this.latestTickNumber ?? tickNumber,
      bufferSize: this.snapshots.size,
    };
  }

  private fillSnapshotWindow(): void {
    if (this.topology === null || this.runtimeState === null) {
      return;
    }

    while (this.snapshots.size < MAX_RETAINED_TICKS) {
      const snapshot = this.createNextSnapshot(this.nextTickNumber);
      this.snapshots.set(this.nextTickNumber, snapshot);
      this.latestTickNumber = this.nextTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? this.nextTickNumber,
        this.nextTickNumber,
      );
      this.nextTickNumber += 1;
    }
  }

  private createNextSnapshot(tickNumber: number): SimulationTickSnapshot {
    if (this.topology === null || this.runtimeState === null) {
      throw new Error("Simulation runtime is not initialized.");
    }

    this.runtimeState.tickNumber = tickNumber;
    resetTickState(this.topology, this.runtimeState);

    if (tickNumber > 0) {
      advanceDevices(this.topology, this.runtimeState);
      buildSolveGraph(this.topology, this.runtimeState);
      breakCycles(this.topology, this.runtimeState);
      solveTransferGraph(this.topology, this.runtimeState);
      moveItems(this.topology, this.runtimeState);
      settleRecipes(this.topology, this.runtimeState);
      return createTickSnapshot(this.topology, this.runtimeState, tickNumber);
    }

    buildSolveGraph(this.topology, this.runtimeState);
    return createTickSnapshot(this.topology, this.runtimeState, tickNumber);
  }
}