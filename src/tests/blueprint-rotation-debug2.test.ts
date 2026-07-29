import { describe, expect, it } from "vitest";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createDummyWorldDocument } from "@/tests/helpers/dummy-document";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

function createWorkspace(): WorkspaceContract {
  return { state: createWorkspaceState(), registry: createRegistryContract(), app: null, editor: null, render: null, simulation: null, sync: null };
}

function _fp(editorHost: ReturnType<typeof createEditorHost>, defId: string): { w: number; h: number } {
  const d = editorHost.workspace.registry.entityDefinitions.find(x => x.id === defId);
  return d ? { w: d.footprint.width, h: d.footprint.height } : { w: 1, h: 1 };
}

function _bounds(e: { position: { x: number; y: number }; rotation: number }, w: number, h: number) {
  const rw = (e.rotation === 90 || e.rotation === 270) ? h : w;
  const rh = (e.rotation === 90 || e.rotation === 270) ? w : h;
  return { left: e.position.x, top: e.position.y, right: e.position.x + rw, bottom: e.position.y + rh };
}

function _adj(a: ReturnType<typeof _bounds>, b: ReturnType<typeof _bounds>) {
  if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) {
    return (a.right === b.left || b.right === a.left) && a.bottom > b.top && b.bottom > a.top
        || (a.bottom === b.top || b.bottom === a.top) && a.right > b.left && b.right > a.left;
  }
  return false;
}

function _ov(a: ReturnType<typeof _bounds>, b: ReturnType<typeof _bounds>) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("蓝图旋转调试", () => {
  it("debug placement draft IDs", () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    editorHost.internalDocument.setSnapshot(createDummyWorldDocument());

    const blueprint = createBlueprintDocument({
      name: "debug",
      baseId: "wuling_protocol_core",
      initialGridPoint: { x: 2, y: 2 },
      entities: {
        a: { id: "a", definitionId: "furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] },
        b: { id: "b", definitionId: "grinder_1", position: { x: 3, y: 0 }, rotation: 0, config: {}, tags: [] },
        c: { id: "c", definitionId: "belt_straight_1x1", position: { x: 0, y: 3 }, rotation: 0, config: {}, tags: [] },
      },
      entityOrder: ["a", "b", "c"],
      slotLinks: [],
    });

    editorHost.actions.createBlueprintPlacementDraft!(blueprint, { x: 20, y: 20 });

    const previewIds = [...editorHost.state.collections.preview];
    console.log("preview IDs:", previewIds);
    console.log("drafts count:", editorHost.internalState.drafts.length);

    for (const id of previewIds) {
      const e = editorHost.queries.getEntityById(id);
      console.log(`  query ${id}:`, e ? `${e.definitionId}@(${e.position.x},${e.position.y})` : "NULL");
    }

    // Also try querying directly from drafts
    for (const draft of editorHost.internalState.drafts) {
      console.log(`  draft ${draft.id}: ${draft.definitionId}@(${draft.position.x},${draft.position.y})`);
    }

    expect(previewIds.length).toBe(3);
    expect(editorHost.internalState.drafts.length).toBe(3);
  });
});
