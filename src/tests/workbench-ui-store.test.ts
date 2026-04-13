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
      locale: "en-US",
      logLevel: "warn",
      leftPanelMode: "placement",
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

    store.setLogLevel("debug");
    store.setDockOpen("right", false);
    store.toggleDockCollapsed("right");
    store.setDiagnosticsVisible(false);
    store.setStatusMessageKey("status.edit");

    expect(store.getSnapshot()).toMatchObject({
      logLevel: "debug",
      diagnosticsVisible: false,
      statusMessageKey: "status.edit",
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
