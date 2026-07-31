// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebDavConflictDialog } from "@/app/shell/dialogs/webdav-conflict-dialog";
import { WebDavInitialSyncGate } from "@/app/shell/layout/webdav-initial-sync-gate";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { SyncContract } from "@/domain/sync";
import { SyncStateImpl } from "@/sync/sync-state-impl";

describe("WebDavConflictDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

  it("stays visible above the canvas gate without the settings dialog", async () => {
    const state = new SyncStateImpl();
    state.setSettings({
      enabled: true,
      url: "https://dav.example.test",
      username: "",
      password: "",
      maxConcurrentRequests: 4,
    });
    state.setStatus({
      ...state.status,
      phase: "downloading",
      initialSyncStage: "canvas",
      currentRunReason: "foreground",
      tasks: [{
        kind: "canvas",
        phase: "running",
        completedUnitCount: 55,
        totalUnitCount: 100,
        lastStartedAt: "2026-07-29T10:00:00.000Z",
        lastFinishedAt: null,
        lastError: null,
      }],
    });
    state.beginConflictDiscovery();
    const resolutionPromise = state.requestConflictResolutions([
      {
        adapterId: "blueprints",
        assetId: "blueprint-a",
        localValue: { name: "local-a" },
        remoteValue: { name: "remote-a" },
        localHash: "local-hash-a",
        remoteHash: "remote-hash-a",
        remoteDeletedAt: null,
        remoteUpdatedAt: "2026-07-29T10:30:00.000Z",
      },
      {
        adapterId: "world-documents",
        assetId: "base-a",
        localValue: { name: "local-b" },
        remoteValue: { name: "remote-b" },
        localHash: "local-hash-b",
        remoteHash: "remote-hash-b",
        remoteDeletedAt: null,
        remoteUpdatedAt: "2026-07-29T10:31:00.000Z",
      },
    ]);
    const sync: SyncContract = {
      state,
      queries: {},
      actions: {
        updateSettings: vi.fn(),
        syncNow: vi.fn(async () => undefined),
        deleteRemoteData: vi.fn(async () => undefined),
        resolveConflicts: (decisions) => {
          state.resolveConflicts(decisions);
        },
      },
    };

    await act(async () => {
      root.render(
        <OverlayStackProvider>
          <WebDavInitialSyncGate sync={sync} translate={(key) => key} />
          <WebDavConflictDialog
            compactMobileLayout={false}
            sync={sync}
            t={(key) => key}
          />
        </OverlayStackProvider>,
      );
    });

    const gate = document.querySelector<HTMLElement>(
      "[data-webdav-initial-sync-stage='canvas']",
    );
    const dialog = document.querySelector<HTMLElement>(
      "[data-dialog-key='webdav-conflict']",
    );
    const dialogBackdrop = dialog?.parentElement;
    expect(gate).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(Number(dialogBackdrop?.style.zIndex)).toBeGreaterThan(
      Number(gate?.style.zIndex),
    );
    expect(document.querySelector(
      "button[aria-label='action.close']",
    )).toBeNull();

    await act(async () => {
      dialogBackdrop?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
      }));
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Escape",
      }));
    });
    expect(state.pendingConflict).not.toBeNull();
    expect(document.querySelector(
      "[data-dialog-key='webdav-conflict']",
    )).not.toBeNull();

    const useRemoteInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "input[value='use-remote']",
      ),
    );
    await act(async () => {
      useRemoteInputs.forEach((input) => input.click());
    });
    const applyButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(
      "webDavConflict.apply",
    ));
    await act(async () => {
      applyButton?.click();
      await resolutionPromise;
    });

    await expect(resolutionPromise).resolves.toEqual([
      {
        adapterId: "blueprints",
        assetId: "blueprint-a",
        resolution: "use-remote",
      },
      {
        adapterId: "world-documents",
        assetId: "base-a",
        resolution: "use-remote",
      },
    ]);
    expect(state.pendingConflict?.phase).toBe("applying");
    expect(document.querySelector(
      "[data-dialog-key='webdav-conflict']",
    )).not.toBeNull();

    await act(async () => {
      state.finishConflictWorkflow();
    });
    expect(document.querySelector(
      "[data-dialog-key='webdav-conflict']",
    )).toBeNull();
  });
});
