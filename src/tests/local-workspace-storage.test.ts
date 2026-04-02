import { beforeEach, describe, expect, it } from "vitest";
import { createWorkbenchUiStore } from "@/app-shell/state/workbench-ui-store";
import { createInitialCanvasSnapshot } from "@/canvas/canvas-host";
import { createWorkspaceStorageGateway } from "@/shared/workspace-storage/local-workspace-storage";

const UI_STATE_KEY = "industrial-planner:workbench-ui-state";

describe("WorkspaceStorageGateway", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears incompatible persisted UI data instead of hydrating legacy fields", () => {
    localStorage.setItem(
      UI_STATE_KEY,
      JSON.stringify({
        locale: "en-US",
        leftDockOpen: false,
        rightDock: {
          collapsed: true,
        },
        simulationSpeed: "4x",
      }),
    );

    const storage = createWorkspaceStorageGateway();
    const hydrated = storage.loadWorkspaceSnapshot();

    expect(hydrated).toEqual({ ui: {} });
    expect(localStorage.getItem(UI_STATE_KEY)).toBeNull();
  });

  it("saves the full UI snapshot with canvas viewport state", () => {
    const storage = createWorkspaceStorageGateway();
    const uiStore = createWorkbenchUiStore({
      locale: "en-US",
    });
    const canvasViewport = createInitialCanvasSnapshot().viewport;

    uiStore.setMode("simulate");
    uiStore.setDockOpen("left", false);
    storage.saveWorkspaceSnapshot({
      ui: uiStore.getSnapshot(),
      canvasViewport: {
        ...canvasViewport,
        offset: { x: 24, y: 40 },
      },
    });

    expect(JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? "null")).toMatchObject({
      mode: "simulate",
      locale: "en-US",
      leftDock: {
        open: false,
        collapsed: false,
      },
      canvasViewport: {
        offset: { x: 24, y: 40 },
        zoom: 1,
      },
      statusMessageKey: "status.simulate",
    });
  });

  it("hydrates canvas viewport when the persisted shape is valid", () => {
    localStorage.setItem(
      UI_STATE_KEY,
      JSON.stringify({
        locale: "en-US",
        canvasViewport: {
          offset: { x: 12, y: 18 },
          zoom: 1.2,
        },
      }),
    );

    const storage = createWorkspaceStorageGateway();

    expect(storage.loadWorkspaceSnapshot()).toEqual({
      ui: {
        locale: "en-US",
      },
      canvasViewport: {
        offset: { x: 12, y: 18 },
        zoom: 1.2,
      },
    });
  });
});
