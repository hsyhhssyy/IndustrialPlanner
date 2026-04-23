import { afterEach, describe, expect, it } from "vitest";
import { runInAction } from "mobx";

import { createAppHost } from "@/app/app-host";
import { WORKBENCH_STATE_LOCAL_STORAGE_KEY } from "@/app/storage-hook";
import { MOBILE_LEFT_DOCK_WIDTH } from "@/app/state-impl";
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
    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(workspace.app?.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.state.workbench.rightDockOpen).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(375);

    runInAction(() => {
      appHost.internalState.settings.locale = "en-US";
      appHost.internalState.workbench.leftDockOpen = false;
      appHost.internalState.workbench.rightDockOpen = false;
      appHost.internalState.workbench.leftDockWidth = 480;
    });
    appHost.internalActions.setScreenProfile({
      viewportWidth: 390,
      viewportHeight: 844,
      devicePixelRatio: 3,
      deviceClass: "mobile",
      screenShape: "portrait",
      aspectRatio: 844 / 390,
      hasTouch: true,
    });

    expect(appHost.state.settings.locale).toBe("en-US");
    expect(appHost.internalState.settings.locale).toBe("en-US");
    expect(workspace.app?.state.settings.locale).toBe("en-US");
    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockWidth).toBe(480);
    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(workspace.app?.state.screenProfile.screenShape).toBe("portrait");
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
        topBarCollapsed: false,
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
        topBarCollapsed: false,
      }),
    );
  });

  it("keeps activePanel in runtime state only without persisting it", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.runtime.activePanel).toBeNull();

    appHost.internalActions.setActivePanel("history");
    appHost.internalActions.setScreenProfile({
      viewportWidth: 820,
      viewportHeight: 1180,
      devicePixelRatio: 2,
      deviceClass: "tablet",
      screenShape: "portrait",
      aspectRatio: 1180 / 820,
      hasTouch: true,
    });

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

  it("reopens the left dock and predicts viewport rect when activating a panel while dock is closed", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 85,
      top: 64,
      width: 1335,
      height: 720,
    });

    appHost.internalActions.toggleLeftDock();

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(-290);
    expect(editorHost.state.viewport.clientRect.width).toBe(1710);

    appHost.internalActions.setActivePanel("history");

    expect(appHost.internalState.runtime.activePanel).toBe("history");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(editorHost.state.viewport.clientRect.left).toBe(85);
    expect(editorHost.state.viewport.clientRect.top).toBe(64);
    expect(editorHost.state.viewport.clientRect.width).toBe(1335);
    expect(editorHost.state.viewport.clientRect.height).toBe(720);
  });

  it("uses the fixed mobile left dock width when predicting viewport rect", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 844,
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      writable: true,
      value: 1,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(pointer: coarse)" || query === "(hover: none)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    editorHost.actions.setViewportClientRect({
      left: 320,
      top: 64,
      width: 900,
      height: 720,
    });

    runInAction(() => {
      appHost.internalState.workbench.leftDockWidth = 512;
    });

    appHost.internalActions.toggleLeftDock();

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(editorHost.state.viewport.clientRect.left).toBe(320 - MOBILE_LEFT_DOCK_WIDTH);
    expect(editorHost.state.viewport.clientRect.width).toBe(900 + MOBILE_LEFT_DOCK_WIDTH);

    appHost.internalActions.setActivePanel("history");

    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(editorHost.state.viewport.clientRect.left).toBe(320);
    expect(editorHost.state.viewport.clientRect.width).toBe(900);
  });
});
