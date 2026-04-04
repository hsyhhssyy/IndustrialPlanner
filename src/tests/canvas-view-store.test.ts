import { autorun } from "@/shared/mobx";
import { createCanvasViewStore } from "@/workbench/canvas-view-store";
import { describe, expect, it, vi } from "vitest";

describe("CanvasViewStore", () => {
  it("hydrates defaults and publishes viewport changes through a snapshot bridge", () => {
    const store = createCanvasViewStore({
      zoom: 2,
      offset: {
        x: 12,
        y: 24,
      },
    });

    expect(store.getSnapshot()).toEqual({
      zoom: 2,
      offset: {
        x: 12,
        y: 24,
      },
    });

    store.update((state) => ({
      ...state,
      zoom: 3,
    }));

    expect(store.getSnapshot().zoom).toBe(3);
    expect(store.zoom).toBe(3);
  });

  it("does not re-run unrelated MobX observers for offset-only changes", () => {
    const store = createCanvasViewStore();
    const zoomTracker = vi.fn();
    const stop = autorun(() => {
      zoomTracker(store.zoom);
    });

    expect(zoomTracker).toHaveBeenCalledTimes(1);

    store.update((state) => ({
      ...state,
      offset: {
        x: 8,
        y: 16,
      },
    }));

    expect(zoomTracker).toHaveBeenCalledTimes(1);

    stop();
  });
});
