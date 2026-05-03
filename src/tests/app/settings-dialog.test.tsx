// @vitest-environment jsdom

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost } from "@/app/host/app-host";
import { SettingsDialog } from "@/app/shell/dialogs/settings-dialog";
import { WorkbenchSettingsDialogController } from "@/app/shell/state/settings-dialog-state";
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

      if (this.id === "settings-dialog-group-system") {
        return DOMRect.fromRect({ x: 0, y: 100, width: 340, height: 120 });
      }

      if (this.id === "settings-dialog-group-shortcuts") {
        return DOMRect.fromRect({ x: 0, y: 460, width: 340, height: 120 });
      }

      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });

    act(() => {
      root.render(<SettingsDialog appHost={appHost} controller={controller} />);
    });

    act(() => {
      appHost.internalActions.openDialog("settings");
    });

    const contentElement = container.querySelector(".settings-dialog-content");
    const shortcutsButton = container.querySelector('[aria-controls="settings-dialog-group-shortcuts"]');

    expect(contentElement).not.toBeNull();
    expect(shortcutsButton).not.toBeNull();

    if (!(contentElement instanceof HTMLDivElement)) {
      throw new Error("Expected settings dialog content element to be rendered.");
    }

    if (!(shortcutsButton instanceof HTMLButtonElement)) {
      throw new Error("Expected shortcuts group button to be rendered.");
    }

    contentElement.scrollTop = 25;
    scrollToMock.mockClear();
    scrollIntoViewMock.mockClear();

    act(() => {
      shortcutsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith({ top: 375 });
  });
});