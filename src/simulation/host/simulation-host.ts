import {
  createMockSimulationKernel,
  type SimulationKernel,
} from "@/simulation/kernel/simulation-kernel";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import type {
  LoadedSimulationWorld,
  RuntimeInspectorDetails,
  RuntimeRenderSnapshot,
  RuntimeTelemetrySummary,
} from "@/simulation/protocol/runtime-protocol";

export interface SimulationHostSnapshot {
  runtimeSnapshot: RuntimeRenderSnapshot;
  telemetry: RuntimeTelemetrySummary;
  inspectorDetails: RuntimeInspectorDetails | null;
}

export interface SimulationHost {
  subscribe: SnapshotStore<SimulationHostSnapshot>["subscribe"];
  getSnapshot: SnapshotStore<SimulationHostSnapshot>["getSnapshot"];
  load: (world: LoadedSimulationWorld) => void;
  start: () => void;
  pause: () => void;
  step: () => void;
  queryInspector: (entityId: string) => Promise<void>;
  dispose: () => void;
}

interface CreateSimulationHostOptions {
  kernel?: SimulationKernel;
}

function createInitialSimulationHostSnapshot(): SimulationHostSnapshot {
  return {
    runtimeSnapshot: {
      tick: 0,
      status: "idle",
      entityViews: {},
    },
    telemetry: {
      tick: 0,
      simulatedHertz: 0,
      entityCount: 0,
    },
    inspectorDetails: null,
  };
}

class SimulationHostImpl implements SimulationHost {
  private readonly kernel: SimulationKernel;
  private readonly store: SnapshotStore<SimulationHostSnapshot>;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(options: CreateSimulationHostOptions) {
    this.kernel = options.kernel ?? createMockSimulationKernel();
    this.store = createSnapshotStore(createInitialSimulationHostSnapshot());
  }

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  getSnapshot = () => this.store.getSnapshot();

  load(world: LoadedSimulationWorld): void {
    this.stopTimer();
    this.kernel.load(world);
    this.emitRuntime(null);
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
    this.store.update((snapshot) => ({
      ...snapshot,
      inspectorDetails: details,
    }));
  }

  dispose(): void {
    this.stopTimer();
    this.kernel.dispose();
    this.emitRuntime(null);
  }

  private emitRuntime(
    inspectorDetails: RuntimeInspectorDetails | null = this.store.getSnapshot().inspectorDetails,
  ): void {
    this.store.setSnapshot({
      runtimeSnapshot: this.kernel.getRenderSnapshot(),
      telemetry: this.kernel.getTelemetrySummary(),
      inspectorDetails,
    });
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

export function createSimulationHost(
  options: CreateSimulationHostOptions = {},
): SimulationHost {
  return new SimulationHostImpl(options);
}
