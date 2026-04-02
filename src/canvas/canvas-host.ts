import type { GridPoint } from "@/shared/geometry/grid";

export type CanvasBackendKind = "edit" | "simulation";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport {
  offset: CanvasPoint;
  zoom: number;
  size: CanvasPoint;
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
  scaleZoomAt: (screenPoint: CanvasPoint, scaleFactor: number) => void;
  panBy: (screenDelta: CanvasPoint) => void;
  setViewportSize: (size: CanvasPoint) => void;
  setWorldSize: (size: CanvasPoint) => void;
  handlePrimaryClick: (input: CanvasScreenInput) => Promise<void>;
  handleWorldChanged: () => void;
}

interface CreateCanvasHostOptions {
  editBackend: CanvasBackend;
  simulationBackend: CanvasBackend;
  initialBackend?: CanvasBackendKind;
  initialViewport?: Partial<CanvasViewport>;
}

const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2.5;

function clampCanvasZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function createInitialCanvasSnapshot(
  activeBackend: CanvasBackendKind = "edit",
  initialViewport: Partial<CanvasViewport> = {},
): CanvasSnapshot {
  return {
    viewport: {
      offset: initialViewport.offset ?? { x: 0, y: 0 },
      zoom: initialViewport.zoom ?? 1,
      size: initialViewport.size ?? { x: 0, y: 0 },
    },
    activeBackend,
  };
}

function clampViewportOffset(
  offset: CanvasPoint,
  zoom: number,
  viewportSize: CanvasPoint,
  worldSize: CanvasPoint,
): CanvasPoint {
  const maxOffsetX = Math.max(0, worldSize.x - viewportSize.x / zoom);
  const maxOffsetY = Math.max(0, worldSize.y - viewportSize.y / zoom);

  return {
    x: Math.min(Math.max(0, offset.x), maxOffsetX),
    y: Math.min(Math.max(0, offset.y), maxOffsetY),
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
  private worldSize: CanvasPoint;

  constructor(options: CreateCanvasHostOptions) {
    this.backends = {
      edit: options.editBackend,
      simulation: options.simulationBackend,
    };
    this.snapshot = createInitialCanvasSnapshot(
      options.initialBackend ?? "edit",
      options.initialViewport,
    );
    this.worldSize = { x: 0, y: 0 };
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
    const nextZoom = clampCanvasZoom(this.snapshot.viewport.zoom + delta);

    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...this.snapshot.viewport,
        zoom: nextZoom,
        offset: clampViewportOffset(
          this.snapshot.viewport.offset,
          nextZoom,
          this.snapshot.viewport.size,
          this.worldSize,
        ),
      },
    };
  }

  scaleZoomAt(screenPoint: CanvasPoint, scaleFactor: number): void {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return;
    }

    const currentViewport = this.snapshot.viewport;
    const nextZoom = clampCanvasZoom(currentViewport.zoom * scaleFactor);

    if (nextZoom === currentViewport.zoom) {
      return;
    }

    const anchorWorldPoint = screenToWorldPoint(screenPoint, currentViewport);
    const nextOffset = clampViewportOffset(
      {
        x: anchorWorldPoint.x - screenPoint.x / nextZoom,
        y: anchorWorldPoint.y - screenPoint.y / nextZoom,
      },
      nextZoom,
      currentViewport.size,
      this.worldSize,
    );

    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...currentViewport,
        zoom: nextZoom,
        offset: nextOffset,
      },
    };
  }

  panBy(screenDelta: CanvasPoint): void {
    const nextOffset = clampViewportOffset(
      {
        x: this.snapshot.viewport.offset.x - screenDelta.x / this.snapshot.viewport.zoom,
        y: this.snapshot.viewport.offset.y - screenDelta.y / this.snapshot.viewport.zoom,
      },
      this.snapshot.viewport.zoom,
      this.snapshot.viewport.size,
      this.worldSize,
    );

    if (
      nextOffset.x === this.snapshot.viewport.offset.x &&
      nextOffset.y === this.snapshot.viewport.offset.y
    ) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...this.snapshot.viewport,
        offset: nextOffset,
      },
    };
  }

  setViewportSize(size: CanvasPoint): void {
    const nextSize = {
      x: Math.max(0, size.x),
      y: Math.max(0, size.y),
    };
    const nextOffset = clampViewportOffset(
      this.snapshot.viewport.offset,
      this.snapshot.viewport.zoom,
      nextSize,
      this.worldSize,
    );

    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...this.snapshot.viewport,
        size: nextSize,
        offset: nextOffset,
      },
    };
  }

  setWorldSize(size: CanvasPoint): void {
    this.worldSize = {
      x: Math.max(0, size.x),
      y: Math.max(0, size.y),
    };

    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...this.snapshot.viewport,
        offset: clampViewportOffset(
          this.snapshot.viewport.offset,
          this.snapshot.viewport.zoom,
          this.snapshot.viewport.size,
          this.worldSize,
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
