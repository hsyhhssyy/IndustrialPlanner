import {
  createMockSimulationKernel,
  type SimulationKernel,
} from "@/simulation/kernel/simulation-kernel";
import type {
  LoadedSimulationWorld,
  RuntimeInspectorDetails,
  RuntimeRenderSnapshot,
  RuntimeTelemetrySummary,
  SimulationStatus,
} from "@/simulation/protocol/runtime-protocol";

export interface SimulationHostCallbacks {
  onRenderSnapshot: (snapshot: RuntimeRenderSnapshot) => void;
  onTelemetry: (summary: RuntimeTelemetrySummary) => void;
  onStatusChange: (status: SimulationStatus) => void;
  onInspectorDetails: (details: RuntimeInspectorDetails) => void;
}

export interface SimulationHost {
  load: (world: LoadedSimulationWorld) => void;
  start: () => void;
  pause: () => void;
  step: () => void;
  queryInspector: (entityId: string) => Promise<void>;
  dispose: () => void;
}

interface CreateSimulationHostOptions {
  callbacks: SimulationHostCallbacks;
  kernel?: SimulationKernel;
}

class SimulationHostImpl implements SimulationHost {
  private readonly callbacks: SimulationHostCallbacks;
  private readonly kernel: SimulationKernel;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(options: CreateSimulationHostOptions) {
    this.callbacks = options.callbacks;
    this.kernel = options.kernel ?? createMockSimulationKernel();
  }

  load(world: LoadedSimulationWorld): void {
    this.stopTimer();
    this.kernel.load(world);
    this.emitRuntime();
  }

  start(): void {
    if (this.timerId !== null || this.kernel.getStatus() === "idle") {
      return;
    }

    this.kernel.start();
    this.emitRuntime();
    this.timerId = setInterval(() => {
      this.kernel.step();
      this.kernel.start();
      this.emitRuntime();
    }, 250);
  }

  pause(): void {
    this.stopTimer();
    this.kernel.pause();
    this.emitRuntime();
  }

  step(): void {
    this.stopTimer();
    this.kernel.step();
    this.emitRuntime();
  }

  async queryInspector(entityId: string): Promise<void> {
    const details = this.kernel.queryInspector(entityId);

    if (details) {
      this.callbacks.onInspectorDetails(details);
    }
  }

  dispose(): void {
    this.stopTimer();
    this.kernel.dispose();
    this.emitRuntime();
  }

  private emitRuntime(): void {
    this.callbacks.onStatusChange(this.kernel.getStatus());
    this.callbacks.onRenderSnapshot(this.kernel.getRenderSnapshot());
    this.callbacks.onTelemetry(this.kernel.getTelemetrySummary());
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

export function createSimulationHost(
  callbacks: SimulationHostCallbacks,
): SimulationHost {
  return new SimulationHostImpl({ callbacks });
}
