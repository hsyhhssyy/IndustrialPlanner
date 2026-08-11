// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeAutoObservable } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebDavSyncStatusDialog } from "@/app/shell/dialogs/webdav-sync-status-dialog";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { DialogStateReadWrite } from "@/app/state/state-impl";
import { SyncStateImpl } from "@/sync/sync-state-impl";

describe("WebDavSyncStatusDialog", () => {
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

  it("shows network concurrency and per-category task activity", () => {
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
      hasCompletedInitialFeatureSync: false,
      currentRunReason: "foreground",
      activeRequestCount: 4,
      queuedRequestCount: 3,
      tasks: [{
        kind: "canvas",
        phase: "running",        direction: null,        completedUnitCount: 0,
        totalUnitCount: 1,
        lastStartedAt: "2026-07-29T07:00:00.000Z",
        lastFinishedAt: null,
        lastError: null,
      }],
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

    act(() => {
      root.render(
        <OverlayStackProvider>
          <WebDavSyncStatusDialog
            compactMobileLayout={false}
            deleting={false}
            dialogState={dialogState}
            onClose={vi.fn()}
            onDeleteAllData={vi.fn()}
            onOffsetChange={vi.fn()}
            onResize={vi.fn()}
            onTestConnection={vi.fn().mockResolvedValue(true)}
            onToggleMaximized={vi.fn()}
            onUpdateSettings={vi.fn()}
            state={state}
            t={(key) => key}
          />
        </OverlayStackProvider>,
      );
    });

    expect(document.querySelector("[data-webdav-sync-status-dialog]")).not.toBeNull();
    expect(document.querySelector(
      "[data-sync-task-kind='canvas'][data-sync-task-phase='running']",
    )).not.toBeNull();
    expect(document.body.textContent).toContain("webDavStatus.maxConcurrentRequests");
    expect(document.body.textContent).toContain("webDavStatus.activeRequests");
    expect(document.body.textContent).toContain("webDavStatus.queuedRequests");
  });
});
