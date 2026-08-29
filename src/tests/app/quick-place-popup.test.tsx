// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { canPlaceEntityDefinitionInBase } from "@/app/placement-zone-availability";
import { buildQuickPlaceDeviceEntries } from "@/app/quick-place";
import { QuickPlacePopup } from "@/app/shell/quick-place/quick-place-popup";
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

function dispatchPointerDown(target: Element): void {
  target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
}

function dispatchInput(target: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  descriptor?.set?.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
}

function dispatchKeyDown(
  target: Element,
  options: {
    readonly key: string;
    readonly code: string;
    readonly isComposing?: boolean;
  },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: options.code,
    key: options.key,
  });

  if (options.isComposing === true) {
    Object.defineProperty(event, "isComposing", { value: true });
  }
  target.dispatchEvent(event);
  return event;
}

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();

  return {
    clearData(format?: string) {
      if (format === undefined) {
        data.clear();
      } else {
        data.delete(format);
      }
    },
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [] as unknown as FileList,
    getData(format: string) {
      return data.get(format) ?? "";
    },
    items: [] as unknown as DataTransferItemList,
    setData(format: string, value: string) {
      data.set(format, value);
    },
    setDragImage() {},
    get types() {
      return Array.from(data.keys());
    },
  } as DataTransfer;
}

function dispatchDragEvent(
  target: Element,
  type: string,
  dataTransfer: DataTransfer,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    clientX: { value: 0 },
    clientY: { value: 0 },
    dataTransfer: { value: dataTransfer },
    relatedTarget: { value: null },
  });
  target.dispatchEvent(event);
}

describe("QuickPlacePopup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let appHost: AppHost;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    appHost = createAppHost(createWorkspace());

    runInAction(() => {
      appHost.internalState.runtime.quickPlace.visible = true;
      appHost.internalState.runtime.quickPlace.anchor = { x: 120, y: 80 };
      appHost.internalState.runtime.quickPlace.openSource = "pointer";
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    appHost.dispose();
    container.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps pointer-opened search unfocused and blurs it before interacting outside the input", () => {
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input") as HTMLInputElement | null;
    const deviceButton = container.querySelector(".quick-place-device-button");
    const emptyFavoriteSlot = container.querySelector(".quick-place-favorite-slot.is-empty");

    expect(searchInput).not.toBeNull();
    expect(deviceButton).not.toBeNull();
    expect(emptyFavoriteSlot).not.toBeNull();
    expect(document.activeElement).not.toBe(searchInput);

    act(() => {
      searchInput?.focus();
      dispatchInput(searchInput!, deviceButton?.getAttribute("title") ?? "");
    });
    expect(document.activeElement).toBe(searchInput);

    const filteredDeviceButton = container.querySelector(".quick-place-device-button");
    expect(filteredDeviceButton).not.toBeNull();

    act(() => {
      dispatchPointerDown(filteredDeviceButton!);
    });
    expect(document.activeElement).not.toBe(searchInput);

    act(() => {
      searchInput?.focus();
      dispatchPointerDown(emptyFavoriteSlot!);
    });
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("focuses search when opened by the keyboard shortcut", () => {
    runInAction(() => {
      appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    expect(document.activeElement).toBe(searchInput);
  });

  it("navigates filtered results without moving input focus and selects the active result with Enter", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    runInAction(() => {
      appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input") as HTMLInputElement | null;
    const resultButtons = Array.from(
      container.querySelectorAll(".quick-place-device-button"),
    ) as HTMLButtonElement[];
    expect(searchInput).not.toBeNull();
    expect(resultButtons.length).toBeGreaterThan(1);

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
    });
    expect(resultButtons[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
    });
    expect(resultButtons[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(searchInput);

    act(() => {
      dispatchKeyDown(searchInput!, { code: "Enter", key: "Enter" });
    });
    expect(handleMouseTap).toHaveBeenCalledOnce();
    expect(container.querySelector(".quick-place-popup")).toBeNull();
  });

  it("clamps result navigation, resets the active result after search changes, and ignores empty-result Enter", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    runInAction(() => {
      appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input") as HTMLInputElement | null;
    let resultButtons = Array.from(
      container.querySelectorAll(".quick-place-device-button"),
    ) as HTMLButtonElement[];
    const lastResult = resultButtons.at(-1);
    expect(searchInput).not.toBeNull();
    expect(lastResult).toBeDefined();

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowUp", key: "ArrowUp" });
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
    });
    expect(lastResult?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      dispatchInput(searchInput!, "pipe");
    });
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();

    act(() => {
      dispatchKeyDown(searchInput!, { code: "ArrowDown", key: "ArrowDown" });
      dispatchKeyDown(searchInput!, { code: "ArrowUp", key: "ArrowUp" });
    });
    resultButtons = Array.from(
      container.querySelectorAll(".quick-place-device-button"),
    ) as HTMLButtonElement[];
    expect(resultButtons[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => {
      dispatchInput(searchInput!, "__no_quick_place_result__");
    });
    act(() => {
      dispatchKeyDown(searchInput!, { code: "Enter", key: "Enter" });
    });
    expect(container.querySelector(".quick-place-empty-results")).not.toBeNull();
    expect(container.querySelector(".quick-place-popup")).not.toBeNull();
    expect(handleMouseTap).not.toHaveBeenCalled();
  });

  it("selects the first filtered result with Enter when no result was explicitly activated", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    const firstEntry = buildQuickPlaceDeviceEntries({
      definitions: appHost.workspace.registry.entityDefinitions,
      translate: appHost.actions.translate,
      canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, null),
    })[0];
    runInAction(() => {
      appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    expect(firstEntry).toBeDefined();
    act(() => {
      dispatchKeyDown(searchInput!, { code: "Enter", key: "Enter" });
    });

    expect(handleMouseTap).toHaveBeenCalledWith(expect.objectContaining({
      uiButtonId: `ui-left-dock-placement-mode-${firstEntry?.id}-mouse-tap`,
    }));
  });

  it("prioritizes occupied numeric favorites and leaves empty numeric slots unconsumed", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    const firstEntry = buildQuickPlaceDeviceEntries({
      definitions: appHost.workspace.registry.entityDefinitions,
      translate: appHost.actions.translate,
      canUseDefinition: (definition) => canPlaceEntityDefinitionInBase(appHost, definition, null),
    })[0];
    expect(firstEntry).toBeDefined();
    runInAction(() => {
      appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
      appHost.internalState.workbench.quickPlaceFavoriteEntityIds = [firstEntry!.id];
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    let occupiedEvent!: KeyboardEvent;
    act(() => {
      occupiedEvent = dispatchKeyDown(searchInput!, { code: "Digit1", key: "1" });
    });
    expect(occupiedEvent.defaultPrevented).toBe(true);
    expect(handleMouseTap).toHaveBeenCalledOnce();

    act(() => {
      runInAction(() => {
        appHost.internalState.runtime.quickPlace.visible = true;
        appHost.internalState.runtime.quickPlace.anchor = { x: 120, y: 80 };
        appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
        appHost.internalState.workbench.quickPlaceFavoriteEntityIds = [];
      });
    });
    const reopenedSearchInput = container.querySelector(".quick-place-search-input");
    let emptyEvent!: KeyboardEvent;
    act(() => {
      emptyEvent = dispatchKeyDown(reopenedSearchInput!, { code: "Digit1", key: "1" });
    });
    expect(emptyEvent.defaultPrevented).toBe(false);
  });

  it("does not navigate or select results while an input method is composing", () => {
    const handleMouseTap = vi.spyOn(appHost.gestureAdapter, "handleUiButtonMouseTap");
    runInAction(() => {
      appHost.internalState.runtime.quickPlace.openSource = "keyboard-shortcut";
    });

    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const searchInput = container.querySelector(".quick-place-search-input");
    let enterEvent!: KeyboardEvent;
    act(() => {
      dispatchKeyDown(searchInput!, {
        code: "ArrowDown",
        isComposing: true,
        key: "ArrowDown",
      });
      enterEvent = dispatchKeyDown(searchInput!, {
        code: "Enter",
        isComposing: true,
        key: "Enter",
      });
    });

    expect(container.querySelector('[aria-selected="true"]')).toBeNull();
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(handleMouseTap).not.toHaveBeenCalled();
  });

  it("commits the highlighted favorite slot when a mobile drag ends without drop", () => {
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const deviceButton = container.querySelector(".quick-place-device-button") as HTMLButtonElement | null;
    const emptyFavoriteSlot = container.querySelector(".quick-place-favorite-slot.is-empty") as HTMLButtonElement | null;
    const dataTransfer = createDataTransfer();

    expect(deviceButton).not.toBeNull();
    expect(emptyFavoriteSlot).not.toBeNull();

    act(() => {
      dispatchDragEvent(deviceButton!, "dragstart", dataTransfer);
      dispatchDragEvent(emptyFavoriteSlot!, "dragenter", dataTransfer);
      dispatchDragEvent(deviceButton!, "dragend", dataTransfer);
    });

    expect(emptyFavoriteSlot?.getAttribute("aria-label")).toBe(`1 ${deviceButton?.title}`);
  });

  it("uses the active in-memory payload when mobile drop data is empty", () => {
    act(() => {
      root.render(<QuickPlacePopup appHost={appHost} />);
    });

    const deviceButton = container.querySelector(".quick-place-device-button") as HTMLButtonElement | null;
    const emptyFavoriteSlot = container.querySelector(".quick-place-favorite-slot.is-empty") as HTMLButtonElement | null;
    const sourceDataTransfer = createDataTransfer();
    const emptyDropDataTransfer = createDataTransfer();

    expect(deviceButton).not.toBeNull();
    expect(emptyFavoriteSlot).not.toBeNull();

    act(() => {
      dispatchDragEvent(deviceButton!, "dragstart", sourceDataTransfer);
      dispatchDragEvent(emptyFavoriteSlot!, "dragenter", sourceDataTransfer);
      dispatchDragEvent(emptyFavoriteSlot!, "drop", emptyDropDataTransfer);
      dispatchDragEvent(deviceButton!, "dragend", sourceDataTransfer);
    });

    expect(emptyFavoriteSlot?.getAttribute("aria-label")).toBe(`1 ${deviceButton?.title}`);
  });
});
