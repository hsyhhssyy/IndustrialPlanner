import type {
  CompiledSimulationTopology,
  SimulationTickPullStatus,
  SimulationTickReadResult,
  SimulationRuntimeStatus,
  SimulationStartResult,
} from "./types";
import type { SimulationCurrentTickReadModel } from "@/domain/query/simulation-read-model";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

import { createTickReadModel } from "./runtime/create-tick-snapshot";
import { advanceDevices } from "./runtime/stage-1-advance-devices";
import { buildSolveGraph } from "./runtime/stage-2-build-solve-graph";
import { solveTransferGraph } from "./runtime/stage-3-layered-reverse-solve";
import { rotateRoutingCursors } from "./runtime/stage-4-rotate-routing-cursors";
import { settleRecipes } from "./runtime/stage-5-settle-recipes";
import {
  createSimulationMutableRuntimeState,
  type SimulationMutableRuntimeState,
} from "./runtime/runtime-state";

const MAX_RETAINED_TICKS = 180;

export class SimulationWorkerRuntime {
  private topology: CompiledSimulationTopology | null = null;
  private runtimeState: SimulationMutableRuntimeState | null = null;
  private tickReadModels = new Map<number, SimulationCurrentTickReadModel>();
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
      case "get-tick-read-model":
        return {
          type: "tick-read-model-result",
          requestId: request.requestId,
          result: this.getTickReadModel(request.tickNumber),
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
      bufferSize: this.tickReadModels.size,
      maxBufferSize: MAX_RETAINED_TICKS,
      error: this.error,
    };
  }

  private loadTopology(topology: CompiledSimulationTopology): SimulationStartResult {
    this.topology = topology;
    this.runtimeState = createSimulationMutableRuntimeState(topology);
    this.tickReadModels.clear();
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

  private getTickReadModel(tickNumber: number): SimulationTickReadResult {
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
          bufferSize: this.tickReadModels.size,
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
          this.tickReadModels.size,
        ),
        currentTick: null,
      };
    }

    const currentTick = this.tickReadModels.get(tickNumber);
    if (currentTick === undefined) {
      return {
        status: createNotFoundStatus(
          tickNumber,
          "unknown",
          this.retainedFromTick,
          this.latestTickNumber,
          this.tickReadModels.size,
        ),
        currentTick: null,
      };
    }

    for (const retainedTickNumber of [...this.tickReadModels.keys()]) {
      if (retainedTickNumber < tickNumber) {
        this.tickReadModels.delete(retainedTickNumber);
      }
    }
    this.retainedFromTick = tickNumber;
    this.fillSnapshotWindow();

    return {
      status: {
        status: "ready",
        retainedFromTick: this.retainedFromTick,
        latestTickNumber: this.latestTickNumber ?? tickNumber,
        bufferSize: this.tickReadModels.size,
      },
      currentTick,
    };
  }

  private fillSnapshotWindow(): void {
    if (this.topology === null || this.runtimeState === null) {
      return;
    }

    while (this.tickReadModels.size < MAX_RETAINED_TICKS) {
      const currentTick = this.createNextTickReadModel(this.nextTickNumber);
      this.tickReadModels.set(this.nextTickNumber, currentTick);
      this.latestTickNumber = this.nextTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? this.nextTickNumber,
        this.nextTickNumber,
      );
      this.nextTickNumber += 1;
    }
  }

  private createNextTickReadModel(tickNumber: number): SimulationCurrentTickReadModel {
    if (this.topology === null || this.runtimeState === null) {
      throw new Error("Simulation runtime is not initialized.");
    }

    this.runtimeState.tickNumber = tickNumber;

    if (tickNumber > 0) {
      advanceDevices(this.topology, this.runtimeState);
      buildSolveGraph(this.topology, this.runtimeState);
      solveTransferGraph(this.topology, this.runtimeState);
      rotateRoutingCursors(this.topology, this.runtimeState);
      settleRecipes(this.topology, this.runtimeState);
      return createTickReadModel(this.topology, this.runtimeState);
    }

    buildSolveGraph(this.topology, this.runtimeState);
    return createTickReadModel(this.topology, this.runtimeState);
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