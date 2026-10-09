import { hasStorageGeneration } from "./storage-generation";
import { prepareStoredJsonMigration } from "./migration-records";
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

/** 全库升级使用与单项读取相同的版本规则，显式产生持久化任务。 */
export async function prepareVersionedStorageMigration<T, TContext>(
  location: IndexedDbStorageLocation, currentVersion: number, migrations: readonly StorageMigration<T, TContext>[],
  context: TContext, normalize: (value: T) => T | null, label: string, version = String(currentVersion),
) {
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: prepareStoredJsonMigration 统一原件隔离
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   const raw = await readFromIndexedDb<unknown>(location, { strict: true });
//   if (raw === null) return { jobs: [] };
//   const value = applyMigrations(raw, currentVersion, migrations, context);
//   const normalized = value === null ? null : normalize(value);
//   if (normalized === null) throw new Error(`${label} 无法升级，原件已保留。`);
//   return { jobs: migratedRecordJob(location, { key: location.key, value: raw }, { _v: currentVersion, data: normalized }, label) };
  return prepareStoredJsonMigration(location, raw => {
    const value = applyMigrations(raw, currentVersion, migrations, context);
    const normalized = value === null ? null : normalize(value);
    return normalized === null ? null : { _v: currentVersion, data: normalized };
  }, label, version);
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

  const migrated = applyMigrations(raw, currentVersion, migrations, context);
  // 2026-09-28: 安全启动后的应用禁止把不可迁移数据解释为空白默认值，再自动保存覆盖原件。
  if (migrated === null && hasStorageGeneration()) throw new Error("Stored data cannot be migrated; original data was preserved.");
  return migrated;
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

  const migrated = applyMigrations(raw, currentVersion, migrations, context);
  // 2026-09-28: 安全启动后的应用禁止把不可迁移数据解释为空白默认值，再自动保存覆盖原件。
  if (migrated === null && hasStorageGeneration()) throw new Error("Stored data cannot be migrated; original data was preserved.");
  return migrated;
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
