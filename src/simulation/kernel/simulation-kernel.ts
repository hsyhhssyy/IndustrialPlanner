import type {
  LoadedSimulationWorld,
  RuntimeEntityView,
  RuntimeInspectorDetails,
  RuntimeRenderSnapshot,
  RuntimeTelemetrySummary,
  SimulationStatus,
} from "@/simulation/protocol/runtime-protocol";

export interface SimulationKernel {
  load: (world: LoadedSimulationWorld) => void;
  start: () => void;
  pause: () => void;
  step: () => void;
  queryInspector: (entityId: string) => RuntimeInspectorDetails | null;
  getRenderSnapshot: () => RuntimeRenderSnapshot;
  getTelemetrySummary: () => RuntimeTelemetrySummary;
  getStatus: () => SimulationStatus;
  dispose: () => void;
}

class MockSimulationKernel implements SimulationKernel {
  private loadedWorld: LoadedSimulationWorld | null = null;
  private runtimeStatus: SimulationStatus = "idle";
  private tick = 0;

  load(world: LoadedSimulationWorld): void {
    this.loadedWorld = world;
    this.tick = 0;
    this.runtimeStatus = "paused";
  }

  start(): void {
    if (!this.loadedWorld) {
      return;
    }

    this.runtimeStatus = "running";
  }

  pause(): void {
    this.runtimeStatus = this.loadedWorld ? "paused" : "idle";
  }

  step(): void {
    if (!this.loadedWorld) {
      return;
    }

    this.runtimeStatus = "paused";
    this.tick += 1;
  }

  queryInspector(entityId: string): RuntimeInspectorDetails | null {
    if (!this.loadedWorld) {
      return null;
    }

    return {
      entityId,
      tick: this.tick,
      lines: [
        "Simulation kernel scaffold",
        `Current tick: ${this.tick}`,
        `Runtime status: ${this.runtimeStatus}`,
      ],
    };
  }

  getRenderSnapshot(): RuntimeRenderSnapshot {
    if (!this.loadedWorld) {
      return {
        tick: 0,
        status: "idle",
        entityViews: {},
      };
    }

    const entityViews: Record<string, RuntimeEntityView> = {};

    this.loadedWorld.document.entityOrder.forEach((entityId, index) => {
      entityViews[entityId] = {
        status: this.runtimeStatus === "running" ? "running" : "idle",
        progress: ((this.tick + index) % 8) / 8,
      };
    });

    return {
      tick: this.tick,
      status: this.runtimeStatus,
      entityViews,
    };
  }

  getTelemetrySummary(): RuntimeTelemetrySummary {
    return {
      tick: this.tick,
      simulatedHertz: this.runtimeStatus === "running" ? 4 : 0,
      entityCount: this.loadedWorld?.document.entityOrder.length ?? 0,
    };
  }

  getStatus(): SimulationStatus {
    return this.runtimeStatus;
  }

  dispose(): void {
    this.loadedWorld = null;
    this.tick = 0;
    this.runtimeStatus = "idle";
  }
}

export function createMockSimulationKernel(): SimulationKernel {
  return new MockSimulationKernel();
}
