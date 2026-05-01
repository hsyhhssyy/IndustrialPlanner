import {
  DEFAULT_WORLD_BASE_ID,
  type WorldDocument,
  createWorldDocument,
} from "@/domain/entity/world-document";
import {
  readFromIndexedDbWithMigration,
  saveToIndexedDbWithVersion,
  type StorageMigration,
} from "@/shared/storage";
import { runInAction } from "mobx";

import type { EditorHost } from "./editor-host";

const DOCUMENT_DATABASE_NAME = "industrial-planner";
const WORD_DOCUMENT_STORE_NAME = "worddocument";
const WORLD_DOCUMENT_PERSIST_VERSION = 1;

interface WorldDocumentPersistContext {
  fallbackDocumentKey: string;
  fallbackBaseId: string;
  validBaseIds: ReadonlySet<string>;
}

const WORLD_DOCUMENT_PERSIST_MIGRATIONS: readonly StorageMigration<
  WorldDocument,
  WorldDocumentPersistContext
>[] = [
  {
    version: WORLD_DOCUMENT_PERSIST_VERSION,
    migrate(value, context) {
      return normalizeWorldDocument(value, context);
    },
  },
];

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
    const persistedDocument = await readWorldDocument(editorHost, lastDocumentId);

    if (persistedDocument !== null) {
      return persistedDocument;
    }
  }

  return createWorldDocument();
}

async function readWorldDocument(
  editorHost: EditorHost,
  documentKey: string,
): Promise<WorldDocument | null> {
  const context = createWorldDocumentPersistContext(editorHost, documentKey);
  const persistedDocument = await readFromIndexedDbWithMigration(
    createWordDocumentLocation(documentKey),
    WORLD_DOCUMENT_PERSIST_VERSION,
    WORLD_DOCUMENT_PERSIST_MIGRATIONS,
    context,
  );

  return normalizeWorldDocument(persistedDocument, context);
}

async function writeWorldDocument(document: WorldDocument): Promise<void> {
  await saveToIndexedDbWithVersion(
    createWordDocumentLocation(document.documentKey),
    WORLD_DOCUMENT_PERSIST_VERSION,
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
  context: WorldDocumentPersistContext,
): WorldDocument | null {
  if (!isWorldDocumentLike(value)) {
    return null;
  }

  const documentKey =
    typeof value.documentKey === "string" && value.documentKey.trim() !== ""
      ? value.documentKey
      : context.fallbackDocumentKey;

  return {
    ...value,
    documentKey,
    baseId: normalizeBaseId(value.baseId, context),
  };
}

function createWorldDocumentPersistContext(
  editorHost: EditorHost,
  fallbackDocumentKey: string,
): WorldDocumentPersistContext {
  const baseDefinitions = editorHost.workspace.registry.baseDefinitions;
  const validBaseIds = new Set(
    baseDefinitions.map((definition) => definition.id),
  );

  return {
    fallbackDocumentKey,
    fallbackBaseId:
      baseDefinitions.find((definition) => definition.id === DEFAULT_WORLD_BASE_ID)
        ?.id
      ?? baseDefinitions[0]?.id
      ?? DEFAULT_WORLD_BASE_ID,
    validBaseIds,
  };
}

function normalizeBaseId(
  baseId: string,
  context: WorldDocumentPersistContext,
): string {
  return context.validBaseIds.has(baseId) ? baseId : context.fallbackBaseId;
}

function isWorldDocumentLike(
  value: unknown,
): value is Omit<WorldDocument, "documentKey"> & { documentKey?: unknown } {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === "number" &&
    typeof value.baseId === "string" &&
    isRecord(value.meta) &&
    isRecord(value.entities) &&
    Array.isArray(value.entityOrder) &&
    Array.isArray(value.explicitLinks) &&
    isRecord(value.documentSettings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
