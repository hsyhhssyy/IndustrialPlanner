import { parse, stringify } from "devalue";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { isPersistedLogEntry, LOG_COLLECTOR_DATABASE_NAME, LOG_COLLECTOR_STORE_NAME } from "./logging/log-collector-protocol";
import { LogCollectorStorage } from "./logging/log-collector-storage";
import { LEGACY_EDA_TASK_LOCATION } from "./storage/eda-task-storage";
import {
  captureLocalData, hasWebDavSettings, isTransferLocalKey, isTransferRecord, stageLocalDataImport,
  type LocalDataSnapshot, type TransferStore,
} from "./storage/local-data-transfer";
import { RECOVERY_STORE } from "./storage/storage-generation";

const FORMAT = "industrial-planner-local-data";
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
// 外部文件只提供记录，不能指定目标数据库或其结构。
const AUXILIARY_LOCATIONS = [
  LEGACY_EDA_TASK_LOCATION,
  { databaseName: LOG_COLLECTOR_DATABASE_NAME, storeName: LOG_COLLECTOR_STORE_NAME },
];

async function ensureLogDatabase() {
  // 首次使用时由日志模块建立 inline 主键和时间索引。
  const logs = new LogCollectorStorage();
  try { await logs.query({ limit: 1 }); } finally { await logs.close(); }
}

export async function prepareLocalDataArchive() {
  await ensureLogDatabase();
  const snapshot = await captureLocalData(AUXILIARY_LOCATIONS);
  return { snapshot, includesWebDavSettings: hasWebDavSettings(snapshot) };
}

export async function createLocalDataArchive(snapshot: LocalDataSnapshot): Promise<Blob> {
  // EDA 检查点包含共享引用，上传队列含二进制数据。普通 JSON 会复制或损坏这些值。
  const body = new Blob([stringify({
    format: FORMAT, version: 1, appVersion: import.meta.env.VITE_APP_VERSION ?? "dev", snapshot,
  })]);
  if (body.size > MAX_ARCHIVE_BYTES) throw new Error("settingsTransfer.tooLarge");
  return new Response(body.stream().pipeThrough(new CompressionStream("gzip")), {
    headers: { "Content-Type": "application/gzip" },
  }).blob();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function invalid(): never { throw new Error("Invalid or incompatible IndustrialPlanner backup."); }

function validateStores(value: unknown, auxiliary: boolean): TransferStore[] {
  if (!Array.isArray(value)) invalid();
  const stores = new Map<string, TransferStore>();
  for (const store of value as unknown[]) {
    if (!isRecord(store) || typeof store.name !== "string" || !/^[a-z0-9-]+$/u.test(store.name)
      || stores.has(store.name) || !Array.isArray(store.entries)) invalid();
    const entries = (store.entries as unknown[]).map(entry => {
      if (!isRecord(entry) || !Object.hasOwn(entry, "value")) invalid();
      const key = entry.key as IDBValidKey;
      indexedDB.cmp(key, key); // 使用浏览器自身的 IndexedDB 主键规则。
      if (!auxiliary && !isTransferRecord(store.name as string, key)) invalid();
      if (auxiliary && store.name === LOG_COLLECTOR_DATABASE_NAME
        && (!isPersistedLogEntry(entry.value) || entry.value.id !== key)) invalid();
      return { key, value: entry.value };
    });
    // 原生 getAllKeys 以主键升序返回。禁止空洞、乱序和重复主键。
    for (let i = 0; i < entries.length; i++) {
      const row = entries[i];
      if (!row || (i > 0 && indexedDB.cmp(entries[i - 1]!.key, row.key) >= 0)) invalid();
    }
    stores.set(store.name, { name: store.name, entries });
  }
  if (auxiliary) {
    if (stores.size !== AUXILIARY_LOCATIONS.length || AUXILIARY_LOCATIONS.some(loc => !stores.has(loc.databaseName))) invalid();
  } else if (!stores.has(RECOVERY_STORE)) invalid();
  return Array.from(stores.values());
}

export async function readLocalDataArchive(file: Blob, signal?: AbortSignal): Promise<LocalDataSnapshot> {
  signal?.throwIfAborted();
  let bytes = 0;
  const stream = file.stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > MAX_ARCHIVE_BYTES) throw new Error("settingsTransfer.tooLarge");
        controller.enqueue(chunk);
      },
    }), { signal },
  );
  const archive: unknown = parse(await new Response(stream).text());
  if (!isRecord(archive) || archive.format !== FORMAT || archive.version !== 1 || !isRecord(archive.snapshot)) invalid();
  const { schemaVersion, local, stores, auxiliary } = archive.snapshot;
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1
    || schemaVersion > BLUEPRINT_SCHEMA_VERSION || !isRecord(local)) invalid();
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(local)) {
    if (!isTransferLocalKey(key) || typeof value !== "string") invalid();
    settings[key] = value;
  }
  return { schemaVersion, local: settings, stores: validateStores(stores, false), auxiliary: validateStores(auxiliary, true) };
}

export async function importLocalDataArchive(snapshot: LocalDataSnapshot): Promise<void> {
  await ensureLogDatabase();
  await stageLocalDataImport(snapshot, AUXILIARY_LOCATIONS);
}
