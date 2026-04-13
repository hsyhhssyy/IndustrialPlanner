import {
  createMockSimulationKernel,
  type SimulationKernel,
} from "@/simulation/kernel/simulation-kernel";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import type { CanvasPoint } from "@/workbench/workspace-state";
import type {
  LoadedSimulationWorld,
  RuntimeInspectorDetails,
  RuntimeRenderSnapshot,
  RuntimeTelemetrySummary,
} from "@/simulation/protocol/runtime-protocol";
import {
  applySimulationEntityConfigPatch,
  createEmptySimulationPatchSet,
  type SimulationPatchSet,
} from "@/simulation/protocol/simulation-patch";
import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";

export interface SimulationState {
  runtimeSnapshot: RuntimeRenderSnapshot;
  telemetry: RuntimeTelemetrySummary;
  inspectorDetails: RuntimeInspectorDetails | null;
  patchSet: SimulationPatchSet;
  selection: string[];
}

export type SimulationHostSnapshot = SimulationState;

export type SimulationInteractionTarget =
  | {
      kind: "blank";
    }
  | {
      kind: "entity";
      entityId: string;
      selected: boolean;
    };

export interface SimulationHost {
  subscribe: SnapshotStore<SimulationState>["subscribe"];
  getSnapshot: SnapshotStore<SimulationState>["getSnapshot"];
  load: (world: LoadedSimulationWorld) => void;
  applyEntityConfigPatch: (
    entityId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  clearPatches: () => void;
  queryInteractionTarget: (
    worldPoint: CanvasPoint,
  ) => SimulationInteractionTarget;
  selectEntity: (entityId: string | null) => Promise<void>;
  start: () => void;
  pause: () => void;
  step: () => void;
  queryInspector: (entityId: string | null) => Promise<void>;
  dispose: () => void;
}

interface CreateSimulationHostOptions {
  kernel?: SimulationKernel;
}

function hitTestWorldEntity(
  document: WorldDocument,
  topology: CompiledTopology,
  worldPoint: CanvasPoint,
): string | null {
  const { gridSize } = document.documentSettings;

  for (let index = document.entityOrder.length - 1; index >= 0; index -= 1) {
    const entityId = document.entityOrder[index];

    if (!entityId) {
      continue;
    }

    const entity = document.entities[entityId];
    const definition = topology.entityViews[entityId]?.definition;

    if (!entity || !definition) {
      continue;
    }

    const x = entity.position.x * gridSize;
    const y = entity.position.y * gridSize;
    const width = definition.footprint.width * gridSize;
    const height = definition.footprint.height * gridSize;

    if (
      worldPoint.x >= x &&
      worldPoint.x <= x + width &&
      worldPoint.y >= y &&
      worldPoint.y <= y + height
    ) {
      return entityId;
    }
  }

  return null;
}

function createInitialSimulationState(): SimulationState {
  return {
    runtimeSnapshot: {
      tick: 0,
      status: "idle",
      entityViews: {},
      patchedEntityIds: [],
    },
    telemetry: {
      tick: 0,
      simulatedHertz: 0,
      entityCount: 0,
    },
    inspectorDetails: null,
    patchSet: createEmptySimulationPatchSet(),
    selection: [],
  };
}

class SimulationHostImpl implements SimulationHost {
  private readonly kernel: SimulationKernel;
  private readonly store: SnapshotStore<SimulationState>;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private loadedWorld: LoadedSimulationWorld | null = null;

  constructor(options: CreateSimulationHostOptions) {
    this.kernel = options.kernel ?? createMockSimulationKernel();
    this.store = createSnapshotStore(createInitialSimulationState());
  }

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  getSnapshot = () => this.store.getSnapshot();

  load(world: LoadedSimulationWorld): void {
    this.stopTimer();
    this.loadedWorld = world;
    const patchSet = createEmptySimulationPatchSet();
    this.kernel.load({
      ...world,
      patchSet,
    });
    const selection = this.store
      .getSnapshot()
      .selection.filter((entityId) => Boolean(world.document.entities[entityId]));
    this.emitRuntime(null, patchSet, selection);
  }

  async applyEntityConfigPatch(
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const nextPatchSet = applySimulationEntityConfigPatch(
      this.store.getSnapshot().patchSet,
      entityId,
      patch,
    );

    this.kernel.applyPatchSet(nextPatchSet);

    const inspectorDetails =
      this.store.getSnapshot().inspectorDetails?.entityId === entityId
        ? this.kernel.queryInspector(entityId)
        : this.store.getSnapshot().inspectorDetails;

    this.emitRuntime(inspectorDetails, nextPatchSet);
  }

  clearPatches(): void {
    const patchSet = createEmptySimulationPatchSet();
    this.kernel.applyPatchSet(patchSet);

    const selectedInspectorEntityId =
      this.store.getSnapshot().inspectorDetails?.entityId ?? null;

    this.emitRuntime(
      selectedInspectorEntityId
        ? this.kernel.queryInspector(selectedInspectorEntityId)
        : null,
      patchSet,
      this.store.getSnapshot().selection,
    );
  }

  queryInteractionTarget(
    worldPoint: CanvasPoint,
  ): SimulationInteractionTarget {
    if (!this.loadedWorld) {
      return {
        kind: "blank",
      };
    }

    const hitEntityId = hitTestWorldEntity(
      this.loadedWorld.document,
      this.loadedWorld.topology,
      worldPoint,
    );

    if (!hitEntityId) {
      return {
        kind: "blank",
      };
    }

    return {
      kind: "entity",
      entityId: hitEntityId,
      selected: this.store.getSnapshot().selection.includes(hitEntityId),
    };
  }

  async selectEntity(entityId: string | null): Promise<void> {
    const resolvedEntityId =
      entityId && this.loadedWorld?.document.entities[entityId] ? entityId : null;

    if (!resolvedEntityId) {
      this.store.update((state) => {
        if (state.selection.length === 0 && state.inspectorDetails === null) {
          return state;
        }

        return {
          ...state,
          inspectorDetails: null,
          selection: [],
        };
      });
      return;
    }

    this.store.update((state) => ({
      ...state,
      selection: [resolvedEntityId],
    }));
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

  async queryInspector(entityId: string | null): Promise<void> {
    const resolvedEntityId =
      entityId && this.loadedWorld?.document.entities[entityId] ? entityId : null;
    const details = resolvedEntityId
      ? this.kernel.queryInspector(resolvedEntityId)
      : null;

    this.store.update((snapshot) => ({
      ...snapshot,
      inspectorDetails: details,
    }));
  }

  dispose(): void {
    this.stopTimer();
    this.loadedWorld = null;
    this.kernel.dispose();
    this.emitRuntime(null, createEmptySimulationPatchSet(), []);
  }

  private emitRuntime(
    inspectorDetails: RuntimeInspectorDetails | null = this.store.getSnapshot().inspectorDetails,
    patchSet: SimulationPatchSet = this.store.getSnapshot().patchSet,
    selection: string[] = this.store.getSnapshot().selection,
  ): void {
    this.store.setSnapshot({
      runtimeSnapshot: this.kernel.getRenderSnapshot(),
      telemetry: this.kernel.getTelemetrySummary(),
      inspectorDetails,
      patchSet,
      selection,
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
