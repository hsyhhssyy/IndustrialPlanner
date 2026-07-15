import { describe, expect, it, vi } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import {
  SimulationActionImpl,
  type SimulationWorkerBridge,
} from "@/simulation/action-impl";
import { createTickSnapshot } from "@/simulation/runtime/create-tick-snapshot";
import { createSimulationMutableRuntimeState } from "@/simulation/runtime/runtime-state";
import { createSimulationStateReadWrite } from "@/simulation/state-impl";
import type {
  CompiledSimulationTopology,
  SimulationRuntimeStatus,
} from "@/simulation/types";
import type { SimulationWorkerResponse } from "@/simulation/worker-protocol";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

describe("simulation playback during topology migration", () => {
  it("publishes a migrated topology atomically at the cached next tick", async () => {
    let document = createWorldDocument({ baseId: "test-no-builtin-base" });
    let loadedTopology: CompiledSimulationTopology | null = null;
    let pendingTopology: CompiledSimulationTopology | null = null;
    let pendingMigrationBaseTickNumber: number | null = null;
    const migrationResponse = createDeferred<TopologyLoadedResponse>();
    const loadTopology = vi.fn<SimulationWorkerBridge["loadTopology"]>()
      .mockImplementationOnce(async (topology) => {
        loadedTopology = topology;
        return createTopologyLoadedResponse(topology, 0, "initialization");
      })
      .mockImplementationOnce((topology, migration) => {
        pendingTopology = topology;
        pendingMigrationBaseTickNumber = migration?.baseTickNumber ?? null;
        return migrationResponse.promise;
      });
    const getTickSnapshot = vi.fn<SimulationWorkerBridge["getTickSnapshot"]>(
      async (tickNumber) => {
        if (loadedTopology === null) {
          throw new Error("Expected a loaded topology before requesting a tick.");
        }
        return createReadyTickResponse(loadedTopology, tickNumber);
      },
    );
    const workspace = {
      state: createWorkspaceState(),
      registry: createRegistryContract(),
      app: null,
      editor: {
        document: {
          getSnapshot: () => document,
        },
      },
      render: null,
      simulation: null,
    } as unknown as WorkspaceContract;
    const state = createSimulationStateReadWrite();
    const action = new SimulationActionImpl({
      workspace,
      state,
      topology: createSnapshotStore<CompiledSimulationTopology | null>(null),
      bridge: {
        loadTopology,
        getTickSnapshot,
      } as unknown as SimulationWorkerBridge,
    });

    await action.refreshFromCurrentDocument();
    state.runningState = "start";
    await action.syncToTick(12, 12.25);
    state.runtimeStatus = {
      ...state.runtimeStatus,
      latestTickNumber: 13,
      bufferSize: 2,
    };

    document = addEntity(document, {
      id: "placed-belt",
      definitionId: "belt_straight_1x1",
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    });
    const refresh = action.refreshFromCurrentDocument();

    await action.advancePlaybackByDeltaMs(25);
    expect(state.currentPlaybackTickNumber).toBe(12.75);
    expect(getTickSnapshot.mock.calls.map(([tickNumber]) => tickNumber)).toEqual([0, 12]);
    expect(pendingMigrationBaseTickNumber).toBe(13);

    if (pendingTopology === null) {
      throw new Error("Expected the migrated topology to be pending.");
    }
    loadedTopology = pendingTopology;
    migrationResponse.resolve(createTopologyLoadedResponse(
      pendingTopology,
      13,
      "topology-hot-swap",
    ));
    let refreshCompleted = false;
    void refresh.then(() => {
      refreshCompleted = true;
    });
    await Promise.resolve();
    expect(refreshCompleted).toBe(false);

    await action.advancePlaybackByDeltaMs(25);
    await refresh;

    expect(state.currentPlaybackTickNumber).toBe(13);
    expect(state.currentSnapshot?.tickNumber).toBe(13);
    expect(getTickSnapshot.mock.calls.map(([tickNumber]) => tickNumber)).toEqual([
      0,
      12,
      13,
    ]);
  });
});

type TopologyLoadedResponse = Extract<
  SimulationWorkerResponse,
  { readonly type: "topology-loaded" }
>;

function createTopologyLoadedResponse(
  topology: CompiledSimulationTopology,
  baseTickNumber: number,
  kind: "initialization" | "topology-hot-swap",
): TopologyLoadedResponse {
  return {
    type: "topology-loaded",
    requestId: baseTickNumber,
    result: {
      status: "started",
      topologyId: topology.topologyId,
      diagnostics: topology.diagnostics,
      runtimeTransition: {
        kind,
        reason: "test topology transition",
        baseTickNumber,
        invalidatedFromTickNumber: baseTickNumber + 1,
        resetDeviceIds: [],
      },
    },
    status: createRuntimeStatus(topology, baseTickNumber),
  };
}

function createReadyTickResponse(
  topology: CompiledSimulationTopology,
  tickNumber: number,
): Awaited<ReturnType<SimulationWorkerBridge["getTickSnapshot"]>> {
  const runtimeState = createSimulationMutableRuntimeState(topology);
  runtimeState.tickNumber = tickNumber;
  runtimeState.lastAdvancedTickNumber = tickNumber;
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
      currentTick: createTickSnapshot(topology, runtimeState, false, 0),
    },
    status: createRuntimeStatus(topology, tickNumber),
  };
}

function createRuntimeStatus(
  topology: CompiledSimulationTopology,
  tickNumber: number,
): SimulationRuntimeStatus {
  return {
    mode: "running",
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    retainedFromTick: tickNumber,
    latestTickNumber: tickNumber,
    bufferSize: 1,
    maxBufferSize: 180,
    dynamicTickRate: topology.standardTickRate,
    error: null,
  };
}

function addEntity(document: WorldDocument, entity: WorldEntity): WorldDocument {
  return {
    ...document,
    entities: {
      ...document.entities,
      [entity.id]: entity,
    },
    entityOrder: [...document.entityOrder, entity.id],
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
