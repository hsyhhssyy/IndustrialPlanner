import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type {
  EditorHistoryRecord,
} from "@/domain/editor/editor-history";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { migrateBlueprintDocumentState, migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";

const DOCUMENT_DATABASE_NAME = "v3-industrial-planner";
const EDITOR_HISTORY_STORE_NAME = "editorhistory";
// AI-CORRECTION 2026-08-20: schema 2 标记历史快照已执行一次设备方向迁移，避免每次读取重复旋转。
// AI-CORRECTION 2026-09-09: schema 3 标记 record 已升级为 schema 2 并显式携带区域差量。
const EDITOR_HISTORY_STORAGE_SCHEMA_VERSION = 3;

export interface PersistedEditorHistoryState {
  readonly schemaVersion: typeof EDITOR_HISTORY_STORAGE_SCHEMA_VERSION;
  readonly documentSchemaVersion?: number;
  readonly documentKey: string;
  readonly cursorSequence: number;
  readonly records: readonly EditorHistoryRecord[];
}

export async function readEditorHistoryState(
  documentKey: string,
): Promise<PersistedEditorHistoryState | null> {
  const persistedState = await readFromIndexedDb<unknown>(
    createEditorHistoryLocation(documentKey),
    { strict: true },
  );
  const document = persistedState === null ? null : await readFromIndexedDb<WorldDocument>({
    databaseName: DOCUMENT_DATABASE_NAME, storeName: "worddocument", key: documentKey,
  }, { strict: true });
  const normalizedState = normalizePersistedEditorHistoryState(persistedState, documentKey, document);
  if (persistedState !== null && normalizedState === null) throw new Error("Invalid editor history; original records were preserved.");

// AI-REMOVED 2026-10-08:
// Reason: 历史读取不再独立写回，写入归全局迁移提交。
// Trigger: REQ-041 全局迁移。
// Evidence: 启动、读取与同步调用链审查。
// Replacement: src/editor/data-migration.ts
// Risk: 需验证全库迁移与中断恢复。
// Human Review: Required
// Original code:
//   if (
//     normalizedState !== null
//     && isRecord(persistedState)
//     && persistedState.documentSchemaVersion !== BLUEPRINT_SCHEMA_VERSION
//   ) {
//     await writeEditorHistoryState(normalizedState);
//   }


  return normalizedState;
}

export async function writeEditorHistoryState(
  historyState: PersistedEditorHistoryState,
): Promise<void> {
  await saveToIndexedDb(
    createEditorHistoryLocation(historyState.documentKey),
    { ...historyState, documentSchemaVersion: BLUEPRINT_SCHEMA_VERSION },
  );
}

function createEditorHistoryLocation(documentKey: string) {
  return {
    databaseName: DOCUMENT_DATABASE_NAME,
    storeName: EDITOR_HISTORY_STORE_NAME,
    key: documentKey,
  };
}

export function normalizePersistedEditorHistoryState(
  value: unknown,
  expectedDocumentKey: string,
  document: WorldDocument | null,
): PersistedEditorHistoryState | null {
  if (
    !isRecord(value)
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== EDITOR_HISTORY_STORAGE_SCHEMA_VERSION)
    || value.documentKey !== expectedDocumentKey
    || typeof value.cursorSequence !== "number"
    || !Array.isArray(value.records)
  ) {
    return null;
  }

  // 包装 schema 2 来自已发布的蓝图 schema 5；包装 schema 3 最早随蓝图 schema 6 引入。
  const sourceSchema = typeof value.documentSchemaVersion === "number"
    ? value.documentSchemaVersion : value.schemaVersion === 1 ? 1 : value.schemaVersion === 2 ? 5 : 6;
  if (!Number.isInteger(sourceSchema) || sourceSchema < 1 || sourceSchema > BLUEPRINT_SCHEMA_VERSION
    || !value.records.every(isEditorHistoryRecordLike)) return null;
  const context = { ...document?.entities };
  for (const item of value.records) {
    const record = item as unknown as EditorHistoryRecord;
    Object.assign(context, record.delta.entities.added, record.delta.entities.removed);
    for (const [id, change] of Object.entries(record.delta.entities.updated)) context[id] = change.after;
  }
  const sortedRecords = (value.records as Record<string, unknown>[])
    .slice()
    .sort((left, right) => (left.sequence as number) - (right.sequence as number));
  const storedCursorSequence = value.cursorSequence;
  const cursorIndex = sortedRecords.filter(record => (record.sequence as number) <= storedCursorSequence).length;
  const migrationResults = sortedRecords.map((record) => {
    try {
      return {
        record: normalizeEditorHistoryRecord(
          sourceSchema < BLUEPRINT_SCHEMA_VERSION
            ? migrateEditorHistoryRecordDeviceIds(record, sourceSchema, context, document?.baseId)
            : record,
        ),
        error: null,
      };
    } catch (error) {
      return { record: null, error };
    }
  });
  const lastFailedUndoIndex = migrationResults
    .slice(0, cursorIndex)
    .findLastIndex(result => result.error !== null);
  const firstFailedRedoOffset = migrationResults
    .slice(cursorIndex)
    .findIndex(result => result.error !== null);
  const retainedStart = lastFailedUndoIndex + 1;
  const retainedEnd = firstFailedRedoOffset < 0
    ? migrationResults.length
    : cursorIndex + firstFailedRedoOffset;
  const retainedRecords = migrationResults
    .slice(retainedStart, retainedEnd)
    .map((result, index) => ({
      ...result.record!,
      sequence: index + 1,
    }));
  const failedResults = migrationResults.flatMap((result, index) => result.error === null ? [] : [{
    sequence: sortedRecords[index]?.sequence,
    error: String(result.error),
  }]);
  if (failedResults.length > 0) {
    console.warn("Editor history migration truncated incompatible records.", {
      documentKey: value.documentKey,
      failedRecords: failedResults,
      discardedBefore: retainedStart,
      discardedAfter: migrationResults.length - retainedEnd,
      retained: retainedRecords.length,
    });
  }
  // AI-REMOVED 2026-09-28:
  // Reason: 整批迁移会让单条不可恢复的旧历史阻断当前蓝图的全部撤销记录，并误报为本地存储故障。
  // Trigger: v1.5.1-beta1 实际数据中的旧连接缺少两端实体，历史迁移拒绝加载。
  // Evidence: 日志报错 Cannot migrate history links without their entities；逐条迁移可保留当前游标所在连续区间。
  // Replacement: 上方 migrationResults、retainedStart、retainedEnd 与下方重新编号后的返回值。
  // Risk: 无法跨越的历史断点及其外侧记录会被截断；当前文档正文不受影响。
  // Human Review: Required
  //
  // Original code:
  // return {
  //   schemaVersion: EDITOR_HISTORY_STORAGE_SCHEMA_VERSION,
  //   documentSchemaVersion: BLUEPRINT_SCHEMA_VERSION,
  //   documentKey: value.documentKey,
  //   cursorSequence: Math.max(0, Math.floor(value.cursorSequence)),
  //   records: value.records.map(record => normalizeEditorHistoryRecord(
  //     sourceSchema < BLUEPRINT_SCHEMA_VERSION
  //       ? migrateEditorHistoryRecordDeviceIds(record, sourceSchema, context, document?.baseId)
  //       : record,
  //   )),
  // };
  return {
    schemaVersion: EDITOR_HISTORY_STORAGE_SCHEMA_VERSION,
    documentSchemaVersion: BLUEPRINT_SCHEMA_VERSION,
    documentKey: value.documentKey,
    cursorSequence: Math.max(0, cursorIndex - retainedStart),
    records: retainedRecords,
  };
}

function migrateEditorHistoryRecordDeviceIds(
  record: Record<string, unknown>, sourceSchema: number,
  context: Record<string, WorldEntity>, baseId?: string,
): Record<string, unknown> {
  // 2026-10-08：6→7 是空步骤，不需要解析历史连接端点，也不能因此截断原本有效的历史。
  if (sourceSchema === 6 && BLUEPRINT_SCHEMA_VERSION === 7) return record;
  const typedRecord = record as unknown as EditorHistoryRecord;
  return {
    ...typedRecord,
    action: {
      ...typedRecord.action,
      definitionIds: typedRecord.action.definitionIds?.map(id => migrateHistoryDefinitionId(id, sourceSchema)),
    },
    delta: {
      ...typedRecord.delta,
      slotLinks: typedRecord.delta.slotLinks === null ? null : {
        before: migrateHistoryLinks(typedRecord.delta.slotLinks.before, context, sourceSchema, baseId),
        after: migrateHistoryLinks(typedRecord.delta.slotLinks.after, context, sourceSchema, baseId),
      },
      entities: {
        added: migrateHistoryEntityRecord(typedRecord.delta.entities.added, sourceSchema, baseId),
        removed: migrateHistoryEntityRecord(typedRecord.delta.entities.removed, sourceSchema, baseId),
        updated: Object.fromEntries(
          Object.entries(typedRecord.delta.entities.updated).map(([entityId, change]) => [
            entityId,
            {
              before: migrateHistoryEntity(change.before, sourceSchema, baseId),
              after: migrateHistoryEntity(change.after, sourceSchema, baseId),
            },
          ]),
        ),
      },
    },
  };
}

function normalizeEditorHistoryRecord(record: Record<string, unknown>): EditorHistoryRecord {
  const typedRecord = record as unknown as EditorHistoryRecord;
  const deltaRecord = typedRecord.delta as unknown as Record<string, unknown>;

  return {
    ...typedRecord,
    schemaVersion: 2,
    delta: {
      ...typedRecord.delta,
      regions: record.schemaVersion === 2 && "regions" in deltaRecord
        ? typedRecord.delta.regions
        : null,
    },
  };
}

function migrateHistoryEntityRecord(
  entities: Readonly<Record<string, WorldEntity>>, sourceSchema: number, baseId?: string,
): Record<string, WorldEntity> {
  const migrated = migrateBlueprintDocumentState({
    baseId, entities: { ...entities }, entityOrder: Object.keys(entities), slotLinks: [], regions: [],
  }, sourceSchema);
  if (migrated === null) throw new Error("Cannot migrate editor history entities.");
  return migrated.entities;
}

function migrateHistoryEntity(entity: WorldEntity, sourceSchema: number, baseId?: string): WorldEntity {
  return migrateHistoryEntityRecord({ entity }, sourceSchema, baseId).entity ?? entity;
}

function migrateHistoryDefinitionId(definitionId: string, sourceSchema: number): string {
  return migrateBlueprintEntityDeviceIds({
    entity: {
      id: "history-definition-id",
      definitionId,
      position: { x: 0, y: 0 },
      rotation: 0,
      config: {},
      tags: [],
    },
  }, sourceSchema, BLUEPRINT_SCHEMA_VERSION)?.entities.entity?.definitionId ?? definitionId;
}

function isEditorHistoryRecordLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value)
    && (value.schemaVersion === 1 || value.schemaVersion === 2)
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

// AI-REMOVED 2026-09-28:
// Reason: 包装版本不能代替正文版本；过滤损坏记录会静默丢失历史。
// Trigger: schema 2 历史重放把 schema 5 实体写回 schema 6 文档。
// Evidence: 读取后撤销复现旧 ID 与旧朝向。
// Replacement: normalizePersistedEditorHistoryState 的显式 documentSchemaVersion 和严格校验。
// Risk: 无法读取时停止历史加载，保留原件。
// Human Review: Required
// Original code:
//   return {
//     schemaVersion: EDITOR_HISTORY_STORAGE_SCHEMA_VERSION,
//     documentKey: value.documentKey,
//     cursorSequence: Math.max(0, Math.floor(value.cursorSequence)),
//     records: value.records
//       .filter(isEditorHistoryRecordLike)
//       .map((record) => normalizeEditorHistoryRecord(
//         value.schemaVersion === 1
//           ? migrateEditorHistoryRecordDeviceIds(record)
//           : record,
//       )),
//   };
// }

function migrateHistoryLinks(
  links: Readonly<WorldDocument["slotLinks"]>, context: Record<string, WorldEntity>, sourceSchema: number, baseId?: string,
): Readonly<WorldDocument["slotLinks"]> {
  if (links.some(link => context[link.source.entityId] === undefined || context[link.target.entityId] === undefined)) {
    throw new Error("Cannot migrate history links without their entities; original history was preserved.");
  }
  const migrated = migrateBlueprintDocumentState({
    baseId, entities: context, entityOrder: Object.keys(context), slotLinks: links, regions: [],
  }, sourceSchema);
  if (migrated === null) throw new Error("Cannot migrate editor history links.");
  return migrated.slotLinks;
}
