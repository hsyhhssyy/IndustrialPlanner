import type { WorldDocument } from "@/domain/document/world-document";

import {
  applyIndexedDbStoreMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  saveToIndexedDb,
  type IndexedDbMutationOperation,
  type IndexedDbStoreLocation,
} from "./browser-storage";

const DOCUMENT_DATABASE_NAME = "industrial-planner";
const WORD_DOCUMENT_STORE_NAME = "worddocument";

export const WORLD_DOCUMENT_DATABASE_LOCATION: IndexedDbStoreLocation = {
  databaseName: DOCUMENT_DATABASE_NAME,
  storeName: WORD_DOCUMENT_STORE_NAME,
};

export async function readWorldDocument(
  documentKey: string,
): Promise<WorldDocument | null> {
  const persistedDocument = await readFromIndexedDb<unknown>(
    createWordDocumentLocation(documentKey),
  );

  return normalizeWorldDocument(persistedDocument);
}

export async function writeWorldDocument(document: WorldDocument): Promise<void> {
  await saveToIndexedDb(
    createWordDocumentLocation(document.documentKey),
    document,
  );
}

export async function replaceWorldDocuments(
  documents: readonly WorldDocument[],
): Promise<boolean> {
  const existingDocuments = await listWorldDocuments();
  const operations: IndexedDbMutationOperation<WorldDocument>[] = [
    ...existingDocuments.map((document) => ({
      type: "delete" as const,
      key: document.documentKey,
    })),
    ...documents.map((document) => ({
      type: "put" as const,
      key: document.documentKey,
      value: document,
    })),
  ];

  return await applyIndexedDbStoreMutations(WORLD_DOCUMENT_DATABASE_LOCATION, operations);
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

  if (typeof latestDocumentId === "string" && latestDocumentId.trim() !== "") {
    const document = await readWorldDocument(latestDocumentId);

    if (document?.baseId === options.baseId) {
      return document;
    }
  }

  const documents = await listWorldDocuments();

  return documents
    .filter((document) => document.baseId === options.baseId)
    .sort(compareWorldDocumentRecency)[0] ?? null;
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

export function normalizeWorldDocument(
  value: unknown,
): WorldDocument | null {
  if (!isWorldDocumentLike(value)) {
    return null;
  }

  // 2026-05-31: 反序列化时对 entityOrder 做去重，作为历史数据修复的最后防线。
  return {
    ...value,
    entityOrder: Array.from(new Set(value.entityOrder)),
  };
}

function createWordDocumentLocation(documentKey: string) {
  return {
    ...WORLD_DOCUMENT_DATABASE_LOCATION,
    key: documentKey,
  };
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
