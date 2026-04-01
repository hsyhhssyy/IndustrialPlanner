import type {
  LoadedSimulationWorld,
  RuntimeEntityView,
  RuntimeInspectorDetails,
  RuntimeRenderSnapshot,
  RuntimeTelemetrySummary,
  SimulationStatus,
} from "@/simulation/protocol/runtime-protocol";
import {
  createEmptySimulationPatchSet,
  getSimulationEntityConfigPatch,
  resolveSimulationEntityConfig,
  type SimulationPatchSet,
} from "@/simulation/protocol/simulation-patch";

export interface SimulationKernel {
  load: (world: LoadedSimulationWorld) => void;
  applyPatchSet: (patchSet: SimulationPatchSet) => void;
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
    this.loadedWorld = {
      ...world,
      patchSet: world.patchSet ?? createEmptySimulationPatchSet(),
    };
    this.tick = 0;
    this.runtimeStatus = "paused";
  }

  applyPatchSet(patchSet: SimulationPatchSet): void {
    if (!this.loadedWorld) {
      return;
    }

    this.loadedWorld = {
      ...this.loadedWorld,
      patchSet,
    };
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

    const patchSet = this.loadedWorld.patchSet ?? createEmptySimulationPatchSet();

    const effectiveConfig = resolveSimulationEntityConfig(
      this.loadedWorld.document,
      patchSet,
      entityId,
    );
    const patchConfig = getSimulationEntityConfigPatch(
      patchSet,
      entityId,
    );
    const configLines = Object.keys(effectiveConfig).length > 0
      ? Object.entries(effectiveConfig).map(
          ([fieldKey, value]) =>
            `Config ${fieldKey}: ${JSON.stringify(value)}`,
        )
      : ["Config is currently empty."];

    return {
      entityId,
      tick: this.tick,
      lines: [
        "Simulation kernel scaffold",
        `Current tick: ${this.tick}`,
        `Runtime status: ${this.runtimeStatus}`,
        `Runtime patches: ${Object.keys(patchConfig).length}`,
        ...configLines,
      ],
      effectiveConfig,
      patchConfig,
    };
  }

  getRenderSnapshot(): RuntimeRenderSnapshot {
    if (!this.loadedWorld) {
      return {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      };
    }

    const patchSet = this.loadedWorld.patchSet ?? createEmptySimulationPatchSet();
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
      patchedEntityIds: Object.keys(patchSet.entityConfigByEntityId),
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
