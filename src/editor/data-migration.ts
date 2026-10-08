import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage/browser-storage";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import { EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY, normalizeEditorPersistState } from "@/shared/storage/editor-persist-state-storage";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import type { DataMigrationPlan } from "@/shared/data-migration";
import { readMigrationRecords, migratedRecordJob } from "@/shared/storage/migration-records";
import { applyIndexedDbTransactionMutations, readFromIndexedDb } from "@/shared/storage/browser-storage";
import { WORLD_DOCUMENT_DATABASE_LOCATION, normalizeWorldDocument } from "./document-storage";
import { normalizePersistedEditorHistoryState } from "./history";
import { LEGACY_REGIONAL_SETTINGS_LOCATION, readLegacyRegionalDarkPipeAsset, planLegacyRegionalDarkPipeMigration } from "@/shared/legacy-regional-dark-pipe";
import { emitStorageChange } from "@/shared/storage/storage-change-event";

export async function prepareEditorDataMigration(registry: RegistryContract): Promise<DataMigrationPlan> {
  const documents = await readMigrationRecords(WORLD_DOCUMENT_DATABASE_LOCATION);
  const migrated = new Map<string, WorldDocument>();
  const jobs = documents.flatMap(record => {
    const value = normalizeWorldDocument(record.value);
    if (value === null || value.documentKey !== record.key) throw new Error(`基地文档 ${String(record.key)} 无法升级，原件已保留。`);
    migrated.set(String(record.key), value);
    return migratedRecordJob(WORLD_DOCUMENT_DATABASE_LOCATION, record, value, `基地：${value.baseId}`).map(job => ({
      ...job, run: async () => { await job.run(); emitStorageChange({ assetType: "world-document",
        assetId: value.documentKey, origin: "local", timestamp: Date.now() }); },
    }));
  });
  const historyLocation = { ...WORLD_DOCUMENT_DATABASE_LOCATION, storeName: "editorhistory" };
  for (const record of await readMigrationRecords(historyLocation)) {
    const value = normalizePersistedEditorHistoryState(record.value, String(record.key), migrated.get(String(record.key)) ?? null);
    jobs.push(...migratedRecordJob(historyLocation, record, value, "编辑历史"));
  }
  const raw = await readFromIndexedDb(LEGACY_REGIONAL_SETTINGS_LOCATION, { strict: true });
  const asset = readLegacyRegionalDarkPipeAsset(raw);
  if (asset !== null) {
    const latest = new Map<string, WorldDocument>();
    for (const document of migrated.values()) {
      const before = latest.get(document.baseId);
      if (before === undefined || before.meta.updatedAt < document.meta.updatedAt) latest.set(document.baseId, document);
    }
    const plan = planLegacyRegionalDarkPipeMigration({ asset, documents: [...latest.values()], bases: registry.baseDefinitions });
    if (plan.diagnostics.length > 0) console.warn("旧跨基地关系保留待补齐。", plan.diagnostics);
    if (plan.changed) jobs.push({ label: "跨基地关系", run: async () => {
      const current = readLegacyRegionalDarkPipeAsset(await readFromIndexedDb(LEGACY_REGIONAL_SETTINGS_LOCATION, { strict: true }));
      if (current === null) throw new Error("跨基地关系原件不可读取。");
      const plan = planLegacyRegionalDarkPipeMigration({ asset: current, documents: [...latest.values()], bases: registry.baseDefinitions });
      if (!await applyIndexedDbTransactionMutations<unknown>(WORLD_DOCUMENT_DATABASE_LOCATION, [
        { storeName: WORLD_DOCUMENT_DATABASE_LOCATION.storeName, operations: plan.changes.map(({ after }) => ({ type: "put", key: after.documentKey, value: after })) },
        { storeName: LEGACY_REGIONAL_SETTINGS_LOCATION.storeName, operations: [{ type: "put", key: LEGACY_REGIONAL_SETTINGS_LOCATION.key, value: plan.nextAsset }] },
      ])) throw new Error("跨基地关系升级未能保存。");
      for (const { after } of plan.changes) emitStorageChange({ assetType: "world-document", assetId: after.documentKey, origin: "local", timestamp: Date.now() });
      emitStorageChange({ assetType: "regional-settings", assetId: LEGACY_REGIONAL_SETTINGS_LOCATION.key, origin: "local", timestamp: Date.now() });
    } });
  }
  const index = readFromLocalStorage(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY);
  if (index !== null) {
    const normalized = normalizeEditorPersistState(index);
    if (createStableJsonHash(index) !== createStableJsonHash(normalized)) jobs.push({ label: "基地索引", run: async () => {
      saveToLocalStorage(EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY, normalized);
    } });
  }
  return { jobs };
}
