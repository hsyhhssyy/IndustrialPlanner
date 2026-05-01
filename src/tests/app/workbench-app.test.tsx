// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import {
  APP_SHORTCUTS_LOCAL_STORAGE_KEY,
  SHORTCUT_KEY,
} from "@/app/actions/keyboard-shortcut-manager";
import { USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY } from "@/app/shell/settings-dialog-state";
import {
  APP_SETTINGS_LOCAL_STORAGE_KEY,
  WORKBENCH_STATE_LOCAL_STORAGE_KEY,
} from "@/app/state/storage-hook";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import { MOBILE_LEFT_DOCK_WIDTH } from "@/app/state/state-impl";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost } from "@/editor/editor-host";

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

const DEFAULT_APP_SETTINGS_STORAGE = {
  locale: "zh-CN",
  themeId: "ayu-light",
  hypergryphOperationMode: true,
  hypergryphImmediateMove: true,
  hypergryphImmediateMarquee: false,
  gameShowHotkeys: false,
  showGrassBackground: false,
  debugShowFps: false,
  debugShowGestureDiagnosticsWindow: false,
} as const;

const DEFAULT_APP_SHORTCUTS_STORAGE = {
  [SHORTCUT_KEY.PLACE_CONVEYOR]: "E",
  [SHORTCUT_KEY.PLACE_PIPE]: "Q",
  [SHORTCUT_KEY.RESOURCES_POWER]: "G",
  [SHORTCUT_KEY.WAREHOUSE]: "C",
  [SHORTCUT_KEY.BASIC_PRODUCTION]: "V",
  [SHORTCUT_KEY.SYNTHESIS]: "B",
} as const;

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
  },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  target.dispatchEvent(event);
  return event;
}

describe("WorkbenchApp", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fullscreenElement: Element | null;
  let coarsePointer: boolean;
  let hoverNone: boolean;

  const setViewport = (options: {
    width: number;
    height: number;
    userAgent: string;
    maxTouchPoints: number;
  }) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: options.width,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: options.height,
    });

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: options.userAgent,
    });

    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: options.maxTouchPoints,
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fullscreenElement = null;
    coarsePointer = false;
    hoverNone = false;

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      writable: true,
      value: 1,
    });

    setViewport({
      width: 1280,
      height: 800,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    });

    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches:
          (query === "(pointer: coarse)" && coarsePointer) ||
          (query === "(hover: none)" && hoverNone),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });

    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });

    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    localStorage.clear();
    document.documentElement.removeAttribute("data-app-theme");
    document.documentElement.removeAttribute("style");
    vi.unstubAllGlobals();
    document.body.classList.remove("is-resizing-left-dock");
  });

  it("applies persisted left dock width to the shell style", () => {
    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 512,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("512px");
  });

  it("updates public screen profile from the shell resize hook", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("desktop");
    expect(appHost.state.screenProfile.screenShape).toBe("landscape");

    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 820,
      height: 1180,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");
  });

  it("updates left dock width through the edge handle and clamps the value", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const handle = container.querySelector(".dock-resize-handle") as HTMLDivElement | null;
    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(handle).not.toBeNull();
    expect(workbench).not.toBeNull();

    act(() => {
      handle?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 375 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 470 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 470 }));
    });

    expect(appHost.state.workbench.leftDockWidth).toBe(470);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("470px");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 470,
        topBarCollapsed: false,
      }),
    );
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBeNull();

    act(() => {
      handle?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 470 }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 900 }));
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 900 }));
    });

    expect(appHost.state.workbench.leftDockWidth).toBe(600);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe("600px");
  });

  it("hides the top and bottom bars and exposes floating fullscreen and expand buttons when a phone landscape top bar is collapsed", async () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 375,
        topBarCollapsed: true,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;
    const floatingControls = container.querySelector(
      ".workbench-floating-top-bar-controls",
    ) as HTMLDivElement | null;
    const floatingFullscreenButton = container.querySelector(
      ".workbench-floating-fullscreen-button",
    ) as HTMLButtonElement | null;
    const floatingToggle = container.querySelector(
      ".workbench-floating-top-bar-toggle",
    ) as HTMLButtonElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--top-bar-height")).toBe("0px");
    expect(workbench?.style.getPropertyValue("--bottom-bar-height")).toBe("0px");
    expect(container.querySelector(".status-bar")).toBeNull();
    expect(container.querySelector(".top-bar")).toBeNull();
    expect(floatingControls).not.toBeNull();
    expect(floatingFullscreenButton?.title).toBe("进入全屏");
    expect(floatingToggle?.title).toBe("展开 运行控制");
    expect(
      floatingFullscreenButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("expand");

    await act(async () => {
      floatingFullscreenButton?.click();
    });

    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(floatingFullscreenButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      floatingFullscreenButton?.querySelector("svg")?.getAttribute("data-workbench-icon"),
    ).toBe("shrink");

    act(() => {
      floatingToggle?.click();
    });

    expect(appHost.state.workbench.topBarCollapsed).toBe(false);
    expect(workbench?.style.getPropertyValue("--top-bar-height")).toBe("48px");
    expect(workbench?.style.getPropertyValue("--bottom-bar-height")).toBe("28px");
    expect(container.querySelector(".workbench-floating-top-bar-controls")).toBeNull();
    expect(container.querySelector(".top-bar")).not.toBeNull();
    expect(container.querySelector(".status-bar")).not.toBeNull();
  });

  it("keeps the bottom bar visible in phone landscape until the top bar is collapsed", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 375,
        topBarCollapsed: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(workbench).not.toBeNull();
    expect(workbench?.style.getPropertyValue("--top-bar-height")).toBe("48px");
    expect(workbench?.style.getPropertyValue("--bottom-bar-height")).toBe("28px");
    expect(container.querySelector(".top-bar")).not.toBeNull();
    expect(container.querySelector(".status-bar")).not.toBeNull();
    expect(container.querySelector(".workbench-floating-top-bar-controls")).toBeNull();
  });

  it("forces the left dock to a fixed mobile width and disables resize handles in phone mode", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    localStorage.setItem(
      WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      JSON.stringify({
        leftDockOpen: true,
        rightDockOpen: true,
        leftDockWidth: 512,
        topBarCollapsed: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const workbench = container.querySelector(".workbench") as HTMLDivElement | null;

    expect(appHost.state.workbench.leftDockWidth).toBe(512);
    expect(workbench?.style.getPropertyValue("--left-dock-width")).toBe(`${MOBILE_LEFT_DOCK_WIDTH}px`);
    expect(container.querySelector(".dock-resize-handle")).toBeNull();
  });

  it("prevents middle mouse native pointerdown behavior at the outer shell", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const canvasPanel = container.querySelector(".canvas-panel") as HTMLElement | null;

    expect(canvasPanel).not.toBeNull();

    if (!canvasPanel) {
      throw new Error("Canvas panel did not render.");
    }

    const middleMouseEvent = dispatchPointerEvent(canvasPanel, "pointerdown", {
      pointerId: 7,
      pointerType: "mouse",
      clientX: 120,
      clientY: 80,
      button: 1,
      buttons: 4,
    });
    const leftMouseEvent = dispatchPointerEvent(canvasPanel, "pointerdown", {
      pointerId: 8,
      pointerType: "mouse",
      clientX: 120,
      clientY: 80,
      button: 0,
      buttons: 1,
    });

    expect(middleMouseEvent.defaultPrevented).toBe(true);
    expect(leftMouseEvent.defaultPrevented).toBe(false);
  });

  it("keeps pointer activity inside the canvas floating toolbar out of canvas gestures and only emits ui-button events", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
      editorHost.actions.createMoveOperationDraft();
      appHost.internalActions.showCanvasFloatingToolbarForCollection(
        [
          "canvas-floating-toolbar-button-ok",
          "canvas-floating-toolbar-button-delete",
        ],
        "preview",
      );
    });

    const toolbar = container.querySelector(".canvas-floating-toolbar") as HTMLDivElement | null;
    const okButton = container.querySelector(
      '[data-ui-button-id="canvas-floating-toolbar-button-ok"]',
    ) as HTMLButtonElement | null;
    const deleteButton = container.querySelector(
      '[data-ui-button-id="canvas-floating-toolbar-button-delete"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(okButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();

    if (!toolbar || !okButton || !deleteButton) {
      throw new Error("Canvas floating toolbar did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 21,
        pointerType: "mouse",
        clientX: 220,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointermove", {
        pointerId: 21,
        pointerType: "mouse",
        clientX: 228,
        clientY: 186,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 21,
        pointerType: "mouse",
        clientX: 228,
        clientY: 186,
        buttons: 0,
      });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(okButton, "pointerdown", {
        pointerId: 22,
        pointerType: "mouse",
        clientX: 220,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(okButton, "pointerup", {
        pointerId: 22,
        pointerType: "mouse",
        clientX: 220,
        clientY: 180,
        buttons: 0,
      });
      dispatchPointerEvent(deleteButton, "pointerdown", {
        pointerId: 23,
        pointerType: "touch",
        clientX: 252,
        clientY: 180,
        buttons: 1,
      });
      dispatchPointerEvent(deleteButton, "pointerup", {
        pointerId: 23,
        pointerType: "touch",
        clientX: 252,
        clientY: 180,
        buttons: 0,
      });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-floating-toolbar-button-ok",
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-floating-toolbar-button-delete",
      },
    ]);
  });

  it("shows the canvas right dock toolbar only while the right dock is closed and restores it after reopen", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        "canvas-right-dock-toolbar-button-exit",
        "canvas-right-dock-toolbar-button-move",
      ]);
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).toBeNull();

    act(() => {
      appHost.internalActions.toggleRightDock();
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    const labels = Array.from(
      toolbar?.querySelectorAll(".canvas-right-dock-toolbar-label") ?? [],
    ).map((element) => element.textContent);

    expect(toolbar).not.toBeNull();
    expect(
      Array.from(toolbar?.querySelectorAll("[data-ui-button-id]") ?? []).map((button) =>
        button.getAttribute("data-ui-button-id"),
      ),
    ).toEqual([
      "canvas-right-dock-toolbar-button-exit",
      "canvas-right-dock-toolbar-button-move",
    ]);
    expect(labels).toEqual(["退出", "移动"]);
    expect(
      toolbar?.querySelector('[data-ui-button-id="canvas-right-dock-toolbar-button-move"] svg')?.getAttribute("data-workbench-icon"),
    ).toBe("move");

    act(() => {
      appHost.internalActions.toggleRightDock();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).toBeNull();

    act(() => {
      appHost.internalActions.toggleRightDock();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).not.toBeNull();

    act(() => {
      appHost.internalActions.hideCanvasRightDockToolbar();
    });

    expect(container.querySelector(".canvas-right-dock-toolbar")).toBeNull();
  });

  it("emits ui-button events from the canvas right dock toolbar without leaking canvas gestures", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasRightDockToolbar([
        "canvas-right-dock-toolbar-button-exit",
        "canvas-right-dock-toolbar-button-move",
      ]);
      appHost.internalActions.toggleRightDock();
    });

    const toolbar = container.querySelector(".canvas-right-dock-toolbar") as HTMLDivElement | null;
    const exitButton = container.querySelector(
      '[data-ui-button-id="canvas-right-dock-toolbar-button-exit"]',
    ) as HTMLButtonElement | null;
    const moveButton = container.querySelector(
      '[data-ui-button-id="canvas-right-dock-toolbar-button-move"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(exitButton).not.toBeNull();
    expect(moveButton).not.toBeNull();

    if (!toolbar || !exitButton || !moveButton) {
      throw new Error("Canvas right dock toolbar did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 24,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 24,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 0,
      });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(exitButton, "pointerdown", {
        pointerId: 25,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 1,
      });
      dispatchPointerEvent(exitButton, "pointerup", {
        pointerId: 25,
        pointerType: "mouse",
        clientX: 1200,
        clientY: 280,
        buttons: 0,
      });
      dispatchPointerEvent(moveButton, "pointerdown", {
        pointerId: 26,
        pointerType: "touch",
        clientX: 1200,
        clientY: 332,
        buttons: 1,
      });
      dispatchPointerEvent(moveButton, "pointerup", {
        pointerId: 26,
        pointerType: "touch",
        clientX: 1200,
        clientY: 332,
        buttons: 0,
      });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-right-dock-toolbar-button-exit",
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-right-dock-toolbar-button-move",
      },
    ]);
  });

  it("shows the canvas top left corner toolbar and updates toggle labels locally", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    expect(container.querySelector(".canvas-top-left-corner-toolbar")).toBeNull();

    act(() => {
      appHost.internalActions.showCanvasTopLeftCornerToolbar([
        "canvas-top-left-corner-toolbar-button-toggle-pipe",
        "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
      ]);
    });

    const toolbar = container.querySelector(".canvas-top-left-corner-toolbar") as HTMLDivElement | null;
    const pipeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-pipe"]',
    ) as HTMLButtonElement | null;
    const reverseMarqueeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-reverse-marquee"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(pipeButton?.textContent).toBe("弱化管道");
    expect(reverseMarqueeButton?.textContent).toBe("切换到反选");
    expect(pipeButton?.getAttribute("aria-pressed")).toBe("false");
    expect(reverseMarqueeButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      if (pipeButton === null) {
        return;
      }

      dispatchPointerEvent(pipeButton, "pointerdown", {
        pointerId: 31,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(pipeButton, "pointerup", {
        pointerId: 31,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
    });

    expect(pipeButton?.textContent).toBe("显示管道");
    expect(pipeButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      if (reverseMarqueeButton === null) {
        return;
      }

      dispatchPointerEvent(reverseMarqueeButton, "pointerdown", {
        pointerId: 32,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 1,
      });
      dispatchPointerEvent(reverseMarqueeButton, "pointerup", {
        pointerId: 32,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 0,
      });
    });

    expect(reverseMarqueeButton?.textContent).toBe("切换到正选");
    expect(reverseMarqueeButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      appHost.internalActions.hideCanvasTopLeftCornerToolbar();
    });

    expect(container.querySelector(".canvas-top-left-corner-toolbar")).toBeNull();
  });

  it("emits toggle ui-button events from the canvas top left corner toolbar without leaking canvas gestures", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
      appHost.internalActions.showCanvasTopLeftCornerToolbar([
        "canvas-top-left-corner-toolbar-button-toggle-pipe",
        "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee",
      ]);
    });

    const toolbar = container.querySelector(".canvas-top-left-corner-toolbar") as HTMLDivElement | null;
    const pipeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-pipe"]',
    ) as HTMLButtonElement | null;
    const reverseMarqueeButton = container.querySelector(
      '[data-ui-button-id="canvas-top-left-corner-toolbar-button-toggle-reverse-marquee"]',
    ) as HTMLButtonElement | null;

    expect(toolbar).not.toBeNull();
    expect(pipeButton).not.toBeNull();
    expect(reverseMarqueeButton).not.toBeNull();

    if (!toolbar || !pipeButton || !reverseMarqueeButton) {
      throw new Error("Canvas top left corner toolbar did not render expected buttons.");
    }

    act(() => {
      dispatchPointerEvent(toolbar, "pointerdown", {
        pointerId: 33,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(toolbar, "pointerup", {
        pointerId: 33,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
    });

    expect(gestures).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(pipeButton, "pointerdown", {
        pointerId: 34,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(pipeButton, "pointerup", {
        pointerId: 34,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
      dispatchPointerEvent(pipeButton, "pointerdown", {
        pointerId: 35,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 1,
      });
      dispatchPointerEvent(pipeButton, "pointerup", {
        pointerId: 35,
        pointerType: "mouse",
        clientX: 464,
        clientY: 92,
        buttons: 0,
      });
      dispatchPointerEvent(reverseMarqueeButton, "pointerdown", {
        pointerId: 36,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 1,
      });
      dispatchPointerEvent(reverseMarqueeButton, "pointerup", {
        pointerId: 36,
        pointerType: "touch",
        clientX: 464,
        clientY: 124,
        buttons: 0,
      });
    });

    expect(gestures).toMatchObject([
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-pipe-on",
      },
      {
        type: "ui-button-mouse-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-pipe-off",
      },
      {
        type: "ui-button-touch-tap",
        uiButtonId: "canvas-top-left-corner-toolbar-button-toggle-reverse-marquee-on",
      },
    ]);
  });

  it("opens the settings dialog from the left toolbar and hydrates saved schema values", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: false,
        debugShowFps: true,
        debugShowGestureDiagnosticsWindow: true,
      }),
    );
    localStorage.setItem(
      USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY,
      JSON.stringify({
        selectedGroupId: "system",
        values: {
          "system-theme": "follow-system",
          "display-frame-rate-limit": "60",
          "game-arknights-operation-mode": true,
          "game-use-simplified-device-icons": false,
          "other-debug-mode": true,
        },
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    expect(container.querySelector(".settings-dialog")).toBeNull();
    expect(settingsButton).not.toBeNull();

    act(() => {
      settingsButton?.click();
    });

    const dialog = container.querySelector(".settings-dialog") as HTMLDivElement | null;
    const languageSelect = container.querySelector(
      'select[name="system-language"]',
    ) as HTMLSelectElement | null;
    const themeSelect = container.querySelector(
      'select[name="system-theme"]',
    ) as HTMLSelectElement | null;
    const operationModeToggle = container.querySelector(
      'input[name="game-arknights-operation-mode"]',
    ) as HTMLInputElement | null;
    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;
    const debugToggle = container.querySelector(
      'input[name="other-debug-mode"]',
    ) as HTMLInputElement | null;
    const showFpsToggle = container.querySelector(
      'input[name="debug-show-fps"]',
    ) as HTMLInputElement | null;
    const showGestureTestWindowToggle = container.querySelector(
      'input[name="debug-show-gesture-diagnostics-window"]',
    ) as HTMLInputElement | null;
    const groupTitles = Array.from(
      dialog?.querySelectorAll(".settings-dialog-group-header h3") ?? [],
    ).map((element) => element.textContent);
    const groupDescriptions = Array.from(
      dialog?.querySelectorAll(".settings-dialog-group-header p") ?? [],
    ).map((element) => element.textContent);
    const languageOptionLabels = Array.from(languageSelect?.options ?? []).map((option) => option.textContent);
    const themeOptionLabels = Array.from(themeSelect?.options ?? []).map((option) => option.textContent);

    expect(dialog).not.toBeNull();
    expect(groupTitles).toEqual(["系统", "显示", "游戏", "鹰角操作模式", "快捷键", "其他", "调试"]);
    expect(groupDescriptions).toEqual([
      "语言、主题与全局界面偏好。",
      "图像输出与帧率表现相关设置。",
      "与游戏操作习惯和显示风格对齐的选项。",
      "与鹰角操作模式附加行为相关的选项。",
      "编辑当前可自定义的快捷键设置。",
      "调试和附加能力开关。",
      "FPS 与手势测试开关，可用于开发调试。",
    ]);
    expect(languageOptionLabels).toEqual(["中文(简体)", "English"]);
    expect(themeOptionLabels).toEqual(["Ayu Light", "Ayu Dark"]);
    expect(languageSelect?.value).toBe("zh-CN");
    expect(themeSelect?.value).toBe("ayu-light");
    expect(operationModeToggle?.checked).toBe(false);
    expect(operationModeToggle?.disabled).toBe(true);
    expect(immediateMoveToggle?.checked).toBe(true);
    expect(immediateMoveToggle?.disabled).toBe(true);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(true);
    expect(debugToggle?.checked).toBe(true);
    expect(showFpsToggle?.checked).toBe(true);
    expect(showGestureTestWindowToggle?.checked).toBe(true);

    const closeButton = container.querySelector(
      ".settings-dialog-close",
    ) as HTMLButtonElement | null;

    act(() => {
      closeButton?.click();
    });

    expect(container.querySelector(".settings-dialog")).toBeNull();
  });

  it("writes language changes into AppSettings and re-renders through mobx", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    expect(settingsButton).not.toBeNull();
    expect(settingsButton?.title).toBe("设置");

    act(() => {
      settingsButton?.click();
    });

    const languageSelect = container.querySelector(
      'select[name="system-language"]',
    ) as HTMLSelectElement | null;

    expect(languageSelect).not.toBeNull();
    expect(languageSelect?.value).toBe("zh-CN");
    expect(container.querySelector(".settings-dialog-header h2")?.textContent).toBe("设置");

    act(() => {
      if (languageSelect === null) {
        return;
      }

      languageSelect.value = "en-US";
      languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(appHost.state.settings.locale).toBe("en-US");
    expect(languageSelect?.value).toBe("en-US");
    expect(settingsButton?.title).toBe("Settings");
    expect(container.querySelector(".settings-dialog-header h2")?.textContent).toBe("Settings");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        locale: "en-US",
      }),
    );
  });

  it("writes theme changes into AppSettings and reapplies the document theme through mobx", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const themeSelect = container.querySelector(
      'select[name="system-theme"]',
    ) as HTMLSelectElement | null;

    expect(themeSelect).not.toBeNull();
    expect(themeSelect?.value).toBe("ayu-light");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-light");

    act(() => {
      if (themeSelect === null) {
        return;
      }

      themeSelect.value = "ayu-dark";
      themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(appHost.state.settings.themeId).toBe("ayu-dark");
    expect(themeSelect?.value).toBe("ayu-dark");
    expect(document.documentElement.dataset.appTheme).toBe("ayu-dark");
    expect(localStorage.getItem(WORKBENCH_STATE_LOCAL_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        themeId: "ayu-dark",
      }),
    );
  });

  it("writes immediate marquee changes into AppSettings and forces immediate move on", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: true,
        hypergryphImmediateMove: false,
        hypergryphImmediateMarquee: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;

    expect(immediateMoveToggle).not.toBeNull();
    expect(immediateMarqueeToggle).not.toBeNull();
    expect(immediateMoveToggle?.checked).toBe(false);
    expect(immediateMoveToggle?.disabled).toBe(false);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(false);

    const immediateMarqueeDescription = immediateMarqueeToggle
      ?.closest(".settings-dialog-setting-card")
      ?.querySelector(".settings-dialog-setting-copy p");

    expect(immediateMarqueeDescription?.textContent).toBe(
      "鼠标模式：从画布空白处开始拖动时，立即开始框选。\n触控模式：从画布空白处长按并拖动时，立即开始框选。\n开启该选项会强制打开立即移动。",
    );

    act(() => {
      if (immediateMarqueeToggle === null) {
        return;
      }

      immediateMarqueeToggle.click();
    });

    expect(appHost.state.settings.hypergryphImmediateMarquee).toBe(true);
    expect(immediateMarqueeToggle?.checked).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        hypergryphImmediateMove: false,
        hypergryphImmediateMarquee: true,
      }),
    );
  });

  it("writes debug settings into AppSettings storage without applying them to the UI", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const showFpsToggle = container.querySelector(
      'input[name="debug-show-fps"]',
    ) as HTMLInputElement | null;
    const showGestureTestWindowToggle = container.querySelector(
      'input[name="debug-show-gesture-diagnostics-window"]',
    ) as HTMLInputElement | null;

    expect(showFpsToggle).not.toBeNull();
    expect(showGestureTestWindowToggle).not.toBeNull();
    expect(showFpsToggle?.checked).toBe(false);
    expect(showGestureTestWindowToggle?.checked).toBe(false);

    act(() => {
      showFpsToggle?.click();
      showGestureTestWindowToggle?.click();
    });

    expect(appHost.state.settings.debugShowFps).toBe(true);
    expect(appHost.state.settings.debugShowGestureDiagnosticsWindow).toBe(true);
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS_STORAGE,
        debugShowFps: true,
        debugShowGestureDiagnosticsWindow: true,
      }),
    );
  });

  it("captures keybinding settings when operation mode is externally off and keeps the mode toggle disabled", () => {
    localStorage.setItem(
      APP_SETTINGS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: false,
      }),
    );

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      ".toolbar-rail-utility .rail-button:last-child",
    ) as HTMLButtonElement | null;

    act(() => {
      settingsButton?.click();
    });

    const operationModeToggle = container.querySelector(
      'input[name="game-arknights-operation-mode"]',
    ) as HTMLInputElement | null;
    const immediateMoveToggle = container.querySelector(
      'input[name="game-arknights-immediate-move"]',
    ) as HTMLInputElement | null;
    const immediateMarqueeToggle = container.querySelector(
      'input[name="game-arknights-immediate-marquee"]',
    ) as HTMLInputElement | null;
    const confirmShortcutButton = container.querySelector(
      'button[data-setting-id="shortcut-place-conveyor"]',
    ) as HTMLButtonElement | null;
    const cancelShortcutButton = container.querySelector(
      'button[data-setting-id="shortcut-place-pipe"]',
    ) as HTMLButtonElement | null;

    expect(operationModeToggle).not.toBeNull();
    expect(immediateMoveToggle).not.toBeNull();
    expect(immediateMarqueeToggle).not.toBeNull();
    expect(confirmShortcutButton).not.toBeNull();
    expect(cancelShortcutButton).not.toBeNull();
    expect(operationModeToggle?.checked).toBe(false);
    expect(operationModeToggle?.disabled).toBe(true);
    expect(immediateMoveToggle?.checked).toBe(true);
    expect(immediateMoveToggle?.disabled).toBe(true);
    expect(immediateMarqueeToggle?.checked).toBe(false);
    expect(immediateMarqueeToggle?.disabled).toBe(true);
    expect(confirmShortcutButton?.disabled).toBe(false);
    expect(confirmShortcutButton?.textContent).toBe("E");

    act(() => {
      confirmShortcutButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(confirmShortcutButton?.textContent).toBe("按任意键...");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    });

    expect(confirmShortcutButton?.textContent).toBe("P");
    expect(localStorage.getItem(USER_SETTINGS_DIALOG_LOCAL_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(APP_SETTINGS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        locale: "zh-CN",
        themeId: "ayu-light",
        hypergryphOperationMode: false,
      }),
    );
    expect(localStorage.getItem(APP_SHORTCUTS_LOCAL_STORAGE_KEY)).toBe(
      JSON.stringify({
        ...DEFAULT_APP_SHORTCUTS_STORAGE,
        [SHORTCUT_KEY.PLACE_CONVEYOR]: "P",
      }),
    );
  });

  it("hides the settings group sidebar in phone portrait mode while keeping the full settings list scrollable", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    const settingsButton = container.querySelector(
      'button[title="设置"]',
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");

    act(() => {
      settingsButton?.click();
    });

    const dialog = container.querySelector(".settings-dialog") as HTMLDivElement | null;
    const groupTitles = Array.from(
      dialog?.querySelectorAll(".settings-dialog-group-header h3") ?? [],
    ).map((element) => element.textContent);

    expect(dialog).not.toBeNull();
    expect(container.querySelector(".settings-dialog-sidebar")).toBeNull();
    expect(groupTitles).toEqual(["系统", "显示", "游戏", "鹰角操作模式", "快捷键", "其他", "调试"]);
  });
});
