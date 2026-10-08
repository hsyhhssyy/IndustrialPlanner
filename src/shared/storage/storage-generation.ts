import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";

export const RECOVERY_DATABASE = "v3-industrial-planner";
export const RECOVERY_STORE = "local-migration-recovery";
export const RECOVERY_STATE_KEY = "state";
export const RECOVERY_GENERATION_KEY = "industrial-planner-storage-generation";
export const RECOVERY_LOCK = "industrial-planner-data-lifecycle";

export interface StorageGeneration {
  readonly formatVersion: 1;
  readonly schemaVersion: number;
  readonly generation: string;
  readonly buildId: string;
  readonly phase: "ready" | "preparing" | "restoring";
  readonly restoreSnapshotId?: string;
  readonly rejectedBuild?: string;
}

let workerGeneration: string | null = null;
let activeGeneration: StorageGeneration | null = null;
let invalidated = false;
let onInvalidated: (() => void) | null = null;

export function installStorageGeneration(state: StorageGeneration, invalidate: () => void): () => void {
  activeGeneration = state;
  invalidated = false;
  onInvalidated = invalidate;
  const check = () => { try { assertLocalStorageGeneration(); } catch { /* 失效入口已触发刷新。 */ } };
  globalThis.addEventListener?.("storage", check);
  globalThis.addEventListener?.("pageshow", check);
  globalThis.addEventListener?.("focus", check);
  return () => {
    globalThis.removeEventListener?.("storage", check);
    globalThis.removeEventListener?.("pageshow", check);
    globalThis.removeEventListener?.("focus", check);
    activeGeneration = null;
    onInvalidated = null;
    invalidated = false;
    workerGeneration = null;
  };
}

export function hasStorageGeneration(): boolean { return activeGeneration !== null; }

export function getStorageGeneration(): StorageGeneration | null { return activeGeneration; }

/** 调度器持有生命周期独占锁并持久化新代际后更新当前页；其他页仍使用旧代际而被阻断。 */
export function adoptStorageGeneration(state: StorageGeneration): void {
  activeGeneration = state;
  localStorage.setItem(RECOVERY_GENERATION_KEY, state.generation);
}

export function assertLocalStorageGeneration(): void {
  if (invalidated) throw new Error("Storage generation changed; reload required.");
  if (activeGeneration === null) return;
  const marker = globalThis.localStorage.getItem(RECOVERY_GENERATION_KEY);
  if (marker !== activeGeneration.generation) invalidateStorageGeneration();
}

export function invalidateStorageGeneration(): never {
  if (!invalidated) {
    invalidated = true;
    onInvalidated?.();
  }
  throw new Error("Storage generation changed; reload required.");
}

/** 校验与正文写入共享同一事务，后台冻结页不能靠漏收事件绕过代际检查。 */
export async function assertIndexedDbGeneration(transaction: IDBTransaction, database: IDBDatabase): Promise<void> {
  if (database.name !== RECOVERY_DATABASE || !database.objectStoreNames.contains(RECOVERY_STORE)) return;
  if (invalidated) invalidateStorageGeneration();
  const raw = await new Promise<StorageGeneration | undefined>((resolve, reject) => {
    const request = transaction.objectStore(RECOVERY_STORE).get(RECOVERY_STATE_KEY);
    request.onsuccess = () => resolve(request.result as StorageGeneration | undefined);
    request.onerror = () => reject(request.error);
  });
  if (raw === undefined) return;
  if (raw.formatVersion !== 1 || raw.phase !== "ready"
    || raw.schemaVersion !== (activeGeneration?.schemaVersion ?? BLUEPRINT_SCHEMA_VERSION)
    || (activeGeneration !== null && raw.generation !== activeGeneration.generation)
    || (activeGeneration === null && workerGeneration !== null && workerGeneration !== raw.generation)) invalidateStorageGeneration();
  if (activeGeneration === null) workerGeneration = raw.generation;
}

export function guardedStoreNames(database: IDBDatabase, storeNames: readonly string[]): string[] {
  return [...new Set([...storeNames, ...(database.name === RECOVERY_DATABASE
    && database.objectStoreNames.contains(RECOVERY_STORE) ? [RECOVERY_STORE] : [])])];
}

/** 远端提交持有共享锁；恢复持有独占锁，等已开始的提交结束后才更换数据。 */
export async function withStorageGeneration<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    assertLocalStorageGeneration();
    if (typeof indexedDB !== "undefined") {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(RECOVERY_DATABASE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (database.objectStoreNames.contains(RECOVERY_STORE)) {
          await assertIndexedDbGeneration(database.transaction(RECOVERY_STORE, "readonly"), database);
        }
      } finally { database.close(); }
    }
    return task();
  };
  return globalThis.navigator?.locks === undefined
    ? run()
    : navigator.locks.request(RECOVERY_LOCK, { mode: "shared" }, run);
}
