// @vitest-environment jsdom

import { WorkbenchApp } from "@/app-shell/workbench-app";
import { LEFT_PANEL_CONTENT } from "@/app-shell/workbench-placeholders";
import { createAppHost } from "@/app/app-host";
import { isPlacementInteractionMode } from "@/editor/contracts/interaction-mode";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import { createWorkbenchController as createWorkbenchControllerBase } from "@/workbench/controller/workbench-controller";
import { asLegacyWorkbenchController } from "@/tests/helpers/legacy-workbench-controller";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createWorkbenchController = (
  ...args: Parameters<typeof createWorkbenchControllerBase>
) => asLegacyWorkbenchController(createWorkbenchControllerBase(...args));

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
const LEFT_DOCK_BUTTON_DESCRIPTORS = LEFT_PANEL_CONTENT.placement.sections.flatMap(
  (section) => section.buttons,
);

async function renderWorkbenchApp() {
  const controller = createWorkbenchController();
  const appHost = createAppHost(controller);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(WorkbenchApp, {
        appHost,
      }),
    );
  });

  return {
    container,
    controller,
    root,
    appHost,
  };
}

async function disposeWorkbenchApp(options: {
  controller: ReturnType<typeof createWorkbenchController>;
  root: Root;
  appHost: ReturnType<typeof createAppHost>;
}) {
  await act(async () => {
    options.root.unmount();
  });
  options.appHost.dispose();
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

  it("hands keyboard focus to the canvas for every left-dock placement button", async () => {
    const app = await renderWorkbenchApp();
    const stage = app.container.querySelector(".canvas-stage");
    const dockButtons = Array.from(
      app.container.querySelectorAll(".placeholder-button-grid button"),
    ) as HTMLButtonElement[];
    const locale = app.controller.uiStore.locale;

    expect(stage).not.toBeNull();
    expect(dockButtons).toHaveLength(LEFT_DOCK_BUTTON_DESCRIPTORS.length);

    for (const [index, descriptor] of LEFT_DOCK_BUTTON_DESCRIPTORS.entries()) {
      if (!descriptor.definitionId) {
        continue;
      }

      const button = dockButtons[index];

      expect(button).toBeDefined();
      expect(button?.textContent).toContain(
        localizeWorkbenchText(locale, descriptor.label),
      );

      button?.focus();
      expect(document.activeElement).toBe(button ?? null);

      await act(async () => {
        button?.click();
      });

      expect(document.activeElement).toBe(stage ?? null);

      const armedMode = app.controller.editorStore.session.currentMode;
      expect(isPlacementInteractionMode(armedMode)).toBe(true);
      expect(
        isPlacementInteractionMode(armedMode) ? armedMode.definitionId : null,
      ).toBe(descriptor.definitionId);
      expect(
        isPlacementInteractionMode(armedMode) ? armedMode.rotation : null,
      ).toBe(0);

      await act(async () => {
        stage?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "r",
          }),
        );
      });

      const rotatedMode = app.controller.editorStore.session.currentMode;
      expect(isPlacementInteractionMode(rotatedMode)).toBe(true);
      expect(
        isPlacementInteractionMode(rotatedMode) ? rotatedMode.rotation : null,
      ).toBe(90);
    }

    await disposeWorkbenchApp(app);
  });
});