// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import type { GestureEvent } from "@/app/input/gesture/adapter";
import { CanvasPanel } from "@/app/shell/canvas/canvas-panel";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
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

function enableGestureDiagnosticsWindow(appHost: ReturnType<typeof createAppHost>) {
  runInAction(() => {
    appHost.internalState.settings.debugShowGestureDiagnosticsWindow = true;
  });
}

describe("CanvasPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
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

  it("routes canvas surface pointer input through the canvas-panel gesture adapter", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const gestures: GestureEvent[] = [];
    appHost.gestureAdapter.subscribe((event) => gestures.push(event));
    enableGestureDiagnosticsWindow(appHost);

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
        clientX: 18,
        clientY: 10,
        buttons: 1,
      });
      dispatchPointerEvent(viewportSurface, "pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 18,
        clientY: 10,
        buttons: 0,
      });
    });

    expect(gestures.map((event) => event.type)).toEqual([
      "mouse dragstart",
      "mouse dragend",
    ]);
    expect(container.querySelector(".canvas-gesture-diagnostics")?.textContent).toContain(
      "mouse dragend",
    );
  });

  it("collapses and expands diagnostics without routing toggle input into the gesture adapter", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    enableGestureDiagnosticsWindow(appHost);

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    const diagnostics = container.querySelector(
      ".canvas-gesture-diagnostics",
    ) as HTMLElement | null;
    const toggleButton = container.querySelector(
      ".canvas-gesture-diagnostics-toggle",
    ) as HTMLButtonElement | null;

    expect(diagnostics).not.toBeNull();
    expect(toggleButton).not.toBeNull();
    expect(toggleButton?.getAttribute("aria-expanded")).toBe("true");

    if (!diagnostics || !toggleButton) {
      throw new Error("Canvas diagnostics toggle did not render.");
    }

    act(() => {
      dispatchPointerEvent(toggleButton, "pointerdown", {
        pointerId: 31,
        pointerType: "mouse",
        clientX: 12,
        clientY: 12,
        buttons: 1,
      });
      dispatchPointerEvent(toggleButton, "pointerup", {
        pointerId: 31,
        pointerType: "mouse",
        clientX: 12,
        clientY: 12,
        buttons: 0,
      });
      toggleButton.click();
    });

    expect(appHost.gestureDiagnostics.getSnapshot().latestEvent).toBeNull();
    expect(diagnostics.classList.contains("is-collapsed")).toBe(true);
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".canvas-gesture-diagnostics-grid")).toBeNull();
    expect(container.querySelector(".canvas-gesture-diagnostics-events")).toBeNull();

    act(() => {
      toggleButton.click();
    });

    expect(diagnostics.classList.contains("is-collapsed")).toBe(false);
    expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".canvas-gesture-diagnostics-grid")).not.toBeNull();
    expect(container.querySelector(".canvas-gesture-diagnostics-events")).not.toBeNull();
  });

  it("shows pointer entity id in the diagnostics window", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    enableGestureDiagnosticsWindow(appHost);

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    act(() => {
      appHost.gestureDiagnostics.recordGesture({
        type: "mouse tap",
        gestureId: "gesture-entity-1",
        button: 0,
        buttons: 0,
        position: { x: 24, y: 40 },
        longPress: false,
        pointerEntity: createPointerEntity("dummy-entity-9"),
        modifiers: {
          alt: false,
          ctrl: false,
          meta: false,
          shift: false,
        },
        sourceEvent: null,
      });
    });

    expect(container.querySelector(".canvas-gesture-diagnostics")?.textContent).toContain(
      "dummy-entity-9",
    );
  });

  it("shows and hides diagnostics window from app settings", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    runInAction(() => {
      appHost.internalState.settings.debugShowGestureDiagnosticsWindow = false;
    });

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    expect(container.querySelector(".canvas-gesture-diagnostics")).toBeNull();

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.debugShowGestureDiagnosticsWindow = true;
      });
    });

    expect(container.querySelector(".canvas-gesture-diagnostics")).not.toBeNull();

    act(() => {
      runInAction(() => {
        appHost.internalState.settings.debugShowGestureDiagnosticsWindow = false;
      });
    });

    expect(container.querySelector(".canvas-gesture-diagnostics")).toBeNull();
  });

  it("pans the editor viewport on middle mouse drag", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);
    const editorHost = createEditorHost(workspace);
    const moveViewportSpy = vi.spyOn(
      editorHost.actions,
      "moveViewportByClientPixelVector",
    );
    enableGestureDiagnosticsWindow(appHost);

    editorHost.actions.setViewportClientRect({
      left: 100,
      top: 50,
      width: 640,
      height: 480,
    });

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    const viewportSurface = container.querySelector(
      ".canvas-viewport-surface",
    ) as HTMLDivElement | null;

    expect(viewportSurface).not.toBeNull();

    if (!viewportSurface) {
      throw new Error("Canvas viewport surface did not render.");
    }

    const pointerDownEventRef: { current: Event | null } = { current: null };

    act(() => {
      pointerDownEventRef.current = dispatchPointerEvent(viewportSurface, "pointerdown", {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 120,
        clientY: 80,
        button: 1,
        buttons: 4,
      });
      dispatchPointerEvent(viewportSurface, "pointermove", {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 136,
        clientY: 64,
        buttons: 4,
      });
      dispatchPointerEvent(viewportSurface, "pointerup", {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 136,
        clientY: 64,
        button: 1,
        buttons: 0,
      });
    });

    expect(moveViewportSpy).toHaveBeenCalledWith({
      startClientPixel: {
        x: 120,
        y: 80,
      },
      endClientPixel: {
        x: 136,
        y: 64,
      },
    });
    expect(editorHost.state.viewport.center.x).toBeCloseTo(-1);
    expect(editorHost.state.viewport.center.y).toBeCloseTo(1);
    expect(container.querySelector(".canvas-gesture-diagnostics")?.textContent).toContain(
      "mouse dragend",
    );
  });

  it("positions the long press indicator above and left of the touch point", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    act(() => {
      root.render(<CanvasPanel appHost={appHost} />);
    });

    const viewportSurface = container.querySelector(
      ".canvas-viewport-surface",
    ) as HTMLDivElement | null;

    expect(viewportSurface).not.toBeNull();

    if (!viewportSurface) {
      throw new Error("Canvas viewport surface did not render.");
    }

    act(() => {
      dispatchPointerEvent(viewportSurface, "pointerdown", {
        pointerId: 12,
        pointerType: "touch",
        clientX: 4,
        clientY: 4,
        buttons: 1,
      });
    });

    expect(container.querySelector(".canvas-touch-hold-indicator")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const indicator = container.querySelector(
      ".canvas-touch-hold-indicator",
    ) as HTMLDivElement | null;

    expect(indicator).not.toBeNull();
    expect(indicator?.style.left).toBe("-8px");
    expect(indicator?.style.top).toBe("-8px");
  });
});

function createPointerEntity(id: string): WorldEntity {
  return {
    id,
    definitionId: "belt_straight_1x1",
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}
