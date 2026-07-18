// @vitest-environment jsdom

import { runInAction } from "mobx";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
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

  it("does not focus search on open and blurs it before interacting outside the input", () => {
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
