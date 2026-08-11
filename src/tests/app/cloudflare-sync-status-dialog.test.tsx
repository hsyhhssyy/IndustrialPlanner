// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeAutoObservable } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudflareSyncStatusDialog } from "@/app/shell/dialogs/cloudflare-sync-status-dialog";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { readCloudflareSyncSettings } from "@/shared/storage/cloudflare-sync-settings";
import { SyncStateImpl } from "@/sync/sync-state-impl";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

describe("CloudflareSyncStatusDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
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

  it("keeps the space name as a draft until Save is pressed", async () => {
    const state = new SyncStateImpl();
    state.setSettings({
      enabled: true,
      url: "",
      username: "",
      password: "",
      maxConcurrentRequests: 4,
    });
    const dialogState = makeAutoObservable<DialogStateReadWrite>({
      visible: true,
      maximized: false,
      offsetX: 0,
      offsetY: 0,
      width: 760,
      height: 620,
      activeTab: null,
    });

    await act(async () => {
      root.render(
        <OverlayStackProvider>
          <CloudflareSyncStatusDialog
            aborting={false}
            compactMobileLayout={false}
            deleting={false}
            dialogState={dialogState}
            onAbortCurrentTransaction={vi.fn()}
            onClose={vi.fn()}
            onDeleteAllData={vi.fn()}
            onOffsetChange={vi.fn()}
            onResize={vi.fn()}
            onToggleMaximized={vi.fn()}
            state={state}
            t={(key) => key}
          />
        </OverlayStackProvider>,
      );
      await Promise.resolve();
    });

    const input = document.querySelector<HTMLInputElement>(
      "[data-cloudflare-space-name-input]",
    );
    const saveButton = document.querySelector<HTMLButtonElement>(
      "[data-cloudflare-space-name-save]",
    );
    expect(input?.value).toBe("default");
    expect(saveButton?.disabled).toBe(true);

    act(() => {
      if (input === null) throw new Error("Missing Cloudflare space input.");
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "factory-a");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "default",
    });
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    });
    await expect(readCloudflareSyncSettings()).resolves.toEqual({
      spaceName: "factory-a",
    });
    expect(saveButton?.disabled).toBe(true);
  });
});
