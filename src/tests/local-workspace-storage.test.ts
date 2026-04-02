import { beforeEach, describe, expect, it } from "vitest";
import { createWorkbenchUiStore } from "@/app-shell/state/workbench-ui-store";
import { createWorkspaceStorageGateway } from "@/persistence/local-workspace-storage";

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
    const hydrated = storage.loadUiSnapshot();

    expect(hydrated).toEqual({});
    expect(localStorage.getItem(UI_STATE_KEY)).toBeNull();
  });

  it("saves the full UI snapshot without depending on state helpers", () => {
    const storage = createWorkspaceStorageGateway();
    const uiStore = createWorkbenchUiStore({
      locale: "en-US",
    });

    uiStore.setMode("simulate");
    uiStore.setDockOpen("left", false);
    storage.saveUiSnapshot(uiStore.getSnapshot());

    expect(JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? "null")).toMatchObject({
      mode: "simulate",
      locale: "en-US",
      leftDock: {
        open: false,
        collapsed: false,
      },
      statusMessageKey: "status.simulate",
    });
  });
});
