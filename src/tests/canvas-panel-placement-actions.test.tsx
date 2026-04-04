// @vitest-environment jsdom

import { CanvasPanel } from "@/app-shell/components/canvas-panel/canvas-panel";
import { createWorkbenchShell } from "@/app-shell/workbench-shell";
import { createWorkbenchController } from "@/workbench/controller/workbench-controller";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/host/renderer-host", () => ({
  RendererHost: () => null,
}));

class MockResizeObserver {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    this.#callback(
      [
        {
          target,
          contentRect: {
            width: 640,
            height: 360,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

class MockPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const OriginalResizeObserver = globalThis.ResizeObserver;
const OriginalPointerEvent = globalThis.PointerEvent;

async function renderCanvasPanel(
  controller: ReturnType<typeof createWorkbenchController>,
): Promise<{
  container: HTMLDivElement;
  root: Root;
  shell: ReturnType<typeof createWorkbenchShell>;
}> {
  const shell = createWorkbenchShell(controller);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(CanvasPanel, {
        controller,
        renderDerivedStore: shell.workspaceDerivedStore.renderStore,
      }),
    );
  });

  return {
    container,
    root,
    shell,
  };
}

async function disposeCanvasPanel(options: {
  root: Root;
  shell: ReturnType<typeof createWorkbenchShell>;
  controller: ReturnType<typeof createWorkbenchController>;
}) {
  await act(async () => {
    options.root.unmount();
  });
  options.shell.dispose();
  options.controller.dispose();
}

describe("CanvasPanel placement actions", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
      writable: true,
    });
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: MockPointerEvent,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: OriginalResizeObserver,
      writable: true,
    });
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: OriginalPointerEvent,
      writable: true,
    });
  });

  it("rotates armed pointer placement on R and cancels it on right click", async () => {
    const controller = createWorkbenchController();
    controller.armPlacement("belt_straight_1x1", "belt");
    const { container, root, shell } = await renderCanvasPanel(controller);
    const stage = container.querySelector(".canvas-stage");
    const viewport = container.querySelector(".canvas-viewport-surface");

    expect(stage).not.toBeNull();
    expect(viewport).not.toBeNull();

    await act(async () => {
      stage?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "r",
        }),
      );
    });

    expect(controller.editorStore.getSnapshot().session.placementRotation).toBe(90);

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      viewport?.dispatchEvent(contextMenuEvent);
    });

    expect(contextMenuEvent.defaultPrevented).toBe(true);

    await act(async () => {
      viewport?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 2,
          buttons: 2,
          clientX: 40,
          clientY: 24,
          pointerId: 7,
          pointerType: "mouse",
        }),
      );
    });

    expect(controller.editorStore.getSnapshot().session.activeTool).toBe("select");
    expect(
      controller.editorStore.getSnapshot().session.placementDefinitionId,
    ).toBeNull();

    await disposeCanvasPanel({ root, shell, controller });
  });

  it("renders touch placement toolbar rotate/cancel actions next to confirm", async () => {
    const controller = createWorkbenchController();
    controller.setCanvasViewportSize({ x: 640, y: 360 });
    controller.armPlacement("belt_straight_1x1", "belt", "anchored-confirm");
    const { container, root, shell } = await renderCanvasPanel(controller);
    const buttonLabels = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".placement-action-button"),
    ).map((button) => button.textContent);
    const rotateButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".placement-action-button"),
    ).find((button) => button.textContent === "旋转");
    const cancelButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".placement-action-button"),
    ).find((button) => button.textContent === "取消");

    expect(buttonLabels).toEqual(["旋转", "取消", "确认放置"]);

    await act(async () => {
      rotateButton?.click();
    });

    expect(controller.editorStore.getSnapshot().session.placementPreview).toMatchObject({
      strategy: "anchored-confirm",
      rotation: 90,
    });

    await act(async () => {
      cancelButton?.click();
    });

    expect(controller.editorStore.getSnapshot().session.activeTool).toBe("select");
    expect(container.querySelector(".placement-action-toolbar")).toBeNull();

    await disposeCanvasPanel({ root, shell, controller });
  });
});
