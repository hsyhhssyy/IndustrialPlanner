import type { IndexedDbStorageLocation } from "./browser-storage";
import {
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
} from "./browser-storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 单个迁移步骤。
 *
 * `version` 是迁移后的目标版本号，`migrate` 接收上一个版本的输出（若是
 * 链式首步则接收原始存储数据），返回迁移后的值，或返回 `null` 表示数据
 * 不可恢复、终止迁移链。
 */
export interface StorageMigration<T, TContext = void> {
  readonly version: number;
  readonly migrate: (raw: unknown, context: TContext) => T | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface VersionedPayload<T> {
  _v: number;
  data: T;
}

function isVersionedPayload(value: unknown): value is VersionedPayload<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "_v" in value &&
    typeof (value as VersionedPayload<unknown>)._v === "number" &&
    "data" in value
  );
}

function applyMigrations<T, TContext>(
  raw: unknown,
  currentVersion: number,
  migrations: readonly StorageMigration<T, TContext>[],
  context: TContext,
): T | null {
  let storedVersion: number;
  let data: unknown;

  if (isVersionedPayload(raw)) {
    storedVersion = raw._v;
    data = raw.data;
  } else {
    // 未版本化旧数据视为 v0。
    storedVersion = 0;
    data = raw;
  }

  // 数据本身为 null/undefined -> 无可迁移内容。
  if (data === null || data === undefined) {
    return null;
  }

  // 新版本写入的数据被旧版本代码读取 -> 拒绝。
  if (storedVersion > currentVersion) {
    return null;
  }

  // 已是最新版本，直接返回。
  if (storedVersion === currentVersion) {
    return data as T;
  }

  // 链式执行所有 version > storedVersion 的迁移步骤（按版本升序）。
  const pending = migrations
    .filter((m) => m.version > storedVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const result = migration.migrate(data, context);

    if (result === null) {
      return null;
    }

    data = result;
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Public API — localStorage
// ---------------------------------------------------------------------------

/**
 * 从 localStorage 读取并执行迁移链。
 *
 * @param key           localStorage key
 * @param currentVersion 当前代码期望的最新版本号
 * @param migrations    按 version 升序排列的迁移链
 * @param context       传递给每个 `migrate` 的额外上下文
 */
export function readFromLocalStorageWithMigration<T, TContext = void>(
  key: string,
  currentVersion: number,
  migrations: readonly StorageMigration<T, TContext>[],
  context: TContext,
): T | null {
  const raw = readFromLocalStorage<unknown>(key);

  if (raw === null) {
    return null;
  }

  return applyMigrations(raw, currentVersion, migrations, context);
}

/**
 * 写入 localStorage 并自动附加版本号包装。
 *
 * 写入格式：`{ _v: currentVersion, data: value }`
 */
export function saveToLocalStorageWithVersion<T>(
  key: string,
  currentVersion: number,
  value: T,
): T {
  const payload: VersionedPayload<T> = { _v: currentVersion, data: value };

  saveToLocalStorage(key, payload);

  return value;
}

// ---------------------------------------------------------------------------
// Public API — IndexedDB
// ---------------------------------------------------------------------------

/**
 * 从 IndexedDB 读取并执行迁移链。
 */
export async function readFromIndexedDbWithMigration<T, TContext = void>(
  location: IndexedDbStorageLocation,
  currentVersion: number,
  migrations: readonly StorageMigration<T, TContext>[],
  context: TContext,
): Promise<T | null> {
  const raw = await readFromIndexedDb<unknown>(location);

  if (raw === null) {
    return null;
  }

  return applyMigrations(raw, currentVersion, migrations, context);
}

/**
 * 写入 IndexedDB 并自动附加版本号包装。
 */
export async function saveToIndexedDbWithVersion<T>(
  location: IndexedDbStorageLocation,
  currentVersion: number,
  value: T,
): Promise<T> {
  const payload: VersionedPayload<T> = { _v: currentVersion, data: value };

  await saveToIndexedDb(location, payload);

  return value;
}
