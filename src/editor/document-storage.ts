import {
  type WorldDocument,
  createWorldDocument,
} from "@/domain/document/world-document";
import {
  listFromIndexedDb,
  readFromIndexedDb,
  saveToIndexedDb,
} from "@/shared/storage";
import { ENABLE_LOCAL_SYNC_SHADOW_MODE } from "@/shared/storage/sync-shadow-build-flags";
import { writeWorldDocumentShadowSaveWithResult } from "@/shared/storage/sync-shadow-storage";
import {
  LOCAL_SYNC_TELEMETRY_MIN_INTERVAL_MS,
  tryUploadLocalSyncTelemetry,
} from "@/shared/storage/sync-telemetry-upload";
import { migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";
import type { EditorHistoryDocumentDelta } from "@/domain/editor/editor-history";
import { runInAction } from "mobx";

import type { EditorHost } from "./editor-host";
import { createWorldDocumentDelta } from "./history";
import { createSyncShadowReplayValidator } from "./sync-shadow-replay-validator";

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
  let shadowQueue = Promise.resolve();
  let lastShadowBaseDocument: WorldDocument | null = null;
  let telemetryHeartbeatId: ReturnType<typeof globalThis.setInterval> | null = null;
  const shadowReplayValidator = createSyncShadowReplayValidator();

  if (ENABLE_LOCAL_SYNC_SHADOW_MODE) {
    void tryUploadLocalSyncTelemetry({ trigger: "sync-shadow-heartbeat" });
    telemetryHeartbeatId = globalThis.setInterval(() => {
      void tryUploadLocalSyncTelemetry({ trigger: "sync-shadow-heartbeat" });
    }, LOCAL_SYNC_TELEMETRY_MIN_INTERVAL_MS);
    unrefTimer(telemetryHeartbeatId);
  }

  const enqueueWrite = (
    document: WorldDocument,
    options: {
      baseDocument?: WorldDocument;
      delta?: EditorHistoryDocumentDelta | null;
      recordShadow?: boolean;
    } = {},
  ): void => {
    const snapshotWrite = writeQueue
      .catch(() => undefined)
      .then(() => writeWorldDocument(document, { recordShadow: false }));

    writeQueue = snapshotWrite;

    if (options.recordShadow === false || !ENABLE_LOCAL_SYNC_SHADOW_MODE) {
      return;
    }

    shadowQueue = shadowQueue
      .catch(() => undefined)
      .then(() => snapshotWrite)
      .then(async () => {
        const result = await writeWorldDocumentShadowSaveWithResult({
          document,
          baseDocument: options.baseDocument,
          delta: options.delta,
        });

        if (result !== null && options.baseDocument !== undefined) {
          shadowReplayValidator.validate({
            baseDocument: options.baseDocument,
            outboxEntry: result.outboxEntry,
          });
        }
      });
  };

  void (async () => {
    const initialDocument = await resolveInitialDocument(editorHost);

    if (disposed) {
      return;
    }

    rememberLatestWorldDocument(editorHost, initialDocument);
    editorHost.internalDocument.setSnapshot(initialDocument);
    lastShadowBaseDocument = initialDocument;
    enqueueWrite(initialDocument, { recordShadow: false });

    unsubscribeDocument = editorHost.internalDocument.subscribe((document) => {
      rememberLatestWorldDocument(editorHost, document);
      const baseDocument = lastShadowBaseDocument;
      const delta = baseDocument === null
        ? null
        : createWorldDocumentDelta(baseDocument, document);

      lastShadowBaseDocument = document;
      enqueueWrite(document, {
        baseDocument: baseDocument ?? undefined,
        delta,
      });
    });
  })();

  return () => {
    disposed = true;
    unsubscribeDocument?.();
    unsubscribeDocument = null;
    if (telemetryHeartbeatId !== null) {
      globalThis.clearInterval(telemetryHeartbeatId);
      telemetryHeartbeatId = null;
    }
    shadowReplayValidator.dispose();
  };
}

function unrefTimer(timer: ReturnType<typeof globalThis.setInterval>): void {
  const nodeTimer = timer as {
    readonly unref?: () => void;
  };

  nodeTimer.unref?.();
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

export async function writeWorldDocument(
  document: WorldDocument,
  options: {
    baseDocument?: WorldDocument;
    delta?: EditorHistoryDocumentDelta | null;
    recordShadow?: boolean;
  } = {},
): Promise<void> {
  if (options.recordShadow === false) {
    await saveToIndexedDb(
      createWordDocumentLocation(document.documentKey),
      document,
    );
    return;
  }

  await saveToIndexedDb(
    createWordDocumentLocation(document.documentKey),
    document,
  );

  if (!ENABLE_LOCAL_SYNC_SHADOW_MODE) {
    return;
  }

  await writeWorldDocumentShadowSaveWithResult({
    document,
    baseDocument: options.baseDocument,
    delta: options.delta,
  });
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
    entities: migrateBlueprintEntityDeviceIds(value.entities),
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
