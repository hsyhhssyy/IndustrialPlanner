import type {
  CanvasBackend,
  CanvasBackendSnapshot,
} from "@/canvas/canvas-host";
import type { WorldDocument } from "@/domain/document/world-document";

interface CreateSimulationCanvasBackendOptions {
  getDocument: () => WorldDocument;
}

export interface SimulationCanvasBackend extends CanvasBackend {
  selectEntity: (entityId: string | null) => void;
}

class SimulationCanvasBackendImpl implements SimulationCanvasBackend {
  readonly kind = "simulation" as const;

  private readonly getDocument: () => WorldDocument;
  private snapshot: CanvasBackendSnapshot = {
    selectedEntityIds: [],
    hoveredEntityId: null,
    placementPreview: null,
    pendingLinkSourceEntityId: null,
  };

  constructor(options: CreateSimulationCanvasBackendOptions) {
    this.getDocument = options.getDocument;
  }

  getSnapshot(): CanvasBackendSnapshot {
    return this.snapshot;
  }

  selectEntity(entityId: string | null): void {
    this.snapshot = {
      ...this.snapshot,
      selectedEntityIds: entityId ? [entityId] : [],
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
): SimulationCanvasBackend {
  return new SimulationCanvasBackendImpl(options);
}
