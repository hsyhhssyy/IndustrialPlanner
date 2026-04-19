import type { WorldDocument } from "@/domain/entity/world-document";
import { EditorContract } from "@/domain/contract/editor-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorldDocument } from "@/domain/entity/world-document";
import {
  createSnapshotStore,
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { createEditorStateReadWrite, EditorStateReadWrite } from "./stste-impl";

// state 和 document 都是外部使用的，editor组件内部使用internal来获取可写的state和document
export interface EditorHost extends EditorContract {
  internalDocument: SnapshotStoreReadWrite<WorldDocument>;
  workspace: WorkspaceContract;
  internalState: EditorStateReadWrite;
}


export function createEditorHost(
  workspace: WorkspaceContract,
): EditorHost {
  const internalDocument = createSnapshotStore(createWorldDocument());
  const editorState = createEditorStateReadWrite();
  const actions: EditorContract["actions"] = {
    setViewportPixelSize: ({ width, height }) => {
      editorState.viewport.pixelSize.width = width;
      editorState.viewport.pixelSize.height = height;
    },
  };

  const host: EditorHost = {
    document: internalDocument,
    state: editorState,
    internalDocument,
    workspace,
    queries: {},
    actions,
    internalState: editorState,
  };

  workspace.editor = host;

  return host;
}
