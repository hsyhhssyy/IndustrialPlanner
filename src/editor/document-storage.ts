import {
  type WorldDocument,
  createWorldDocument,
} from "@/domain/document/world-document";
import {
  listFromIndexedDb,
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";
import { migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";
import { runInAction } from "mobx";

import { createLogger } from "@/shared/logging/logger";
import type { EditorHost } from "./editor-host";
import { ensureProtocolCoreEntity } from "./ensure-protocol-core";

const logger = createLogger("document-storage");

const DOCUMENT_DATABASE_NAME = "v3-industrial-planner";
const WORD_DOCUMENT_STORE_NAME = "worddocument";

export const WORLD_DOCUMENT_DATABASE_LOCATION = {
  databaseName: DOCUMENT_DATABASE_NAME,
  storeName: WORD_DOCUMENT_STORE_NAME,
};

export function hookDocumentStorage(editorHost: EditorHost): () => void {
  let disposed = false;
  let unsubscribeDocument: (() => void) | null = null;
  let writeQueue = Promise.resolve();

  const enqueueWrite = (
    document: WorldDocument,
  ): void => {
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(() => writeWorldDocument(document));
  };

  void (async () => {
    const initialDocument = await resolveInitialDocument(editorHost);

    if (disposed) {
      return;
    }

    rememberLatestWorldDocument(editorHost, initialDocument);
    editorHost.internalDocument.setSnapshot(initialDocument);
    enqueueWrite(initialDocument);

    unsubscribeDocument = editorHost.internalDocument.subscribe((document) => {
      rememberLatestWorldDocument(editorHost, document);
      enqueueWrite(document);
    });
  })();

  return () => {
    disposed = true;
    unsubscribeDocument?.();
    unsubscribeDocument = null;
  };
}

async function resolveInitialDocument(
  editorHost: EditorHost,
): Promise<WorldDocument> {
  const lastDocumentId = resolveLastDocumentId(editorHost);
  logger.info("resolveInitialDocument start", { lastDocumentId });

  let document: WorldDocument | null = null;

  if (lastDocumentId !== null) {
    document = await readWorldDocument(lastDocumentId);
    logger.info("resolveInitialDocument readWorldDocument", {
      lastDocumentId,
      found: document !== null,
      baseId: document?.baseId,
      entityCount: document !== null ? Object.keys(document.entities).length : 0,
    });
  } else {
    logger.info("resolveInitialDocument no lastDocumentId, will create new");
  }

  // 校验 baseId 有效性。IndexedDB 可能残留已废弃基地的旧文档，或 V2 迁移引入了不存在的 baseId。
  if (document !== null) {
    const isValidBase = editorHost.workspace.registry.baseDefinitions
      .some((definition) => definition.id === document!.baseId);
    if (!isValidBase) {
      logger.warn("resolveInitialDocument baseId invalid, discarding document", {
        baseId: document.baseId,
      });
      document = null;
    }
  }

  if (document === null) {
    document = createWorldDocument();
    logger.info("resolveInitialDocument created new document", {
      baseId: document.baseId,
      documentKey: document.documentKey,
    });
  }

  // 确保协议核心实体在首次加载时即存在，与 loadLatestBaseDocument 路径保持一致。
  const result = ensureProtocolCoreEntity({
    document,
    queries: editorHost.workspace.registry.queries,
  });

  logger.info("resolveInitialDocument done", {
    baseId: result.baseId,
    documentKey: result.documentKey,
    entityCount: Object.keys(result.entities).length,
    hasProtocolCore: Object.values(result.entities).some(
      (e) => editorHost.workspace.registry.queries.isProtocolCore(e.definitionId),
    ),
  });

  return result;
}

export async function readWorldDocument(
  documentKey: string,
): Promise<WorldDocument | null> {
  const persistedDocument = await readFromIndexedDb<unknown>(
    createWordDocumentLocation(documentKey),
  );

  const result = normalizeWorldDocument(persistedDocument);

  logger.info("readWorldDocument", {
    documentKey,
    hasRawData: persistedDocument !== undefined,
    normalized: result !== null,
    baseId: result?.baseId ?? null,
    entityCount: result !== null ? Object.keys(result.entities).length : 0,
  });

  return result;
}

export async function writeWorldDocument(
  document: WorldDocument,
): Promise<void> {
  await saveToIndexedDb(
    createWordDocumentLocation(document.documentKey),
    document,
  );
}

export async function listWorldDocuments(): Promise<WorldDocument[]> {
  const persistedDocuments = await listFromIndexedDb<unknown>(
    WORLD_DOCUMENT_DATABASE_LOCATION,
  );

  return persistedDocuments.flatMap((persistedDocument) => {
    const document = normalizeWorldDocument(persistedDocument);

    return document === null ? [] : [document];
  });
}

export async function resolveLatestWorldDocumentForBase(options: {
  baseId: string;
  latestDocumentIdByBaseId: Readonly<Record<string, string>>;
}): Promise<WorldDocument | null> {
  const latestDocumentId = options.latestDocumentIdByBaseId[options.baseId];

  logger.info("resolveLatestWorldDocumentForBase start", {
    baseId: options.baseId,
    latestDocumentId: latestDocumentId ?? null,
  });

  if (typeof latestDocumentId === "string" && latestDocumentId.trim() !== "") {
    const document = await readWorldDocument(latestDocumentId);

    if (document?.baseId === options.baseId) {
      logger.info("resolveLatestWorldDocumentForBase found by latestDocumentId", {
        baseId: options.baseId,
        documentKey: document.documentKey,
        entityCount: Object.keys(document.entities).length,
      });
      return document;
    }
  }

  const documents = await listWorldDocuments();
  const matched = documents.filter((d) => d.baseId === options.baseId);

  logger.info("resolveLatestWorldDocumentForBase listWorldDocuments", {
    baseId: options.baseId,
    totalDocuments: documents.length,
    matchedForBase: matched.length,
  });

  const result = matched.sort(compareWorldDocumentRecency)[0] ?? null;

  logger.info("resolveLatestWorldDocumentForBase done", {
    baseId: options.baseId,
    found: result !== null,
    documentKey: result?.documentKey ?? null,
    entityCount: result !== null ? Object.keys(result.entities).length : 0,
  });

  return result;
}

export async function listLatestWorldDocumentsByBase(
  latestDocumentIdByBaseId: Readonly<Record<string, string>>,
): Promise<Map<string, WorldDocument>> {
  const documents = await listWorldDocuments();
  const latestByBaseId = new Map<string, WorldDocument>();

  for (const document of documents) {
    const currentLatest = latestByBaseId.get(document.baseId);

    if (
      currentLatest === undefined
      || compareWorldDocumentRecency(document, currentLatest) < 0
    ) {
      latestByBaseId.set(document.baseId, document);
    }
  }

  for (const [baseId, documentKey] of Object.entries(latestDocumentIdByBaseId)) {
    const indexedDocument = await readWorldDocument(documentKey);

    if (indexedDocument?.baseId === baseId) {
      latestByBaseId.set(baseId, indexedDocument);
    }
  }

  return latestByBaseId;
}

export function rememberLatestWorldDocument(
  editorHost: EditorHost,
  document: WorldDocument,
): void {
  setLastDocumentId(editorHost, document.documentKey);
  setLatestDocumentIdByBaseId(editorHost, document.baseId, document.documentKey);
}

function createWordDocumentLocation(documentKey: string) {
  return {
    ...WORLD_DOCUMENT_DATABASE_LOCATION,
    key: documentKey,
  };
}

function resolveLastDocumentId(editorHost: EditorHost): string | null {
  const lastDocumentId =
    editorHost.internalState.internalPersistState.lastDocumentId;

  return typeof lastDocumentId === "string" && lastDocumentId.trim() !== ""
    ? lastDocumentId
    : null;
}

function setLastDocumentId(
  editorHost: EditorHost,
  documentKey: string,
): void {
  if (editorHost.internalState.internalPersistState.lastDocumentId === documentKey) {
    return;
  }

  runInAction(() => {
    editorHost.internalState.internalPersistState.lastDocumentId = documentKey;
  });
}

function setLatestDocumentIdByBaseId(
  editorHost: EditorHost,
  baseId: string,
  documentKey: string,
): void {
  if (
    editorHost.internalState.internalPersistState.latestDocumentIdByBaseId[baseId]
    === documentKey
  ) {
    return;
  }

  runInAction(() => {
    editorHost.internalState.internalPersistState.latestDocumentIdByBaseId = {
      ...editorHost.internalState.internalPersistState.latestDocumentIdByBaseId,
      [baseId]: documentKey,
    };
  });
}

function compareWorldDocumentRecency(left: WorldDocument, right: WorldDocument): number {
  const updatedAtDelta = timestampToNumber(right.meta.updatedAt) - timestampToNumber(left.meta.updatedAt);

  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  const createdAtDelta = timestampToNumber(right.meta.createdAt) - timestampToNumber(left.meta.createdAt);

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return right.documentKey.localeCompare(left.documentKey);
}

function timestampToNumber(value: string): number {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeWorldDocument(
  value: unknown,
): WorldDocument | null {
  if (!isWorldDocumentLike(value)) {
    return null;
  }

  // 2026-05-31: 反序列化时对 entityOrder 做去重，作为历史数据修复的最后防线。
  const migration = migrateBlueprintEntityDeviceIds(value.entities, value.schemaVersion);

  if (migration === null) {
    return null;
  }

  // 2026-07-23: 清理 entityOrder 中 entities 已不存在的无效 ID，
  // 修复历史删除操作未同步清理 entityOrder 导致计数虚高的问题。
  const validEntityOrder = Array.from(new Set(value.entityOrder))
    .filter((entityId) => entityId in migration.entities);

  return {
    ...value,
    schemaVersion: migration.schemaVersion,
    entities: migration.entities,
    entityOrder: validEntityOrder,
  };
}

function isWorldDocumentLike(
  value: unknown,
): value is WorldDocument {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === "number" &&
    typeof value.documentKey === "string" &&
    value.documentKey.trim() !== "" &&
    typeof value.baseId === "string" &&
    isRecord(value.meta) &&
    isRecord(value.entities) &&
    Array.isArray(value.entityOrder) &&
    Array.isArray(value.slotLinks) &&
    isWorldDocumentSettingsLike(value.documentSettings)
  );
}

function isWorldDocumentSettingsLike(
  value: unknown,
): value is WorldDocument["documentSettings"] {
  return (
    isRecord(value)
    && isWorldDocumentViewportSettingsLike(value.viewport)
  );
}

function isWorldDocumentViewportSettingsLike(
  value: unknown,
): value is WorldDocument["documentSettings"]["viewport"] {
  return (
    isRecord(value)
    && isRecord(value.center)
    && typeof value.center.x === "number"
    && Number.isFinite(value.center.x)
    && typeof value.center.y === "number"
    && Number.isFinite(value.center.y)
    && typeof value.gridSize === "number"
    && Number.isFinite(value.gridSize)
    && value.gridSize > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
