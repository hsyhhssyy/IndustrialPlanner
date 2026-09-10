import type { SimulationHostWorkerMode } from "../contracts";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { SimulationAdmissionCounterReset } from "@/domain/simulation/types/simulation-types";

import { type SimulationWorkerBridge } from "./bridge-contract";

import { SimulationWorkerRuntime } from "./worker-runtime";
import type {
  SimulationWorkerErrorNotification,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./worker-protocol";

import type { CompiledSimulationTopology, SimulationTopologyMigration } from "../contracts";
import type { SimulationRuntimeExport } from "./runtime-export";
import {
  attachWorkerRuntime,
  type WorkerRuntimeAttachment,
} from "@/shared/worker/attach-worker-runtime";

export function createSimulationWorkerBridge(
  workerMode: SimulationHostWorkerMode,
  registry: WorkspaceContract["registry"],
): SimulationWorkerBridge {
  if (workerMode === "auto" && typeof Worker === "function") {
    return new BrowserSimulationWorkerBridge();
  }

  return new LocalSimulationWorkerBridge(registry);
}

class BrowserSimulationWorkerBridge implements SimulationWorkerBridge {
  private readonly worker: Worker;
  private readonly runtimeAttachment: WorkerRuntimeAttachment;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (response: SimulationWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  public constructor() {
    this.worker = new Worker(new URL("../simulation-worker.ts", import.meta.url), {
      type: "module",
    });
    this.runtimeAttachment = attachWorkerRuntime(this.worker, "simulation", {
      onFault: (fault) => {
        this.rejectAll(new Error(`Simulation worker failed: ${fault.message}`));
      },
    });
    this.worker.addEventListener("message", (event: MessageEvent<SimulationWorkerResponse | SimulationWorkerErrorNotification>) => {
      if (event.data.type === "worker-error") {
        // Worker 内已经通过 console.error 进入 Collector；主线程不重复输出。
        return;
      }

      const handlers = this.pending.get(event.data.requestId);
      if (handlers === undefined) {
        return;
      }

      this.pending.delete(event.data.requestId);
      handlers.resolve(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      const message = event.message || "Unknown worker error";
      console.error("[SimWorker] startup or uncaught worker error", message, event.filename, event.lineno);
      this.rejectAll(new Error(`Simulation worker crashed: ${message}`));
    });
  }

  public loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number, debugDataEnabled?: boolean, powerMode?: "real" | "infinite", powerConsumptionOverride?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    return this.request({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
      migration,
      perfEnabled,
      debugDataEnabled,
      simulationSpeed,
      powerMode,
      powerConsumptionOverride,
    }, "topology-loaded");
  }

  public getTickSnapshot(tickNumber: number, simulationSpeed?: number, retainTickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    return this.request({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      retainTickNumber,
      simulationSpeed,
    }, "tick-snapshot-result");
  }

  public getTickSnapshotRange(fromTickNumber: number, toTickNumber: number, generation: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-range-result" }
  >> {
    return this.request({
      type: "get-tick-snapshot-range",
      requestId: this.createRequestId(),
      fromTickNumber,
      toTickNumber,
      generation,
      simulationSpeed,
    }, "tick-snapshot-range-result");
  }

  public acknowledgePresentedTick(tickNumber: number, generation: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "presented-tick-acknowledged" }
  >> {
    return this.request({
      type: "acknowledge-presented-tick",
      requestId: this.createRequestId(),
      tickNumber,
      generation,
    }, "presented-tick-acknowledged");
  }

  public setDebugEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-enabled-set" }
  >> {
    return this.request({
      type: "set-debug-enabled",
      requestId: this.createRequestId(),
      debugEnabled: value,
    }, "debug-enabled-set");
  }

  public setDebugDataEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-data-enabled-set" }
  >> {
    return this.request({
      type: "set-debug-data-enabled",
      requestId: this.createRequestId(),
      debugDataEnabled: value,
    }, "debug-data-enabled-set");
  }

  public setSimulationSpeed(value: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "simulation-speed-set" }
  >> {
    return this.request({
      type: "set-simulation-speed",
      requestId: this.createRequestId(),
      simulationSpeed: value,
    }, "simulation-speed-set");
  }

  public patchRuntimeSlot(patch: Parameters<SimulationWorkerBridge["patchRuntimeSlot"]>[0]): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-slot-patched" }
  >> {
    return this.request({
      type: "patch-runtime-slot",
      requestId: this.createRequestId(),
      patch,
    }, "runtime-slot-patched");
  }

  public resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "admission-counter-reset" }
  >> {
    return this.request({
      type: "reset-admission-counter",
      requestId: this.createRequestId(),
      reset,
    }, "admission-counter-reset");
  }

  public getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >> {
    return this.request({
      type: "get-perf-report",
      requestId: this.createRequestId(),
    }, "perf-report");
  }

  public exportRuntimeState(tickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-exported" }
  >> {
    return this.request({
      type: "export-runtime-state",
      requestId: this.createRequestId(),
      tickNumber,
    }, "runtime-state-exported");
  }

  public importRuntimeState(runtimeExport: SimulationRuntimeExport): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-imported" }
  >> {
    return this.request({
      type: "import-runtime-state",
      requestId: this.createRequestId(),
      runtimeExport,
    }, "runtime-state-imported");
  }

  public setPowerMode(powerMode: "real" | "infinite"): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-mode-set" }
  >> {
    return this.request({
      type: "set-power-mode",
      requestId: this.createRequestId(),
      powerMode,
    }, "power-mode-set");
  }

  public setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-consumption-override-set" }
  >> {
    return this.request({
      type: "set-power-consumption-override",
      requestId: this.createRequestId(),
      powerConsumptionOverride,
    }, "power-consumption-override-set");
  }

  public dispose(): void {
    const error = new Error("Simulation worker disposed");
    this.rejectAll(error);
    this.runtimeAttachment.dispose();
    this.worker.terminate();
  }

  private rejectAll(error: Error): void {
    for (const handlers of this.pending.values()) {
      handlers.reject(error);
    }
    this.pending.clear();
  }

  private request<TType extends SimulationWorkerResponse["type"]>(
    request: SimulationWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<SimulationWorkerResponse, { readonly type: TType }>> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: (response) => {
          if (response.type !== expectedType) {
            reject(new Error(`Unexpected simulation worker response "${response.type}".`));
            return;
          }
          resolve(response as Extract<SimulationWorkerResponse, { readonly type: TType }>);
        },
        reject,
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
  private readonly runtime: SimulationWorkerRuntime;
  private nextRequestId = 1;

  public constructor(registry: WorkspaceContract["registry"]) {
    this.runtime = new SimulationWorkerRuntime(registry);
  }

  public loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number, debugDataEnabled?: boolean, powerMode?: "real" | "infinite", powerConsumptionOverride?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-topology",
      requestId: this.createRequestId(),
      topology,
      migration,
      perfEnabled,
      debugDataEnabled,
      simulationSpeed,
      powerMode,
      powerConsumptionOverride,
    });
    if (response.type !== "topology-loaded") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickSnapshot(tickNumber: number, simulationSpeed?: number, retainTickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >> {
    // Local 模式无事件循环，setTimeout 不触发，需同步推进到目标 tick。
    const initialResponse = this.runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      retainTickNumber,
      simulationSpeed,
    });
    if (initialResponse.type !== "tick-snapshot-result") {
      throw new Error(`Unexpected simulation worker response "${initialResponse.type}".`);
    }
    if (initialResponse.result.status.status === "ready") {
      return Promise.resolve(initialResponse);
    }

    this.runtime.advanceToTick(tickNumber);
    const response = this.runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: this.createRequestId(),
      tickNumber,
      retainTickNumber,
      simulationSpeed,
    });
    if (response.type !== "tick-snapshot-result") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTickSnapshotRange(fromTickNumber: number, toTickNumber: number, generation: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-range-result" }
  >> {
    // Local 模式没有后台事件循环；同步推进仅用于保持与 Browser Worker 相同的可用范围语义。
    this.runtime.advanceToTick(toTickNumber);
    const response = this.runtime.handleRequest({
      type: "get-tick-snapshot-range",
      requestId: this.createRequestId(),
      fromTickNumber,
      toTickNumber,
      generation,
      simulationSpeed,
    });
    if (response.type !== "tick-snapshot-range-result") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public acknowledgePresentedTick(tickNumber: number, generation: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "presented-tick-acknowledged" }
  >> {
    const response = this.runtime.handleRequest({
      type: "acknowledge-presented-tick",
      requestId: this.createRequestId(),
      tickNumber,
      generation,
    });
    if (response.type !== "presented-tick-acknowledged") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setDebugEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-enabled-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-debug-enabled",
      requestId: this.createRequestId(),
      debugEnabled: value,
    });
    if (response.type !== "debug-enabled-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setDebugDataEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-data-enabled-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-debug-data-enabled",
      requestId: this.createRequestId(),
      debugDataEnabled: value,
    });
    if (response.type !== "debug-data-enabled-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setSimulationSpeed(value: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "simulation-speed-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-simulation-speed",
      requestId: this.createRequestId(),
      simulationSpeed: value,
    });
    if (response.type !== "simulation-speed-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public patchRuntimeSlot(patch: Parameters<SimulationWorkerBridge["patchRuntimeSlot"]>[0]): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-slot-patched" }
  >> {
    const response = this.runtime.handleRequest({
      type: "patch-runtime-slot",
      requestId: this.createRequestId(),
      patch,
    });
    if (response.type !== "runtime-slot-patched") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "admission-counter-reset" }
  >> {
    const response = this.runtime.handleRequest({
      type: "reset-admission-counter",
      requestId: this.createRequestId(),
      reset,
    });
    if (response.type !== "admission-counter-reset") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-perf-report",
      requestId: this.createRequestId(),
    });
    if (response.type !== "perf-report") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public exportRuntimeState(tickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-exported" }
  >> {
    const response = this.runtime.handleRequest({
      type: "export-runtime-state",
      requestId: this.createRequestId(),
      tickNumber,
    });
    if (response.type !== "runtime-state-exported") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public importRuntimeState(runtimeExport: SimulationRuntimeExport): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-imported" }
  >> {
    const response = this.runtime.handleRequest({
      type: "import-runtime-state",
      requestId: this.createRequestId(),
      runtimeExport,
    });
    if (response.type !== "runtime-state-imported") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setPowerMode(powerMode: "real" | "infinite"): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-mode-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-power-mode",
      requestId: this.createRequestId(),
      powerMode,
    });
    if (response.type !== "power-mode-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-consumption-override-set" }
  >> {
    const response = this.runtime.handleRequest({
      type: "set-power-consumption-override",
      requestId: this.createRequestId(),
      powerConsumptionOverride,
    });
    if (response.type !== "power-consumption-override-set") {
      throw new Error(`Unexpected simulation worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public dispose(): void {
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}
