import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyIndexedDbTransactionMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("browser-storage", () => {
  it("round-trips JSON through localStorage", () => {
    const snapshot = {
      locale: "zh-CN",
      zoom: 2,
    };

    saveToLocalStorage("workspace", snapshot);

    expect(readFromLocalStorage<typeof snapshot>("workspace")).toEqual(snapshot);
  });

  it("returns null when localStorage contains invalid JSON", () => {
    localStorage.setItem("workspace", "{");

    expect(readFromLocalStorage("workspace")).toBeNull();
  });

  it("round-trips JSON through IndexedDB", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const location = {
      databaseName: "v3-industrial-planner",
      storeName: "workspace",
      key: "primary",
    } satisfies {
      databaseName: string;
      storeName: string;
      key: string;
    };
    const snapshot = {
      locale: "en-US",
      zoom: 4,
    };

    await saveToIndexedDb(location, snapshot);

    await expect(readFromIndexedDb<typeof snapshot>(location)).resolves.toEqual(
      snapshot,
    );
  });

  it("lists all JSON documents from IndexedDB", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const storeLocation = {
      databaseName: "v3-industrial-planner",
      storeName: "workspace",
    } satisfies {
      databaseName: string;
      storeName: string;
    };

    await saveToIndexedDb(
      {
        ...storeLocation,
        key: "primary",
      },
      { locale: "zh-CN", zoom: 1 },
    );
    await saveToIndexedDb(
      {
        ...storeLocation,
        key: "secondary",
      },
      { locale: "en-US", zoom: 4 },
    );

    await expect(
      listFromIndexedDb<{ locale: string; zoom: number }>(storeLocation),
    ).resolves.toEqual([
      { locale: "zh-CN", zoom: 1 },
      { locale: "en-US", zoom: 4 },
    ]);
  });

  it("applies mutations across multiple IndexedDB stores in one transaction", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const databaseName = "v3-industrial-planner";

    await expect(
      applyIndexedDbTransactionMutations(
        { databaseName },
        [
          {
            storeName: "worlddocument",
            operations: [{
              type: "put",
              key: "document-a",
              value: { documentKey: "document-a" },
            }],
          },
          {
            storeName: "sync-shadow-state",
            operations: [{
              type: "put",
              key: "world-document:document-a",
              value: { documentKey: "document-a", nextLocalSequence: 2 },
            }],
          },
        ],
      ),
    ).resolves.toBe(true);

    await expect(
      readFromIndexedDb({
        databaseName,
        storeName: "worlddocument",
        key: "document-a",
      }),
    ).resolves.toEqual({ documentKey: "document-a" });
    await expect(
      readFromIndexedDb({
        databaseName,
        storeName: "sync-shadow-state",
        key: "world-document:document-a",
      }),
    ).resolves.toEqual({ documentKey: "document-a", nextLocalSequence: 2 });
  });

  it("returns null when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(
      readFromIndexedDb({
        databaseName: "v3-industrial-planner",
        storeName: "workspace",
        key: "primary",
      }),
    ).resolves.toBeNull();
  });
});
