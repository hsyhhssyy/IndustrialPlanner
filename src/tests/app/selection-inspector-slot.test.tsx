// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { SelectionInspectorSlot } from "@/app/shell/inspector/selection-inspector-slot";
import type { SimulationRunState } from "@/domain/simulation/types/simulation-types";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
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
    state: SimulationRunState;
    runtimeStatus: ReturnType<NonNullable<WorkspaceContract["simulation"]>["queries"]["getDeviceRuntimeStatus"]>;
  },
) {
  const getDeviceRuntimeStatus = vi.fn(() => options.runtimeStatus);

  workspace.simulation = {
    state: {
      runningState: options.state,
      simulationSpeed: 1,
    },
    topology: createSnapshotStore(null),
    queries: {
      getStatusRuntimeJson: () => JSON.stringify({
        state: {
          runningState: options.state,
          simulationSpeed: 1,
          currentPlaybackTickNumber: 0,
        },
        runtimeStatus: {
          mode: options.state === "start" ? "running" : "stopped",
          topologyId: null,
          documentHash: null,
          retainedFromTick: null,
          latestTickNumber: null,
          bufferSize: 0,
          maxBufferSize: 180,
          error: null,
        },
        currentTick: null,
      }),
      getDeviceRuntimeStatus,
    },
    actions: {
      start: vi.fn(async () => {}),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      setSimulationSpeed: vi.fn(),
      advancePlaybackByDeltaMs: vi.fn(async () => {}),
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
        progressSeconds: 0.5,
        desiredSeconds: 2,
        slotItems: [],
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
    expect(container.querySelector("[data-runtime-field='progressSeconds']")?.textContent).toContain("0.5");
    expect(container.querySelector("[data-runtime-field='desiredSeconds']")?.textContent).toContain("2");
    expect(container.querySelector("[data-runtime-field='progressPercent']")?.textContent).toContain("25%");
  });

  it("keeps the simulation runtime inspector mounted outside stop state", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    const { getDeviceRuntimeStatus } = attachSimulationStub(workspace, {
      state: "pause",
      runtimeStatus: {
        recipeId: "paused-recipe",
        progressSeconds: 0.1,
        desiredSeconds: 2,
        slotItems: [],
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
  });
});
