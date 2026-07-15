import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import {
  createStableJsonHash,
  listLocalSyncOutboxEntriesForAsset,
  readLocalDocumentSyncState,
  writeWorldDocumentWithShadowSave,
} from "@/shared/storage/sync-shadow-storage";
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
        definitionId: "item_port_storager_1",
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
      syncedRemoteRevision: null,
      localHeadHash: createStableJsonHash(document),
      nextLocalSequence: 2,
      pendingOutboxCount: 1,
      hasUnsyncedChanges: true,
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    expect(outboxEntries).toHaveLength(1);
    expect(outboxEntries[0]).toMatchObject({
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
});
