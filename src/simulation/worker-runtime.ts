import type {
  CompiledSimulationTopology,
  GetSimulationTickSnapshotResult,
  SimulationDeviceRuntimeSnapshot,
  SimulationNodeSolveSnapshot,
  SimulationRuntimeStatus,
  SimulationSlotRuntimeSnapshot,
  SimulationStartResult,
  SimulationTickSnapshot,
} from "@/domain/types/simulation";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

const MAX_RETAINED_TICKS = 180;

export class SimulationWorkerRuntime {
  private topology: CompiledSimulationTopology | null = null;
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
    if (this.topology === null) {
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
    if (this.topology === null) {
      return;
    }

    while (this.snapshots.size < MAX_RETAINED_TICKS) {
      const snapshot = createTickSnapshot({
        topology: this.topology,
        tickNumber: this.nextTickNumber,
      });
      this.snapshots.set(this.nextTickNumber, snapshot);
      this.latestTickNumber = this.nextTickNumber;
      this.retainedFromTick = Math.min(
        this.retainedFromTick ?? this.nextTickNumber,
        this.nextTickNumber,
      );
      this.nextTickNumber += 1;
    }

    this.mode = "stopped";
  }
}

function createTickSnapshot(options: {
  readonly topology: CompiledSimulationTopology;
  readonly tickNumber: number;
}): SimulationTickSnapshot {
  return {
    schemaVersion: 1,
    topologyId: options.topology.topologyId,
    documentHash: options.topology.documentHash,
    tickNumber: options.tickNumber,
    status: options.tickNumber === 0 ? "initial" : "running",
    slots: createSlotSnapshots(options.topology),
    devices: createDeviceSnapshots(options.topology),
    nodes: createNodeSnapshots(options.topology),
    transfers: [],
    routingCursors: createRoutingCursorSnapshot(options.topology),
    warehouse: createWarehouseSnapshot(options.topology),
    diagnostics: [],
  };
}

function createSlotSnapshots(
  topology: CompiledSimulationTopology,
): Record<string, SimulationSlotRuntimeSnapshot> {
  const slots: Record<string, SimulationSlotRuntimeSnapshot> = {};

  for (const slotId of topology.ordering.slotOrder) {
    const slot = topology.slots[slotId];
    if (slot === undefined) {
      continue;
    }

    slots[slotId] = {
      slotId,
      itemType: slot.initialItemType,
      count: slot.initialCount,
      reserved: [],
    };
  }

  return slots;
}

function createDeviceSnapshots(
  topology: CompiledSimulationTopology,
): Record<string, SimulationDeviceRuntimeSnapshot> {
  const devices: Record<string, SimulationDeviceRuntimeSnapshot> = {};

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    devices[deviceId] = {
      deviceId,
      block: false,
      recipe: null,
    };
  }

  return devices;
}

function createNodeSnapshots(
  topology: CompiledSimulationTopology,
): Record<string, SimulationNodeSolveSnapshot> {
  const nodes: Record<string, SimulationNodeSolveSnapshot> = {};

  for (const cacheGroupId of topology.ordering.cacheGroupOrder) {
    nodes[cacheGroupId] = {
      cacheGroupId,
      result: "uncertain",
      acceptedInputEdgeIds: [],
      acceptedOutputEdgeIds: [],
    };
  }

  return nodes;
}

function createRoutingCursorSnapshot(
  topology: CompiledSimulationTopology,
): Record<string, number> {
  const cursors: Record<string, number> = {};

  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId];
    if (device === undefined) {
      continue;
    }

    for (const [portRef, entry] of Object.entries(device.routing)) {
      cursors[`${deviceId}:${portRef}`] = entry.roundRobinSeed;
    }
  }

  return cursors;
}

function createWarehouseSnapshot(
  topology: CompiledSimulationTopology,
): Record<string, number> {
  const warehouse: Record<string, number> = {};

  for (const slotId of topology.ordering.slotOrder) {
    const slot = topology.slots[slotId];
    if (slot !== undefined && slot.lock !== null && slot.sourceSlotId === slot.lock) {
      warehouse[slot.lock] = slot.initialCount;
    }
  }

  return warehouse;
}
