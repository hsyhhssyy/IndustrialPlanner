import { describe, expect, it, vi } from "vitest";
import {
  createCanvasHost,
  screenToWorldPoint,
  worldToGridPoint,
  type CanvasBackend,
  type CanvasBackendSnapshot,
} from "@/canvas/canvas-host";

function createMockBackend(
  kind: CanvasBackend["kind"],
  snapshot: Partial<CanvasBackendSnapshot> = {},
): CanvasBackend {
  return {
    kind,
    getSnapshot: () => ({
      selectedEntityIds: [],
      hoveredEntityId: null,
      placementPreview: null,
      pendingLinkSourceEntityId: null,
      ...snapshot,
    }),
    handleWorldChanged: vi.fn(),
  };
}

describe("CanvasHost", () => {
  it("converts screen coordinates into world and grid coordinates", () => {
    expect(
      screenToWorldPoint(
        { x: 30, y: 18 },
        { offset: { x: 8, y: 4 }, zoom: 2, size: { x: 0, y: 0 } },
      ),
    ).toEqual({ x: 23, y: 13 });
    expect(worldToGridPoint({ x: 95, y: 47 }, 16)).toEqual({ x: 5, y: 2 });
  });

  it("switches between backend snapshots without owning input semantics", () => {
    const host = createCanvasHost({
      editBackend: createMockBackend("edit", {
        selectedEntityIds: ["edit-selected"],
      }),
      simulationBackend: createMockBackend("simulation", {
        selectedEntityIds: ["simulation-selected"],
      }),
    });

    expect(host.getActiveBackendSnapshot().selectedEntityIds).toEqual([
      "edit-selected",
    ]);

    host.setActiveBackend("simulation");

    expect(host.getActiveBackendSnapshot().selectedEntityIds).toEqual([
      "simulation-selected",
    ]);
  });

  it("exposes normalized world and grid coordinates for non-click input flows", () => {
    const host = createCanvasHost({
      editBackend: createMockBackend("edit"),
      simulationBackend: createMockBackend("simulation"),
      initialViewport: {
        offset: { x: 40, y: 24 },
        zoom: 1.5,
      },
    });

    expect(
      host.resolveScreenInput({
        screenPoint: { x: 90, y: 45 },
        gridSize: 16,
      }),
    ).toEqual({
      worldPoint: { x: 100, y: 54 },
      gridPoint: { x: 6, y: 3 },
    });
  });

  it("clamps panning and zooming against viewport and world bounds", () => {
    const host = createCanvasHost({
      editBackend: createMockBackend("edit"),
      simulationBackend: createMockBackend("simulation"),
    });

    host.setWorldSize({ x: 1280, y: 960 });
    host.setViewportSize({ x: 320, y: 160 });
    host.panBy({ x: -400, y: -200 });

    expect(host.getSnapshot().viewport.offset).toEqual({ x: 400, y: 200 });

    host.panBy({ x: -1000, y: -1000 });

    expect(host.getSnapshot().viewport.offset).toEqual({ x: 960, y: 800 });

    host.zoomBy(1.5);
    expect(host.getSnapshot().viewport.zoom).toBe(2.5);

    host.panBy({ x: 4000, y: 4000 });
    expect(host.getSnapshot().viewport.offset).toEqual({ x: 0, y: 0 });
  });

  it("keeps the wheel anchor stable when scaling zoom", () => {
    const host = createCanvasHost({
      editBackend: createMockBackend("edit"),
      simulationBackend: createMockBackend("simulation"),
      initialViewport: {
        offset: { x: 40, y: 24 },
        zoom: 1,
        size: { x: 320, y: 160 },
      },
    });

    host.setWorldSize({ x: 1600, y: 1200 });

    const anchor = { x: 96, y: 48 };
    const worldPointBefore = screenToWorldPoint(anchor, host.getSnapshot().viewport);

    host.scaleZoomAt(anchor, 1.5);

    const snapshot = host.getSnapshot().viewport;
    const worldPointAfter = screenToWorldPoint(anchor, snapshot);

    expect(snapshot.zoom).toBe(1.5);
    expect(worldPointAfter.x).toBeCloseTo(worldPointBefore.x, 6);
    expect(worldPointAfter.y).toBeCloseTo(worldPointBefore.y, 6);
  });
});
