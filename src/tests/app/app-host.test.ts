import { afterEach, describe, expect, it, vi } from "vitest";
import { runInAction } from "mobx";

import { createAppHost } from "@/app/host/app-host";
import type {
  GestureEvent,
  GestureKeyboardEventLike,
  GesturePointerEventLike,
  GestureWheelEventLike,
} from "@/app/input/gesture/adapter";
import {
  APP_SETTINGS_LOCAL_STORAGE_KEY,
  WORKBENCH_STATE_LOCAL_STORAGE_KEY,
} from "@/app/state/storage-hook";
import { MOBILE_LEFT_DOCK_WIDTH } from "@/app/state/state-impl";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { EntityCollectionType } from "@/domain/state/types";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
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
      "hypergryph-logistics-placement-gesture",
      "hypergryph-single-placement-gesture",
      "hypergryph-move-gesture",
      "hypergryph-marquee-gesture",
      "hypergryph-select-gesture",
      "hypergryph-mouse-viewport-pan",
      "hypergryph-viewport-zoom",
      "hypergryph-select-tool-button",
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
    expect(appHost.state.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(appHost.internalState.settings.locale).toBe("zh-CN");
    expect(appHost.internalState.settings.themeId).toBe("ayu-light");
    expect(appHost.internalState.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.internalState.settings.debugShowFps).toBe(false);
    expect(appHost.internalState.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.settings.locale).toBe("zh-CN");
    expect(workspace.app?.state.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMove).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(workspace.app?.state.settings.debugShowFps).toBe(false);
    expect(workspace.app?.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.theme.id).toBe("ayu-light");
    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(workspace.app?.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.workbench.leftDockOpen).toBe(true);
    expect(appHost.state.workbench.rightDockOpen).toBe(true);
    expect(appHost.state.workbench.leftDockWidth).toBe(375);
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();

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
    expect(appHost.state.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(appHost.state.theme.name).toBe("Ayu Light");
    expect(appHost.internalState.settings.locale).toBe("en-US");
    expect(appHost.internalState.settings.themeId).toBe("ayu-light");
    expect(appHost.internalState.settings.hypergryphOperationMode).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.internalState.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.internalState.settings.debugShowFps).toBe(false);
    expect(appHost.internalState.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.settings.locale).toBe("en-US");
    expect(workspace.app?.state.settings.hypergryphOperationMode).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMove).toBe(true);
    expect(workspace.app?.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(workspace.app?.state.settings.debugShowFps).toBe(false);
    expect(workspace.app?.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
    expect(workspace.app?.state.theme.id).toBe("ayu-light");
    expect(appHost.state.workbench.leftDockOpen).toBe(false);
    expect(appHost.internalState.workbench.rightDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockOpen).toBe(false);
    expect(workspace.app?.state.workbench.leftDockWidth).toBe(480);
    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(workspace.app?.state.screenProfile.screenShape).toBe("portrait");
    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
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

  it("hydrates and persists the current split localStorage keys", () => {
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
    expect(appHost.state.settings.hypergryphImmediateMove).toBe(true);
    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(false);
    expect(appHost.state.settings.debugShowFps).toBe(false);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(false);
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

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handleKeyDown({
      code: "KeyX",
      key: "x",
      keyCode: 88,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("marquee");

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("marquee");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-tool-marquee",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("marquee");

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

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-tool-select",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");

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

    expect(appHost.internalState.activeTool).toBe("select");

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "placement-tool-marquee",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
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

  it("creates a move draft from mouse entity hit or touch selected entity", () => {
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

    expect(appHost.internalState.activeTool).toBe("select");

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

    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 4, y: 4 });
    expect(editorHost.state.collections.selection).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.ghost).toEqual(["dummy-entity-2"]);
    expect(editorHost.state.collections.preview).toHaveLength(1);

    appHost.internalActions.setActiveTool("select");
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    appHost.gestureAdapter.handlePointerDown(touchEvent(34, entityPoint.x, entityPoint.y));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerUp(touchEvent(34, entityPoint.x, entityPoint.y));

    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection).toBe(
      EntityCollectionType.preview,
    );
    expect(appHost.internalState.runtime.canvasFloatingToolbar.buttonIds).toEqual([
      "canvas-floating-toolbar-button-cancel",
      "canvas-floating-toolbar-button-rotate",
      "canvas-floating-toolbar-button-ok",
    ]);
  });

  it("aligns an attached canvas floating toolbar to its collection and avoids the cell below", () => {
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

    editorHost.internalState.collections.preview.replace(["dummy-entity-1"]);

    expect(appHost.internalActions.showCanvasFloatingToolbarForCollection(
      ["canvas-floating-toolbar-button-ok"],
      EntityCollectionType.preview,
    )).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection).toBe(
      EntityCollectionType.preview,
    );
    expect(appHost.internalState.runtime.canvasFloatingToolbar.anchor).toEqual({
      x: 520,
      y: 370,
    });

    appHost.internalActions.setCanvasFloatingToolbarSize({
      width: 44,
      height: 16,
    });

    expect(appHost.internalState.runtime.canvasFloatingToolbar.anchor).toEqual({
      x: 498,
      y: 384,
    });
  });

  it("moves the preview draft and applies or cancels the move gesture", () => {
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

    expect(appHost.internalState.activeTool).toBe("select");

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

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

    expect(appHost.internalState.activeTool).toBe("move");
    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 4, y: 4 });

    const previewDraftId = editorHost.state.collections.preview[0];
    expect(previewDraftId).toBeDefined();

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x + 20,
      clientY: entityPoint.y,
      buttons: 1,
    }));

    expect(appHost.internalState.runtime.moveAnchor).toEqual({ x: 5, y: 4 });
    expect(
      editorHost.internalState.drafts.find((entity) => entity.id === previewDraftId)?.position,
    ).toEqual({ x: 5, y: 4 });

    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 35,
      clientX: entityPoint.x + 20,
      clientY: entityPoint.y,
      buttons: 0,
    }));

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

    expect(appHost.internalState.activeTool).toBe("select");
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.position).toEqual({
      x: 4,
      y: 4,
    });

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    appHost.gestureAdapter.handlePointerDown(touchEvent(37, entityPoint.x, entityPoint.y));
    vi.advanceTimersByTime(500);
    appHost.gestureAdapter.handlePointerMove(touchEvent(37, entityPoint.x + 4, entityPoint.y));

    expect(appHost.internalState.activeTool).toBe("move");

    appHost.gestureAdapter.handlePointerMove(touchEvent(37, entityPoint.x + 20, entityPoint.y));
    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(false);
    expect(editorHost.document.getSnapshot().entities["dummy-entity-2"]?.position).toEqual({
      x: 5,
      y: 4,
    });
  });

  it("cancels move drafts when activeTool leaves move by another path", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    editorHost.actions.createMoveOperationDraft();
    appHost.internalState.runtime.moveAnchor = { x: 12, y: 8 };
    appHost.internalActions.showCanvasFloatingToolbarForCollection(
      ["canvas-floating-toolbar-button-ok", "canvas-floating-toolbar-button-cancel"],
      "preview",
    );
    appHost.internalActions.setActiveTool("move");

    expect(editorHost.state.collections.preview).toHaveLength(1);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);

    appHost.internalActions.setActiveTool("single-placement");

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.moveAnchor).toBeNull();
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(false);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.state.collections.ghost).toEqual([]);
  });

  it("creates and applies single-placement drafts from placement device buttons", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const initialEntityOrderLength = editorHost.document.getSnapshot().entityOrder.length;

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "ui-left-dock-placement-mode-item_port_storager_1-touch-tap",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 0, y: 0 });
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe("item_port_storager_1");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(editorHost.state.collections.preview).toHaveLength(1);

    const draftId = editorHost.state.collections.preview[0];
    expect(draftId).toBeDefined();
    expect(editorHost.queries.getEntityById(draftId ?? "")).toMatchObject({
      definitionId: "item_port_storager_1",
      position: { x: -1, y: -1 },
    });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "canvas-floating-toolbar-button-ok",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.placementAnchor).toBeNull();
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBeNull();
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(false);
    expect(editorHost.state.collections.preview).toEqual([]);
    expect(editorHost.document.getSnapshot().entityOrder).toHaveLength(
      initialEntityOrderLength + 1,
    );
    expect(editorHost.document.getSnapshot().entities[draftId ?? ""]).toMatchObject({
      definitionId: "item_port_storager_1",
      position: { x: -1, y: -1 },
    });
  });

  it("cancels single-placement drafts when activeTool leaves by another path", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);

    appHost.gestureAdapter.handleUiButtonMouseTap({
      uiButtonId: "ui-left-dock-placement-mode-item_port_storager_1-mouse-tap",
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(editorHost.state.collections.preview).toHaveLength(1);

    appHost.internalActions.setActiveTool("select");

    expect(appHost.internalState.activeTool).toBe("select");
    expect(appHost.internalState.runtime.placementAnchor).toBeNull();
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBeNull();
    expect(editorHost.state.collections.preview).toEqual([]);
  });

  it("enters logistics-placement from E/Q and arms logistics device shortcuts", () => {
    const workspace = createWorkspace();
    createEditorHost(workspace);
    const appHost = createAppHost(workspace);

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));

    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.kind).toBe("belt");
    expect(appHost.internalState.runtime.logisticsPlacement.shortcutPlacementGroup).toBe(
      "beltLogistics",
    );

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyQ",
      key: "q",
      keyCode: 81,
    }));

    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.kind).toBe("pipe");
    expect(appHost.internalState.runtime.logisticsPlacement.shortcutPlacementGroup).toBe(
      "pipeLogistics",
    );
  });

  it("draws, applies, and continues mouse logistics placement from the previous head", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const initialEntityOrderLength = editorHost.document.getSnapshot().entityOrder.length;
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const endPoint = resolveClientPixelPointForGridCell(editorHost, { x: 2, y: 0 });

    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 41,
      clientX: startPoint.x,
      clientY: startPoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 42,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 0,
    }));

    let logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft).toMatchObject({
      canApply: true,
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 2, y: 0 });
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([
      editorHost.state.collections.preview.at(-1),
    ]);

    appHost.gestureAdapter.handlePointerDown(pointerEvent({
      pointerId: 43,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 1,
    }));
    appHost.gestureAdapter.handlePointerUp(pointerEvent({
      pointerId: 43,
      clientX: endPoint.x,
      clientY: endPoint.y,
      buttons: 0,
    }));

    const snapshot = editorHost.document.getSnapshot();
    const headEntity = Object.values(snapshot.entities).find((entity) =>
      entity.definitionId.startsWith("belt_")
      && entity.position.x === 2
      && entity.position.y === 0,
    );

    expect(headEntity).toBeDefined();
    expect(snapshot.entityOrder).toHaveLength(initialEntityOrderLength + 3);
    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft).toMatchObject({
      canApply: true,
      source: {
        type: "logistics-entity",
        entityId: headEntity?.id,
      },
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 2, y: 0 });
    expect(editorHost.state.collections.ghost).toEqual([headEntity?.id]);
  });

  it("creates touch logistics drafts from the press cell and anchors the toolbar to logistics head", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const endPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 2 });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-action-belt-draw",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    appHost.gestureAdapter.handlePointerDown(touchEvent(51, startPoint.x, startPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(51, endPoint.x, endPoint.y));

    expect(appHost.internalState.activeTool).toBe("logistics-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.pointerMode).toBe("touch");
    expect(appHost.internalState.runtime.canvasFloatingToolbar.visible).toBe(true);
    expect(appHost.internalState.runtime.canvasFloatingToolbar.attachedCollection).toBe(
      EntityCollectionType.logisticsHead,
    );
    expect(appHost.internalState.runtime.canvasFloatingToolbar.buttonIds).toEqual([
      "canvas-floating-toolbar-button-cancel",
      "canvas-floating-toolbar-button-ok",
    ]);
    const logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(logisticsDraft).toMatchObject({
      canApply: true,
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 0, y: 2 });
  });

  it("lets touch drags away from an unfinished logistics head fall through to viewport pan", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const panSpy = vi.spyOn(editorHost.actions, "moveViewportByClientPixelVector");
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const headPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 2 });
    const otherStartPoint = resolveClientPixelPointForGridCell(editorHost, { x: 4, y: 4 });
    const otherEndPoint = resolveClientPixelPointForGridCell(editorHost, { x: 5, y: 4 });
    const otherContinuePoint = {
      x: otherEndPoint.x + editorHost.state.viewport.gridCellPixelSize,
      y: otherEndPoint.y,
    };

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-action-belt-draw",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    appHost.gestureAdapter.handlePointerDown(touchEvent(71, startPoint.x, startPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(71, headPoint.x, headPoint.y));
    appHost.gestureAdapter.handlePointerUp(touchEvent(71, headPoint.x, headPoint.y));

    const beforeDraft = editorHost.queries.resolveLogisticsDraftState();
    const beforeCells = beforeDraft?.cells.map((cell) => ({
      gridPoint: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }));
    const beforePreview = [...editorHost.state.collections.preview];

    appHost.gestureAdapter.handlePointerDown(touchEvent(72, otherStartPoint.x, otherStartPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(72, otherEndPoint.x, otherEndPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(
      72,
      otherContinuePoint.x,
      otherContinuePoint.y,
    ));

    const afterDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(panSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(editorHost.state.collections.preview).toEqual(beforePreview);
    expect(afterDraft?.source).toEqual(beforeDraft?.source);
    expect(afterDraft?.cells.map((cell) => ({
      gridPoint: cell.gridPoint,
      shape: cell.shape,
      rotation: cell.rotation,
    }))).toEqual(beforeCells);
  });

  it("continues touch logistics drafts only when dragging from the logistics head", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const panSpy = vi.spyOn(editorHost.actions, "moveViewportByClientPixelVector");
    const startPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 0 });
    const headPoint = resolveClientPixelPointForGridCell(editorHost, { x: 0, y: 2 });
    const nextHeadPoint = resolveClientPixelPointForGridCell(editorHost, { x: 1, y: 2 });
    const secondNextHeadPoint = resolveClientPixelPointForGridCell(editorHost, { x: 2, y: 2 });

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "placement-action-belt-draw",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    appHost.gestureAdapter.handlePointerDown(touchEvent(81, startPoint.x, startPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(81, headPoint.x, headPoint.y));
    appHost.gestureAdapter.handlePointerUp(touchEvent(81, headPoint.x, headPoint.y));
    panSpy.mockClear();

    appHost.gestureAdapter.handlePointerDown(touchEvent(82, headPoint.x, headPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(82, nextHeadPoint.x, nextHeadPoint.y));
    appHost.gestureAdapter.handlePointerMove(touchEvent(
      82,
      secondNextHeadPoint.x,
      secondNextHeadPoint.y,
    ));

    const logisticsDraft = editorHost.queries.resolveLogisticsDraftState();
    expect(panSpy).not.toHaveBeenCalled();
    expect(logisticsDraft).toMatchObject({
      source: {
        type: "empty-cell",
        gridPoint: { x: 0, y: 0 },
      },
    });
    expect(logisticsDraft?.cells.at(-1)?.gridPoint).toEqual({ x: 2, y: 2 });
    expect(editorHost.state.collections[EntityCollectionType.logisticsHead]).toEqual([
      editorHost.state.collections.preview.at(-1),
    ]);
  });

  it("switches from logistics-placement to current logistics device placement on number shortcuts", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.actions.setViewportClientRect({
      left: 120,
      top: 80,
      width: 400,
      height: 400,
    });
    const appHost = createAppHost(workspace);
    const expectedDeviceId = workspace.registry.entityDefinitions
      .filter((definition) => definition.uiGroup === "beltLogistics")
      .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
    const anchorPoint = resolveClientPixelPointForGridCell(editorHost, { x: 3, y: 2 });

    appHost.gestureAdapter.handlePointerMove(pointerEvent({
      pointerId: 61,
      clientX: anchorPoint.x,
      clientY: anchorPoint.y,
      buttons: 0,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "KeyE",
      key: "e",
      keyCode: 69,
    }));
    appHost.gestureAdapter.handleKeyDown(keyEvent({
      code: "Digit1",
      key: "1",
      keyCode: 49,
    }));

    expect(expectedDeviceId).toBeDefined();
    expect(appHost.internalState.activeTool).toBe("single-placement");
    expect(appHost.internalState.runtime.logisticsPlacement.kind).toBeNull();
    expect(appHost.internalState.runtime.singlePlacementDeviceId).toBe(expectedDeviceId);
    expect(appHost.internalState.runtime.placementAnchor).toEqual({ x: 3, y: 2 });
    expect(editorHost.state.collections.preview).toHaveLength(1);
  });

  it("clears selected placement groups on active tool changes except select to placement", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    appHost.internalState.runtime.selectingPlacementGroup = "warehouse";
    appHost.internalActions.setActiveTool("single-placement");

    expect(appHost.internalState.runtime.selectingPlacementGroup).toBe("warehouse");

    appHost.internalActions.setActiveTool("select");

    expect(appHost.internalState.runtime.selectingPlacementGroup).toBeNull();

    appHost.internalState.runtime.selectingPlacementGroup = "warehouse";
    appHost.internalActions.setActiveTool("move");

    expect(appHost.internalState.runtime.selectingPlacementGroup).toBeNull();
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

function keyEvent(
  overrides: Partial<GestureKeyboardEventLike>,
): GestureKeyboardEventLike {
  return {
    code: "",
    key: "",
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
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
  const gridCellSize = editorHost.state.viewport.gridCellPixelSize;

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
