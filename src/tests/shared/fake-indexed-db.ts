interface FakeDatabaseState {
  version: number;
  stores: Map<string, Map<IDBValidKey, unknown>>;
}

interface FakeTransactionState {
  pendingRequestCount: number;
  completionQueued: boolean;
  aborted: boolean;
}

export function createFakeIndexedDbFactory(): IDBFactory {
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
        throw new Error(`Store "${targetStoreName}" does not exist.`);
      }

      return createTransactionHandle(targetStoreName, store);
    },
  } as unknown as IDBDatabase;
}

function createTransactionHandle(
  storeName: string,
  store: Map<IDBValidKey, unknown>,
): IDBTransaction {
  const transactionState: FakeTransactionState = {
    pendingRequestCount: 0,
    completionQueued: false,
    aborted: false,
  };
  const transaction = {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore: (requestedStoreName: string) => {
      if (requestedStoreName !== storeName) {
        throw new Error(`Unexpected store "${requestedStoreName}".`);
      }

      return createObjectStoreHandle(
        store,
        transaction as unknown as IDBTransaction,
        transactionState,
      );
    },
  };

  return transaction as unknown as IDBTransaction;
}

function createObjectStoreHandle(
  store: Map<IDBValidKey, unknown>,
  transaction: IDBTransaction,
  transactionState: FakeTransactionState,
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
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        if (key === undefined) {
          transactionState.aborted = true;
          assignRequestError(request, new Error("Key is required."));
          request.onerror?.(new Event("error"));
          transaction.onabort?.(new Event("abort"));
          return;
        }

        store.set(key, value);
        assignRequestResult(request, key);
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    delete: (key: IDBValidKey) => {
      const request = createRequest<undefined>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        store.delete(key);
        assignRequestResult(request, undefined);
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    getAll: () => {
      const request = createRequest<unknown[]>();

      queueMicrotask(() => {
        assignRequestResult(request, Array.from(store.values()));
        request.onsuccess?.(new Event("success"));
      });

      return request;
    },
  } as unknown as IDBObjectStore;
}

function trackFakeTransactionRequest(transactionState: FakeTransactionState): void {
  transactionState.pendingRequestCount += 1;
}

function finishFakeTransactionRequest(
  transactionState: FakeTransactionState,
  transaction: IDBTransaction,
): void {
  transactionState.pendingRequestCount = Math.max(0, transactionState.pendingRequestCount - 1);

  if (
    transactionState.pendingRequestCount > 0
    || transactionState.completionQueued
    || transactionState.aborted
  ) {
    return;
  }

  transactionState.completionQueued = true;

  queueMicrotask(() => {
    transactionState.completionQueued = false;

    if (transactionState.pendingRequestCount === 0 && !transactionState.aborted) {
      transaction.oncomplete?.(new Event("complete"));
    }
  });
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

function assignRequestResult<TResult>(
  request: IDBRequest<TResult>,
  result: TResult,
): void {
  Object.defineProperty(request, "result", {
    configurable: true,
    value: result,
    writable: true,
  });
}

function assignRequestError<TResult>(
  request: IDBRequest<TResult>,
  error: Error,
): void {
  Object.defineProperty(request, "error", {
    configurable: true,
    value: error,
    writable: true,
  });
}
