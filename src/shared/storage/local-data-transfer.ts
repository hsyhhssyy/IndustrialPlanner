import {
  openIndexedDbStores, waitForRequest, waitForTransaction, type IndexedDbStoreLocation,
} from "./browser-storage";
import {
  assertIndexedDbGeneration, assertLocalStorageGeneration, RECOVERY_DATABASE, RECOVERY_GENERATION_KEY,
  RECOVERY_LOCK, RECOVERY_STATE_KEY, RECOVERY_STORE, type StorageGeneration,
} from "./storage-generation";
import type { MigrationRecord } from "./migration-records";
import { SYNC_CONNECTION_SETTINGS_LOCATION } from "./sync-tombstone-storage";

const IMPORT_KEY = "pending-local-data-import";

// 同源部署可以承载其他应用。只读写本软件实际使用的持久设置，代际由本机重新建立。
const LOCAL_KEYS = new Set([
  "v3-app-settings", "v3-app-shortcuts", "v3-backend-api-address-override", "v3-cloudflare-oauth-session",
  "v3-editor-persist-state", "v3-experimental-regional-multi-base", "v3-network-registry-settings",
  "v3-planner-last-picker-query", "v3-planner-recent-picker-items", "v3-sync-metadata", "v3-sync-provider",
  "v3-sync-provider-activation", "v3-user-settings-dialog", "v3-v2-migration-state", "v3-warehouse-pinned-items",
  "v3-workbench-state", "v3-yituliu-session", "v3-module-balancing-tombstones",
  "industrial-planner-changelog-last-read-version", "industrial-planner-changelog-read-state",
  "industrial-planner-pwa-preference", "industrial-planner:pixi-render-antialias",
  "industrial-planner:pixi-render-group-mode", "industrial-planner:pixi-render-layer-profile",
  "stage1-active-base", "stage1-blueprints", "stage1-clipboard-blueprint", "stage1-layouts-by-base",
  "stage3-blueprint-last-clipboard", "stage3-blueprints-user", "stage3-clipboard-blueprint", "stage3-public-blueprint-index",
  "stage6-layout-history-by-base", "stage8-modular-balance-recent-picker-items",
  "modular-balance-canvases", "modular-balance-modules", "modular-balance-selected-canvas-id",
  "modular-balance-selected-stage-id", "modular-balance-stages", "modular-balance-system-inputs",
  "modular-balance-warehouse-enabled", "modular-balance-warehouse-max",
]);

export interface TransferStore {
  name: string;
  entries: MigrationRecord[];
}

interface SideData {
  local: Record<string, string>;
  auxiliary: TransferStore[];
}

export interface LocalDataSnapshot extends SideData {
  stores: TransferStore[];
  schemaVersion: number;
}

export function hasWebDavSettings(snapshot: LocalDataSnapshot): boolean {
  const { storeName, key } = SYNC_CONNECTION_SETTINGS_LOCATION;
  const raw = snapshot.stores.find(store => store.name === storeName)
    ?.entries.find(entry => entry.key === key)?.value;
  if (typeof raw !== "string") return false;

  try {
    const settings: unknown = JSON.parse(raw);
    if (settings === null || typeof settings !== "object") return false;
    const { url, username, password } = settings as Record<string, unknown>;
    return (typeof url === "string" && url.trim() !== "")
      || (typeof username === "string" && username.trim() !== "")
      || (typeof password === "string" && password !== "");
  } catch {
    return false;
  }
}

interface PendingImport {
  snapshot: LocalDataSnapshot;
  original: SideData;
  previousState: StorageGeneration;
  nextState: StorageGeneration;
  locations: readonly IndexedDbStoreLocation[];
}

export function isTransferLocalKey(key: string): boolean {
  return LOCAL_KEYS.has(key) || key.startsWith("v3-yituliu-sync:");
}

export function isTransferRecord(storeName: string, key: IDBValidKey): boolean {
  return storeName !== RECOVERY_STORE || (typeof key === "string" && key.startsWith("snapshot:"));
}

async function openDatabase(databaseName: string, stores: readonly string[]) {
  const database = await openIndexedDbStores({ databaseName }, stores);
  if (!database) throw new Error("Local database unavailable.");
  return database;
}

async function readStore(store: IDBObjectStore, name: string): Promise<TransferStore> {
  const [keys, values] = await Promise.all([
    waitForRequest(store.getAllKeys()), waitForRequest<unknown[]>(store.getAll()),
  ]);
  return { name, entries: keys.map((key, index) => ({ key, value: values[index] })) };
}

function readLocal(includePendingLogin: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key === null || !(isTransferLocalKey(key) || (includePendingLogin && key.startsWith("v3-yituliu-login:")))) continue;
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

async function readSideData(locations: readonly IndexedDbStoreLocation[], includePendingLogin: boolean): Promise<SideData> {
  const local = readLocal(includePendingLogin);
  const auxiliary = await Promise.all(locations.map(async ({ databaseName, storeName }) => {
    const db = await openDatabase(databaseName, [storeName]);
    try {
      return await readStore(db.transaction(storeName).objectStore(storeName), databaseName);
    } finally { db.close(); }
  }));
  return { local, auxiliary };
}

export async function captureLocalData(locations: readonly IndexedDbStoreLocation[]): Promise<LocalDataSnapshot> {
  return navigator.locks.request(RECOVERY_LOCK, { mode: "exclusive" }, async () => {
    assertLocalStorageGeneration();
    const db = await openDatabase(RECOVERY_DATABASE, [RECOVERY_STORE]);
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, "readonly");
      const [state, stores, side] = await Promise.all([
        waitForRequest<StorageGeneration>(tx.objectStore(RECOVERY_STORE).get(RECOVERY_STATE_KEY)),
        Promise.all(names.map(name => readStore(tx.objectStore(name), name))),
        readSideData(locations, false), assertIndexedDbGeneration(tx, db), waitForTransaction(tx),
      ]);
      if (state?.phase !== "ready") throw new Error("Local storage is not ready.");
      for (const store of stores) {
        if (store.name === RECOVERY_STORE) store.entries = store.entries.filter(entry => isTransferRecord(store.name, entry.key));
      }
      return { ...side, stores, schemaVersion: state.schemaVersion };
    } finally { db.close(); }
  });
}

async function writeTransaction(db: IDBDatabase, names: string[], write: (tx: IDBTransaction) => void) {
  const tx = db.transaction(names, "readwrite");
  const done = waitForTransaction(tx);
  try {
    write(tx);
    await done;
  } catch (error) {
    try { tx.abort(); } catch { /* 异步写入错误已中止事务。 */ }
    await done.catch(() => undefined);
    throw error;
  }
}

/** 确认后只提交导入意图。整包与原有跨库数据写入失败时，当前存档仍可使用。 */
export async function stageLocalDataImport(snapshot: LocalDataSnapshot, locations: readonly IndexedDbStoreLocation[]) {
  await navigator.locks.request(RECOVERY_LOCK, { mode: "exclusive" }, async () => {
    assertLocalStorageGeneration();
    const db = await openDatabase(RECOVERY_DATABASE, [RECOVERY_STORE, ...snapshot.stores.map(store => store.name)]);
    try {
      const tx = db.transaction(RECOVERY_STORE, "readonly");
      const [previousState, original] = await Promise.all([
        waitForRequest<StorageGeneration>(tx.objectStore(RECOVERY_STORE).get(RECOVERY_STATE_KEY)),
        readSideData(locations, true), assertIndexedDbGeneration(tx, db),
      ]);
      if (previousState?.phase !== "ready") throw new Error("Local storage is not ready.");
      const nextState: StorageGeneration = {
        formatVersion: 1, schemaVersion: snapshot.schemaVersion, buildId: previousState.buildId,
        generation: crypto.randomUUID(), phase: "ready",
      };
      const pending: PendingImport = { snapshot, original, locations, previousState, nextState };
      await writeTransaction(db, [RECOVERY_STORE], transaction => {
        const store = transaction.objectStore(RECOVERY_STORE);
        store.add(pending, IMPORT_KEY);
        store.put({ ...nextState, phase: "restoring", restoreSnapshotId: IMPORT_KEY }, RECOVERY_STATE_KEY);
      });
      // 主库已拦截旧页写入。即使标签页标记触及配额，也须进入启动恢复。
      try { localStorage.setItem(RECOVERY_GENERATION_KEY, nextState.generation); } catch { /* 启动时重试。 */ }
    } finally { db.close(); }
  });
}

function replaceEntries(store: IDBObjectStore, entries: readonly MigrationRecord[]) {
  store.clear();
  for (const { key, value } of entries) {
    if (store.keyPath == null) store.add(value, key);
    else store.add(value);
  }
}

async function replaceSideData(data: SideData, locations: readonly IndexedDbStoreLocation[]) {
  // 先释放本应用占用的空间，避免等量替换也因瞬时双份占用而失败。
  // 未完成的登录回调绑定原标签页；成功替换时作废，回退时才恢复本机原值。
  for (const key of Object.keys(readLocal(true))) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(data.local)) localStorage.setItem(key, value);
  for (const { databaseName, storeName } of locations) {
    const records = data.auxiliary.find(store => store.name === databaseName)!;
    const db = await openDatabase(databaseName, [storeName]);
    try {
      await writeTransaction(db, [storeName], tx => replaceEntries(tx.objectStore(storeName), records.entries));
    } finally { db.close(); }
  }
}

/** 已持有生命周期独占锁，所有业务主机尚未启动。中断后可幂等重试，主库存档最后原子提交。 */
export async function finishPendingLocalDataImport(db: IDBDatabase): Promise<void> {
  const pending = await waitForRequest<PendingImport | undefined>(
    db.transaction(RECOVERY_STORE).objectStore(RECOVERY_STORE).get(IMPORT_KEY),
  );
  if (!pending) return;
  try {
    await replaceSideData(pending.snapshot, pending.locations);
    localStorage.setItem(RECOVERY_GENERATION_KEY, pending.nextState.generation);
    const stores = new Map(pending.snapshot.stores.map(store => [store.name, store.entries]));
    const names = Array.from(db.objectStoreNames);
    await writeTransaction(db, names, tx => {
      for (const name of names) replaceEntries(tx.objectStore(name), stores.get(name) ?? []);
      tx.objectStore(RECOVERY_STORE).put(pending.nextState, RECOVERY_STATE_KEY);
    });
  } catch (error) {
    await replaceSideData(pending.original, pending.locations);
    localStorage.setItem(RECOVERY_GENERATION_KEY, pending.previousState.generation);
    await writeTransaction(db, [RECOVERY_STORE], tx => {
      const store = tx.objectStore(RECOVERY_STORE);
      store.put(pending.previousState, RECOVERY_STATE_KEY);
      store.delete(IMPORT_KEY);
    });
    throw new Error("未能完成数据替换，已恢复原有数据。请重新加载。", { cause: error });
  }
}
