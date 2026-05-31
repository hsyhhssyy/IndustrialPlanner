import {
  type WorldDocument,
  createWorldDocument,
} from "@/domain/document/world-document";
import {
  listFromIndexedDb,
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";
import { runInAction } from "mobx";

import type { EditorHost } from "./editor-host";

const DOCUMENT_DATABASE_NAME = "industrial-planner";
const WORD_DOCUMENT_STORE_NAME = "worddocument";

export const WORLD_DOCUMENT_DATABASE_LOCATION = {
  databaseName: DOCUMENT_DATABASE_NAME,
  storeName: WORD_DOCUMENT_STORE_NAME,
};

export function hookDocumentStorage(editorHost: EditorHost): () => void {
  let disposed = false;
  let unsubscribeDocument: (() => void) | null = null;
  let writeQueue = Promise.resolve();

  const enqueueWrite = (document: WorldDocument): void => {
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

  if (lastDocumentId !== null) {
    const persistedDocument = await readWorldDocument(lastDocumentId);

    if (persistedDocument !== null) {
      return persistedDocument;
    }
  }

  return createWorldDocument();
}

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
  return {
    ...value,
    entityOrder: Array.from(new Set(value.entityOrder)),
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
