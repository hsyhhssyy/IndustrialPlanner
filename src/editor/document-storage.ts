import {
  type WorldDocument,
  createWorldDocument,
} from "@/domain/entity/world-document";
import {
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";
import { runInAction } from "mobx";

import type { EditorHost } from "./editor-host";

const DOCUMENT_DATABASE_NAME = "industrial-planner";
const WORD_DOCUMENT_STORE_NAME = "worddocument";

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

    setLastDocumentId(editorHost, initialDocument.documentKey);
    editorHost.internalDocument.setSnapshot(initialDocument);
    enqueueWrite(initialDocument);

    unsubscribeDocument = editorHost.internalDocument.subscribe((document) => {
      setLastDocumentId(editorHost, document.documentKey);
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

async function readWorldDocument(
  documentKey: string,
): Promise<WorldDocument | null> {
  const persistedDocument = await readFromIndexedDb<unknown>(
    createWordDocumentLocation(documentKey),
  );

  return normalizeWorldDocument(persistedDocument);
}

async function writeWorldDocument(document: WorldDocument): Promise<void> {
  await saveToIndexedDb(
    createWordDocumentLocation(document.documentKey),
    document,
  );
}

function createWordDocumentLocation(documentKey: string) {
  return {
    databaseName: DOCUMENT_DATABASE_NAME,
    storeName: WORD_DOCUMENT_STORE_NAME,
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

function normalizeWorldDocument(
  value: unknown,
): WorldDocument | null {
  if (!isWorldDocumentLike(value)) {
    return null;
  }

  return value;
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
    isRecord(value.documentSettings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
