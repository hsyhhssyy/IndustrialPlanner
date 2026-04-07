import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceStorageGateway } from "@/workbench/persistence/workspace-storage";
import { createWorkbenchUiStore } from "@/workbench/workbench-ui-store";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";

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
        logLevel: "debug",
        leftDockOpen: false,
        rightDock: {
          collapsed: true,
        },
        simulationSpeed: "4x",
      }),
    );

    const storage = createWorkspaceStorageGateway();
    const hydrated = storage.loadWorkspaceState();

    expect(hydrated).toEqual({ ui: {} });
    expect(localStorage.getItem(UI_STATE_KEY)).toBeNull();
  });

  it("saves the full UI snapshot with canvas viewport state", () => {
    const storage = createWorkspaceStorageGateway();
    const uiStore = createWorkbenchUiStore({
      locale: "en-US",
    });
    const canvasView = createInitialCanvasViewState();

    uiStore.setPhase("simulate");
    uiStore.setLogLevel("error");
    uiStore.setDockOpen("left", false);
    storage.saveWorkspaceState({
      ui: uiStore.getSnapshot(),
      canvasView: {
        ...canvasView,
        offset: { x: 24, y: 40 },
      },
    });

    expect(JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? "null")).toMatchObject({
      phase: "simulate",
      locale: "en-US",
      logLevel: "error",
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
        logLevel: "info",
        canvasViewport: {
          offset: { x: 12, y: 18 },
          zoom: 1.2,
        },
      }),
    );

    const storage = createWorkspaceStorageGateway();

    expect(storage.loadWorkspaceState()).toEqual({
      ui: {
        locale: "en-US",
        logLevel: "info",
      },
      canvasView: {
        offset: { x: 12, y: 18 },
        zoom: 1.2,
      },
    });
  });
});
