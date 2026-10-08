// 固定于 2026-10-08、REQ-041 实施前的恢复入口。禁止随新恢复器同步改写；用于证明旧实现可读取新流程保留的原件。
import { openIndexedDbStores, waitForRequest, waitForTransaction } from "@/shared/storage/browser-storage";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import {
  installStorageGeneration, RECOVERY_DATABASE, RECOVERY_GENERATION_KEY, RECOVERY_LOCK,
  RECOVERY_STATE_KEY, RECOVERY_STORE, type StorageGeneration,
} from "@/shared/storage/storage-generation";

export const MIGRATION_BACKUP_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
const SNAPSHOT_PREFIX = "snapshot:";
const TRANSIENT_STORES = new Set(["cf-sync-upload-journal", "cf-sync-upload-payloads"]);
// 登录身份和连接目标不属于业务迁移，避免恢复快照把同步切回旧账户或旧空间。
const CONNECTION_STORES = new Set(["sync-connection-settings", "cloudflare-sync-settings", "sync-owner-state"]);
const CONNECTION_KEYS = new Set(["v3-cloudflare-oauth-session", "v3-sync-provider", "v3-sync-provider-activation", "v3-backend-api-address-override"]);

interface RawStore {
  readonly name: string;
  readonly entries: readonly { readonly key: IDBValidKey; readonly value: unknown }[];
}
interface RecoverySnapshot {
  readonly formatVersion: 1;
  readonly id: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly stores: readonly RawStore[];
  readonly local: Readonly<Record<string, string>>;
  readonly checksum: string;
}

/** 所有主机创建之前执行；任何失败都不得放行业务模块。 */
export async function prepareLocalMigrationRecovery(options: {
  readonly schemaVersion: number;
  readonly buildId: string;
  readonly onInvalidated: () => void;
  readonly now?: number;
  readonly verifyCurrentBuild?: () => Promise<boolean>;
}): Promise<() => void> {
  if (globalThis.navigator?.locks === undefined) throw new Error("浏览器不支持安全的数据升级，请更新浏览器后重试。");
  return navigator.locks.request(RECOVERY_LOCK, { mode: "exclusive" }, async () => {
    const database = await openIndexedDbStores({ databaseName: RECOVERY_DATABASE }, [RECOVERY_STORE]);
    if (database === null) throw new Error("无法打开本地存储，原数据未修改。");
    try {
      const now = options.now ?? Date.now();
      const transaction = database.transaction(Array.from(database.objectStoreNames), "readonly");
      const completion = waitForTransaction(transaction);
      void completion.catch(() => undefined);
      const [stored, snapshots, stores] = await Promise.all([
        waitForRequest<StorageGeneration | undefined>(transaction.objectStore(RECOVERY_STORE).get(RECOVERY_STATE_KEY)),
        waitForRequest<unknown[]>(transaction.objectStore(RECOVERY_STORE).getAll()),
        readStores(transaction, database),
      ]);
      await completion;
      if (stored !== undefined && !isGeneration(stored)) throw new Error("本地恢复记录无效，已停止写入。");
      const observedSchema = readDataSchema(stores, stored?.schemaVersion ?? options.schemaVersion);
      const sourceSchema = Math.max(stored?.schemaVersion ?? 0, observedSchema);
      const buildKey = `${options.schemaVersion}:${options.buildId}`;
      if (stored?.rejectedBuild !== undefined && options.schemaVersion > stored.schemaVersion
        && (stored.rejectedBuild === buildKey || !await options.verifyCurrentBuild?.())) {
        throw new Error("此页面仍是已回滚的版本，请联网刷新获取当前版本。");
      }

      let state: StorageGeneration;
      if (stored?.phase === "restoring" || sourceSchema > options.schemaVersion) {
        const candidates = snapshots.filter(isSnapshot).filter(snapshot =>
          snapshot.schemaVersion <= options.schemaVersion
          && (stored?.phase === "restoring"
            ? snapshot.id === stored.restoreSnapshotId
            : snapshot.expiresAt > now),
        ).sort((a, b) => b.createdAt - a.createdAt);
        const snapshot = candidates[0];
        if (snapshot === undefined || snapshot.checksum !== checksum(snapshot)) {
          throw new Error("没有完整且兼容的本地恢复备份，已保留当前数据并停止写入。");
        }
        state = stored?.phase === "restoring" ? stored : {
          formatVersion: 1, schemaVersion: options.schemaVersion, buildId: options.buildId,
          generation: crypto.randomUUID(), phase: "restoring", restoreSnapshotId: snapshot.id,
          rejectedBuild: `${sourceSchema}:${stored?.buildId ?? "unknown"}`,
        };
        // 先持久化恢复意图，再替换正文；跨 IndexedDB/localStorage 中断后可重试。
        await writeState(database, state);
        localStorage.setItem(RECOVERY_GENERATION_KEY, state.generation);
        await restoreStores(database, snapshot, snapshots.filter(isSnapshot)
          .filter(candidate => candidate.schemaVersion > options.schemaVersion).map(candidate => candidate.id));
        restoreLocal(snapshot.local);
        state = { ...state, schemaVersion: options.schemaVersion, buildId: options.buildId, phase: "ready" };
        await writeState(database, state);
      } else if (stored === undefined || sourceSchema < options.schemaVersion || stored.phase === "preparing") {
        state = {
          formatVersion: 1, schemaVersion: sourceSchema, buildId: options.buildId,
          generation: crypto.randomUUID(), phase: "preparing", rejectedBuild: stored?.rejectedBuild,
        };
        await writeState(database, state);
        localStorage.setItem(RECOVERY_GENERATION_KEY, state.generation);
        // 代际屏障建立后重新读取；已提交的旧写入也必须收入快照。
        const capture = database.transaction(Array.from(database.objectStoreNames), "readonly");
        const captured = waitForTransaction(capture);
        void captured.catch(() => undefined);
        const originalStores = await readStores(capture, database);
        await captured;
        const data = {
          formatVersion: 1 as const, id: `${SNAPSHOT_PREFIX}${state.generation}`,
          schemaVersion: sourceSchema, createdAt: now, expiresAt: now + MIGRATION_BACKUP_RETENTION_MS,
          stores: originalStores, local: readLocal(),
        };
        const snapshot: RecoverySnapshot = { ...data, checksum: checksum(data) };
        const commit = database.transaction(RECOVERY_STORE, "readwrite");
        const committed = waitForTransaction(commit);
        void committed.catch(() => undefined);
        state = { ...state, schemaVersion: options.schemaVersion, phase: "ready" };
        try {
          commit.objectStore(RECOVERY_STORE).put(snapshot, snapshot.id);
          commit.objectStore(RECOVERY_STORE).put(state, RECOVERY_STATE_KEY);
          await committed;
        } catch (error) {
          try { commit.abort(); } catch { /* 事务已结束。 */ }
          await committed.catch(() => undefined);
          throw error;
        }
      } else {
        state = { ...stored, buildId: options.buildId };
        await writeState(database, state);
      }
      localStorage.setItem(RECOVERY_GENERATION_KEY, state.generation);
      await purgeExpiredSnapshots(database, now);
      return installStorageGeneration(state, options.onInvalidated);
    } finally { database.close(); }
  });
}

async function readStores(transaction: IDBTransaction, database: IDBDatabase): Promise<RawStore[]> {
  return Promise.all(Array.from(database.objectStoreNames).filter(name =>
    name !== RECOVERY_STORE && !TRANSIENT_STORES.has(name) && !CONNECTION_STORES.has(name),
  ).map(name => new Promise<RawStore>((resolve, reject) => {
    const entries: { key: IDBValidKey; value: unknown }[] = [];
    const request = transaction.objectStore(name).openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) { resolve({ name, entries }); return; }
      entries.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
    };
  })));
}

async function writeState(database: IDBDatabase, state: StorageGeneration): Promise<void> {
  const transaction = database.transaction(RECOVERY_STORE, "readwrite");
  const completion = waitForTransaction(transaction);
  void completion.catch(() => undefined);
  transaction.objectStore(RECOVERY_STORE).put(state, RECOVERY_STATE_KEY);
  await completion;
}

async function restoreStores(database: IDBDatabase, snapshot: RecoverySnapshot, discardSnapshotIds: readonly string[]): Promise<void> {
  const transaction = database.transaction(Array.from(database.objectStoreNames), "readwrite");
  const completion = waitForTransaction(transaction);
  void completion.catch(() => undefined);
  try {
    for (const name of Array.from(database.objectStoreNames)) {
      if (name !== RECOVERY_STORE && !CONNECTION_STORES.has(name)) transaction.objectStore(name).clear();
    }
    for (const id of discardSnapshotIds) transaction.objectStore(RECOVERY_STORE).delete(id);
    for (const store of snapshot.stores) {
      if (CONNECTION_STORES.has(store.name)) continue;
      for (const entry of store.entries) {
        // 比较 hash 随快照恢复；全局游标及缓存强制重新探测远端，禁止重放上传日志。
        if (store.name === "cf-sync-state") continue;
        transaction.objectStore(store.name).put(entry.value, entry.key);
      }
    }
    await completion;
  } catch (error) {
    try { transaction.abort(); } catch { /* 事务可能已经中止。 */ }
    await completion.catch(() => undefined);
    throw error;
  }
}

function isProtectedLocalKey(key: string): boolean {
  return !key.startsWith("v3-yituliu-login:") && key !== "v3-yituliu-session" && !CONNECTION_KEYS.has(key) && (key.startsWith("v3-") || /^stage\d+-/.test(key) || key.startsWith("modular-balance-"));
}

function readLocal(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null && isProtectedLocalKey(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) entries[key] = value;
    }
  }
  return entries;
}

function restoreLocal(values: Readonly<Record<string, string>>): void {
  for (const key of Object.keys(readLocal())) {
    if (!(key in values)) localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(values)) {
    if (!isProtectedLocalKey(key)) continue;
    if (key === "v3-sync-metadata") {
      const metadata = JSON.parse(value) as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...metadata, remoteRevisions: {}, remoteEtags: {} }));
    } else localStorage.setItem(key, value);
  }
}

function readDataSchema(stores: readonly RawStore[], fallback: number): number {
  let version = 0;
  for (const store of stores) {
    if (store.name !== "worddocument" && store.name !== "blueprints") continue;
    for (const entry of store.entries) {
      // 损坏正文仍进入原始备份；不能把解析失败的内容当成不存在或丢弃。
      try {
        const value: unknown = typeof entry.value === "string" ? JSON.parse(entry.value) : entry.value;
        if (typeof value === "object" && value !== null && "schemaVersion" in value
          && typeof value.schemaVersion === "number" && Number.isInteger(value.schemaVersion)) {
          version = Math.max(version, value.schemaVersion);
        }
      } catch { /* 原文由快照保留，业务严格读取会阻止覆盖。 */ }
    }
  }
  return version || fallback;
}

function checksum(value: Omit<RecoverySnapshot, "checksum">): string {
  return createStableJsonHash({ formatVersion: value.formatVersion, id: value.id,
    schemaVersion: value.schemaVersion, createdAt: value.createdAt, expiresAt: value.expiresAt,
    stores: value.stores, local: value.local });
}

function isSnapshot(value: unknown): value is RecoverySnapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<RecoverySnapshot>;
  return record.formatVersion === 1 && typeof record.id === "string" && record.id.startsWith(SNAPSHOT_PREFIX)
    && Number.isInteger(record.schemaVersion) && typeof record.createdAt === "number"
    && typeof record.expiresAt === "number" && Array.isArray(record.stores)
    && typeof record.local === "object" && record.local !== null && typeof record.checksum === "string";
}

function isGeneration(value: unknown): value is StorageGeneration {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<StorageGeneration>;
  return state.formatVersion === 1 && Number.isInteger(state.schemaVersion)
    && typeof state.generation === "string" && typeof state.buildId === "string"
    && (state.phase === "ready" || state.phase === "preparing" || state.phase === "restoring");
}

async function purgeExpiredSnapshots(database: IDBDatabase, now: number): Promise<void> {
  const transaction = database.transaction(RECOVERY_STORE, "readwrite");
  const completion = waitForTransaction(transaction);
  void completion.catch(() => undefined);
  const store = transaction.objectStore(RECOVERY_STORE);
  const values = await waitForRequest<unknown[]>(store.getAll());
  for (const value of values) if (isSnapshot(value) && value.expiresAt <= now) store.delete(value.id);
  await completion;
}
