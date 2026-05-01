// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { EditSelectionInspector } from "@/app/shell/components/inspector/edit-selection-inspector";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
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

describe("EditSelectionInspector", () => {
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

  it("keeps only the empty state when nothing is selected", () => {
    const workspace = createWorkspace();
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <EditSelectionInspector
          appHost={currentAppHost}
          context={null}
          state={{ locale: "zh-CN" }}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    expect(container.textContent).toContain("未选中对象");
    expect(container.textContent).not.toContain("快捷操作");
    expect(container.textContent).not.toContain("连接");
    expect(container.textContent).not.toContain("配置字段");
  });

  it("shows the mounted inspector without placeholder sections for a single selection", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-2"]);
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <EditSelectionInspector
          appHost={currentAppHost}
          context={null}
          state={{ locale: "zh-CN" }}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(container.textContent).toContain("运行态细节");
    expect(container.textContent).not.toContain("未选中对象");
    expect(container.textContent).not.toContain("快捷操作");
    expect(container.textContent).not.toContain("连接");
    expect(container.textContent).not.toContain("配置字段");
  });
});