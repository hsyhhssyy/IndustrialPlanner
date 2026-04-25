import { afterEach, describe, expect, it, vi } from "vitest";
import { runInAction } from "mobx";

import { createAppHost } from "@/app/app-host";
import type {
  GestureEvent,
  GesturePointerEventLike,
  GestureWheelEventLike,
} from "@/app/input/gesture-adapter";
import {
  APP_SETTINGS_LOCAL_STORAGE_KEY,
  WORKBENCH_STATE_LOCAL_STORAGE_KEY,
} from "@/app/storage-hook";
import { MOBILE_LEFT_DOCK_WIDTH } from "@/app/state-impl";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { resolveWorldGridCellPixelSize } from "@/shared/geometry/viewport-transform";

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
  document.documentElement.removeAttribute("data-app-theme");
  document.documentElement.removeAttribute("style");
  vi.useRealTimers();
});

describe("createAppHost", () => {
  it("initializes gesture adapter and gesture action router as app runtime services", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.gestureAdapter.getKeyboardSnapshot().pressedKeys.size).toBe(0);
    expect(appHost.gestureActionRouter.getRegisteredModuleIds()).toEqual([
      "hypergryph-gesture-diagnostics",
      "hypergryph-move-mode-toggle",
      "hypergryph-select-gesture",
      "hypergryph-mouse-viewport-pan",
      "hypergryph-viewport-zoom",
      "hypergryph-select-tool-button",
      "hypergryph-marquee-mode-toggle",
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
    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(appHost.internalState.settings.locale).toBe("zh-CN");
    expect(appHost.internalState.settings.themeId).toBe("ayu-light");
    expect(appHost.internalState.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.settings.locale).toBe("zh-CN");
    expect(workspace.app?.state.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.theme.id).toBe("ayu-light");
    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(workspace.app?.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.state.workbench.rightDockOpen).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(375);
    expect(appHost.internalState.runtime.activeTool).toBe("select");

    runInAction(() => {
      appHost.internalState.settings.locale = "en-US";
      appHost.internalState.settings.themeId = "ayu-light";
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
    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(appHost.internalState.settings.locale).toBe("en-US");
    expect(appHost.internalState.settings.themeId).toBe("ayu-light");
    expect(appHost.internalState.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.settings.locale).toBe("en-US");
    expect(workspace.app?.state.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.theme.id).toBe("ayu-light");
    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockWidth).toBe(480);
    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(workspace.app?.state.screenProfile.screenShape).toBe("portrait");
    expect(appHost.internalState.runtime.activeTool).toBe("select");
  });

  it("translates arbitrary i18n keys through the current locale", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.actions.translate("app.title")).toBe("集成工业仿真器");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("放置模式");
    expect(appHost.actions.translate("unknown.key")).toBe("unknown.key");

    appHost.internalActions.setLocale("en-US");

    expect(appHost.actions.translate("app.title")).toBe("Industrial Planner Stage1");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("Placement");
    expect(appHost.actions.translate("workbench.base.wuling")).toBe("Wuling");
  });

  it("hydrates only the current split localStorage keys and ignores the legacy combined key", () => {
    localStorage.setItem(
      "v3-workbench-state",
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 599,
        topBarCollapsed: true,
        locale: "zh-CN",
        themeId: "ayu-dark",
      }),
    );
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: false,
        rightDockOpen: false,
        leftDockWidth: 512,
        topBarCollapsed: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.state.workbench.rightDockOpen).toBe(false);
    expect(appHost.state.workbench.leftDockWidth).toBe(512);
    expect(appHost.state.settings.locale).toBe("en-US");
    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );

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
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );
    expect(localStorage.getItem("v3-workbench-state")).toBe(
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 599,
        topBarCollapsed: true,
        locale: "zh-CN",
        themeId: "ayu-dark",
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
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "en-US",
        themeId: "ayu-light",
      }),
    );
  });

  it("reacts to theme state changes and exposes the theme on app state", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.theme.id).toBe("ayu-light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
    expect(document.documentElement.style.getPropertyValue("--shell-bg")).toBe("#f5f7fa");

    runInAction(() => {
      appHost.internalState.settings.themeId = "ayu-dark";
    });

    expect(appHost.state.settings.themeId).toBe("ayu-dark");
    expect(appHost.state.theme.id).toBe("ayu-dark");
    expect(workspace.app?.state.theme.id).toBe("ayu-dark");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--shell-bg")).toBe("#0f1419");

    runInAction(() => {
      appHost.internalState.settings.themeId = "ayu-light";
    });

    expect(appHost.state.settings.themeId).toBe("ayu-light");
    expect(appHost.state.theme.id).toBe("ayu-light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");
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

  it("zooms the editor viewport on wheel up and wheel down gestures", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const zoomSpy = vi.spyOn(editorHost.actions, "zoom");

    appHost.gestureAdapter.handleWheel(wheelEvent({ deltaY: -1.1 }));

    expect(zoomSpy).toHaveBeenCalledTimes(1);
    expect(zoomSpy.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(editorHost.state.viewport.gridSize).toBeGreaterThan(1);

    const zoomedInGridSize = editorHost.state.viewport.gridSize;

    appHost.gestureAdapter.handleWheel(wheelEvent({ deltaY: 1.4 }));

    expect(zoomSpy).toHaveBeenCalledTimes(2);
    expect(zoomSpy.mock.calls[1]?.[0]).toBeLessThan(0);
    expect(editorHost.state.viewport.gridSize).toBeLessThan(zoomedInGridSize);
  });

  it("disables all hypergryph gesture modules when hypergryph operation mode is off", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const zoomSpy = vi.spyOn(editorHost.actions, "zoom");
    const initialGridSize = editorHost.state.viewport.gridSize;

    runInAction(() => {
      appHost.internalState.settings.hypergryphOperationMode = false;
    });

    appHost.gestureAdapter.handleWheel(wheelEvent({ deltaY: -1.1 }));

    expect(zoomSpy).not.toHaveBeenCalled();
    expect(editorHost.state.viewport.gridSize).toBe(initialGridSize);
    expect(appHost.gestureDiagnostics.getSnapshot().latestEvent).toBeNull();
  });

  it("switches the private active tool from hypergryph gesture modules", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handleKeyDown({
      code: "KeyX",
      key: "x",
      keyCode: 88,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.runtime.activeTool).toBe("marquee");

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-tool-marquee",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.runtime.activeTool).toBe("marquee");

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 7,
      button: 2,
      buttons: 2,
      clientX: 14,
      clientY: 18,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 7,
      button: 2,
      buttons: 0,
      clientX: 14,
      clientY: 18,
    }));

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-tool-select",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    runInAction(() => {
      appHost.internalState.settings.hypergryphOperationMode = false;
    });

    appHost.gestureAdapter.handleKeyDown({
      code: "KeyX",
      key: "x",
      keyCode: 88,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.runtime.activeTool).toBe("select");
  });

  it("attaches pointerEntity from editor queries to pointer tap and dragstart events", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    const entityPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 21,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 21,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 0,
    }));

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 22,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 22,
      clientX: entityPoint.x + 4,
      clientY: entityPoint.y,
      buttons: 1,
    }));

    expect(gestures).toMatchObject([
      {
        type: "mouse tap",
        pointerEntity: {
          id: "dummy-entity-2",
        },
      },
      {
        type: "mouse dragstart",
        pointerEntity: {
          id: "dummy-entity-2",
        },
      },
    ]);
  });

  it("switches the active tool to move on longpress tap over an entity", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const entityPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });
    const emptyPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 31,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 31,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 0,
    }));

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 32,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 32,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 0,
    }));

    expect(appHost.internalState.runtime.activeTool).toBe("move");

    appHost.internalActions.setActiveTool("select");

    appHost.gestureAdapter.handlePointerDown(touchEvent(33, entityPoint.x, entityPoint.y));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(touchEvent(33, entityPoint.x, entityPoint.y));

    expect(appHost.internalState.runtime.activeTool).toBe("move");
  });

  it("switches the active tool to move on longpress dragstart over an entity and exits on right tap", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const entityPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });
    const emptyPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 34,
      clientX: emptyPoint.x,
      clientY: emptyPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 34,
      clientX: emptyPoint.x + 4,
      clientY: emptyPoint.y,
      buttons: 1,
    }));

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
      buttons: 1,
    }));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x + 4,
      clientY: entityPoint.y,
      buttons: 1,
    }));

    expect(appHost.internalState.runtime.activeTool).toBe("move");

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 36,
      button: 2,
      buttons: 2,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 36,
      button: 2,
      buttons: 0,
      clientX: entityPoint.x,
      clientY: entityPoint.y,
    }));

    expect(appHost.internalState.runtime.activeTool).toBe("select");

    appHost.gestureAdapter.handlePointerDown(touchEvent(37, entityPoint.x, entityPoint.y));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(touchEvent(37, entityPoint.x + 4, entityPoint.y));

    expect(appHost.internalState.runtime.activeTool).toBe("move");
  });

  it("zooms the editor viewport on pinch out and pinch in gestures", () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const zoomSpy = vi.spyOn(editorHost.actions, "zoom");

    appHost.gestureAdapter.handlePointerDown(touchEvent(1, 0, 0));
    vi.advanceTimersByTime(1000);
    appHost.gestureAdapter.handlePointerMove(touchEvent(1, 1, 0));
    appHost.gestureAdapter.handlePointerDown(touchEvent(2, 0, 10));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 4, 16));

    expect(zoomSpy).toHaveBeenCalledTimes(1);
    expect(zoomSpy.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(editorHost.state.viewport.gridSize).toBeGreaterThan(1);

    const zoomedOutGridSize = editorHost.state.viewport.gridSize;

    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 0, 4));

    expect(zoomSpy).toHaveBeenCalledTimes(2);
    expect(zoomSpy.mock.calls[1]?.[0]).toBeLessThan(0);
    expect(editorHost.state.viewport.gridSize).toBeLessThan(zoomedOutGridSize);
  });

  it("does not pan the editor viewport when a pinch ends with one touch still down", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const appHost = createAppHost(workspace);
    const initialCenter = {
      ...editorHost.state.viewport.center,
    };

    appHost.gestureAdapter.handlePointerDown(touchEvent(1, 0, 0));
    appHost.gestureAdapter.handlePointerDown(touchEvent(2, 0, 10));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 4, 16));

    expect(editorHost.state.viewport.center).toEqual(initialCenter);

    appHost.gestureAdapter.handlePointerUp(touchEvent(1, 0, 0));
    appHost.gestureAdapter.handlePointerMove(touchEvent(2, 7, 20));
    appHost.gestureAdapter.handlePointerUp(touchEvent(2, 7, 20));

    expect(editorHost.state.viewport.center).toEqual(initialCenter);
  });
});

function pointerEvent(
  overrides: Partial<GesturePointerEventLike> = {},
): GesturePointerEventLike {
  return {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function touchEvent(
  pointerId: number,
  clientX: number,
  clientY: number,
): GesturePointerEventLike {
  return pointerEvent({
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  });
}

function wheelEvent(
  overrides: Partial<GestureWheelEventLike>,
): GestureWheelEventLike {
  return {
    clientX: 20,
    clientY: 40,
    deltaY: 0,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function resolveClientPixelPointForGridCell(
  editorHost: ReturnType<typeof createEditorHost>,
  cell: {
    x: number;
    y: number;
  },
): {
  x: number;
  y: number;
} {
  const gridCellSize = resolveWorldGridCellPixelSize(
    editorHost.state.viewport.gridSize,
  );

  return {
    x:
      editorHost.state.viewport.clientRect.left
      +
      editorHost.state.viewport.clientRect.width / 2
      + (cell.x + 0.5 - editorHost.state.viewport.center.x) * gridCellSize,
    y:
      editorHost.state.viewport.clientRect.top
      +
      editorHost.state.viewport.clientRect.height / 2
      + (cell.y + 0.5 - editorHost.state.viewport.center.y) * gridCellSize,
  };
}
