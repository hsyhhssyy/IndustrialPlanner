import type { BlueprintExecutionEngine, BlueprintExecutionEngineOptions } from "../contracts";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintRunRequest, SimulationBlueprintRunReport, SimulationEngineKind } from "@/domain/simulation";
import { attachWorkerRuntime, type WorkerRuntimeAttachment } from "@/shared/worker/attach-worker-runtime";
import { executeBlueprint, validateBlueprintRequest } from "./execute";
import type { BlueprintWorkerRequest, BlueprintWorkerResponse } from "./protocol";

/** Host 拥有独立验证任务的生命周期；停止主场景不影响这些任务。 */
export class BlueprintExecutionClient {
  private readonly active = new Set<AbortController>();
  private disposed = false;

  constructor(
    private readonly registry: RegistryContract,
    private readonly engineKind: SimulationEngineKind,
    private readonly workerMode: "auto" | "runtime",
    private readonly createEngine: (options: BlueprintExecutionEngineOptions) => BlueprintExecutionEngine,
    private readonly denseTickRate?: 2 | 4,
  ) {}

  async run(request: SimulationBlueprintRunRequest, signal?: AbortSignal): Promise<SimulationBlueprintRunReport> {
    if (this.disposed) throw new Error("Simulation host is disposed.");
    validateBlueprintRequest(this.registry, request);
    const snapshot = structuredClone(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    this.active.add(controller);
    try {
      return this.workerMode === "runtime" || typeof Worker === "undefined"
        ? await executeBlueprint(this.registry, this.engineKind, snapshot, this.createEngine, controller.signal, this.denseTickRate)
        : await this.runWorker(snapshot, controller.signal);
    } finally {
      signal?.removeEventListener("abort", abort);
      this.active.delete(controller);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.active) controller.abort();
  }

  private async runWorker(request: SimulationBlueprintRunRequest, signal: AbortSignal): Promise<SimulationBlueprintRunReport> {
    const startedAt = performance.now();
    let worker: Worker | null = null;
    let attachment: WorkerRuntimeAttachment | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    const stoppedReport = (status: SimulationBlueprintRunReport["status"], message: string): SimulationBlueprintRunReport => ({
      status, engineKind: this.engineKind, simulationSeconds: 0, observationSeconds: 0,
      elapsedMs: performance.now() - startedAt, probes: [], inventorySamples: [], deviceStatuses: [],
      diagnostics: [{ severity: status === "failed" ? "error" : "warning", code: "blueprint-worker-interrupted", message }],
    });
    try {
      if (signal.aborted) return stoppedReport("cancelled", "Blueprint execution was cancelled before startup.");
      worker = new Worker(new URL("../simulation-worker.ts", import.meta.url), { type: "module" });
      return await new Promise<SimulationBlueprintRunReport>((resolve) => {
        const finish = (report: SimulationBlueprintRunReport) => resolve(report);
        attachment = attachWorkerRuntime(worker!, "simulation", {
          onFault: (fault) => finish(stoppedReport("failed", fault.message)),
        });
        worker!.addEventListener("message", (event: MessageEvent<BlueprintWorkerResponse>) => {
          if (event.data.type === "blueprint-completed") finish(event.data.report);
        });
        worker!.addEventListener("error", (event) => finish(stoppedReport("failed", event.message)));
        worker!.addEventListener("messageerror", () => finish(stoppedReport("failed", "Invalid blueprint worker response.")));
        const send = (message: BlueprintWorkerRequest) => worker!.postMessage(message);
        abort = () => {
          send({ type: "cancel-blueprint" });
          cancelTimer = setTimeout(() => finish(stoppedReport("cancelled", "Cancelled worker did not return a report.")), 1000);
        };
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => finish(stoppedReport("timeout", "Blueprint worker exceeded its wall-clock budget.")), request.maxWallTimeMs + 1000);
        send({ type: "run-blueprint", request, engineKind: this.engineKind, denseTickRate: this.denseTickRate });
        if (signal.aborted) abort();
      });
    } finally {
      clearTimeout(timer);
      clearTimeout(cancelTimer);
      signal.removeEventListener("abort", abort);
      // Promise 回调内赋值，清理时始终读取当前 attachment。
      (attachment as WorkerRuntimeAttachment | null)?.dispose();
      worker?.terminate();
    }
  }
}
