import { describe, expect, it, vi } from "vitest";
import {
  createCanvasHost,
  screenToWorldPoint,
  worldToGridPoint,
  type CanvasBackend,
  type CanvasBackendSnapshot,
  type CanvasWorldInput,
} from "@/canvas/canvas-host";

function createMockBackend(
  kind: CanvasBackend["kind"],
  onClick: (input: CanvasWorldInput) => void = () => undefined,
): CanvasBackend {
  let snapshot: CanvasBackendSnapshot = {
    selectedEntityIds: [],
    hoveredEntityId: null,
    pendingLinkSourceEntityId: null,
  };

  return {
    kind,
    getSnapshot: () => snapshot,
    handlePrimaryClick: (input) => {
      onClick(input);
      snapshot = {
        ...snapshot,
        selectedEntityIds: [`${kind}-selected`],
      };
    },
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

  it("routes normalized input to the active backend", async () => {
    const editClick = vi.fn();
    const simulationClick = vi.fn();
    const host = createCanvasHost({
      editBackend: createMockBackend("edit", editClick),
      simulationBackend: createMockBackend("simulation", simulationClick),
    });

    host.zoomBy(1);
    await host.handlePrimaryClick({
      screenPoint: { x: 64, y: 32 },
      gridSize: 16,
    });

    expect(editClick).toHaveBeenCalledWith({
      worldPoint: { x: 32, y: 16 },
      gridPoint: { x: 2, y: 1 },
    });
    expect(simulationClick).not.toHaveBeenCalled();

    host.setActiveBackend("simulation");
    await host.handlePrimaryClick({
      screenPoint: { x: 96, y: 48 },
      gridSize: 16,
    });

    expect(simulationClick).toHaveBeenCalledWith({
      worldPoint: { x: 48, y: 24 },
      gridPoint: { x: 3, y: 1 },
    });
    expect(host.getActiveBackendSnapshot().selectedEntityIds).toEqual([
      "simulation-selected",
    ]);
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
});
