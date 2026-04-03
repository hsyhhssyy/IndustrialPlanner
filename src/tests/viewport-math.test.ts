import { describe, expect, it } from "vitest";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";
import {
  clampCanvasViewState,
  panCanvasView,
  scaleCanvasViewAt,
  screenToWorldPoint,
  worldToGridPoint,
} from "@/workbench/viewport-math";

describe("viewport math", () => {
  it("converts screen coordinates into world and grid coordinates", () => {
    expect(
      screenToWorldPoint(
        { x: 30, y: 18 },
        {
          offset: { x: 8, y: 4 },
          zoom: 2,
        },
      ),
    ).toEqual({ x: 23, y: 13 });
    expect(worldToGridPoint({ x: 95, y: 47 }, 16)).toEqual({ x: 5, y: 2 });
  });

  it("clamps panning and zooming against viewport and world bounds", () => {
    const metrics = {
      size: { x: 320, y: 160 },
      worldSize: { x: 1280, y: 960 },
    };
    const clamped = clampCanvasViewState(
      {
        offset: { x: 4000, y: 4000 },
        zoom: 4,
      },
      metrics,
    );
    const panned = panCanvasView(
      createInitialCanvasViewState(),
      { x: -400, y: -200 },
      metrics,
    );
    const farPanned = panCanvasView(panned, { x: -1000, y: -1000 }, metrics);

    expect(clamped.zoom).toBe(2.5);
    expect(clamped.offset).toEqual({ x: 1152, y: 896 });
    expect(panned.offset).toEqual({ x: 400, y: 200 });
    expect(farPanned.offset).toEqual({ x: 960, y: 800 });
  });

  it("keeps the wheel anchor stable when scaling zoom", () => {
    const metrics = {
      size: { x: 320, y: 160 },
      worldSize: { x: 1600, y: 1200 },
    };
    const initialView = {
      offset: { x: 40, y: 24 },
      zoom: 1,
    };
    const anchor = { x: 96, y: 48 };
    const worldPointBefore = screenToWorldPoint(anchor, initialView);
    const nextView = scaleCanvasViewAt(initialView, anchor, 1.5, metrics);
    const worldPointAfter = screenToWorldPoint(anchor, nextView);

    expect(nextView.zoom).toBe(1.5);
    expect(worldPointAfter.x).toBeCloseTo(worldPointBefore.x, 6);
    expect(worldPointAfter.y).toBeCloseTo(worldPointBefore.y, 6);
  });
});
