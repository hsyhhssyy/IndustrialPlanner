import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorldDocument } from "@/domain/document/world-document";
import {
  readWorldDocument,
  WORLD_DOCUMENT_DATABASE_LOCATION,
} from "@/editor/document-storage";
import { saveToIndexedDb } from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "@/tests/shared/fake-indexed-db";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editor document storage device id migration", () => {
  it("migrates historical device ids when reading world documents", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const document = createWorldDocument();
    document.schemaVersion = 1;
    document.entities = {
      pool: {
        id: "pool",
        definitionId: "item_port_mix_pool_large_1",
        position: { x: 10, y: 12 },
        rotation: 0,
        config: {},
        tags: [],
      },
    };
    document.entityOrder = ["pool"];

    await saveToIndexedDb(
      {
        ...WORLD_DOCUMENT_DATABASE_LOCATION,
        key: document.documentKey,
      },
      document,
    );

    const migratedDocument = await readWorldDocument(document.documentKey);

    expect(migratedDocument?.schemaVersion).toBe(3);
    expect(migratedDocument?.entities.pool?.definitionId).toBe("mix_pool_2");
  });
});
