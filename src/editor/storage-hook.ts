import { reaction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { EditorHost } from "./editor-host";
import type { EditorInternalPersistStateReadWrite } from "./state-impl";

export const EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY = "v1-editor-persist-state";

export function hookLocalstorage(editorHost: EditorHost): () => void {
  hydrateInternalPersistState(
    editorHost,
    readFromLocalStorage<unknown>(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY),
  );

  return reaction(
    () => getInternalPersistStateSnapshot(editorHost),
    (internalPersistState) => {
      saveToLocalStorage(
        EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
        internalPersistState,
      );
    },
  );
}

function hydrateInternalPersistState(
  editorHost: EditorHost,
  persistedState: unknown,
): void {
  if (!isRecord(persistedState)) {
    return;
  }

  if (
    typeof persistedState.lastDocumentId === "string" ||
    persistedState.lastDocumentId === null
  ) {
    editorHost.internalState.internalPersistState.lastDocumentId =
      persistedState.lastDocumentId;
  }
}

function getInternalPersistStateSnapshot(
  editorHost: EditorHost,
): EditorInternalPersistStateReadWrite {
  return {
    lastDocumentId: editorHost.internalState.internalPersistState.lastDocumentId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}