// @vitest-environment jsdom

import { WorkbenchApp } from "@/app-shell/workbench-app";
import { createWorkbenchShell } from "@/app-shell/workbench-shell";
import { isPlacementInteractionMode } from "@/editor/contracts/interaction-mode";
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
            width: 1280,
            height: 720,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

const OriginalResizeObserver = globalThis.ResizeObserver;

async function renderWorkbenchApp() {
  const controller = createWorkbenchController();
  const shell = createWorkbenchShell(controller);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(WorkbenchApp, {
        shell,
      }),
    );
  });

  return {
    container,
    controller,
    root,
    shell,
  };
}

async function disposeWorkbenchApp(options: {
  controller: ReturnType<typeof createWorkbenchController>;
  root: Root;
  shell: ReturnType<typeof createWorkbenchShell>;
}) {
  await act(async () => {
    options.root.unmount();
  });
  options.shell.dispose();
  options.controller.dispose();
}

describe("WorkbenchApp context menu policy", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: OriginalResizeObserver,
      writable: true,
    });
  });

  it("prevents the browser context menu across the workbench surface", async () => {
    const app = await renderWorkbenchApp();
    const workbench = app.container.querySelector(".workbench");
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      workbench?.dispatchEvent(contextMenuEvent);
    });

    expect(contextMenuEvent.defaultPrevented).toBe(true);

    await disposeWorkbenchApp(app);
  });

  it("moves keyboard focus to the canvas after arming placement from the left dock", async () => {
    const app = await renderWorkbenchApp();
    const stage = app.container.querySelector(".canvas-stage");
    const beltButton = Array.from(
      app.container.querySelectorAll(".placeholder-button-grid button"),
    ).find((button) => button.textContent?.includes("铺设传送带"));

    expect(stage).not.toBeNull();
    expect(beltButton).toBeDefined();

    (beltButton as HTMLButtonElement | undefined)?.focus();
    expect(document.activeElement).toBe(beltButton ?? null);

    await act(async () => {
      (beltButton as HTMLButtonElement | undefined)?.click();
    });

    expect(document.activeElement).toBe(stage ?? null);

    await act(async () => {
      stage?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "r",
        }),
      );
    });

    const currentMode = app.controller.editorStore.session.currentMode;
    expect(isPlacementInteractionMode(currentMode)).toBe(true);
    expect(
      isPlacementInteractionMode(currentMode) ? currentMode.rotation : null,
    ).toBe(90);

    await disposeWorkbenchApp(app);
  });
});