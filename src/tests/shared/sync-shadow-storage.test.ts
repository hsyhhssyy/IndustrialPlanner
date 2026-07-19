import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import { createWorldDocumentDelta } from "@/editor/history";
import {
  appendLocalSyncDiagnosticEvent,
  compactWorldDocumentShadowOutbox,
  createStableJsonHash,
  listLocalSyncCompactSummaries,
  listLocalSyncDiagnosticEvents,
  listLocalSyncOutboxEntriesForAsset,
  markWorldDocumentShadowEntryValidated,
  markWorldDocumentShadowEntriesValidated,
  readLocalDocumentSyncState,
  writeWorldDocumentWithShadowSave,
} from "@/shared/storage/sync-shadow-storage";
import {
  activateAccountOwnerAfterImport,
  ensureLocalSyncOwnerState,
} from "@/shared/storage/sync-owner-storage";
import { readFromIndexedDb } from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

const WORLD_DOCUMENT_STORE_LOCATION = {
  databaseName: "v3-industrial-planner",
  storeName: "worddocument",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync shadow storage", () => {
  it("initializes sync metadata when saving a document without existing metadata", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const document = createWorldDocument();
    document.entities = {
      "entity-1": {
        id: "entity-1",
        definitionId: "storager_1",
        position: { x: 1, y: 2 },
        rotation: 0,
        config: {},
        tags: [],
      },
    };
    document.entityOrder = ["entity-1"];

    await expect(
      writeWorldDocumentWithShadowSave({
        document,
        documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
        now: "2026-07-15T00:00:00.000Z",
      }),
    ).resolves.toBe(true);

    await expect(
      readFromIndexedDb({
        ...WORLD_DOCUMENT_STORE_LOCATION,
        key: document.documentKey,
      }),
    ).resolves.toEqual(document);

    const state = await readLocalDocumentSyncState(document.documentKey);
    const outboxEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: document.documentKey,
    });

    expect(state).toEqual({
      schemaVersion: 1,
      documentKey: document.documentKey,
      owner: outboxEntries[0]?.owner,
      syncedRemoteRevision: null,
      localHeadHash: createStableJsonHash(document),
      nextLocalSequence: 2,
      pendingOutboxCount: 1,
      hasUnsyncedChanges: true,
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    expect(outboxEntries).toHaveLength(1);
    expect(outboxEntries[0]).toMatchObject({
      owner: state?.owner,
      deviceId: expect.any(String),
      assetType: "world-document",
      assetId: document.documentKey,
      localSequence: 1,
      baseRemoteRevision: null,
      remoteRevision: null,
      contentHash: createStableJsonHash(document),
      status: "pending",
      operationPayload: {
        type: "world-document.shadow-snapshot",
        documentKey: document.documentKey,
        baseId: document.baseId,
        schemaVersion: document.schemaVersion,
        entityCount: 1,
        slotLinkCount: 0,
        documentUpdatedAt: document.meta.updatedAt,
      },
    });
  });

  it("increments local sequence and keeps shadow outbox bounded", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const document = createWorldDocument();

    for (let index = 0; index < 205; index += 1) {
      await writeWorldDocumentWithShadowSave({
        document: {
          ...document,
          meta: {
            ...document.meta,
            updatedAt: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
          },
        },
        documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
        now: new Date(Date.UTC(2026, 6, 15, 1, 0, index)).toISOString(),
      });
    }

    const state = await readLocalDocumentSyncState(document.documentKey);
    const outboxEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: document.documentKey,
    });

    expect(state?.nextLocalSequence).toBe(206);
    expect(state?.pendingOutboxCount).toBe(200);
    expect(outboxEntries).toHaveLength(200);
    expect(outboxEntries[0]?.localSequence).toBe(6);
    expect(outboxEntries.at(-1)?.localSequence).toBe(205);
  });

  it("stores replayable history delta payloads when a base document and delta are provided", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const baseDocument = createWorldDocument();
    const nextDocument: WorldDocument = {
      ...baseDocument,
      meta: {
        ...baseDocument.meta,
        updatedAt: "2026-07-15T00:10:00.000Z",
      },
      entities: {
        "entity-1": {
          id: "entity-1",
          definitionId: "storager_1",
          position: { x: 1, y: 2 },
          rotation: 0,
          config: {},
          tags: [],
        },
      },
      entityOrder: ["entity-1"],
    };
    const delta = createWorldDocumentDelta(baseDocument, nextDocument);

    await expect(
      writeWorldDocumentWithShadowSave({
        document: nextDocument,
        baseDocument,
        delta,
        documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
        now: "2026-07-15T00:11:00.000Z",
      }),
    ).resolves.toBe(true);

    const outboxEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: nextDocument.documentKey,
    });

    expect(outboxEntries).toHaveLength(1);
    expect(outboxEntries[0]?.operationPayload).toMatchObject({
      type: "world-document.history-delta",
      documentKey: nextDocument.documentKey,
      baseContentHash: createStableJsonHash(baseDocument),
      targetContentHash: createStableJsonHash(nextDocument),
      targetMeta: nextDocument.meta,
    });
  });

  it("keeps anonymous and account shadow sequences scoped by owner", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const document = createWorldDocument();
    const anonymousState = await ensureLocalSyncOwnerState({
      now: "2026-07-15T00:00:00.000Z",
    });

    await writeWorldDocumentWithShadowSave({
      document,
      documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
      now: "2026-07-15T00:01:00.000Z",
    });
    await activateAccountOwnerAfterImport({
      userId: "user-1",
      resolution: "imported-anonymous",
      now: "2026-07-15T00:02:00.000Z",
    });
    await writeWorldDocumentWithShadowSave({
      document,
      documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
      now: "2026-07-15T00:03:00.000Z",
    });

    const anonymousEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: document.documentKey,
      owner: anonymousState.activeOwner,
    });
    const accountEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: document.documentKey,
    });
    const anonymousDocumentState = await readLocalDocumentSyncState(document.documentKey, {
      owner: anonymousState.activeOwner,
    });
    const accountDocumentState = await readLocalDocumentSyncState(document.documentKey);

    expect(anonymousEntries).toHaveLength(1);
    expect(accountEntries).toHaveLength(1);
    expect(anonymousEntries[0]?.localSequence).toBe(1);
    expect(accountEntries[0]?.localSequence).toBe(1);
    expect(anonymousEntries[0]?.owner).toEqual(anonymousState.activeOwner);
    expect(accountEntries[0]?.owner).toEqual({
      kind: "account",
      ownerId: "user-1",
    });
    expect(anonymousDocumentState?.nextLocalSequence).toBe(2);
    expect(accountDocumentState?.nextLocalSequence).toBe(2);
  });

  it("keeps diagnostics bounded by count", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    for (let index = 0; index < 1005; index += 1) {
      await appendLocalSyncDiagnosticEvent({
        severity: "warning",
        category: "replay",
        code: `event-${index}`,
        assetType: "world-document",
        assetId: "document-1",
        now: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
      });
    }

    const events = await listLocalSyncDiagnosticEvents();

    expect(events).toHaveLength(1000);
    expect(events[0]?.code).toBe("event-5");
    expect(events.at(-1)?.code).toBe("event-1004");
  });

  it("compacts only validated world document shadow entries", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const document = createWorldDocument();

    for (let index = 0; index < 3; index += 1) {
      await writeWorldDocumentWithShadowSave({
        document: {
          ...document,
          meta: {
            ...document.meta,
            updatedAt: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
          },
        },
        documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
        now: new Date(Date.UTC(2026, 6, 15, 1, 0, index)).toISOString(),
      });
    }

    await expect(
      compactWorldDocumentShadowOutbox({
        documentKey: document.documentKey,
        throughLocalSequence: 2,
        baseContentHash: "hash-before-validation",
        now: "2026-07-15T02:00:00.000Z",
      }),
    ).resolves.toBeNull();

    await expect(
      markWorldDocumentShadowEntriesValidated({
        documentKey: document.documentKey,
        throughLocalSequence: 2,
        now: "2026-07-15T02:05:00.000Z",
      }),
    ).resolves.toBe(2);

    const summary = await compactWorldDocumentShadowOutbox({
      documentKey: document.documentKey,
      throughLocalSequence: 2,
      baseContentHash: createStableJsonHash(document),
      now: "2026-07-15T02:10:00.000Z",
    });
    const outboxEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: document.documentKey,
    });
    const summaries = await listLocalSyncCompactSummaries();
    const state = await readLocalDocumentSyncState(document.documentKey);

    expect(summary).toMatchObject({
      assetType: "world-document",
      assetId: document.documentKey,
      fromLocalSequence: 1,
      toLocalSequence: 2,
      operationCount: 2,
      baseContentHash: createStableJsonHash(document),
      compactedAt: "2026-07-15T02:10:00.000Z",
    });
    expect(outboxEntries).toHaveLength(1);
    expect(outboxEntries[0]?.localSequence).toBe(3);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(summary);
    expect(state?.pendingOutboxCount).toBe(1);
  });

  it("does not validate earlier pending entries when marking one shadow entry", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const document = createWorldDocument();

    for (let index = 0; index < 2; index += 1) {
      await writeWorldDocumentWithShadowSave({
        document: {
          ...document,
          meta: {
            ...document.meta,
            updatedAt: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
          },
        },
        documentStoreLocation: WORLD_DOCUMENT_STORE_LOCATION,
        now: new Date(Date.UTC(2026, 6, 15, 1, 0, index)).toISOString(),
      });
    }

    await expect(
      markWorldDocumentShadowEntryValidated({
        documentKey: document.documentKey,
        localSequence: 2,
        now: "2026-07-15T02:00:00.000Z",
      }),
    ).resolves.toBe(true);

    await compactWorldDocumentShadowOutbox({
      documentKey: document.documentKey,
      throughLocalSequence: 2,
      baseContentHash: createStableJsonHash(document),
      now: "2026-07-15T02:05:00.000Z",
    });

    const outboxEntries = await listLocalSyncOutboxEntriesForAsset({
      assetType: "world-document",
      assetId: document.documentKey,
    });

    expect(outboxEntries).toHaveLength(1);
    expect(outboxEntries[0]).toMatchObject({
      localSequence: 1,
      status: "pending",
    });
  });
});
