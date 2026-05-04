// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { SelectionInspectorSlot } from "@/app/shell/inspector/selection-inspector-slot";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

import { SIMULATION_RUNTIME_INSPECTOR_KEY } from "@/app/shell/inspector/simulation-runtime-inspector";

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

function queryInspectorKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-inspector-key]"))
    .map((element) => element.dataset.inspectorKey ?? "");
}

function attachSimulationStub(
  workspace: WorkspaceContract,
  options: {
    state: "stop" | "start" | "pause";
    runtimeStatus: ReturnType<NonNullable<WorkspaceContract["simulation"]>["queries"]["getDeviceRuntimeStatus"]>;
  },
) {
  const getDeviceRuntimeStatus = vi.fn(() => options.runtimeStatus);

  workspace.simulation = {
    state: options.state,
    playbackTickRateHz: 1,
    topology: createSnapshotStore(null),
    queries: {
      getStatus: () => ({
        mode: options.state === "start" ? "running" : "stopped",
        topologyId: null,
        documentHash: null,
        retainedFromTick: null,
        latestTickNumber: null,
        bufferSize: 0,
        maxBufferSize: 180,
        error: null,
      }),
      getCurrentTickSnapshot: () => null,
      getDeviceRuntimeStatus,
    },
    actions: {
      start: vi.fn(async () => ({
        status: "started",
        topologyId: null,
        diagnostics: [],
      })),
      pause: vi.fn(),
      stop: vi.fn(),
      getTickSnapshot: vi.fn(async () => ({
        status: "not-ready",
        requestedTickNumber: 0,
        retainedFromTick: null,
        latestTickNumber: null,
        bufferSize: 0,
      })),
      advancePlaybackByDeltaMs: vi.fn(async () => null),
    },
  } as NonNullable<WorkspaceContract["simulation"]>;

  return { getDeviceRuntimeStatus };
}

describe("SelectionInspectorSlot", () => {
  let container: HTMLDivElement;
  let root: Root;
  let appHost: AppHost | null;
  let editorHost: EditorHost | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    appHost = null;
    editorHost = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    appHost?.dispose();
    editorHost?.dispose();
    container.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mounts the default slot-config inspector for a storage device selection", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    expect(container.querySelector("[data-selection-inspector-slot]")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryInspectorKeys(container)).toEqual(["slot-config"]);
    expect(container.querySelector("[data-slot-config-group='item_storage']")).not.toBeNull();
    expect(container.querySelector("[data-slot-id='slot_1']")?.textContent).toContain("slot_1");
    expect(container.querySelector("[data-slot-id='slot_6']")?.textContent).toContain("slot_6");
  });

  it("hides on multi selection and remounts after narrowing back to one entity", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(container.querySelector("[data-slot-config-group='item_storage']")).not.toBeNull();

    editorHost.internalState.collections.selection.replace([
      "dummy-entity-2",
      "dummy-entity-3",
    ]);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(container.querySelector("[data-selection-inspector-slot]")).toBeNull();

    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(container.querySelector("[data-slot-config-group='item_storage']")).not.toBeNull();
  });

  it("mounts the simulation runtime inspector for any device while simulation is running", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    const { getDeviceRuntimeStatus } = attachSimulationStub(workspace, {
      state: "start",
      runtimeStatus: {
        recipeId: "transport-recipe",
        progressTicks: 1,
        desiredTicks: 4,
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryInspectorKeys(container)).toEqual([SIMULATION_RUNTIME_INSPECTOR_KEY]);
    expect(getDeviceRuntimeStatus).toHaveBeenCalledWith("dummy-entity-1");
    expect(container.querySelector("[data-runtime-field='recipeId']")?.textContent).toContain("transport-recipe");
    expect(container.querySelector("[data-runtime-field='progressTicks']")?.textContent).toContain("1");
    expect(container.querySelector("[data-runtime-field='desiredTicks']")?.textContent).toContain("4");
    expect(container.querySelector("[data-runtime-field='progressPercent']")?.textContent).toContain("25%");
  });

  it("does not mount the simulation runtime inspector outside running simulation", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    const { getDeviceRuntimeStatus } = attachSimulationStub(workspace, {
      state: "pause",
      runtimeStatus: {
        recipeId: "paused-recipe",
        progressTicks: 2,
        desiredTicks: 4,
      },
    });
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <SelectionInspectorSlot
          appHost={currentAppHost}
          translate={(key) => key}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryInspectorKeys(container)).toEqual([]);
    expect(getDeviceRuntimeStatus).not.toHaveBeenCalled();
  });
});
