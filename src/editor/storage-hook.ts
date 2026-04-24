import { reaction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { EditorHost } from "./editor-host";
import type { EditorInternalPersistStateReadWrite } from "./state-impl";

export const EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY = "v1-editor-persist-state";

export function hookLocalstorage(editorHost: EditorHost): () => void {
  const persistedInternalPersistState =
    readFromLocalStorage<EditorInternalPersistStateReadWrite>(
      EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
    );

  if (persistedInternalPersistState !== null) {
    editorHost.internalState.internalPersistState = persistedInternalPersistState;
  }

  return reaction(
    () => JSON.stringify(editorHost.internalState.internalPersistState),
    () => {
      saveToLocalStorage<EditorInternalPersistStateReadWrite>(
        EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
        editorHost.internalState.internalPersistState,
      );
    },
  );
}