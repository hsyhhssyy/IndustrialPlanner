// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/app-host";
import { WORKBENCH_STATE_LOCAL_STORAGE_KEY } from "@/app/storage-hook";
import { WorkbenchApp } from "@/app/app-shell/workbench-app";
import { MOBILE_LEFT_DOCK_WIDTH } from "@/app/state-impl";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
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
    expect(container.textContent).toContain("设备: 电脑");
    expect(container.textContent).toContain("屏幕: 横屏");

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
    expect(container.textContent).toContain("设备: 平板");
    expect(container.textContent).toContain("屏幕: 竖屏");
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
        themeId: "ayu-dark",
      }),
    );

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
    expect(container.querySelector(".workbench-floating-top-bar-controls")).toBeNull();
    expect(container.querySelector(".top-bar")).not.toBeNull();
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
});
