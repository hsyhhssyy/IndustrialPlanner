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
// AI-CORRECTION 2026-08-20: schema 2 标记历史快照已执行一次设备方向迁移，避免每次读取重复旋转。
const EDITOR_HISTORY_STORAGE_SCHEMA_VERSION = 2;

export interface PersistedEditorHistoryState {
  readonly schemaVersion: typeof EDITOR_HISTORY_STORAGE_SCHEMA_VERSION;
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
  const normalizedState = normalizePersistedEditorHistoryState(persistedState, documentKey);

  if (
    normalizedState !== null
    && isRecord(persistedState)
    && persistedState.schemaVersion === 1
  ) {
    await writeEditorHistoryState(normalizedState);
  }

  return normalizedState;
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
    || (value.schemaVersion !== 1 && value.schemaVersion !== EDITOR_HISTORY_STORAGE_SCHEMA_VERSION)
    || value.documentKey !== expectedDocumentKey
    || typeof value.cursorSequence !== "number"
    || !Array.isArray(value.records)
  ) {
    return null;
  }

  return {
    schemaVersion: EDITOR_HISTORY_STORAGE_SCHEMA_VERSION,
    documentKey: value.documentKey,
    cursorSequence: Math.max(0, Math.floor(value.cursorSequence)),
    records: value.records
      .filter(isEditorHistoryRecordLike)
      .map((record) => value.schemaVersion === 1
        ? migrateEditorHistoryRecordDeviceIds(record)
        : record),
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
  return migrateBlueprintEntityDeviceIds({
    entity: {
      id: "history-definition-id",
      definitionId,
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
  }, 1, 4)?.entities.entity?.definitionId ?? definitionId;
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
