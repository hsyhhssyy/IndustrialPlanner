export interface JsonStorageCodec<TValue> {
  serialize?: (value: TValue) => string;
  deserialize?: (rawValue: string) => TValue;
}

export interface IndexedDbStoreLocation {
  databaseName: string;
  storeName: string;
  version?: number;
}

export interface IndexedDbDatabaseLocation {
  databaseName: string;
  version?: number;
}

export interface IndexedDbStorageLocation extends IndexedDbStoreLocation {
  key: IDBValidKey;
}

export type IndexedDbMutationOperation<TValue> =
  | {
    type: "put";
    key: IDBValidKey;
    value: TValue;
  }
  | {
    type: "delete";
    key: IDBValidKey;
  };

export interface IndexedDbStoreMutationBatch<TValue> {
  storeName: string;
  operations: readonly IndexedDbMutationOperation<TValue>[];
}

/**
 * 读取 IndexedDB 中由 structured clone 保存的原始值。
 *
 * JSON 存储 API 仍是业务数据的默认边界；该 API 仅供必须保留二进制载荷的基础设施使用。
 */
export async function readRawFromIndexedDb<TValue>(
  location: IndexedDbStorageLocation,
): Promise<TValue | null> {
  const database = await openIndexedDb(location);

  if (database === null) {
    return null;
  }

  try {
    const request = database
      .transaction(location.storeName, "readonly")
      .objectStore(location.storeName)
      .get(location.key);
    const value = await waitForRequest<unknown>(request);

    return value === undefined ? null : value as TValue;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

/** 原子写入一组 structured-clone 值，不经过 JSON 编解码。 */
export async function applyRawIndexedDbTransactionMutations<TValue>(
  location: IndexedDbDatabaseLocation,
  batches: readonly IndexedDbStoreMutationBatch<TValue>[],
): Promise<boolean> {
  const activeBatches = batches.filter((batch) => batch.operations.length > 0);

  if (activeBatches.length === 0) {
    return true;
  }

  const database = await openIndexedDbStores(
    location,
    activeBatches.map((batch) => batch.storeName),
  );

  if (database === null) {
    return false;
  }

  try {
    const storeNames = Array.from(new Set(activeBatches.map((batch) => batch.storeName)));
    const transaction = database.transaction(storeNames, "readwrite");
    const completion = waitForTransaction(transaction);

    for (const batch of activeBatches) {
      const objectStore = transaction.objectStore(batch.storeName);

      for (const operation of batch.operations) {
        if (operation.type === "put") {
          await waitForRequest(objectStore.put(operation.value, operation.key));
          continue;
        }

        await waitForRequest(objectStore.delete(operation.key));
      }
    }

    await completion;
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export function readFromLocalStorage<TValue>(
  key: string,
  codec: JsonStorageCodec<TValue> = {},
): TValue | null {
  const storage = getLocalStorage();

  if (storage === null) {
    return null;
  }

  try {
    const rawValue = storage.getItem(key);

    if (rawValue === null) {
      return null;
    }

    return getCodec(codec).deserialize(rawValue);
  } catch {
    return null;
  }
}

export function saveToLocalStorage<TValue>(
  key: string,
  value: TValue,
  codec: JsonStorageCodec<TValue> = {},
): TValue {
  const storage = getLocalStorage();

  if (storage === null) {
    return value;
  }

  try {
    storage.setItem(key, getCodec(codec).serialize(value));
  } catch {
    return value;
  }

  return value;
}

export async function readFromIndexedDb<TValue>(
  location: IndexedDbStorageLocation,
  codec: JsonStorageCodec<TValue> = {},
): Promise<TValue | null> {
  const database = await openIndexedDb(location);

  if (database === null) {
    return null;
  }

  try {
    const request = database
      .transaction(location.storeName, "readonly")
      .objectStore(location.storeName)
      .get(location.key);
    const rawValue = await waitForRequest<unknown>(request);

    if (typeof rawValue !== "string") {
      return null;
    }

    return getCodec(codec).deserialize(rawValue);
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function listFromIndexedDb<TValue>(
  location: IndexedDbStoreLocation,
  codec: JsonStorageCodec<TValue> = {},
): Promise<TValue[]> {
  const database = await openIndexedDb(location);

  if (database === null) {
    return [];
  }

  try {
    const request = database
      .transaction(location.storeName, "readonly")
      .objectStore(location.storeName)
      .getAll();
    const rawValues = await waitForRequest<unknown[]>(request);
    const deserialize = getCodec(codec).deserialize;

    return rawValues.flatMap((rawValue) => {
      if (typeof rawValue !== "string") {
        return [];
      }

      try {
        return [deserialize(rawValue)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    database.close();
  }
}

export async function saveToIndexedDb<TValue>(
  location: IndexedDbStorageLocation,
  value: TValue,
  codec: JsonStorageCodec<TValue> = {},
): Promise<TValue> {
  await trySaveToIndexedDb(location, value, codec);

  return value;
}

export async function applyIndexedDbStoreMutations<TValue>(
  location: IndexedDbStoreLocation,
  operations: readonly IndexedDbMutationOperation<TValue>[],
  codec: JsonStorageCodec<TValue> = {},
): Promise<boolean> {
  return await applyIndexedDbTransactionMutations(
    {
      databaseName: location.databaseName,
      version: location.version,
    },
    [{
      storeName: location.storeName,
      operations,
    }],
    codec,
  );
}

export async function applyIndexedDbTransactionMutations<TValue>(
  location: IndexedDbDatabaseLocation,
  batches: readonly IndexedDbStoreMutationBatch<TValue>[],
  codec: JsonStorageCodec<TValue> = {},
): Promise<boolean> {
  const activeBatches = batches.filter((batch) => batch.operations.length > 0);

  if (activeBatches.length === 0) {
    return true;
  }

  const database = await openIndexedDbStores(
    location,
    activeBatches.map((batch) => batch.storeName),
  );

  if (database === null) {
    return false;
  }

  try {
    const transaction = database.transaction(
      Array.from(new Set(activeBatches.map((batch) => batch.storeName))),
      "readwrite",
    );
    const completion = waitForTransaction(transaction);
    const serialize = getCodec(codec).serialize;

    for (const batch of activeBatches) {
      const objectStore = transaction.objectStore(batch.storeName);

      for (const operation of batch.operations) {
        if (operation.type === "put") {
          await waitForRequest(
            objectStore.put(serialize(operation.value), operation.key),
          );
          continue;
        }

        await waitForRequest(objectStore.delete(operation.key));
      }
    }

    await completion;

    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function deleteFromIndexedDb(
  location: IndexedDbStorageLocation,
): Promise<boolean> {
  return await applyIndexedDbStoreMutations(location, [{
    type: "delete",
    key: location.key,
  }]);
}

export async function clearIndexedDbStores(
  location: IndexedDbDatabaseLocation,
  storeNames: readonly string[],
): Promise<boolean> {
  const activeStoreNames = Array.from(new Set(
    storeNames.filter((storeName) => storeName.trim() !== ""),
  ));

  if (activeStoreNames.length === 0) {
    return true;
  }

  const database = await openIndexedDbStores(location, activeStoreNames);

  if (database === null) {
    return false;
  }

  try {
    const transaction = database.transaction(activeStoreNames, "readwrite");
    const completion = waitForTransaction(transaction);

    for (const storeName of activeStoreNames) {
      await waitForRequest(transaction.objectStore(storeName).clear());
    }

    await completion;

    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function trySaveToIndexedDb<TValue>(
  location: IndexedDbStorageLocation,
  value: TValue,
  codec: JsonStorageCodec<TValue> = {},
): Promise<boolean> {
  return await applyIndexedDbStoreMutations(location, [{
    type: "put",
    key: location.key,
    value,
  }], codec);
}

function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function getCodec<TValue>(codec: JsonStorageCodec<TValue>) {
  return {
    serialize: codec.serialize ?? ((value: TValue) => JSON.stringify(value)),
    deserialize:
      codec.deserialize ??
      ((rawValue: string) => JSON.parse(rawValue) as TValue),
  };
}

async function openIndexedDb(
  location: IndexedDbStoreLocation,
): Promise<IDBDatabase | null> {
  return await openIndexedDbStores(location, [location.storeName]);
}

async function openIndexedDbStores(
  location: IndexedDbDatabaseLocation,
  storeNames: readonly string[],
): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === "undefined") {
    return null;
  }

  try {
    const uniqueStoreNames = Array.from(new Set(storeNames.filter((storeName) => storeName.trim() !== "")));
    const database = await openDatabase(
      location.databaseName,
      location.version,
    );

    const missingStoreNames = uniqueStoreNames.filter((storeName) => (
      !database.objectStoreNames.contains(storeName)
    ));

    if (missingStoreNames.length === 0) {
      return database;
    }

    // 缺少对象仓库时，通过一次版本升级补建，避免调用方手动管理初始化流程。
    const nextVersion = database.version + 1;
    database.close();

    return await openDatabase(
      location.databaseName,
      nextVersion,
      missingStoreNames,
    );
  } catch {
    return null;
  }
}

function openDatabase(
  databaseName: string,
  version?: number,
  storeNamesToCreate?: readonly string[],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? globalThis.indexedDB.open(databaseName)
        : globalThis.indexedDB.open(databaseName, version);

    request.onerror = () => {
      reject(
        request.error ??
          new Error(`Failed to open IndexedDB database "${databaseName}".`),
      );
    };

    request.onupgradeneeded = () => {
      if (storeNamesToCreate === undefined) {
        return;
      }

      const database = request.result;

      for (const storeNameToCreate of storeNamesToCreate) {
        if (!database.objectStoreNames.contains(storeNameToCreate)) {
          database.createObjectStore(storeNameToCreate);
        }
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function waitForRequest<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };

    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };
  });
}
