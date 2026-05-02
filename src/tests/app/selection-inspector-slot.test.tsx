// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { SelectionInspectorSlot } from "@/app/shell/components/inspector/selection-inspector-slot";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { INSPECTOR_TYPE } from "@/domain/types/registry/inspector-types";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createDummyWorldDocument } from "@/editor/dummy-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
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

function queryInspectorKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-inspector-key]"))
    .map((element) => element.dataset.inspectorKey ?? "");
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

  it("polls the single selected entity definition and mounts inspectors in definition order", () => {
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

    expect(queryInspectorKeys(container)).toEqual([INSPECTOR_TYPE.slotConfig]);
    expect(container.textContent).toContain("tick 1");

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(container.querySelector("[data-inspector-key='slot-config']")?.textContent)
      .toContain("tick 3");
  });

  it("hides on multi selection and resets inspector counters after remount", () => {
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

    expect(container.querySelector("[data-inspector-key='slot-config']")?.textContent)
      .toContain("tick 2");

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

    expect(container.querySelector("[data-inspector-key='slot-config']")?.textContent)
      .toContain("tick 1");
  });
});
