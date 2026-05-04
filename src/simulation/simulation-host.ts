import type { SimulationContract } from "@/domain/contract/simulation-contract";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type {
  CompiledSimulationTopology,
  SimulationDeviceRuntimeStatus,
} from "@/domain/types/simulation";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";

import {
  SimulationActionImpl,
  type SimulationInternalAction,
  type SimulationWorkerBridge,
} from "./action-impl";
import {
  createSimulationStateReadWrite,
  type SimulationStateReadWrite,
} from "./state-impl";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

export interface SimulationHost extends SimulationContract {
  workspace: WorkspaceContract;
  internalState: SimulationStateReadWrite;
  internalActions: SimulationInternalAction;
  dispose: () => void;
}

export function createSimulationHost(
  workspace: WorkspaceContract
): SimulationHost {
  const bridge = createSimulationWorkerBridge();
  const disposers: Array<() => void> = [];
  const topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null> = createSnapshotStore<CompiledSimulationTopology | null>(null);
  const internalState = createSimulationStateReadWrite();
  const actionImpl = new SimulationActionImpl({
    workspace,
    state: internalState,
    topology: topologyStore,
    bridge,
  });
  const actions: SimulationContract["actions"] = actionImpl;
  const internalActions: SimulationInternalAction = actionImpl;

  const host: SimulationHost = {
    workspace,
    internalState,
    internalActions,
    get state() {
      return internalState.state;
    },
    get playbackTickRateHz() {
      return internalState.playbackTickRateHz;
    },
    set playbackTickRateHz(value: number) {
      internalActions.setPlaybackTickRateHz(value);
    },
    topology: topologyStore,
    queries: {
      getStatus: () => internalState.runtimeStatus,
      getCurrentTickSnapshot: () => internalState.currentTickSnapshot,
      getDeviceRuntimeStatus: (deviceId) => resolveDeviceRuntimeStatus({
        topology: topologyStore.getSnapshot(),
        deviceId,
        currentTickSnapshot: internalState.currentTickSnapshot,
      }),
    },
    actions,
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      internalActions.reset();
      bridge.dispose();
    },
  };

  workspace.simulation = host;

  const document = workspace.editor?.document;
  if (document !== undefined) {
    disposers.push(document.subscribe(() => {
      if (internalState.hasStarted) {
        void internalActions.refreshFromCurrentDocument();
      }
    }));
  }

  return host;
}

function resolveDeviceRuntimeStatus(options: {
  topology: CompiledSimulationTopology | null;
  deviceId: string;
  currentTickSnapshot: SimulationHost["internalState"]["currentTickSnapshot"];
}): SimulationDeviceRuntimeStatus | null {
  if (options.topology === null || options.currentTickSnapshot === null) {
    return null;
  }

  const compiledDeviceId = options.topology.ordering.deviceOrder.find((topologyDeviceId) =>
    options.topology?.devices[topologyDeviceId]?.sourceEntityId === options.deviceId
  );
  if (compiledDeviceId === undefined) {
    return null;
  }

  const deviceSnapshot = options.currentTickSnapshot.devices[compiledDeviceId];
  if (deviceSnapshot === undefined) {
    return null;
  }

  return {
    recipeId: deviceSnapshot.recipe?.recipeId ?? null,
    progressTicks: deviceSnapshot.recipe?.progressTicks ?? null,
    desiredTicks: deviceSnapshot.recipe?.durationTicks ?? null,
  };
}

function createSimulationWorkerBridge(): SimulationWorkerBridge {
  if (typeof Worker === "function") {
    return new BrowserSimulationWorkerBridge();
  }

  return new LocalSimulationWorkerBridge();
}

class BrowserSimulationWorkerBridge implements SimulationWorkerBridge {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    (response: SimulationWorkerResponse) => void
  >();

  public constructor() {
    this.worker = new Worker(new URL("./simulation-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse>) => {
      const resolve = this.pending.get(event.data.requestId);
      if (resolve === undefined) {
        return;
      }

      this.pending.delete(event.data.requestId);
      resolve(event.data);
    });
  }

  public loadTopology(topology: CompiledSimulationTopology): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    return this.request({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
    }, "topology-loaded");
  }

  public getTickSnapshot(tickNumber: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    return this.request({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
    }, "tick-snapshot-result");
  }

  public dispose(): void {
    this.pending.clear();
    this.worker.terminate();
  }

  private request<TType extends SimulationWorkerResponse["type"]>(
    request: SimulationWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<SimulationWorkerResponse, { readonly type: TType }>> {
    return new Promise((resolve) => {
      this.pending.set(request.requestId, (response) => {
        if (response.type !== expectedType) {
          throw new Error(`Unexpected simulation worker response "${response.type}".`);
        }
        resolve(response as Extract<SimulationWorkerResponse, { readonly type: TType }>);
      });
      this.worker.postMessage(request);
    });
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

class LocalSimulationWorkerBridge implements SimulationWorkerBridge {
  private readonly runtime = new SimulationWorkerRuntime();
  private nextRequestId = 1;

  public loadTopology(topology: CompiledSimulationTopology): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
    });
    if (response.type !== "topology-loaded") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickSnapshot(tickNumber: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
    });
    if (response.type !== "tick-snapshot-result") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public dispose(): void {
    // Local runtime has no external resources.
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}
