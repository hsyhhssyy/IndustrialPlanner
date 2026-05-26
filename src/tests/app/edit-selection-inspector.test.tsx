// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppHost, type AppHost } from "@/app/host/app-host";
import { EditSelectionInspector } from "@/app/shell/inspector/edit-selection-inspector";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
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
          mode="dock"
          state={{ locale: "zh-CN" }}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    expect(container.textContent).toContain("未选中对象");
    expect(container.querySelector("[data-selection-action-strip]")).toBeNull();
    expect(container.textContent).not.toContain("快捷操作");
    expect(container.textContent).not.toContain("连接");
    expect(container.textContent).not.toContain("配置字段");
  });

  it("shows the mounted inspector and action strip for a non-logistics single selection", () => {
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
          mode="dock"
          state={{ locale: "zh-CN" }}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

  const actionStrip = container.querySelector("[data-selection-action-strip]") as HTMLElement | null;
  const actionButtonList = container.querySelector(".selection-inspector-action-button-list") as HTMLElement | null;

  expect(actionStrip).not.toBeNull();
  expect(actionButtonList?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-move"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-switch-mode"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-save-blueprint"]')).toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-delete"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-delete-many"]')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(container.textContent).toContain("运行态细节");
    expect(container.textContent).not.toContain("未选中对象");
    expect(container.textContent).not.toContain("快捷操作");
    expect(container.textContent).not.toContain("连接");
    expect(container.textContent).not.toContain("配置字段");
  });

  it("shows batch delete in the action strip for a dedicated logistics selection", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());
    editorHost.internalState.collections.selection.replace(["dummy-entity-1"]);
    const currentAppHost = createAppHost(workspace);
    appHost = currentAppHost;

    act(() => {
      root.render(
        <EditSelectionInspector
          appHost={currentAppHost}
          context={null}
          mode="dock"
          state={{ locale: "zh-CN" }}
          translate={currentAppHost.actions.translate}
        />,
      );
    });

    const actionStrip = container.querySelector("[data-selection-action-strip]") as HTMLElement | null;
    const actionButtonLists = container.querySelectorAll(".selection-inspector-action-button-list");
    const generalRow = actionButtonLists[0] as HTMLElement | null;
    const logisticsRow = actionButtonLists[1] as HTMLElement | null;

    expect(actionStrip).not.toBeNull();
    // 通用操作行：移动 + 删除，共 2 个按钮
    expect(generalRow?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    // 物流段操作行：删除前段 + 删除整段 + 删除后段，共 3 个按钮
    expect(logisticsRow?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-save-blueprint"]')).toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-delete-many"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-delete-upstream-segment"]')).not.toBeNull();
    expect(container.querySelector('[data-ui-button-id="canvas-floating-toolbar-button-delete-downstream-segment"]')).not.toBeNull();
  });
});
