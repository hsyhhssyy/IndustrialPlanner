import {
  LOG_COLLECTOR_DATABASE_NAME,
  LOG_COLLECTOR_DATABASE_VERSION,
  LOG_COLLECTOR_MAX_ENTRIES,
  LOG_COLLECTOR_STORE_NAME,
  type LogEntryInput,
  type PersistedLogEntry,
} from "./log-collector-protocol";

export interface LogCollectorQuery {
  readonly beforeId?: number;
  readonly limit: number;
}

export interface LogCollectorQueryResult {
  readonly entries: PersistedLogEntry[];
  readonly nextBeforeId?: number;
  readonly total: number;
}

export interface LogCollectorStorageOptions {
  readonly indexedDb?: IDBFactory;
  readonly keyRange?: Pick<typeof IDBKeyRange, "upperBound">;
  readonly databaseName?: string;
  readonly maxEntries?: number;
}

export class LogCollectorStorage {
  private readonly indexedDb: IDBFactory;
  private readonly databaseName: string;
  private readonly maxEntries: number;
  private readonly keyRange: Pick<typeof IDBKeyRange, "upperBound">;
  private databasePromise: Promise<IDBDatabase> | null = null;

  public constructor(options: LogCollectorStorageOptions = {}) {
    const indexedDb = options.indexedDb ?? globalThis.indexedDB;
    if (indexedDb === undefined) {
      throw new Error("IndexedDB is unavailable.");
    }

    this.indexedDb = indexedDb;
    this.keyRange = options.keyRange ?? IDBKeyRange;
    this.databaseName = options.databaseName ?? LOG_COLLECTOR_DATABASE_NAME;
    this.maxEntries = options.maxEntries ?? LOG_COLLECTOR_MAX_ENTRIES;
  }

  public async append(entry: LogEntryInput): Promise<PersistedLogEntry> {
    const database = await this.openDatabase();
    const transaction = database.transaction(LOG_COLLECTOR_STORE_NAME, "readwrite");
    const completed = waitForTransaction(transaction);
    const store = transaction.objectStore(LOG_COLLECTOR_STORE_NAME);
    const collectedAt = Date.now();
    const id = Number(await requestResult(store.add({ ...entry, collectedAt })));
    const count = await requestResult(store.count());

    if (count > this.maxEntries) {
      await deleteOldestEntries(store, count - this.maxEntries);
    }

    await completed;
    return { ...entry, id, collectedAt };
  }

  public async query(options: LogCollectorQuery): Promise<LogCollectorQueryResult> {
    const database = await this.openDatabase();
    const transaction = database.transaction(LOG_COLLECTOR_STORE_NAME, "readonly");
    const completed = waitForTransaction(transaction);
    const store = transaction.objectStore(LOG_COLLECTOR_STORE_NAME);
    const totalPromise = requestResult(store.count());
    const requestedLimit = Number.isFinite(options.limit)
      ? Math.round(options.limit)
      : LOG_COLLECTOR_MAX_ENTRIES;
    const limit = Math.max(1, Math.min(requestedLimit, LOG_COLLECTOR_MAX_ENTRIES));
    const entries = await readEntriesDescending(
      store,
      this.keyRange,
      options.beforeId,
      limit + 1,
    );
    const total = await totalPromise;
    await completed;

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const lastEntry = page.at(-1);
    return {
      entries: page,
      ...(hasMore && lastEntry !== undefined ? { nextBeforeId: lastEntry.id } : {}),
      total,
    };
  }

  public async clear(): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(LOG_COLLECTOR_STORE_NAME, "readwrite");
    const completed = waitForTransaction(transaction);
    await requestResult(transaction.objectStore(LOG_COLLECTOR_STORE_NAME).clear());
    await completed;
  }

  public async close(): Promise<void> {
    if (this.databasePromise === null) {
      return;
    }

    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }

  private openDatabase(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.indexedDb.open(
        this.databaseName,
        LOG_COLLECTOR_DATABASE_VERSION,
      );

      request.onupgradeneeded = () => {
        const database = request.result;
        if (database.objectStoreNames.contains(LOG_COLLECTOR_STORE_NAME)) {
          return;
        }

        const store = database.createObjectStore(LOG_COLLECTOR_STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("byOccurredAt", "occurredAt");
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error("Failed to open log collector database."));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error("Log collector database upgrade was blocked."));
      };
    });

    return this.databasePromise;
  }
}

function requestResult<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("IndexedDB transaction failed."),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("IndexedDB transaction was aborted."),
    );
  });
}

function deleteOldestEntries(store: IDBObjectStore, deleteCount: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let remaining = deleteCount;
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("Failed to trim old logs."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || remaining <= 0) {
        resolve();
        return;
      }

      const deleteRequest = cursor.delete();
      deleteRequest.onerror = () => reject(
        deleteRequest.error ?? new Error("Failed to delete an old log."),
      );
      deleteRequest.onsuccess = () => {
        remaining -= 1;
        cursor.continue();
      };
    };
  });
}

function readEntriesDescending(
  store: IDBObjectStore,
  keyRange: Pick<typeof IDBKeyRange, "upperBound">,
  beforeId: number | undefined,
  limit: number,
): Promise<PersistedLogEntry[]> {
  return new Promise((resolve, reject) => {
    const range = beforeId === undefined ? null : keyRange.upperBound(beforeId, true);
    const request = store.openCursor(range, "prev");
    const entries: PersistedLogEntry[] = [];

    request.onerror = () => reject(request.error ?? new Error("Failed to read logs."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || entries.length >= limit) {
        resolve(entries);
        return;
      }

      entries.push(cursor.value as PersistedLogEntry);
      cursor.continue();
    };
  });
}
