import type {
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";

const DOCUMENT_DATABASE_NAME = "industrial-planner";
const EDITOR_HISTORY_STORE_NAME = "editorhistory";

export interface PersistedEditorHistoryState {
  readonly schemaVersion: 1;
  readonly documentKey: string;
  readonly cursorSequence: number;
  readonly records: readonly EditorHistoryRecord[];
}

export async function readEditorHistoryState(
  documentKey: string,
): Promise<PersistedEditorHistoryState | null> {
  const persistedState = await readFromIndexedDb<unknown>(
    createEditorHistoryLocation(documentKey),
  );

  return normalizePersistedEditorHistoryState(persistedState, documentKey);
}

export async function writeEditorHistoryState(
  historyState: PersistedEditorHistoryState,
): Promise<void> {
  await saveToIndexedDb(
    createEditorHistoryLocation(historyState.documentKey),
    historyState,
  );
}

function createEditorHistoryLocation(documentKey: string) {
  return {
    databaseName: DOCUMENT_DATABASE_NAME,
    storeName: EDITOR_HISTORY_STORE_NAME,
    key: documentKey,
  };
}

function normalizePersistedEditorHistoryState(
  value: unknown,
  expectedDocumentKey: string,
): PersistedEditorHistoryState | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.documentKey !== expectedDocumentKey
    || typeof value.cursorSequence !== "number"
    || !Array.isArray(value.records)
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    documentKey: value.documentKey,
    cursorSequence: Math.max(0, Math.floor(value.cursorSequence)),
    records: value.records.filter(isEditorHistoryRecordLike),
  };
}

function isEditorHistoryRecordLike(value: unknown): value is EditorHistoryRecord {
  return (
    isRecord(value)
    && value.schemaVersion === 1
    && typeof value.id === "string"
    && typeof value.documentKey === "string"
    && typeof value.sequence === "number"
    && typeof value.createdAt === "string"
    && isRecord(value.action)
    && isRecord(value.delta)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
