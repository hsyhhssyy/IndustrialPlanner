// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebDavSaveIndicator } from "@/app/shell/layout/webdav-save-indicator";
import { SyncStateImpl } from "@/sync/sync-state-impl";
import type { WebDavSyncServiceStatus } from "@/sync";

describe("WebDavSaveIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: SyncStateImpl;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    controller = new SyncStateImpl();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("uses the existing save and loader assets while a save is pending", () => {
    act(() => {
      controller.setSettings({
        enabled: true,
        url: "https://example.com",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      });
      controller.setStatus(createStatus({
        saveState: "pending",
        pendingLocalChangeCount: 2,
      }));
      root.render(<WebDavSaveIndicator syncState={controller} translate={(key) => key} />);
    });

    const indicator = container.querySelector("[data-webdav-save-state='pending']");
    expect(indicator?.getAttribute("role")).toBe("status");
    expect(indicator?.querySelector("[data-workbench-icon='save-blueprint']")).not.toBeNull();
    expect(indicator?.querySelector("[data-workbench-icon='save-progress']")).not.toBeNull();
  });

  it("keeps the failure asset visible until success or WebDAV is disabled", () => {
    act(() => {
      controller.setSettings({
        enabled: true,
        url: "https://example.com",
        username: "",
        password: "",
        maxConcurrentRequests: 4,
      });
      controller.setStatus(createStatus({
        phase: "error",
        saveState: "error",
        pendingLocalChangeCount: 1,
        saveError: "server unavailable",
        lastError: "server unavailable",
      }));
      root.render(<WebDavSaveIndicator syncState={controller} translate={(key) => key} />);
    });

    expect(container.querySelector("[role='alert'] [data-workbench-icon='save-failed']")).not.toBeNull();

    act(() => {
      controller.setSettings({
        ...controller.settings,
        enabled: false,
      });
    });
    expect(container.querySelector("[data-webdav-save-state]")).toBeNull();

    act(() => {
      controller.setSettings({
        ...controller.settings,
        enabled: true,
      });
      controller.setStatus(createStatus());
    });
    expect(container.querySelector("[data-webdav-save-state]")).toBeNull();
  });
});

function createStatus(
  overrides: Partial<WebDavSyncServiceStatus> = {},
): WebDavSyncServiceStatus {
  return {
    phase: "idle",
    saveState: "idle",
    initialSyncStage: "ready",
    hasCompletedInitialFeatureSync: true,
    currentRunReason: null,
    activeRequestCount: 0,
    queuedRequestCount: 0,
    tasks: [],
    pendingLocalChangeCount: 0,
    saveError: null,
    lastUploadAt: null,
    lastDownloadAt: null,
    lastError: null,
    lastResults: [],
    ...overrides,
  };
}
