import type {
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import type { WorldEntity } from "@/domain/document/world-document";
import { migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";

const DOCUMENT_DATABASE_NAME = "v3-industrial-planner";
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
    records: value.records
      .filter(isEditorHistoryRecordLike)
      .map(migrateEditorHistoryRecordDeviceIds),
  };
}

function migrateEditorHistoryRecordDeviceIds(record: EditorHistoryRecord): EditorHistoryRecord {
  return {
    ...record,
    action: {
      ...record.action,
      definitionIds: record.action.definitionIds?.map(migrateHistoryDefinitionId),
    },
    delta: {
      ...record.delta,
      entities: {
        added: migrateHistoryEntityRecord(record.delta.entities.added),
        removed: migrateHistoryEntityRecord(record.delta.entities.removed),
        updated: Object.fromEntries(
          Object.entries(record.delta.entities.updated).map(([entityId, change]) => [
            entityId,
            {
              before: migrateHistoryEntity(change.before),
              after: migrateHistoryEntity(change.after),
            },
          ]),
        ),
      },
    },
  };
}

function migrateHistoryEntityRecord(
  entities: Readonly<Record<string, WorldEntity>>,
): Record<string, WorldEntity> {
  return migrateBlueprintEntityDeviceIds({ ...entities }, 1)?.entities ?? { ...entities };
}

function migrateHistoryEntity(entity: WorldEntity): WorldEntity {
  return migrateHistoryEntityRecord({ entity }).entity ?? entity;
}

function migrateHistoryDefinitionId(definitionId: string): string {
  return migrateHistoryEntity({
    id: "history-definition-id",
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  }).definitionId;
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
