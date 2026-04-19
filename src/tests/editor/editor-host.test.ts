import { describe, expect, it } from "vitest";
import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
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

describe("createEditorHost", () => {
  it("updates viewport pixel size through editor actions", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);

    editorHost.actions.setViewportPixelSize({
      width: 1024,
      height: 768,
    });

    expect(editorHost.internalState.viewport.pixelSize.width).toBe(1024);
    expect(editorHost.internalState.viewport.pixelSize.height).toBe(768);
    expect(editorHost.state.viewport.pixelSize.width).toBe(1024);
    expect(editorHost.state.viewport.pixelSize.height).toBe(768);
    expect(workspace.editor?.state.viewport.pixelSize.width).toBe(1024);
    expect(workspace.editor?.state.viewport.pixelSize.height).toBe(768);
  });
});