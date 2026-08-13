// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppHost } from "@/app/host/app-host";
import { SyncConflictDialog } from "@/app/shell/dialogs/sync-conflict-dialog";
import { SyncInitialSyncGate } from "@/app/shell/layout/sync-initial-sync-gate";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { SyncContract } from "@/domain/sync";
import { SyncStateImpl } from "@/sync/sync-state-impl";

describe("SyncConflictDialog", () => {
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
        direction: null,
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
        abortCurrentTransaction: vi.fn(async () => undefined),
      },
    };
    const translate: AppHost["actions"]["translate"] = (key) => ({
      "syncConflict.itemLabel": "{type} - {name}",
      "syncConflict.type.base": "基地",
      "syncConflict.type.blueprint": "蓝图",
      "syncConflict.nameUnavailable": "名称不可用",
    }[key] ?? key);
    const appHost = {
      workspace: {
        registry: {
          baseDefinitions: [{
            id: "base-a",
            name: "天王坪援建点",
          }],
        },
      },
      internalState: {
        workbench: {
          toolbox: {
            moduleBalancing: {
              customModules: [],
              folders: [],
              canvases: [],
              canvasFolders: [],
            },
          },
        },
      },
    } as unknown as AppHost;
    const stopSync = vi.fn();

    await act(async () => {
      root.render(
        <OverlayStackProvider>
          <SyncInitialSyncGate sync={sync} translate={(key) => key} />
          <SyncConflictDialog
            appHost={appHost}
            compactMobileLayout={false}
            onStopSync={stopSync}
            sync={sync}
            t={translate}
          />
        </OverlayStackProvider>,
      );
    });

    const gate = document.querySelector<HTMLElement>(
      "[data-sync-initial-sync-stage='canvas']",
    );
    const dialog = document.querySelector<HTMLElement>(
      "[data-dialog-key='sync-conflict']",
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
    expect(dialog?.textContent).toContain("基地 - 天王坪援建点");
    expect(dialog?.textContent).not.toContain("world-documents");
    expect(dialog?.textContent).not.toContain("base-a");
    expect(document.querySelector("input[value='pause']")).toBeNull();

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
      "[data-dialog-key='sync-conflict']",
    )).not.toBeNull();

    const stopSyncButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(
      "syncConflict.stopSync",
    ));
    await act(async () => {
      stopSyncButton?.click();
    });
    expect(stopSync).toHaveBeenCalledOnce();

    const batchUseRemoteButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(
      "syncConflict.batchUseRemote",
    ));
    await act(async () => {
      batchUseRemoteButton?.click();
    });
    const useRemoteInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "input[value='use-remote']",
      ),
    );
    expect(useRemoteInputs.every((input) => input.checked)).toBe(true);
    const applyButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes(
      "syncConflict.apply",
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
      "[data-dialog-key='sync-conflict']",
    )).not.toBeNull();

    await act(async () => {
      state.finishConflictWorkflow();
    });
    expect(document.querySelector(
      "[data-dialog-key='sync-conflict']",
    )).toBeNull();
  });
});
