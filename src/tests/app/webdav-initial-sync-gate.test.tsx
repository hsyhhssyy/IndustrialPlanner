// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WebDavInitialSyncFeatureGate,
  WebDavInitialSyncGate,
} from "@/app/shell/layout/webdav-initial-sync-gate";
import { OverlayStackProvider } from "@/app/shell/shared/overlay-stack";
import type { SyncContract, SyncInitialSyncStage } from "@/domain/sync";
import { SyncStateImpl } from "@/sync/sync-state-impl";

describe("WebDavInitialSyncGate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: SyncStateImpl;
  let sync: SyncContract;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    state = new SyncStateImpl();
    state.setSettings({
      enabled: true,
      url: "https://dav.example.test",
      username: "",
      password: "",
      maxConcurrentRequests: 4,
    });
    sync = {
      state,
      actions: {
        resolveConflicts: vi.fn(),
        syncNow: vi.fn(async () => undefined),
        deleteRemoteData: vi.fn(async () => undefined),
        updateSettings: vi.fn(),
      },
      queries: {},
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("blocks the whole workbench only while the current canvas is checking", () => {
    act(() => {
      setInitialStage(state, "canvas");
      // AI-REMOVED 2026-07-29:
      // Reason: SyncStateImpl 测试初始值的 tasks 为空，map 不会创建 canvas task，导致夹具始终把进度渲染为 0%。
      // Trigger: 全量测试发现期望 55、实际 0；真实浏览器与 service 状态均正确输出 55/100。
      // Evidence: SyncStateImpl.status.tasks 默认值为 []。
      // Replacement: 下方显式 canvas task 夹具。
      // Risk: None。
      // Human Review: Required
      //
      // Original code:
      // tasks: state.status.tasks.map((task) =>
      //   task.kind === "canvas"
      //     ? {
      //       ...task,
      //       phase: "running",
      //       completedUnitCount: 55,
      //       totalUnitCount: 100,
      //     }
      //     : task
      // ),
      state.setStatus({
        ...state.status,
        tasks: [{
          kind: "canvas",
          phase: "running",
          completedUnitCount: 55,
          totalUnitCount: 100,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastError: null,
        }],
      });
      root.render(
        <OverlayStackProvider>
          <WebDavInitialSyncGate sync={sync} translate={(key) => key} />
        </OverlayStackProvider>,
      );
    });

    expect(document.querySelector(
      "[data-webdav-initial-sync-stage='canvas']",
    )).not.toBeNull();
    expect(document.querySelector(
      "[data-webdav-initial-sync-progress]",
    )).toHaveProperty("value", 55);
    expect(document.querySelector("output")?.textContent).toBe("55%");
    expect(document.querySelector("section")?.getAttribute("aria-label"))
      .toBe("webDavInitialSync.canvasSyncing");

    act(() => {
      setInitialStage(state, "blueprints");
    });
    expect(document.querySelector(
      "[data-webdav-initial-sync-stage='canvas']",
    )).toBeNull();
  });

  it("unlocks feature gates only after their first sync stage completes", () => {
    act(() => {
      setInitialStage(state, "blueprints");
      root.render(
        <>
          <WebDavInitialSyncFeatureGate
            feature="blueprints"
            state={state}
            translate={(key) => key}
          >
            <span data-feature-content="blueprints" />
          </WebDavInitialSyncFeatureGate>
          <WebDavInitialSyncFeatureGate
            feature="modules"
            state={state}
            translate={(key) => key}
          >
            <span data-feature-content="modules" />
          </WebDavInitialSyncFeatureGate>
        </>,
      );
    });

    expect(container.querySelector(
      "[data-webdav-initial-sync-feature='blueprints']",
    )).not.toBeNull();
    expect(container.querySelector("[data-feature-content='blueprints']")).toBeNull();

    act(() => {
      setInitialStage(state, "modules");
    });
    expect(container.querySelector("[data-feature-content='blueprints']")).not.toBeNull();
    expect(container.querySelector("[data-feature-content='modules']")).toBeNull();

    act(() => {
      setInitialStage(state, "toolbox");
    });
    expect(container.querySelector("[data-feature-content='modules']")).not.toBeNull();

    act(() => {
      state.setStatus({
        ...state.status,
        phase: "downloading",
        initialSyncStage: "canvas",
        hasCompletedInitialFeatureSync: true,
      });
    });
    expect(container.querySelector("[data-feature-content='blueprints']")).not.toBeNull();
    expect(container.querySelector("[data-feature-content='modules']")).not.toBeNull();
  });
});

function setInitialStage(
  state: SyncStateImpl,
  initialSyncStage: SyncInitialSyncStage,
): void {
  state.setStatus({
    ...state.status,
    phase: initialSyncStage === "ready" ? "idle" : "downloading",
    initialSyncStage,
  });
}
