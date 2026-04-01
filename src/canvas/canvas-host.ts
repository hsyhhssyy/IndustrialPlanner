import type { GridPoint } from "@/shared/geometry/grid";

export type CanvasBackendKind = "edit" | "simulation";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport {
  offset: CanvasPoint;
  zoom: number;
}

export interface CanvasSnapshot {
  viewport: CanvasViewport;
  activeBackend: CanvasBackendKind;
}

export interface CanvasBackendSnapshot {
  selectedEntityIds: string[];
  hoveredEntityId: string | null;
  pendingLinkSourceEntityId: string | null;
}

export interface CanvasScreenInput {
  screenPoint: CanvasPoint;
  gridSize: number;
}

export interface CanvasWorldInput {
  worldPoint: CanvasPoint;
  gridPoint: GridPoint;
}

export interface CanvasBackend {
  readonly kind: CanvasBackendKind;
  getSnapshot: () => CanvasBackendSnapshot;
  handlePrimaryClick: (input: CanvasWorldInput) => Promise<void> | void;
  handleWorldChanged: () => void;
}

export interface CanvasHost {
  getSnapshot: () => CanvasSnapshot;
  getActiveBackendSnapshot: () => CanvasBackendSnapshot;
  setActiveBackend: (backend: CanvasBackendKind) => void;
  zoomBy: (delta: number) => void;
  handlePrimaryClick: (input: CanvasScreenInput) => Promise<void>;
  handleWorldChanged: () => void;
}

interface CreateCanvasHostOptions {
  editBackend: CanvasBackend;
  simulationBackend: CanvasBackend;
  initialBackend?: CanvasBackendKind;
}

const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2.5;

export function createInitialCanvasSnapshot(
  activeBackend: CanvasBackendKind = "edit",
): CanvasSnapshot {
  return {
    viewport: {
      offset: { x: 0, y: 0 },
      zoom: 1,
    },
    activeBackend,
  };
}

export function screenToWorldPoint(
  screenPoint: CanvasPoint,
  viewport: CanvasViewport,
): CanvasPoint {
  return {
    x: screenPoint.x / viewport.zoom + viewport.offset.x,
    y: screenPoint.y / viewport.zoom + viewport.offset.y,
  };
}

export function worldToGridPoint(
  worldPoint: CanvasPoint,
  gridSize: number,
): GridPoint {
  return {
    x: Math.max(0, Math.floor(worldPoint.x / gridSize)),
    y: Math.max(0, Math.floor(worldPoint.y / gridSize)),
  };
}

class CanvasHostImpl implements CanvasHost {
  private readonly backends: Record<CanvasBackendKind, CanvasBackend>;
  private snapshot: CanvasSnapshot;

  constructor(options: CreateCanvasHostOptions) {
    this.backends = {
      edit: options.editBackend,
      simulation: options.simulationBackend,
    };
    this.snapshot = createInitialCanvasSnapshot(
      options.initialBackend ?? "edit",
    );
  }

  getSnapshot(): CanvasSnapshot {
    return this.snapshot;
  }

  getActiveBackendSnapshot(): CanvasBackendSnapshot {
    return this.backends[this.snapshot.activeBackend].getSnapshot();
  }

  setActiveBackend(backend: CanvasBackendKind): void {
    this.snapshot = {
      ...this.snapshot,
      activeBackend: backend,
    };
  }

  zoomBy(delta: number): void {
    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...this.snapshot.viewport,
        zoom: Math.min(
          MAX_CANVAS_ZOOM,
          Math.max(MIN_CANVAS_ZOOM, this.snapshot.viewport.zoom + delta),
        ),
      },
    };
  }

  async handlePrimaryClick(input: CanvasScreenInput): Promise<void> {
    const worldPoint = screenToWorldPoint(
      input.screenPoint,
      this.snapshot.viewport,
    );
    const gridPoint = worldToGridPoint(worldPoint, input.gridSize);

    await this.backends[this.snapshot.activeBackend].handlePrimaryClick({
      worldPoint,
      gridPoint,
    });
  }

  handleWorldChanged(): void {
    for (const backend of Object.values(this.backends)) {
      backend.handleWorldChanged();
    }
  }
}

export function createCanvasHost(options: CreateCanvasHostOptions): CanvasHost {
  return new CanvasHostImpl(options);
}
