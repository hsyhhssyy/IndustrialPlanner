import type { WorldDocument } from "@/domain/document/world-document";
import { EditorContract } from "@/domain/editor/editor-contract";
import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { runInAction } from "mobx";
import { createWorldDocument } from "@/domain/document/world-document";
import {
  createSnapshotStore,
  SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import { createEditorActions } from "./actions";
import { applyWorldDocumentViewportSettings, createViewportPersistence } from "./document-viewport";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { createSnapshotSelector, shallowSnapshotEqual } from "@/shared/snapshot/snapshot-selector";
import { selectDocumentEntities } from "@/shared/snapshot/world-document-selection";
import { hookDocumentStorage } from "./document-storage";
import {
  createEditorDocumentWriter,
  EditorDocumentWriter,
  EditorHistoryRuntime,
} from "./history";
import { createEditorQueries } from "./queries";
import { syncPlacementValidationState } from "./placement-validation";
import { syncPoweredEntityCollection } from "./actions/powered-collection";
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
  let publishedDocument: WorldDocument | null = null;
  const internalDocument = createSnapshotStore(createWorldDocument(), (nextDocument) => {
    if (publishedDocument !== null && publishedDocument.documentKey !== nextDocument.documentKey) {
      viewportPersistence?.flush();
    }
    publishedDocument = freezeSnapshot(nextDocument);
    return publishedDocument;
  });
  const editorState = createEditorStateReadWrite();
  const internalHistory = new EditorHistoryRuntime(editorState.history);
  const internalDocumentWriter = createEditorDocumentWriter({
    document: internalDocument,
    history: internalHistory,
  });
  const viewportPersistence = createViewportPersistence({
    document: internalDocument,
    documentWriter: internalDocumentWriter,
    state: editorState,
  });
  const actions: EditorContract["actions"] = createEditorActions({
    document: internalDocument,
    documentWriter: internalDocumentWriter,
    history: internalHistory,
    state: editorState,
    workspace,
    persistViewportSettings: viewportPersistence.schedule,
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
    regionAnnotations: editorState.regionAnnotations,
    collections: editorState.collections,
    get hoverTarget() {
      return editorState.hoverTarget;
    },
    get suppressBelts() {
      return editorState.suppressBelts;
    },
    get suppressPipes() {
      return editorState.suppressPipes;
    },
  };

  const host: EditorHost = {
    document: {
      getSnapshot: internalDocument.getSnapshot,
      subscribe: internalDocument.subscribe,
    },
    state: publicState,
    internalDocument,
    internalDocumentWriter,
    internalHistory,
    workspace,
    dispose: () => {
      viewportPersistence?.dispose();
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
  disposers.push(hookPoweredCollection(host));
  disposers.push(hookLocalstorage(host));
  disposers.push(hookDocumentStorage(host));

  return host;
}

function hookPlacementValidation(editorHost: EditorHost): () => void {
  return createSnapshotSelector(editorHost.internalDocument, selectDocumentEntities, shallowSnapshotEqual).subscribe(() => {
    const document = editorHost.internalDocument.getSnapshot();
    runInAction(() => {
      syncPlacementValidationState({
        document,
        state: editorHost.internalState,
        workspace: editorHost.workspace,
      });
    });
  });
}

function hookPoweredCollection(editorHost: EditorHost): () => void {
  return createSnapshotSelector(editorHost.internalDocument, selectDocumentEntities, shallowSnapshotEqual).subscribe(() => {
    const document = editorHost.internalDocument.getSnapshot();
    runInAction(() => {
      syncPoweredEntityCollection({
        document,
        state: editorHost.internalState,
        workspace: editorHost.workspace,
      });
    });
  });
}

function hookDocumentHistory(editorHost: EditorHost): () => void {
  let documentKey: string | null = null;

  return editorHost.internalDocument.subscribe((document) => {
    if (documentKey === document.documentKey) {
      return;
    }

    documentKey = document.documentKey;
    editorHost.internalHistory.loadDocumentHistory(document.documentKey);
  });
}

function hookDocumentViewport(editorHost: EditorHost): () => void {
  let documentKey: string | null = null;

  return editorHost.internalDocument.subscribe((document) => {
    if (documentKey === document.documentKey) {
      return;
    }

    documentKey = document.documentKey;
    runInAction(() => {
      applyWorldDocumentViewportSettings({
        document,
        state: editorHost.internalState,
        workspace: editorHost.workspace,
      });
    });
  });
}
