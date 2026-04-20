import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

interface FakeDatabaseState {
  version: number;
  stores: Map<string, Map<IDBValidKey, unknown>>;
}

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

function createFakeIndexedDbFactory(): IDBFactory {
  const databases = new Map<string, FakeDatabaseState>();

  return {
    open: (databaseName: string, version?: number) => {
      const request = createRequest<IDBDatabase>() as IDBOpenDBRequest;

      queueMicrotask(() => {
        let databaseState = databases.get(databaseName);
        let shouldUpgrade = false;

        if (!databaseState) {
          databaseState = {
            version: version ?? 1,
            stores: new Map(),
          };
          databases.set(databaseName, databaseState);
          shouldUpgrade = true;
        } else if (version !== undefined && version < databaseState.version) {
          assignRequestError(request, new Error("VersionError"));
          request.onerror?.(new Event("error"));
          return;
        } else if (version !== undefined && version > databaseState.version) {
          databaseState.version = version;
          shouldUpgrade = true;
        }

        assignRequestResult(request, createDatabaseHandle(databaseState));

        if (shouldUpgrade) {
          request.onupgradeneeded?.(
            new Event("upgradeneeded") as unknown as IDBVersionChangeEvent,
          );
        }

        request.onsuccess?.(new Event("success"));
      });

      return request;
    },
  } as unknown as IDBFactory;
}

function createDatabaseHandle(databaseState: FakeDatabaseState): IDBDatabase {
  return {
    get version() {
      return databaseState.version;
    },
    get objectStoreNames() {
      return createDomStringList(databaseState);
    },
    close: () => {},
    createObjectStore: (storeName: string) => {
      if (!databaseState.stores.has(storeName)) {
        databaseState.stores.set(storeName, new Map());
      }

      return {} as IDBObjectStore;
    },
    transaction: (storeName: string | string[]) => {
      const targetStoreName = Array.isArray(storeName) ? storeName[0] : storeName;

      if (targetStoreName === undefined) {
        throw new Error("Store name is required.");
      }

      const store = databaseState.stores.get(targetStoreName);

      if (!store) {
        throw new Error(`Store \"${targetStoreName}\" does not exist.`);
      }

      return createTransactionHandle(targetStoreName, store);
    },
  } as unknown as IDBDatabase;
}

function createTransactionHandle(
  storeName: string,
  store: Map<IDBValidKey, unknown>,
): IDBTransaction {
  const transaction = {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore: (requestedStoreName: string) => {
      if (requestedStoreName !== storeName) {
        throw new Error(`Unexpected store \"${requestedStoreName}\".`);
      }

      return createObjectStoreHandle(store, transaction as unknown as IDBTransaction);
    },
  };

  return transaction as unknown as IDBTransaction;
}

function createObjectStoreHandle(
  store: Map<IDBValidKey, unknown>,
  transaction: IDBTransaction,
): IDBObjectStore {
  return {
    get: (key: IDBValidKey) => {
      const request = createRequest<unknown>();

      queueMicrotask(() => {
        assignRequestResult(request, store.get(key));
        request.onsuccess?.(new Event("success"));
      });

      return request;
    },
    put: (value: unknown, key?: IDBValidKey) => {
      const request = createRequest<IDBValidKey>();

      queueMicrotask(() => {
        if (key === undefined) {
          assignRequestError(request, new Error("Key is required."));
          request.onerror?.(new Event("error"));
          transaction.onabort?.(new Event("abort"));
          return;
        }

        store.set(key, value);
        assignRequestResult(request, key);
        request.onsuccess?.(new Event("success"));

        queueMicrotask(() => {
          transaction.oncomplete?.(new Event("complete"));
        });
      });

      return request;
    },
  } as unknown as IDBObjectStore;
}

function createDomStringList(databaseState: FakeDatabaseState): DOMStringList {
  return {
    get length() {
      return databaseState.stores.size;
    },
    contains: (value: string) => databaseState.stores.has(value),
    item: (index: number) => Array.from(databaseState.stores.keys())[index] ?? null,
  } as unknown as DOMStringList;
}

function createRequest<TResult>(): IDBRequest<TResult> {
  return {
    error: null,
    onerror: null,
    onsuccess: null,
  } as unknown as IDBRequest<TResult>;
}

function assignRequestResult<TResult>(request: IDBRequest<TResult>, result: TResult) {
  Object.defineProperty(request, "result", {
    configurable: true,
    value: result,
    writable: true,
  });
}

function assignRequestError<TResult>(request: IDBRequest<TResult>, error: Error) {
  Object.defineProperty(request, "error", {
    configurable: true,
    value: error,
    writable: true,
  });
}