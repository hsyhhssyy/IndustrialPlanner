import type { WorldDocument } from "@/domain/document/world-document";
import { EditorContract } from "@/domain/editor/editor-contract";
import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorldDocument } from "@/domain/document/world-document";
import {
  createSnapshotStore,
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { createEditorActions } from "./actions";
import { applyWorldDocumentViewportSettings } from "./document-viewport";
import { hookDocumentStorage } from "./document-storage";
import {
  createEditorDocumentWriter,
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "./history";
import { createEditorQueries } from "./queries";
import { syncPlacementValidationState } from "./placement-validation";
import { hookLocalstorage } from "./storage-hook";
import { createEditorStateReadWrite, EditorStateReadWrite } from "./state-impl";

// state 和 document 都是外部使用的，editor组件内部使用internal来获取可写的state和document
export interface EditorHost extends EditorContract {
  internalDocument: SnapshotStoreReadWrite<WorldDocument>;
  internalDocumentWriter: EditorDocumentWriter;
  internalHistory: EditorHistoryRuntime;
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
  const internalHistory = new EditorHistoryRuntime(editorState.history);
  const internalDocumentWriter = createEditorDocumentWriter({
    document: internalDocument,
    history: internalHistory,
  });
  const actions: EditorContract["actions"] = createEditorActions({
    document: internalDocument,
    documentWriter: internalDocumentWriter,
    history: internalHistory,
    state: editorState,
    workspace,
  });
  const queries: EditorContract["queries"] = createEditorQueries({
    document: internalDocument,
    state: editorState,
    workspace,
  });

  const publicState: EditorContract["state"] = {
    viewport: editorState.viewport,
    get marqueeGridRect() {
      return editorState.marqueeGridRect;
    },
    history: editorState.history,
    collections: editorState.collections,
  };

  const host: EditorHost = {
    document: internalDocument,
    state: publicState,
    internalDocument,
    internalDocumentWriter,
    internalHistory,
    workspace,
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries,
    actions,
    internalState: editorState,
  };

  workspace.editor = host;
  disposers.push(hookDocumentHistory(host));
  disposers.push(hookDocumentViewport(host));
  disposers.push(hookPlacementValidation(host));
  disposers.push(hookLocalstorage(host));
  disposers.push(hookDocumentStorage(host));

  return host;
}

function hookPlacementValidation(editorHost: EditorHost): () => void {
  const syncPlacementValidation = (document: WorldDocument): void => {
    syncPlacementValidationState({
      document,
      state: editorHost.internalState,
      workspace: editorHost.workspace,
    });
  };

  syncPlacementValidation(editorHost.internalDocument.getSnapshot());

  return editorHost.internalDocument.subscribe(syncPlacementValidation);
}

function hookDocumentHistory(editorHost: EditorHost): () => void {
  let documentKey: string | null = null;

  const loadHistoryForDocument = (document: WorldDocument): void => {
    if (documentKey === document.documentKey) {
      return;
    }

    documentKey = document.documentKey;
    editorHost.internalHistory.loadDocumentHistory(document.documentKey);
  };

  loadHistoryForDocument(editorHost.internalDocument.getSnapshot());

  return editorHost.internalDocument.subscribe(loadHistoryForDocument);
}

function hookDocumentViewport(editorHost: EditorHost): () => void {
  let documentKey: string | null = null;

  const loadViewportForDocument = (document: WorldDocument): void => {
    if (documentKey === document.documentKey) {
      return;
    }

    documentKey = document.documentKey;
    applyWorldDocumentViewportSettings({
      document,
      state: editorHost.internalState,
      workspace: editorHost.workspace,
    });
  };

  loadViewportForDocument(editorHost.internalDocument.getSnapshot());

  return editorHost.internalDocument.subscribe(loadViewportForDocument);
}
