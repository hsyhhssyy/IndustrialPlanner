// @vitest-environment jsdom

import { action, observable } from "mobx";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { BottomStatusBar } from "@/app/shell/layout/bottom-status-bar";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { resolveScreenProfileFromWindow } from "@/shared/browser/screen-profile";

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

describe("BottomStatusBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let coarsePointer: boolean;
  let hoverNone: boolean;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    coarsePointer = false;
    hoverNone = false;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      writable: true,
      value: 1,
    });

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    });

    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps only device and screen icons on the right side while left side holds text", () => {
    const workspace = createWorkspace();
    const editorState = observable({
      viewport: {
        gridSize: 1,
      },
    });
    const setGridSize = action((value: number) => {
      editorState.viewport.gridSize = value;
    });
    workspace.editor = {
      state: editorState,
    } as unknown as WorkspaceContract["editor"];
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<BottomStatusBar appHost={appHost} />);
    });

    const leftGroup = container.querySelector(
      ".status-bar-group-left",
    ) as HTMLDivElement | null;
    const rightGroup = container.querySelector(
      ".status-bar-group-right",
    ) as HTMLDivElement | null;

    expect(leftGroup).not.toBeNull();
    expect(rightGroup).not.toBeNull();

    if (!leftGroup || !rightGroup) {
      throw new Error("Bottom status bar groups were not rendered.");
    }

    expect(leftGroup.textContent).toContain("工具:select");
    expect(leftGroup.textContent).toContain("缩放: 100%");
    expect(leftGroup.textContent).not.toContain("集成工业仿真");
    expect(leftGroup.textContent).not.toContain("语言: 中文");
    expect(leftGroup.textContent).not.toContain("当前视图: 左侧面板");

    act(() => {
      appHost.internalActions.setActiveTool("move");
      setGridSize(1.25);
    });

    expect(leftGroup.textContent).toContain("工具:move");
    expect(leftGroup.textContent).toContain("缩放: 125%");

    const icons = rightGroup.querySelectorAll(".status-bar-icon-chip");

    expect(icons).toHaveLength(2);
    expect(rightGroup.querySelectorAll(".status-chip")).toHaveLength(0);
    expect((icons[0] as HTMLSpanElement).title).toBe("电脑");
    expect((icons[1] as HTMLSpanElement).title).toBe("横屏");

    coarsePointer = true;
    hoverNone = true;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 820,
    });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 1180,
    });

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    });

    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });

    act(() => {
      appHost.internalActions.setScreenProfile(resolveScreenProfileFromWindow());
    });

    const updatedIcons = rightGroup.querySelectorAll(".status-bar-icon-chip");

    expect((updatedIcons[0] as HTMLSpanElement).title).toBe("平板");
    expect((updatedIcons[1] as HTMLSpanElement).title).toBe("竖屏");
  });
});
