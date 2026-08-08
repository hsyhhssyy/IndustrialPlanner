interface FakeDatabaseState {
  version: number;
  stores: Map<string, FakeObjectStoreState>;
}

interface FakeObjectStoreState {
  readonly values: Map<IDBValidKey, unknown>;
  readonly keyPath?: string;
  readonly autoIncrement: boolean;
  nextKey: number;
}

interface FakeKeyRange {
  readonly upper: IDBValidKey;
  readonly upperOpen: boolean;
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

export function createFakeIdbKeyRangeFactory(): typeof IDBKeyRange {
  return {
    upperBound: (upper: IDBValidKey, open = false) => ({
      upper,
      upperOpen: open,
    } as unknown as IDBKeyRange),
  } as typeof IDBKeyRange;
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
    createObjectStore: (storeName: string, options?: IDBObjectStoreParameters) => {
      if (!databaseState.stores.has(storeName)) {
        databaseState.stores.set(storeName, {
          values: new Map(),
          ...(typeof options?.keyPath === "string" ? { keyPath: options.keyPath } : {}),
          autoIncrement: options?.autoIncrement === true,
          nextKey: 1,
        });
      }

      return {
        createIndex: () => ({} as IDBIndex),
      } as unknown as IDBObjectStore;
    },
    transaction: (storeName: string | string[]) => {
      const targetStoreNames = Array.isArray(storeName) ? storeName : [storeName];

      if (targetStoreNames.length === 0) {
        throw new Error("Store name is required.");
      }

      const stores = new Map<string, FakeObjectStoreState>();

      for (const targetStoreName of targetStoreNames) {
        const store = databaseState.stores.get(targetStoreName);

        if (!store) {
          throw new Error(`Store "${targetStoreName}" does not exist.`);
        }

        stores.set(targetStoreName, store);
      }

      return createTransactionHandle(stores);
    },
  } as unknown as IDBDatabase;
}

function createTransactionHandle(
  stores: ReadonlyMap<string, FakeObjectStoreState>,
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
      const store = stores.get(requestedStoreName);

      if (store === undefined) {
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
  store: FakeObjectStoreState,
  transaction: IDBTransaction,
  transactionState: FakeTransactionState,
): IDBObjectStore {
  return {
    get: (key: IDBValidKey) => {
      const request = createRequest<unknown>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        assignRequestResult(request, store.values.get(key));
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    put: (value: unknown, key?: IDBValidKey) => writeValue(
      store,
      transaction,
      transactionState,
      value,
      key,
      false,
    ),
    add: (value: unknown, key?: IDBValidKey) => writeValue(
      store,
      transaction,
      transactionState,
      value,
      key,
      true,
    ),
    count: () => {
      const request = createRequest<number>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        assignRequestResult(request, store.values.size);
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    clear: () => {
      const request = createRequest<undefined>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        store.values.clear();
        assignRequestResult(request, undefined);
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    delete: (key: IDBValidKey) => {
      const request = createRequest<undefined>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        store.values.delete(key);
        assignRequestResult(request, undefined);
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    getAll: () => {
      const request = createRequest<unknown[]>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        assignRequestResult(request, Array.from(store.values.values()));
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
    },
    openCursor: (range?: IDBKeyRange | null, direction?: IDBCursorDirection) =>
      createCursorRequest(store, transaction, transactionState, range, direction),
  } as unknown as IDBObjectStore;
}

function writeValue(
  store: FakeObjectStoreState,
  transaction: IDBTransaction,
  transactionState: FakeTransactionState,
  value: unknown,
  explicitKey: IDBValidKey | undefined,
  addOnly: boolean,
): IDBRequest<IDBValidKey> {
      const request = createRequest<IDBValidKey>();
      trackFakeTransactionRequest(transactionState);

      queueMicrotask(() => {
        const derivedKey = explicitKey ?? readKeyPathValue(value, store.keyPath);
        const key = derivedKey ?? (store.autoIncrement ? store.nextKey : undefined);
        if (key === undefined) {
          transactionState.aborted = true;
          assignRequestError(request, new Error("Key is required."));
          request.onerror?.(new Event("error"));
          transaction.onabort?.(new Event("abort"));
          return;
        }

        if (addOnly && store.values.has(key)) {
          transactionState.aborted = true;
          assignRequestError(request, new Error("ConstraintError"));
          request.onerror?.(new Event("error"));
          transaction.onabort?.(new Event("abort"));
          return;
        }

        if (store.autoIncrement && typeof key === "number") {
          store.nextKey = Math.max(store.nextKey, key + 1);
        }
        const storedValue = injectKeyPathValue(value, store.keyPath, key);
        store.values.set(key, storedValue);
        assignRequestResult(request, key);
        request.onsuccess?.(new Event("success"));
        finishFakeTransactionRequest(transactionState, transaction);
      });

      return request;
}

function createCursorRequest(
  store: FakeObjectStoreState,
  transaction: IDBTransaction,
  transactionState: FakeTransactionState,
  range: IDBKeyRange | null | undefined,
  direction: IDBCursorDirection | undefined,
): IDBRequest<IDBCursorWithValue | null> {
  const request = createRequest<IDBCursorWithValue | null>();
  const fakeRange = range as unknown as FakeKeyRange | null | undefined;
  const keys = Array.from(store.values.keys())
    .filter((key) => fakeRange === null || fakeRange === undefined
      || compareKeys(key, fakeRange.upper) < (fakeRange.upperOpen ? 0 : 1))
    .sort(compareKeys);
  if (direction === "prev" || direction === "prevunique") {
    keys.reverse();
  }
  let index = 0;
  trackFakeTransactionRequest(transactionState);

  const emitCursor = (): void => {
    const key = keys[index];
    if (key === undefined) {
      assignRequestResult(request, null);
      request.onsuccess?.(new Event("success"));
      finishFakeTransactionRequest(transactionState, transaction);
      return;
    }

    let continued = false;
    const cursor = {
      key,
      primaryKey: key,
      value: store.values.get(key),
      continue: () => {
        continued = true;
        index += 1;
        queueMicrotask(emitCursor);
      },
      delete: () => {
        const deleteRequest = createRequest<undefined>();
        trackFakeTransactionRequest(transactionState);
        queueMicrotask(() => {
          store.values.delete(key);
          assignRequestResult(deleteRequest, undefined);
          deleteRequest.onsuccess?.(new Event("success"));
          finishFakeTransactionRequest(transactionState, transaction);
        });
        return deleteRequest;
      },
    } as unknown as IDBCursorWithValue;
    assignRequestResult(request, cursor);
    request.onsuccess?.(new Event("success"));
    queueMicrotask(() => {
      if (!continued) {
        finishFakeTransactionRequest(transactionState, transaction);
      }
    });
  };

  queueMicrotask(emitCursor);
  return request;
}

function readKeyPathValue(value: unknown, keyPath: string | undefined): IDBValidKey | undefined {
  if (keyPath === undefined || typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[keyPath];
  return typeof candidate === "string" || typeof candidate === "number"
    ? candidate
    : undefined;
}

function injectKeyPathValue(
  value: unknown,
  keyPath: string | undefined,
  key: IDBValidKey,
): unknown {
  if (keyPath === undefined || typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return { ...(value as Record<string, unknown>), [keyPath]: key };
}

function compareKeys(left: IDBValidKey, right: IDBValidKey): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
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
