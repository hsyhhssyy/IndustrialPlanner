import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
      databaseName: "industrial-planner",
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

  it("returns null when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(
      readFromIndexedDb({
        databaseName: "industrial-planner",
        storeName: "workspace",
        key: "primary",
      }),
    ).resolves.toBeNull();
  });
});
