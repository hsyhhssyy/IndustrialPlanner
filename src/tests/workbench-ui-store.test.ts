import { describe, expect, it } from "vitest";
import { createWorkbenchUiStore } from "@/workbench/workbench-ui-store";

describe("WorkbenchUiStore", () => {
  it("hydrates defaults from a partial snapshot and owns UI updates", () => {
    const store = createWorkbenchUiStore({
      locale: "en-US",
      leftDock: {
        open: false,
      },
      rightDock: {
        collapsed: true,
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      mode: "edit",
      locale: "en-US",
      logLevel: "warn",
      leftPanelMode: "placement",
      simulationSpeed: "1x",
      leftDock: {
        open: false,
        collapsed: false,
      },
      rightDock: {
        open: true,
        collapsed: true,
      },
      diagnosticsVisible: true,
      statusMessageKey: "status.ready",
    });

    store.setMode("simulate");
    store.setLogLevel("debug");
    store.setSimulationSpeedPreset("4x");
    store.setDockOpen("right", false);
    store.toggleDockCollapsed("right");
    store.setDiagnosticsVisible(false);

    expect(store.getSnapshot()).toMatchObject({
      mode: "simulate",
      logLevel: "debug",
      simulationSpeed: "4x",
      diagnosticsVisible: false,
      statusMessageKey: "status.simulate",
      rightDock: {
        open: true,
        collapsed: true,
      },
    });
  });
});
