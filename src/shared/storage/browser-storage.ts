export interface JsonStorageCodec<TValue> {
  serialize?: (value: TValue) => string;
  deserialize?: (rawValue: string) => TValue;
}

export interface IndexedDbStorageLocation {
  databaseName: string;
  storeName: string;
  key: IDBValidKey;
  version?: number;
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

export async function saveToIndexedDb<TValue>(
  location: IndexedDbStorageLocation,
  value: TValue,
  codec: JsonStorageCodec<TValue> = {},
): Promise<TValue> {
  const database = await openIndexedDb(location);

  if (database === null) {
    return value;
  }

  try {
    const transaction = database.transaction(location.storeName, "readwrite");
    const completion = waitForTransaction(transaction);

    await waitForRequest(
      transaction
        .objectStore(location.storeName)
        .put(getCodec(codec).serialize(value), location.key),
    );
    await completion;
  } catch {
    return value;
  } finally {
    database.close();
  }

  return value;
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
  location: IndexedDbStorageLocation,
): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === "undefined") {
    return null;
  }

  try {
    const database = await openDatabase(
      location.databaseName,
      location.version,
    );

    if (database.objectStoreNames.contains(location.storeName)) {
      return database;
    }

    // 缺少对象仓库时，通过一次版本升级补建，避免调用方手动管理初始化流程。
    const nextVersion = database.version + 1;
    database.close();

    return await openDatabase(
      location.databaseName,
      nextVersion,
      location.storeName,
    );
  } catch {
    return null;
  }
}

function openDatabase(
  databaseName: string,
  version?: number,
  storeNameToCreate?: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined
        ? globalThis.indexedDB.open(databaseName)
        : globalThis.indexedDB.open(databaseName, version);

    request.onerror = () => {
      reject(
        request.error ??
          new Error(`Failed to open IndexedDB database \"${databaseName}\".`),
      );
    };

    request.onupgradeneeded = () => {
      if (!storeNameToCreate) {
        return;
      }

      const database = request.result;

      if (!database.objectStoreNames.contains(storeNameToCreate)) {
        database.createObjectStore(storeNameToCreate);
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