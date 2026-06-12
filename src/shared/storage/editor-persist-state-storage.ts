import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "./browser-storage";

export const EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY = "v1-editor-persist-state";

export interface EditorPersistState {
  lastDocumentId: string | null;
  latestDocumentIdByBaseId: Record<string, string>;
}

export function readEditorPersistState(
  fallback: EditorPersistState = createEmptyEditorPersistState(),
): EditorPersistState {
  const persistedState = readFromLocalStorage<unknown>(
    EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
  );

  return normalizeEditorPersistState(persistedState, fallback);
}

export function writeEditorPersistState(
  state: EditorPersistState,
): EditorPersistState {
  const normalizedState = normalizeEditorPersistState(state, createEmptyEditorPersistState());

  return saveToLocalStorage<EditorPersistState>(
    EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
    normalizedState,
  );
}

export function normalizeEditorPersistState(
  value: unknown,
  fallback: EditorPersistState = createEmptyEditorPersistState(),
): EditorPersistState {
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

function createEmptyEditorPersistState(): EditorPersistState {
  return {
    lastDocumentId: null,
    latestDocumentIdByBaseId: {},
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
