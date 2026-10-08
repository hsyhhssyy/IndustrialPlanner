import { readFromIndexedDb, saveToIndexedDb, openIndexedDbStores, waitForRequest, waitForTransaction } from "./browser-storage";
import { adoptStorageGeneration, getStorageGeneration, RECOVERY_DATABASE, RECOVERY_STORE, RECOVERY_STATE_KEY, type StorageGeneration } from "./storage-generation";

export const DATA_MIGRATION_STORE = "data-migration-state";
export const DATA_MIGRATION_LOCATION = { databaseName: RECOVERY_DATABASE, storeName: DATA_MIGRATION_STORE, key: "complete" };

export interface DataMigrationCompletion {
  readonly version: string;
  readonly generation: string;
  readonly complete: boolean;
}

export async function isDataMigrationComplete(version: string): Promise<boolean> {
  const value = await readFromIndexedDb<DataMigrationCompletion>(DATA_MIGRATION_LOCATION, { strict: true });
  return value?.complete === true && value.version === version && value.generation === getStorageGeneration()?.generation;
}

/** 完成记录独立于旧恢复协议的 ready；失败和输入采纳前先持久化失效。 */
export async function writeDataMigrationCompletion(version: string, complete: boolean): Promise<void> {
  const generation = getStorageGeneration();
  if (generation === null) throw new Error("尚未建立本地数据恢复屏障。");
  await saveToIndexedDb(DATA_MIGRATION_LOCATION, { version, generation: generation.generation, complete } satisfies DataMigrationCompletion);
}

/** 必须在枚举迁移源之前建立跨页屏障，失效标记与新代际同事务提交。 */
export async function beginDataMigration(version: string): Promise<void> {
  const current = getStorageGeneration();
  if (current === null) throw new Error("尚未建立本地数据恢复屏障。");
  const database = await openIndexedDbStores({ databaseName: RECOVERY_DATABASE }, [RECOVERY_STORE, DATA_MIGRATION_STORE]);
  if (database === null) throw new Error("无法开始本地数据升级。");
  try {
    const transaction = database.transaction([RECOVERY_STORE, DATA_MIGRATION_STORE], "readwrite");
    const done = waitForTransaction(transaction);
    void done.catch(() => undefined);
    const stored = await waitForRequest<StorageGeneration>(transaction.objectStore(RECOVERY_STORE).get(RECOVERY_STATE_KEY));
    if (stored.generation !== current.generation || stored.phase !== "ready") {
      transaction.abort();
      await done.catch(() => undefined);
      throw new Error("本地数据已被其他页面更新，请重新加载。");
    }
    const next = { ...stored, generation: crypto.randomUUID() };
    transaction.objectStore(RECOVERY_STORE).put(next, RECOVERY_STATE_KEY);
    transaction.objectStore(DATA_MIGRATION_STORE).put(JSON.stringify({ version, generation: next.generation, complete: false }), "complete");
    await done;
    adoptStorageGeneration(next);
  } finally { database.close(); }
}
