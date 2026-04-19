// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/app-host";
import { CanvasPanel } from "@/app/app-shell/components/canvas-panel";
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

function createContentRect(width: number, height: number): DOMRectReadOnly {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRectReadOnly;
}

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly observedElements = new Set<Element>();

  public constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe = (target: Element) => {
    this.observedElements.add(target);
  };

  unobserve = (target: Element) => {
    this.observedElements.delete(target);
  };

  disconnect = () => {
    this.observedElements.clear();
  };

  emit(target: Element, size: { width: number; height: number }) {
    this.callback(
      [
        {
          target,
          contentRect: createContentRect(size.width, size.height),
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

describe("CanvasPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    vi.unstubAllGlobals();
  });

  it("dispatches viewport resize through editor actions", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const editorHost = createEditorHost(workspace);
    const setViewportPixelSizeSpy = vi.spyOn(
      editorHost.actions,
      "setViewportPixelSize",
    );

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    const viewportSurface = container.querySelector(
      ".canvas-viewport-surface",
    ) as HTMLDivElement | null;
    const resizeObserver = ResizeObserverMock.instances[0];

    expect(viewportSurface).not.toBeNull();
    expect(resizeObserver).toBeDefined();

    if (!viewportSurface || !resizeObserver) {
      throw new Error("Canvas viewport resize observer was not initialized.");
    }

    expect(resizeObserver.observedElements.has(viewportSurface)).toBe(true);

    Object.defineProperty(viewportSurface, "clientWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(viewportSurface, "clientHeight", {
      configurable: true,
      value: 480,
    });

    act(() => {
      resizeObserver.emit(viewportSurface, {
        width: 640,
        height: 480,
      });
    });

    expect(setViewportPixelSizeSpy).toHaveBeenCalledWith({
      width: 640,
      height: 480,
    });
    expect(editorHost.state.viewport.pixelSize.width).toBe(640);
    expect(editorHost.state.viewport.pixelSize.height).toBe(480);
  });
});