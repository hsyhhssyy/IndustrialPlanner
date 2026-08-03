// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { PwaController } from "@/app/pwa/pwa-controller";
import { SettingsDialog } from "@/app/shell/dialogs/settings-dialog";
import { WorkbenchSettingsDialogController } from "@/app/shell/state/settings-dialog-state";
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

describe("SettingsDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToDescriptor: PropertyDescriptor | undefined;
  let scrollIntoViewDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

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
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    localStorage.clear();

    if (scrollToDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }

    if (scrollIntoViewDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("scrolls only the settings content container when selecting a group", () => {
    const appHost = createAppHost(createWorkspace());
    const controller = new WorkbenchSettingsDialogController();
    const scrollToMock = vi.fn(function(this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === "object" && typeof options.top === "number") {
        this.scrollTop = options.top;
      }
    });
    const scrollIntoViewMock = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.classList.contains("settings-dialog-content")) {
        return DOMRect.fromRect({ x: 0, y: 100, width: 360, height: 400 });
      }

      if (this.id === "settings-dialog-group-display-system") {
        return DOMRect.fromRect({ x: 0, y: 100, width: 340, height: 120 });
      }

      // AI-REMOVED 2026-08-03:
      // Reason: 通用设置页不再存在 shortcuts 分组。
      // Trigger: ST2-RQ-002 独立快捷键设置对话框。
      // Evidence: 滚动容器测试改用 game 分组。
      // Replacement: 下方 settings-dialog-group-game 分支。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (this.id === "settings-dialog-group-shortcuts") {
      if (this.id === "settings-dialog-group-game") {
        return DOMRect.fromRect({ x: 0, y: 460, width: 340, height: 120 });
      }

      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });

    act(() => {
      root.render(
        <SettingsDialog
          appHost={appHost}
          controller={controller}
          pwaController={new PwaController()}
        />,
      );
    });

    act(() => {
      appHost.internalActions.openDialog("settings");
    });

    const contentElement = container.querySelector(".settings-dialog-content");
    const gameButton = container.querySelector('[aria-controls="settings-dialog-group-game"]');

    expect(contentElement).not.toBeNull();
    expect(gameButton).not.toBeNull();

    if (!(contentElement instanceof HTMLDivElement)) {
      throw new Error("Expected settings dialog content element to be rendered.");
    }

    if (!(gameButton instanceof HTMLButtonElement)) {
      throw new Error("Expected game group button to be rendered.");
    }

    contentElement.scrollTop = 25;
    scrollToMock.mockClear();
    scrollIntoViewMock.mockClear();

    act(() => {
      gameButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith({ top: 375 });
  });

  it("replaces the shortcuts group with a game-section entry that opens the dedicated dialog", () => {
    const appHost = createAppHost(createWorkspace());
    const controller = new WorkbenchSettingsDialogController();

    act(() => {
      root.render(
        <SettingsDialog
          appHost={appHost}
          controller={controller}
          pwaController={new PwaController()}
        />,
      );
    });

    act(() => {
      appHost.internalActions.openDialog("settings");
    });

    expect(container.querySelector('[aria-controls="settings-dialog-group-shortcuts"]')).toBeNull();

    const openButton = [...container.querySelectorAll("button")].find((button) => (
      button.textContent === "打开快捷键设置"
    ));
    expect(openButton).toBeDefined();
    expect(openButton?.closest("article")?.querySelector("p")).toBeNull();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const shortcutDialog = document.querySelector('[data-dialog-key="keyboard-shortcut-settings"]');
    expect(shortcutDialog).not.toBeNull();
    expect(shortcutDialog?.querySelectorAll('[data-shortcut-id="shortcut-pan-viewport-up"]')).toHaveLength(2);

    const panUpImages = shortcutDialog?.querySelectorAll(
      '[data-shortcut-id="shortcut-pan-viewport-up"] img',
    );
    expect(panUpImages).toHaveLength(2);
    expect([...panUpImages ?? []].map((image) => image.getAttribute("src"))).toEqual([
      "/input-prompts/keyboard_w_outline.svg",
      "/input-prompts/keyboard_arrow_up_outline.svg",
    ]);

    const saveBlueprintSlot = shortcutDialog?.querySelector<HTMLButtonElement>(
      '[data-shortcut-id="shortcut-save-blueprint"][data-slot-index="0"]',
    );
    expect(saveBlueprintSlot?.querySelectorAll("img")).toHaveLength(2);
    expect(saveBlueprintSlot?.textContent).toBe("+");
    const saveBlueprintImages = saveBlueprintSlot?.querySelectorAll("img");
    expect(Number(saveBlueprintImages?.item(0).parentElement?.style.getPropertyValue(
      "--keyboard-shortcut-prompt-scale",
    ))).toBeCloseTo(4 / 3);
    expect(Number(saveBlueprintImages?.item(1).parentElement?.style.getPropertyValue(
      "--keyboard-shortcut-prompt-scale",
    ))).toBe(1);

    const panUpSlots = shortcutDialog?.querySelectorAll<HTMLButtonElement>(
      '[data-shortcut-id="shortcut-pan-viewport-up"]',
    );
    const secondPanUpSlot = panUpSlots?.item(1);
    expect(secondPanUpSlot).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      secondPanUpSlot?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyI",
        key: "i",
      }));
    });

    expect(appHost.internalActions.getKeyboardShortcutFor("shortcut-pan-viewport-up")).toBe("W;I");
    expect(secondPanUpSlot?.querySelector("img")?.getAttribute("src")).toBe(
      "/input-prompts/keyboard_i_outline.svg",
    );

    const secondRotateSlot = shortcutDialog?.querySelectorAll<HTMLButtonElement>(
      '[data-shortcut-id="shortcut-rotate"]',
    ).item(1);
    act(() => {
      secondRotateSlot?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyE",
        key: "e",
      }));
    });

    const conflictDialog = document.querySelector('[data-dialog-key="keyboard-shortcut-conflict"]');
    expect(conflictDialog).not.toBeNull();
    expect(conflictDialog?.querySelector('img[data-key-token="E"]')).not.toBeNull();
    const replaceButton = [...conflictDialog?.querySelectorAll("button") ?? []].find((button) => (
      button.textContent === "更换"
    ));
    act(() => {
      replaceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(appHost.internalActions.getKeyboardShortcutFor("shortcut-place-conveyor")).toBe("");
    expect(appHost.internalActions.getKeyboardShortcutFor("shortcut-rotate")).toBe("R;E");
  });
});
