// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
  };
}

describe("Mobile portrait gate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fullscreenElement: Element | null;
  let coarsePointer: boolean;
  let hoverNone: boolean;
  let standalone: boolean;

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

  const renderWorkbench = () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<WorkbenchApp appHost={appHost} />);
    });

    return appHost;
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fullscreenElement = null;
    coarsePointer = false;
    hoverNone = false;
    standalone = false;

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
          (query === "(hover: none)" && hoverNone) ||
          (query === "(display-mode: standalone)" && standalone),
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
  });

  it("shows the Apple PWA guide after an iPhone user clicks unsupported fullscreen", async () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });

    const appHost = renderWorkbench();
    const gate = container.querySelector(".mobile-portrait-gate");
    const fullscreenButton = container.querySelector(
      ".mobile-portrait-gate-fullscreen",
    ) as HTMLButtonElement | null;

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");
    expect(gate).not.toBeNull();
    expect(gate?.textContent).toContain("请旋转手机横屏使用");
    expect(fullscreenButton?.textContent).toContain("进入全屏");

    await act(async () => {
      fullscreenButton?.click();
    });

    expect(container.textContent).toContain("无法直接进入全屏");
    expect(container.textContent).toContain("添加到主屏幕");
    expect(container.textContent).toContain("作为 Web App 打开");

    const closeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "我知道了",
    );

    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      closeButton?.click();
    });

    expect(container.textContent).not.toContain("无法直接进入全屏");
    expect(document.activeElement).toBe(fullscreenButton);
  });

  it("hides the gate after rotation without automatically requesting fullscreen", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const appHost = renderWorkbench();

    expect(container.querySelector(".mobile-portrait-gate")).not.toBeNull();
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(0);

    setViewport({
      width: 844,
      height: 390,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
    });

    expect(appHost.state.screenProfile.deviceClass).toBe("mobile");
    expect(appHost.state.screenProfile.screenShape).toBe("landscape");
    expect(container.querySelector(".mobile-portrait-gate")).toBeNull();
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(0);
  });

  it("hides unsupported fullscreen controls in iPhone standalone mode", () => {
    coarsePointer = true;
    hoverNone = true;
    standalone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });

    renderWorkbench();

    expect(container.querySelector(".mobile-portrait-gate")).not.toBeNull();
    expect(container.querySelector(".mobile-portrait-gate-fullscreen")).toBeNull();
    expect(container.textContent).toContain("当前已在独立应用模式中");
  });

  it("keeps supported fullscreen controls in Android standalone mode", () => {
    coarsePointer = true;
    hoverNone = true;
    standalone = true;
    setViewport({
      width: 390,
      height: 844,
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 Chrome/136.0.0.0 Mobile Safari/537.36",
      maxTouchPoints: 5,
    });

    renderWorkbench();

    expect(container.querySelector(".mobile-portrait-gate-fullscreen")).not.toBeNull();
    expect(container.textContent).toContain("建议进入全屏");
  });

  it("keeps tablet portrait usable without the phone gate", () => {
    coarsePointer = true;
    hoverNone = true;
    setViewport({
      width: 820,
      height: 1180,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    });

    const appHost = renderWorkbench();

    expect(appHost.state.screenProfile.deviceClass).toBe("tablet");
    expect(appHost.state.screenProfile.screenShape).toBe("portrait");
    expect(container.querySelector(".mobile-portrait-gate")).toBeNull();
  });
});
