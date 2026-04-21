import type { WorldDocument } from "@/domain/entity/world-document";
import { EditorContract } from "@/domain/contract/editor-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorldDocument } from "@/domain/entity/world-document";
import {
  createSnapshotStore,
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { readWorldDocumentFromIndexedDb } from "./document-storage";
import { hookLocalstorage } from "./storage-hook";
import { createEditorStateReadWrite, EditorStateReadWrite } from "./state-impl";

// state 和 document 都是外部使用的，editor组件内部使用internal来获取可写的state和document
export interface EditorHost extends EditorContract {
  internalDocument: SnapshotStoreReadWrite<WorldDocument>;
  workspace: WorkspaceContract;
  internalState: EditorStateReadWrite;
  dispose: () => void;
}


export function createEditorHost(
  workspace: WorkspaceContract,
): EditorHost {
  const disposers: Array<() => void> = [];
  const internalDocument = createSnapshotStore(createWorldDocument());
  const editorState = createEditorStateReadWrite();
  const actions: EditorContract["actions"] = {
    setViewportClientRect: ({ left, top, width, height }) => {
      editorState.viewport.clientRect.left = resolveViewportClientOffset(
        left,
        editorState.viewport.clientRect.left,
      );
      editorState.viewport.clientRect.top = resolveViewportClientOffset(
        top,
        editorState.viewport.clientRect.top,
      );
      editorState.viewport.clientRect.width = resolveViewportAxisSize(
        width,
        editorState.viewport.clientRect.width,
      );
      editorState.viewport.clientRect.height = resolveViewportAxisSize(
        height,
        editorState.viewport.clientRect.height,
      );
    },
  };

  const host: EditorHost = {
    document: internalDocument,
    state: editorState,
    internalDocument,
    workspace,
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries: {},
    actions,
    internalState: editorState,
  };

  workspace.editor = host;
  disposers.push(hookLocalstorage(host));
  void hydrateInitialDocument(host);

  return host;
}

function resolveViewportClientOffset(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

async function hydrateInitialDocument(editorHost: EditorHost): Promise<void> {
  const document = await readWorldDocumentFromIndexedDb(
    editorHost.internalState.internalPersistState.lastDocumentId,
  );

  editorHost.internalDocument.setSnapshot(document);
}
