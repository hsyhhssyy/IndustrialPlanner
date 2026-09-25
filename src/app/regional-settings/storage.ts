import type { ItemDefinition } from "@/domain/registry/types/item-definition";
// AI-REMOVED 2026-09-25:
// Reason: 旧 App 建链事务停用后无引用。
// Trigger: REQ-038 将关系权威迁入出口文档，Editor Action 改为异步持久化。
// Evidence: 旧测试直接调用同步 Action / App 资产，不能覆盖 IndexedDB 与后台文档。
// AI-CORRECTION 2026-09-25: 此处归档对象是旧 App 事务及其导入，而非测试；该事务同时写 App 关系资产和基地文档，与新的 Editor 文档权威写入入口重复，因此停用。
// Replacement: src/editor/document-transactions.ts
// Risk: 需以真实浏览器回归确认交互、互斥与关闭模式覆盖。
// Human Review: Required
// Original code:
// import type { WorldDocument } from "@/domain/document/world-document";
import {
  applyIndexedDbTransactionMutations,
  deleteFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbStorageLocation,
} from "@/shared/storage/browser-storage";
// AI-REMOVED 2026-09-25:
// Reason: 旧 App 建链事务停用后无引用。
// Trigger: REQ-038 将关系权威迁入出口文档，Editor Action 改为异步持久化。
// Evidence: 旧测试直接调用同步 Action / App 资产，不能覆盖 IndexedDB 与后台文档。
// AI-CORRECTION 2026-09-25: 此处归档对象是旧 App 事务及其导入，而非测试；该事务同时写 App 关系资产和基地文档，与新的 Editor 文档权威写入入口重复，因此停用。
// Replacement: src/editor/document-transactions.ts
// Risk: 需以真实浏览器回归确认交互、互斥与关闭模式覆盖。
// Human Review: Required
// Original code:
// import { normalizeWorldDocument, WORLD_DOCUMENT_DATABASE_LOCATION } from "@/shared/storage/world-document-storage";
import { LEGACY_REGIONAL_SETTINGS_LOCATION } from "@/shared/legacy-regional-dark-pipe";
import {
  readFromIndexedDbWithMigration,
  // AI-REMOVED 2026-09-25:
  // Reason: 资源设置写入需保留数据库中尚未迁移的旧关系，防止旧内存副本恢复已迁移记录。
  // Trigger: REQ-038 文档权威及晚到同步。
  // Evidence: 原无条件整资产写入可覆盖 Editor 原子迁移结果。
  // Replacement: 下方 saveRegionalSettingsAsset 条件事务。
  // Risk: 保存失败现在明确抛出。
  // Human Review: Required
  // Original code:
  // saveToIndexedDbWithVersion,
  type StorageMigration,
} from "@/shared/storage/migration";
import {
  emitStorageChange,
  type StorageWriteOptions,
} from "@/shared/storage/storage-change-event";
import {
  normalizeRegionalSettingsAsset,
  REGIONAL_SETTINGS_ASSET_ID,
  REGIONAL_SETTINGS_SCHEMA_VERSION,
  type RegionalSettingsAsset,
} from "./model";

const REGIONAL_SETTINGS_STORE_LOCATION: IndexedDbStorageLocation = {
  ...LEGACY_REGIONAL_SETTINGS_LOCATION,
};

export async function loadRegionalSettingsAsset(
  itemDefinitions: readonly ItemDefinition[],
): Promise<RegionalSettingsAsset | null> {
  const migrations: readonly StorageMigration<RegionalSettingsAsset, readonly ItemDefinition[]>[] = [{
    version: REGIONAL_SETTINGS_SCHEMA_VERSION,
    migrate: (raw, definitions) => normalizeRegionalSettingsAsset(raw, definitions),
  }];
  const asset = await readFromIndexedDbWithMigration(
    REGIONAL_SETTINGS_STORE_LOCATION,
    REGIONAL_SETTINGS_SCHEMA_VERSION,
    migrations,
    itemDefinitions,
  );
  return asset === null ? null : normalizeRegionalSettingsAsset(asset, itemDefinitions);
}

export async function saveRegionalSettingsAsset(
  asset: RegionalSettingsAsset,
  options: StorageWriteOptions = {},
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readFromIndexedDb<{ data?: { darkPipeLinks?: unknown } }>(REGIONAL_SETTINGS_STORE_LOCATION);
    // 本地资源编辑无权新增旧格式关系；同步输入保留旧记录供 Editor 消费。
    const data = options.origin === "remote-sync" ? asset : {
      ...asset, darkPipeLinks: stored?.data?.darkPipeLinks ?? [],
    };
    const { storeName, key } = REGIONAL_SETTINGS_STORE_LOCATION;
    if (await applyIndexedDbTransactionMutations<unknown>(REGIONAL_SETTINGS_STORE_LOCATION, [{
      storeName, operations: [{ type: "put", key, value: { _v: REGIONAL_SETTINGS_SCHEMA_VERSION, data } }],
    }], {}, { expectedValues: [{ storeName, key, value: stored }] })) {
      emitRegionalSettingsStorageChange(options);
      return;
    }
  }
  throw new Error("Regional settings changed during saving or could not be persisted.");
}

// AI-REMOVED 2026-09-25:
// Reason: App 不再保存跨基地暗管关系，旧事务入口停用。
// Trigger: REQ-038 将关系权威迁入出口文档，Editor Action 改为异步持久化。
// Evidence: 旧测试直接调用同步 Action / App 资产，不能覆盖 IndexedDB 与后台文档。
// AI-CORRECTION 2026-09-25: 此处归档对象是旧 App 事务及其导入，而非测试；该事务同时写 App 关系资产和基地文档，与新的 Editor 文档权威写入入口重复，因此停用。
// Replacement: src/editor/document-transactions.ts
// Risk: 需以真实浏览器回归确认交互、互斥与关闭模式覆盖。
// Human Review: Required
// Original code:
// /** 区域关系与两个基地的端点配置作为一笔事务保存；任一前置版本变化就整笔取消。 */
// export async function saveRegionalDarkPipeConnection(options: {
//   readonly previousAsset: RegionalSettingsAsset;
//   readonly nextAsset: RegionalSettingsAsset;
//   readonly documents: readonly { readonly before: WorldDocument; readonly after: WorldDocument }[];
//   readonly itemDefinitions: readonly ItemDefinition[];
//   readonly signal: AbortSignal;
// }): Promise<boolean> {
//   const rawAsset = await readFromIndexedDb<{ _v: number; data: RegionalSettingsAsset }>(REGIONAL_SETTINGS_STORE_LOCATION);
//   const storedAsset = rawAsset === null ? null
//     : normalizeRegionalSettingsAsset(rawAsset.data, options.itemDefinitions);
//   if (storedAsset === null || JSON.stringify(storedAsset) !== JSON.stringify(options.previousAsset)) return false;
//
//   const expectedValues: Array<{ storeName: string; key: string; value: unknown }> = [{
//     storeName: REGIONAL_SETTINGS_STORE_LOCATION.storeName,
//     key: REGIONAL_SETTINGS_ASSET_ID,
//     value: rawAsset,
//   }];
//   for (const { before } of options.documents) {
//     const rawDocument = await readFromIndexedDb<unknown>({
//       ...WORLD_DOCUMENT_DATABASE_LOCATION, key: before.documentKey,
//     });
//     if (JSON.stringify(normalizeWorldDocument(rawDocument)) !== JSON.stringify(before)) return false;
//     expectedValues.push({ storeName: WORLD_DOCUMENT_DATABASE_LOCATION.storeName, key: before.documentKey, value: rawDocument });
//   }
//   const saved = await applyIndexedDbTransactionMutations<unknown>(REGIONAL_SETTINGS_STORE_LOCATION, [
//     {
//       storeName: WORLD_DOCUMENT_DATABASE_LOCATION.storeName,
//       operations: options.documents.filter(({ before, after }) => before !== after).map(({ after }) => ({
//         type: "put" as const, key: after.documentKey, value: after,
//       })),
//     },
//     {
//       storeName: REGIONAL_SETTINGS_STORE_LOCATION.storeName,
//       operations: [{ type: "put", key: REGIONAL_SETTINGS_ASSET_ID,
//         value: { _v: REGIONAL_SETTINGS_SCHEMA_VERSION, data: options.nextAsset } }],
//     },
//   ], {}, { signal: options.signal, expectedValues });
//   return saved;
// }
//
// /** 内存发布完成后再通知同步，避免消费者读取到半更新的关系。 */
// export function emitRegionalDarkPipeConnectionChange(documents: readonly WorldDocument[]): void {
//   emitRegionalSettingsStorageChange({ origin: "local" });
//   for (const document of documents) {
//     emitStorageChange({ assetType: "world-document", assetId: document.documentKey, origin: "local", timestamp: Date.now() });
//   }
// }
//

export async function deleteRegionalSettingsAsset(
  options: StorageWriteOptions = {},
): Promise<void> {
  await deleteFromIndexedDb(REGIONAL_SETTINGS_STORE_LOCATION);
  emitRegionalSettingsStorageChange(options);
}

function emitRegionalSettingsStorageChange(options: StorageWriteOptions): void {
  emitStorageChange({
    assetType: "regional-settings",
    assetId: REGIONAL_SETTINGS_ASSET_ID,
    origin: options.origin ?? "local",
    timestamp: Date.now(),
  });
}
