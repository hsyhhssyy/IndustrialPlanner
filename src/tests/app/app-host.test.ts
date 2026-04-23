import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";

import { createAppHost } from "@/app/app-host";
import { WORKBENCH_STATE_LOCAL_STORAGE_KEY } from "@/app/storage-hook";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("createAppHost", () => {
  it("initializes gesture adapter and gesture action router as app runtime services", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.gestureAdapter.getKeyboardSnapshot().pressedKeys.size).toBe(0);
    expect(appHost.gestureActionRouter.getRegisteredModuleIds()).toEqual([
      "app.gesture-diagnostics",
    ]);
    expect(appHost.gestureDiagnostics.getSnapshot().latestEvent).toBeNull();

    appHost.dispose();

    expect(() =>
      appHost.gestureActionRouter.registerModule({
        id: "late-module",
        handle: () => ({ status: "ignored" }),
      }),
    ).toThrow("GestureActionRouter has been disposed.");
  });

  it("initializes app settings and workbench state and keeps readonly views in sync", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.settings.locale).toBe("zh-CN");
    expect(appHost.internalState.settings.locale).toBe("zh-CN");
    expect(workspace.app?.state.settings.locale).toBe("zh-CN");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.state.workbench.rightDockOpen).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(375);

    runInAction(() => {
      appHost.internalState.settings.locale = "en-US";
      appHost.internalState.workbench.leftDockOpen = false;
      appHost.internalState.workbench.rightDockOpen = false;
      appHost.internalState.workbench.leftDockWidth = 480;
    });

    expect(appHost.state.settings.locale).toBe("en-US");
    expect(appHost.internalState.settings.locale).toBe("en-US");
    expect(workspace.app?.state.settings.locale).toBe("en-US");
    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockWidth).toBe(480);
  });

  it("translates arbitrary i18n keys through the current locale", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.actions.translate("app.title")).toBe("集成工业仿真器");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("放置模式");
    expect(appHost.actions.translate("unknown.key")).toBe("unknown.key");

    runInAction(() => {
      appHost.internalState.settings.locale = "en-US";
    });

    expect(appHost.actions.translate("app.title")).toBe("Industrial Planner Stage1");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("Placement");
    expect(appHost.actions.translate("workbench.base.wuling")).toBe("Wuling");
  });

  it("hydrates workbench state from localStorage and persists later changes", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: false,
        rightDockOpen: false,
        leftDockWidth: 512,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(appHost.state.workbench.leftDockWidth).toBe(512);

    runInAction(() => {
      appHost.internalState.workbench.rightDockOpen = true;
      appHost.internalState.workbench.leftDockWidth = 420;
    });

    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        leftDockOpen: false,
        rightDockOpen: true,
        leftDockWidth: 420,
      }),
    );

    appHost.dispose();
    runInAction(() => {
      appHost.internalState.workbench.leftDockOpen = true;
    });

    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        leftDockOpen: false,
        rightDockOpen: true,
        leftDockWidth: 420,
      }),
    );
  });

  it("keeps activePanel in runtime state only without persisting it", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.runtime.activePanel).toBeNull();

    appHost.internalActions.setActivePanel("history");

    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBeNull();

    const nextWorkspace = createWorkspace();
    const nextAppHost = createAppHost(nextWorkspace);

    expect(nextAppHost.internalState.runtime.activePanel).toBeNull();
  });

  it("predicts viewport rect immediately when dock toggles run", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 460,
      top: 64,
      width: 960,
      height: 720,
    });

    appHost.internalActions.toggleLeftDock();

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(85);
    expect(editorHost.state.viewport.clientRect.top).toBe(64);
    expect(editorHost.state.viewport.clientRect.width).toBe(1335);
    expect(editorHost.state.viewport.clientRect.height).toBe(720);

    appHost.internalActions.toggleRightDock();

    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(85);
    expect(editorHost.state.viewport.clientRect.top).toBe(64);
    expect(editorHost.state.viewport.clientRect.width).toBe(1675);
    expect(editorHost.state.viewport.clientRect.height).toBe(720);
  });
});
