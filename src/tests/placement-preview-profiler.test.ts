import { describe, expect, it } from "vitest";
import { createPlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

describe("PlacementPreviewProfiler", () => {
  it("aggregates stage timings, preview update counts, and React commit durations", () => {
    const profiler = createPlacementPreviewProfiler();

    profiler.setEnabled(true);
    profiler.recordStageDuration("controller.total", 12.3456);
    profiler.recordStageDuration("controller.total", 3.2);
    profiler.recordUpdateResult({
      changed: false,
      previousPreview: {
        definitionId: "belt_straight_1x1",
        interactionMode: "pointer",
        gridPoint: { x: 3, y: 4 },
        rotation: 0,
        valid: true,
      },
      nextPreview: {
        definitionId: "belt_straight_1x1",
        interactionMode: "pointer",
        gridPoint: { x: 3, y: 4 },
        rotation: 0,
        valid: true,
      },
    });
    profiler.recordReactCommit("CanvasPanel", 2.25, 5.5);

    const snapshot = profiler.getSnapshot();

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.counts).toMatchObject({
      updateCalls: 1,
      previewChangedCalls: 0,
      previewUnchangedCalls: 1,
      previewPresentCalls: 1,
      previewMissingCalls: 0,
    });
    expect(snapshot.latest).toMatchObject({
      changed: false,
      nextPreview: {
        definitionId: "belt_straight_1x1",
        gridPoint: { x: 3, y: 4 },
      },
    });
    expect(snapshot.stages["controller.total"]).toMatchObject({
      count: 2,
      totalDurationMs: 15.546,
      averageDurationMs: 7.773,
      maxDurationMs: 12.346,
      minDurationMs: 3.2,
    });
    expect(snapshot.reactSurfaces.CanvasPanel).toMatchObject({
      count: 1,
      totalActualDurationMs: 2.25,
      averageActualDurationMs: 2.25,
      totalBaseDurationMs: 5.5,
      averageBaseDurationMs: 5.5,
    });
  });

  it("resets accumulated metrics without disabling the profiler", () => {
    const profiler = createPlacementPreviewProfiler();

    profiler.setEnabled(true);
    profiler.recordStageDuration("render.runtime.total", 8);
    profiler.recordUpdateResult({
      changed: true,
      previousPreview: null,
      nextPreview: null,
    });

    profiler.reset();

    const snapshot = profiler.getSnapshot();

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.counts.updateCalls).toBe(0);
    expect(snapshot.stages["render.runtime.total"].count).toBe(0);
    expect(snapshot.reactSurfaces.LeftDock.count).toBe(0);
    expect(snapshot.latest).toBeNull();
  });
});
