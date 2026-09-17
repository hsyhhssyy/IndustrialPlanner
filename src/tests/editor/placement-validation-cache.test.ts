import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRegistryContract } from "@/registry";
import { createEditorHost } from "@/editor/editor-host";

afterEach(() => localStorage.clear());

describe("移动预览的静态碰撞缓存", () => {
  it("跟随虚影移动、原件隐藏、取消及正式提交失效，不保留旧位置的重叠结果", () => {
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(), registry: createRegistryContract(),
      app: null, editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null,
    };
    const editor = createEditorHost(workspace);
    const previewOverlap = () => editor.queries.getEntityPlacementValidation(
      editor.state.collections.preview[0]!,
    ).reasons.some((reason) => reason.code === "overlap");
    try {
      editor.actions.createSinglePlacementDraft("grinder_1", { x: 20, y: 20 });
      expect(editor.actions.applyPlacementDraft()).toBe(true);
      const original = Object.values(editor.document.getSnapshot().entities).find((entity) => entity.definitionId === "grinder_1")!;
      editor.actions.createSinglePlacementDraft("grinder_1", { x: 20, y: 20 });
      expect(previewOverlap()).toBe(true);
      editor.actions.moveCollectionTo({ collectionType: "preview", startGridPoint: { x: 0, y: 0 }, endGridPoint: { x: 10, y: 0 } });
      expect(previewOverlap()).toBe(false);
      editor.actions.cancelPlacementDraft();

      editor.actions.addToCollection({ collectionType: "selection", entityId: original.id });
      editor.actions.createMoveOperationDraft();
      expect(previewOverlap()).toBe(false);
      editor.actions.cancelMoveOperationDraft();
      editor.actions.createSinglePlacementDraft("grinder_1", { x: 20, y: 20 });
      expect(previewOverlap()).toBe(true);
      editor.actions.cancelPlacementDraft();

      editor.actions.clearCollection("selection");
      editor.actions.addToCollection({ collectionType: "selection", entityId: original.id });
      editor.actions.createMoveOperationDraft();
      editor.actions.moveCollectionTo({ collectionType: "preview", startGridPoint: { x: 0, y: 0 }, endGridPoint: { x: 10, y: 0 } });
      expect(editor.actions.applyMoveOerationDraft()).toBe(true);
      editor.actions.createSinglePlacementDraft("grinder_1", { x: 20, y: 20 });
      expect(previewOverlap()).toBe(false);
      editor.actions.cancelPlacementDraft();
      editor.actions.createSinglePlacementDraft("grinder_1", { x: 30, y: 20 });
      expect(previewOverlap()).toBe(true);
    } finally {
      editor.dispose();
    }
  });
});
