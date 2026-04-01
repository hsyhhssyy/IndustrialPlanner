import {
  hitTestWorldEntity,
} from "@/canvas/hit-test";
import type {
  CanvasBackend,
  CanvasBackendSnapshot,
  CanvasWorldInput,
} from "@/canvas/canvas-host";
import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";

interface CreateSimulationCanvasBackendOptions {
  getDocument: () => WorldDocument;
  getTopology: () => CompiledTopology;
}

class SimulationCanvasBackendImpl implements CanvasBackend {
  readonly kind = "simulation" as const;

  private readonly getDocument: () => WorldDocument;
  private readonly getTopology: () => CompiledTopology;
  private snapshot: CanvasBackendSnapshot = {
    selectedEntityIds: [],
    hoveredEntityId: null,
    pendingLinkSourceEntityId: null,
  };

  constructor(options: CreateSimulationCanvasBackendOptions) {
    this.getDocument = options.getDocument;
    this.getTopology = options.getTopology;
  }

  getSnapshot(): CanvasBackendSnapshot {
    return this.snapshot;
  }

  handlePrimaryClick(input: CanvasWorldInput): void {
    const hitEntityId = hitTestWorldEntity({
      document: this.getDocument(),
      topology: this.getTopology(),
      worldPoint: input.worldPoint,
    });

    this.snapshot = {
      ...this.snapshot,
      selectedEntityIds: hitEntityId ? [hitEntityId] : [],
    };
  }

  handleWorldChanged(): void {
    const document = this.getDocument();

    this.snapshot = {
      ...this.snapshot,
      selectedEntityIds: this.snapshot.selectedEntityIds.filter(
        (entityId) => Boolean(document.entities[entityId]),
      ),
    };
  }
}

export function createSimulationCanvasBackend(
  options: CreateSimulationCanvasBackendOptions,
): CanvasBackend {
  return new SimulationCanvasBackendImpl(options);
}
