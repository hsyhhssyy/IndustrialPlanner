import { autorun } from "@/shared/mobx";
import { describe, expect, it } from "vitest";
import { createWorkbenchUiStore } from "@/workbench/workbench-ui-store";
import { vi } from "vitest";

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

  it("does not re-run unrelated MobX observers for locale-only changes", () => {
    const store = createWorkbenchUiStore();
    const layoutTracker = vi.fn();
    const stop = autorun(() => {
      layoutTracker(store.leftDock.open, store.rightDock.collapsed);
    });

    expect(layoutTracker).toHaveBeenCalledTimes(1);

    store.setLocale("en-US");

    expect(layoutTracker).toHaveBeenCalledTimes(1);

    stop();
  });
});
