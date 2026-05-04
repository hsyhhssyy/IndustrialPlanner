import type { SimulationContract } from "@/domain/contract/simulation-contract";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import type {
  CompiledSimulationTopology,
  GetSimulationTickSnapshotResult,
  SimulationRuntimeStatus,
  SimulationStartResult,
} from "@/domain/types/simulation";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";

import { compileSimulationTopology } from "./topology-compiler";
import { SimulationWorkerRuntime } from "./worker-runtime";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

export interface SimulationHost extends SimulationContract {
  workspace: WorkspaceContract;
  dispose: () => void;
}

interface SimulationWorkerBridge {
  loadTopology(topology: CompiledSimulationTopology): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >>;
  getTickSnapshot(tickNumber: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >>;
  dispose(): void;
}

const INITIAL_STATUS: SimulationRuntimeStatus = {
  mode: "idle",
  topologyId: null,
  documentHash: null,
  retainedFromTick: null,
  latestTickNumber: null,
  bufferSize: 0,
  maxBufferSize: 180,
  error: null,
};

export function createSimulationHost(
  workspace: WorkspaceContract
): SimulationHost {
  const bridge = createSimulationWorkerBridge();
  const disposers: Array<() => void> = [];
  const topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null> = createSnapshotStore<CompiledSimulationTopology | null>(null);
  let status: SimulationRuntimeStatus = INITIAL_STATUS;
  let hasStarted = false;

  const startFromCurrentDocument = async (): Promise<SimulationStartResult> => {
    const document = workspace.editor?.document.getSnapshot();
    if (document === undefined) {
      topologyStore.setSnapshot(null);
      status = {
        ...status,
        mode: "error",
        error: "Simulation cannot start before editor document is available.",
      };
      return {
        status: "failed",
        topologyId: null,
        diagnostics: [],
        error: status.error ?? undefined,
      };
    }

    status = {
      ...status,
      mode: "starting",
      error: null,
    };

    const compiledTopology = compileSimulationTopology({
      document,
      registry: workspace.registry,
    });
    const response = await bridge.loadTopology(compiledTopology);
    topologyStore.setSnapshot(compiledTopology);
    status = response.status;
    return response.result;
  };

  const host: SimulationHost = {
    workspace,
    topology: topologyStore,
    queries: {
      getStatus: () => status,
    },
    actions: {
      start: async () => {
        hasStarted = true;
        return startFromCurrentDocument();
      },
      getTickSnapshot: async (
        tickNumber: number,
      ): Promise<GetSimulationTickSnapshotResult> => {
        const response = await bridge.getTickSnapshot(tickNumber);
        status = response.status;
        return response.result;
      },
    },
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      topologyStore.setSnapshot(null);
      bridge.dispose();
    },
  };

  workspace.simulation = host;

  const document = workspace.editor?.document;
  if (document !== undefined) {
    disposers.push(document.subscribe(() => {
      if (hasStarted) {
        void startFromCurrentDocument();
      }
    }));
  }

  return host;
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
