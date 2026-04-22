// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/app-host";
import type { GestureEvent } from "@/app/input/gesture-adapter";
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
): void {
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
    const setViewportClientRectSpy = vi.spyOn(
      editorHost.actions,
      "setViewportClientRect",
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
    vi.spyOn(viewportSurface, "getBoundingClientRect").mockReturnValue(
      createContentRect(640, 480),
    );

    act(() => {
      resizeObserver.emit(viewportSurface, {
        width: 640,
        height: 480,
      });
    });

    expect(setViewportClientRectSpy).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      width: 640,
      height: 480,
    });
    expect(editorHost.state.viewport.clientRect.left).toBe(0);
    expect(editorHost.state.viewport.clientRect.top).toBe(0);
    expect(editorHost.state.viewport.clientRect.width).toBe(640);
    expect(editorHost.state.viewport.clientRect.height).toBe(480);
  });

  it("routes canvas surface input through the canvas-panel gesture adapter", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    const canvasPanel = container.querySelector(".canvas-panel") as HTMLElement | null;
    const viewportSurface = container.querySelector(
      ".canvas-viewport-surface",
    ) as HTMLDivElement | null;

    expect(canvasPanel).not.toBeNull();
    expect(viewportSurface).not.toBeNull();

    if (!canvasPanel || !viewportSurface) {
      throw new Error("Canvas panel did not render.");
    }

    act(() => {
      dispatchPointerEvent(viewportSurface, "pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 10,
        clientY: 10,
        buttons: 1,
      });
      dispatchPointerEvent(viewportSurface, "pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 14,
        clientY: 10,
        buttons: 1,
      });
      dispatchPointerEvent(viewportSurface, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 14,
        clientY: 10,
        buttons: 0,
      });
      canvasPanel.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "KeyA",
          key: "a",
        }),
      );
    });

    expect(gestures.map((event) => event.type)).toEqual([
      "mouse dragstart",
      "mouse dragend",
    ]);
    expect(appHost.gestureAdapter.getKeyboardSnapshot().pressedKeys.has("KeyA")).toBe(true);
  });
});
