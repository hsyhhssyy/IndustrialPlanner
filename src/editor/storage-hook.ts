import { reaction, runInAction } from "mobx";

import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

import type { EditorHost } from "./editor-host";
import type { EditorInternalPersistStateReadWrite } from "./state-impl";

export const EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY = "v1-editor-persist-state";

export function hookLocalstorage(editorHost: EditorHost): () => void {
  const persistedInternalPersistState =
    readFromLocalStorage<unknown>(
      EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
    );

  if (persistedInternalPersistState !== null) {
    runInAction(() => {
      Object.assign(
        editorHost.internalState.internalPersistState,
        normalizePersistedEditorState(
          persistedInternalPersistState,
          editorHost.internalState.internalPersistState,
        ),
      );
    });
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

function normalizePersistedEditorState(
  value: unknown,
  fallback: EditorInternalPersistStateReadWrite,
): EditorInternalPersistStateReadWrite {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    lastDocumentId: typeof value.lastDocumentId === "string"
      && value.lastDocumentId.trim() !== ""
        ? value.lastDocumentId
        : null,
    latestDocumentIdByBaseId: normalizeLatestDocumentIdByBaseId(
      value.latestDocumentIdByBaseId,
    ),
  };
}

function normalizeLatestDocumentIdByBaseId(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([baseId, documentKey]) => {
      if (
        baseId.trim() === ""
        || typeof documentKey !== "string"
        || documentKey.trim() === ""
      ) {
        return [];
      }

      return [[baseId, documentKey]];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
