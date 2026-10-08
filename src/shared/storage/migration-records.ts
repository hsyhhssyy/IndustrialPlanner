import { openIndexedDbStores, waitForTransaction, type IndexedDbStoreLocation, saveToIndexedDb } from "./browser-storage";
import { createStableJsonHash } from "./hash-utils";

export interface MigrationRecord { readonly key: IDBValidKey; readonly value: unknown }

/** 迁移必须保留真实主键，不能凭记录字段猜测或把损坏原件当作缺席。 */
export async function readMigrationRecords(location: IndexedDbStoreLocation, options: { readonly raw?: boolean } = {}): Promise<MigrationRecord[]> {
  const database = await openIndexedDbStores(location, [location.storeName]);
  if (database === null) throw new Error("无法读取待升级的数据。");
  try {
    const transaction = database.transaction(location.storeName, "readonly");
    const done = waitForTransaction(transaction);
    void done.catch(() => undefined);
    // AI-REMOVED 2026-10-08:
    // Reason: 全库迁移逐记录等待游标往返，放大 IndexedDB 扫描延迟。
    // Trigger: REQ-041 全库预检与移动端开发验证。
    // Evidence: 40 条蓝图库记录的预检约耗时 8 秒；该循环每项单独等待 onsuccess。
    // Replacement: 下方同一只读事务的 getAll/getAllKeys 批量快照。
    // Risk: 一次保留全库快照，与原函数返回全部记录的内存规模一致。
    // Human Review: Required
    //
    // Original code:
    // const records = await new Promise<MigrationRecord[]>((resolve, reject) => {
    //   const result: MigrationRecord[] = [];
    //   const request = transaction.objectStore(location.storeName).openCursor();
    //   request.onerror = () => reject(request.error);
    //   request.onsuccess = () => {
    //     const cursor = request.result;
    //     if (cursor === null) { resolve(result); return; }
    //     try {
    //       result.push({ key: cursor.key, value: !options.raw && typeof cursor.value === "string" ? JSON.parse(cursor.value) : cursor.value });
    //       cursor.continue();
    //     } catch (error) { reject(error); }
    //   };
    // });
    const objectStore = transaction.objectStore(location.storeName);
    const keysRequest = objectStore.getAllKeys();
    const valuesRequest = objectStore.getAll();
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((resolve, reject) => {
        keysRequest.onsuccess = () => resolve(keysRequest.result);
        keysRequest.onerror = () => reject(keysRequest.error);
      }),
      new Promise<unknown[]>((resolve, reject) => {
        valuesRequest.onsuccess = () => resolve(valuesRequest.result);
        valuesRequest.onerror = () => reject(valuesRequest.error);
      }),
    ]);
    const records = keys.map((key, index) => ({ key,
      value: !options.raw && typeof values[index] === "string" ? JSON.parse(values[index]) as unknown : values[index],
    }));
    await done;
    return records;
  } finally { database.close(); }
}

/** 返回需要显式提交的工作项；转换规则由资源 owner 提供。 */
export function migratedRecordJob(location: IndexedDbStoreLocation, record: MigrationRecord, value: unknown, label: string) {
  if (value === null) throw new Error(`${label} 无法升级，原始内容已保留。`);
  if (createStableJsonHash(record.value) === createStableJsonHash(value)) return [];
  return [{ label, run: async () => { await saveToIndexedDb({ ...location, key: record.key }, value); } }];
}
