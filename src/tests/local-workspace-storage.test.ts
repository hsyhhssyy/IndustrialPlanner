import { beforeEach, describe, expect, it } from "vitest";
import { createWorkbenchUiStore } from "@/app-shell/state/workbench-ui-store";
import { createWorkspaceStorageGateway } from "@/persistence/local-workspace-storage";

const UI_STATE_KEY = "industrial-planner:workbench-ui-state";

describe("WorkspaceStorageGateway", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads a contract-shaped UI snapshot from legacy dock fields", () => {
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
    const hydrated = createWorkbenchUiStore(storage.loadUiSnapshot()).getSnapshot();

    expect(hydrated.locale).toBe("en-US");
    expect(hydrated.leftDock).toEqual({
      open: false,
      collapsed: false,
    });
    expect(hydrated.rightDock).toEqual({
      open: true,
      collapsed: true,
    });
    expect(hydrated.simulationSpeed).toBe("4x");
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
