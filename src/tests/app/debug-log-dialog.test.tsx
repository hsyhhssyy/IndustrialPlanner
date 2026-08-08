// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const collectorMocks = vi.hoisted(() => ({
  clearLogEntries: vi.fn(async () => {}),
  queryLogEntries: vi.fn(),
}));

vi.mock("@/shared/logging/log-collector-client", () => ({
  clearLogEntries: collectorMocks.clearLogEntries,
  getLogCollectorStatus: () => "ready",
  queryLogEntries: collectorMocks.queryLogEntries,
  subscribeLogCollectorStatus: () => () => {},
}));

import { createAppHost } from "@/app/host/app-host";
import { DebugLogDialog } from "@/app/shell/dialogs/debug-log-dialog";
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

describe("DebugLogDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    collectorMocks.clearLogEntries.mockClear();
    collectorMocks.queryLogEntries.mockReset();
    collectorMocks.queryLogEntries.mockResolvedValue({
      entries: [{
        id: 1,
        occurredAt: Date.parse("2026-08-08T10:00:00.000Z"),
        collectedAt: Date.parse("2026-08-08T10:00:00.001Z"),
        level: "warn",
        source: "webdav",
        instanceId: "webdav-test",
        message: "polling smoke",
      }],
      total: 1,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("queries immediately, polls only while visible and refreshes after clear", async () => {
    const appHost = createAppHost(createWorkspace());
    act(() => {
      runInAction(() => {
        appHost.internalState.settings.debugMode = true;
      });
      appHost.internalActions.openDialog("debug-log");
    });

    await act(async () => {
      root.render(<DebugLogDialog appHost={appHost} />);
      await Promise.resolve();
    });
    expect(collectorMocks.queryLogEntries).toHaveBeenCalledTimes(1);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea?.value).toContain("[webdav:webdav-test] polling smoke");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(collectorMocks.queryLogEntries).toHaveBeenCalledTimes(2);

    const clearButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "清空日志");
    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(collectorMocks.clearLogEntries).toHaveBeenCalledTimes(1);
    expect(collectorMocks.queryLogEntries).toHaveBeenCalledTimes(3);

    act(() => appHost.internalActions.closeDialog("debug-log"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(collectorMocks.queryLogEntries).toHaveBeenCalledTimes(3);
  });
});
