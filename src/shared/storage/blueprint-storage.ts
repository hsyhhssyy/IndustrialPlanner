import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { createUuid } from "@/domain/shared/uuid";
import { migrateBlueprintEntityDeviceIds } from "@/shared/blueprint-device-id-migration";

import {
  applyIndexedDbStoreMutations,
  listFromIndexedDb,
  readFromIndexedDb,
  type IndexedDbStoreLocation,
} from "./browser-storage";
import { emitStorageChange } from "./storage-change-event";
import {
  clearActiveSyncTombstone,
  clearActiveSyncTombstones,
  listActiveSyncTombstones,
  writeActiveSyncTombstone,
} from "./sync-tombstone-storage";

const BLUEPRINT_DATABASE_NAME = "v3-industrial-planner";
const BLUEPRINT_STORE_NAME = "blueprints";
const BLUEPRINT_DELETED_RETENTION_DAYS = 30;
const BLUEPRINT_DELETED_RETENTION_MS = BLUEPRINT_DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const BLUEPRINT_SYNC_ADAPTER_ID = "blueprints";
const BLUEPRINT_FOLDER_SYNC_ADAPTER_ID = "blueprint-folders";

export const BLUEPRINT_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: BLUEPRINT_DATABASE_NAME,
  storeName: BLUEPRINT_STORE_NAME,
};

export interface BlueprintRecord extends BlueprintDocument {
  kind: "blueprint";
  parentFolderId: string | null;
  // AI-REMOVED 2026-08-08:
  // Reason: deletedAt 是同步墓碑元数据，不是蓝图业务属性。
  // Trigger: 用户要求同步属性不得渗入主数据库对象。
  // Evidence: 删除传播现在由 BlueprintSyncEntry 独立承载。
  // Replacement: BlueprintSyncEntry.deletedAt。
  // Risk: Low；同步功能仍通过独立条目保留删除时间。
  // Human Review: Required
  //
  // Original code:
  // deletedAt: string | null;
}

export interface BlueprintFolderRecord {
  schemaVersion: number;
  kind: "folder";
  folderId: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  // AI-REMOVED 2026-08-08:
  // Reason: deletedAt 是同步墓碑元数据，不是蓝图目录业务属性。
  // Trigger: 用户要求同步属性不得渗入主数据库对象。
  // Evidence: 删除传播现在由 BlueprintSyncEntry 独立承载。
  // Replacement: BlueprintSyncEntry.deletedAt。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // deletedAt: string | null;
}

export type BlueprintStorageEntry = BlueprintRecord | BlueprintFolderRecord;

export interface BlueprintSyncEntry<TValue extends BlueprintStorageEntry> {
  readonly id: string;
  readonly value: TValue;
  readonly deletedAt: string | null;
}

export interface BlueprintDirectoryListing {
  parentFolderId: string | null;
  folders: BlueprintFolderRecord[];
  blueprints: BlueprintRecord[];
}

export interface CreateBlueprintFolderInput {
  name: string;
  parentFolderId?: string | null;
}

export interface UpsertBlueprintFolderInput extends CreateBlueprintFolderInput {
  folderId: string;
}

export interface RenameBlueprintFolderInput {
  folderId: string;
  name: string;
}

export interface SaveBlueprintOptions {
  parentFolderId?: string | null;
}

// AI-REMOVED 2026-08-08:
// Reason: 业务读取不再暴露同步墓碑；同步模块使用 listBlueprintSyncEntries。
// Trigger: 用户要求同步数据与业务对象彻底隔离。
// Evidence: 已删除对象会从 blueprints store 物理移除。
// Replacement: listBlueprintSyncEntries。
// Risk: Low。
// Human Review: Required
//
// Original code:
// export interface BlueprintReadOptions {
//   includeDeleted?: boolean;
// }

export async function createBlueprintFolder(
  input: CreateBlueprintFolderInput,
): Promise<BlueprintFolderRecord | null> {
  const name = normalizeName(input.name);

  if (name === null) {
    return null;
  }

  const parentFolderId = normalizeOptionalId(input.parentFolderId);

  if (!(await doesFolderExist(parentFolderId))) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const folderRecord: BlueprintFolderRecord = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    kind: "folder",
    folderId: createUuid(),
    name,
    parentFolderId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return await writeBlueprintEntry(createFolderKey(folderRecord.folderId), folderRecord);
}

export async function upsertBlueprintFolder(
  input: UpsertBlueprintFolderInput,
): Promise<BlueprintFolderRecord | null> {
  const folderId = normalizeName(input.folderId);
  const name = normalizeName(input.name);

  if (folderId === null || name === null) {
    return null;
  }

  const parentFolderId = normalizeOptionalId(input.parentFolderId);

  if (!(await doesFolderExist(parentFolderId))) {
    return null;
  }

  const existingFolder = await readBlueprintFolder(folderId);
  const timestamp = new Date().toISOString();
  const folderRecord: BlueprintFolderRecord = {
    schemaVersion: existingFolder?.schemaVersion ?? BLUEPRINT_SCHEMA_VERSION,
    kind: "folder",
    folderId,
    name,
    parentFolderId,
    createdAt: existingFolder?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  return await writeBlueprintEntry(createFolderKey(folderRecord.folderId), folderRecord);
}

export async function readBlueprintFolder(
  folderId: string,
): Promise<BlueprintFolderRecord | null> {
  const entry = await readBlueprintEntry(createFolderKey(folderId));

  return entry?.kind === "folder" ? entry : null;
}

export async function renameBlueprintFolder(
  input: RenameBlueprintFolderInput,
): Promise<BlueprintFolderRecord | null> {
  const folder = await readBlueprintFolder(input.folderId);
  const name = normalizeName(input.name);

  if (folder === null || name === null) {
    return null;
  }

  const updatedFolder: BlueprintFolderRecord = {
    ...folder,
    name,
    updatedAt: new Date().toISOString(),
  };

  return await writeBlueprintEntry(createFolderKey(folder.folderId), updatedFolder);
}

export async function saveBlueprintDocument(
  document: BlueprintDocument,
  options: SaveBlueprintOptions = {},
): Promise<BlueprintRecord | null> {
  const existingRecord = await readBlueprintRecord(document.blueprintId);
  const parentFolderId =
    options.parentFolderId === undefined
      ? existingRecord?.parentFolderId ?? null
      : normalizeOptionalId(options.parentFolderId);

  if (!(await doesFolderExist(parentFolderId))) {
    return null;
  }

  const normalizedDocument = normalizeBlueprintDocument(document);

  if (normalizedDocument === null) {
    return null;
  }

  const blueprintRecord: BlueprintRecord = {
    ...normalizedDocument,
    kind: "blueprint",
    parentFolderId,
    createdAt: existingRecord?.createdAt ?? normalizedDocument.createdAt,
  };

  return await writeBlueprintEntry(
    createBlueprintKey(blueprintRecord.blueprintId),
    blueprintRecord,
  );
}

export async function readBlueprintRecord(
  blueprintId: string,
): Promise<BlueprintRecord | null> {
  const entry = await readBlueprintEntry(createBlueprintKey(blueprintId));

  return entry?.kind === "blueprint" ? entry : null;
}

export async function deleteBlueprintDocument(
  blueprintId: string,
): Promise<BlueprintRecord | null> {
  const record = await readBlueprintRecord(blueprintId);

  if (record === null) {
    return null;
  }

  const deletedAt = new Date().toISOString();
  await writeActiveSyncTombstone({
    adapterId: BLUEPRINT_SYNC_ADAPTER_ID,
    assetId: blueprintId,
    value: record,
    deletedAt,
  });
  const deleted = await deleteBlueprintEntries([createBlueprintKey(blueprintId)]);

  if (!deleted) {
    throw new Error("Failed to remove deleted blueprint from business storage.");
  }

  // AI-REMOVED 2026-08-08:
  // Reason: 删除时间属于同步墓碑，不应伪装成蓝图业务内容的最后编辑时间。
  // Trigger: 用户要求同步属性不得渗入蓝图主数据库对象。
  // Evidence: updatedAt 被蓝图库用于展示和排序，而墓碑现在独立保存在 provider 同步 store。
  // Replacement: 上方 writeActiveSyncTombstone；业务记录随后物理删除。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // return await writeBlueprintEntry(createBlueprintKey(blueprintId), {
  //   ...record,
  //   deletedAt,
  //   updatedAt: deletedAt,
  // });
  return record;
}

export async function canDeleteBlueprintFolder(folderId: string): Promise<boolean | null> {
  const rootFolder = await readBlueprintFolder(folderId);

  if (rootFolder === null) {
    return null;
  }

  const entries = await listBlueprintStorageEntries();
  const folderTreeIds = collectBlueprintFolderTreeIds(folderId, entries);

  if (folderTreeIds.size > 1) {
    return false;
  }

  const hasBlueprintDescendant = entries.some((entry) => (
    entry.kind === "blueprint"
      && entry.parentFolderId !== null
      && folderTreeIds.has(entry.parentFolderId)
  ));

  return !hasBlueprintDescendant;
}

export async function deleteBlueprintFolder(
  folderId: string,
): Promise<BlueprintFolderRecord | null> {
  const rootFolder = await readBlueprintFolder(folderId);

  if (rootFolder === null) {
    return null;
  }

  const canDelete = await canDeleteBlueprintFolder(folderId);

  if (canDelete !== true) {
    return null;
  }

  const deletedAt = new Date().toISOString();
  await writeActiveSyncTombstone({
    adapterId: BLUEPRINT_FOLDER_SYNC_ADAPTER_ID,
    assetId: rootFolder.folderId,
    value: rootFolder,
    deletedAt,
  });
  const deleted = await deleteBlueprintEntries([createFolderKey(rootFolder.folderId)]);

  if (!deleted) {
    throw new Error("Failed to remove deleted blueprint folder from business storage.");
  }

  // AI-REMOVED 2026-08-08:
  // Reason: 文件夹删除时间属于同步墓碑，不是业务编辑时间。
  // Trigger: 用户要求同步属性不得渗入蓝图主数据库对象。
  // Evidence: 墓碑已迁入 provider 同步 store，主存储不再保留已删除文件夹。
  // Replacement: 上方 writeActiveSyncTombstone；业务记录随后物理删除。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // return await writeBlueprintEntry(createFolderKey(rootFolder.folderId), {
  //   ...rootFolder,
  //   deletedAt,
  //   updatedAt: deletedAt,
  // });
  return rootFolder;
}

export async function listBlueprintDirectory(
  parentFolderId: string | null = null,
): Promise<BlueprintDirectoryListing> {
  const normalizedParentFolderId = normalizeOptionalId(parentFolderId);
  const entries = await listBlueprintStorageEntries();

  return {
    parentFolderId: normalizedParentFolderId,
    folders: entries
      .filter((entry): entry is BlueprintFolderRecord => entry.kind === "folder")
      .filter((entry) => entry.parentFolderId === normalizedParentFolderId)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    blueprints: entries
      .filter((entry): entry is BlueprintRecord => entry.kind === "blueprint")
      .filter((entry) => entry.parentFolderId === normalizedParentFolderId)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
  };
}

export async function listBlueprintStorageEntries(): Promise<BlueprintStorageEntry[]> {
  const entries = await listFromIndexedDb<unknown>(BLUEPRINT_STORE_LOCATION);
  return entries
    .map((entry) => normalizeBlueprintStorageEntry(entry))
    .filter((entry): entry is BlueprintStorageEntry => entry !== null);
}

export async function listBlueprintSyncEntries<
  TValue extends BlueprintStorageEntry,
>(kind: TValue["kind"]): Promise<BlueprintSyncEntry<TValue>[]> {
  await purgeExpiredDeletedBlueprintLibraryEntries();
  const activeEntries = (await listBlueprintStorageEntries())
    .filter((entry): entry is TValue => entry.kind === kind);
  const adapterId = kind === "blueprint"
    ? BLUEPRINT_SYNC_ADAPTER_ID
    : BLUEPRINT_FOLDER_SYNC_ADAPTER_ID;
  const tombstones = await listActiveSyncTombstones<TValue>(adapterId);
  const activeIds = new Set(activeEntries.map(readBlueprintStorageEntryId));

  return [
    ...activeEntries.map((value) => ({
      id: readBlueprintStorageEntryId(value),
      value,
      deletedAt: null,
    })),
    ...tombstones.flatMap((tombstone) => activeIds.has(tombstone.assetId)
      ? []
      : [{
          id: tombstone.assetId,
          value: tombstone.value,
          deletedAt: tombstone.deletedAt,
        }]),
  ];
}

export async function applyBlueprintSyncEntry<TValue extends BlueprintStorageEntry>(
  entry: BlueprintSyncEntry<TValue>,
): Promise<void> {
  if (readBlueprintStorageEntryId(entry.value) !== entry.id) {
    throw new Error("Blueprint sync asset id does not match its content id.");
  }
  const key = createBlueprintStorageEntryKey(entry.value);
  const adapterId = entry.value.kind === "blueprint"
    ? BLUEPRINT_SYNC_ADAPTER_ID
    : BLUEPRINT_FOLDER_SYNC_ADAPTER_ID;

  if (entry.deletedAt !== null) {
    await writeActiveSyncTombstone({
      adapterId,
      assetId: entry.id,
      value: entry.value,
      deletedAt: entry.deletedAt,
    });
    const deleted = await deleteBlueprintEntries([key]);
    if (!deleted) {
      throw new Error("Failed to apply remote blueprint tombstone.");
    }
    return;
  }

  await writeBlueprintEntry(key, entry.value);
}

// AI-REMOVED 2026-08-08:
// Reason: 旧入口把同步 deletedAt 合并进 BlueprintStorageEntry，导致业务对象与同步传输结构耦合。
// Trigger: 用户要求同步属性全部收归同步存储。
// Evidence: BlueprintRecord/BlueprintFolderRecord 已不再声明 deletedAt。
// Replacement: listBlueprintSyncEntries + applyBlueprintSyncEntry。
// Risk: Low；旧实验性调用点已统一迁移。
// Human Review: Required
//
// Original code:
// export async function upsertBlueprintStorageEntry(
//   entry: BlueprintStorageEntry,
// ): Promise<BlueprintStorageEntry | null> {
//   const key = entry.kind === "blueprint"
//     ? createBlueprintKey(entry.blueprintId)
//     : createFolderKey(entry.folderId);
//
//   return await writeBlueprintEntry(key, entry);
// }

async function readBlueprintEntry(
  key: string,
): Promise<BlueprintStorageEntry | null> {
  const rawEntry = await readFromIndexedDb<unknown>({
    ...BLUEPRINT_STORE_LOCATION,
    key,
  });

  return normalizeBlueprintStorageEntry(rawEntry);
}

async function writeBlueprintEntry<TEntry extends BlueprintStorageEntry>(
  key: string,
  entry: TEntry,
): Promise<TEntry | null> {
  const didWrite = await writeBlueprintEntries([{ key, entry }]);

  if (!didWrite) {
    return null;
  }

  await clearActiveSyncTombstone(
    entry.kind === "blueprint"
      ? BLUEPRINT_SYNC_ADAPTER_ID
      : BLUEPRINT_FOLDER_SYNC_ADAPTER_ID,
    readBlueprintStorageEntryId(entry),
  );

  return entry;
}

async function writeBlueprintEntries(
  entries: readonly {
    key: string;
    entry: BlueprintStorageEntry;
  }[],
): Promise<boolean> {
  const saved = await applyIndexedDbStoreMutations(BLUEPRINT_STORE_LOCATION, entries.map((entry) => ({
    type: "put" as const,
    key: entry.key,
    value: entry.entry,
  })));

  if (saved) {
    for (const entry of entries) {
      emitStorageChange({
        assetType: entry.entry.kind === "blueprint" ? "blueprint" : "blueprint-folder",
        assetId: entry.entry.kind === "blueprint" ? entry.entry.blueprintId : entry.entry.folderId,
        timestamp: Date.now(),
      });
    }
  }

  return saved;
}

async function deleteBlueprintEntries(keys: readonly string[]): Promise<boolean> {
  return await applyIndexedDbStoreMutations(BLUEPRINT_STORE_LOCATION, keys.map((key) => ({
    type: "delete" as const,
    key,
  })));
}

async function purgeExpiredDeletedBlueprintLibraryEntries(): Promise<void> {
  const [blueprints, folders] = await Promise.all([
    listActiveSyncTombstones<BlueprintRecord>(BLUEPRINT_SYNC_ADAPTER_ID),
    listActiveSyncTombstones<BlueprintFolderRecord>(BLUEPRINT_FOLDER_SYNC_ADAPTER_ID),
  ]);
  const now = Date.now();
  const expiredBlueprintIds = blueprints
    .filter((entry) => isDeletedBlueprintLibraryEntryExpired(entry.deletedAt, now))
    .map((entry) => entry.assetId);
  const expiredFolderIds = folders
    .filter((entry) => isDeletedBlueprintLibraryEntryExpired(entry.deletedAt, now))
    .map((entry) => entry.assetId);

  if (expiredBlueprintIds.length === 0 && expiredFolderIds.length === 0) {
    return;
  }

  await Promise.all([
    clearActiveSyncTombstones(
      BLUEPRINT_SYNC_ADAPTER_ID,
      expiredBlueprintIds,
    ),
    clearActiveSyncTombstones(
      BLUEPRINT_FOLDER_SYNC_ADAPTER_ID,
      expiredFolderIds,
    ),
  ]);
}

function createBlueprintStorageEntryKey(entry: BlueprintStorageEntry): string {
  return entry.kind === "blueprint"
    ? createBlueprintKey(entry.blueprintId)
    : createFolderKey(entry.folderId);
}

function readBlueprintStorageEntryId(entry: BlueprintStorageEntry): string {
  return entry.kind === "blueprint" ? entry.blueprintId : entry.folderId;
}

function isDeletedBlueprintLibraryEntryExpired(deletedAt: string, now: number): boolean {
  const normalizedDeletedAt = normalizeOptionalTimestamp(deletedAt);
  return normalizedDeletedAt !== null
    && now - Date.parse(normalizedDeletedAt) >= BLUEPRINT_DELETED_RETENTION_MS;
}

async function doesFolderExist(folderId: string | null): Promise<boolean> {
  if (folderId === null) {
    return true;
  }

  const folder = await readBlueprintFolder(folderId);

  return folder !== null;
}

function collectBlueprintFolderTreeIds(
  folderId: string,
  entries: readonly BlueprintStorageEntry[],
): Set<string> {
  const folderTreeIds = new Set<string>([folderId]);
  let didGrow = true;

  while (didGrow) {
    didGrow = false;

    for (const entry of entries) {
      if (
        entry.kind !== "folder"
        || folderTreeIds.has(entry.folderId)
        || entry.parentFolderId === null
        || !folderTreeIds.has(entry.parentFolderId)
      ) {
        continue;
      }

      folderTreeIds.add(entry.folderId);
      didGrow = true;
    }
  }

  return folderTreeIds;
}

function normalizeBlueprintStorageEntry(
  value: unknown,
): BlueprintStorageEntry | null {
  if (!isRecord(value) || value.kind === undefined) {
    return null;
  }

  if (value.kind === "folder") {
    return normalizeBlueprintFolderRecord(value);
  }

  if (value.kind === "blueprint") {
    return normalizeBlueprintRecord(value);
  }

  return null;
}

function normalizeBlueprintRecord(value: unknown): BlueprintRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const document = normalizeBlueprintDocument(value);
  const parentFolderId = normalizeOptionalId(value.parentFolderId);

  if (
    document === null ||
    !isNullableString(value.parentFolderId)
  ) {
    return null;
  }

  return {
    ...document,
    kind: "blueprint",
    parentFolderId,
  };
}

function normalizeBlueprintFolderRecord(
  value: unknown,
): BlueprintFolderRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = normalizeName(value.name);
  const parentFolderId = normalizeOptionalId(value.parentFolderId);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (
    typeof value.schemaVersion !== "number" ||
    value.kind !== "folder" ||
    !isNonEmptyString(value.folderId) ||
    name === null ||
    !isNullableString(value.parentFolderId) ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    schemaVersion: value.schemaVersion,
    kind: "folder",
    folderId: value.folderId,
    name,
    parentFolderId,
    createdAt,
    updatedAt,
  };
}

function normalizeBlueprintDocument(
  value: unknown,
): BlueprintDocument | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = normalizeName(value.name);
  const description = typeof value.description === "string" ? value.description : null;
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (
    typeof value.schemaVersion !== "number" ||
    !isNonEmptyString(value.blueprintId) ||
    typeof value.version !== "string" ||
    name === null ||
    description === null ||
    !isNonEmptyString(value.baseId) ||
    !isGridPoint(value.initialGridPoint) ||
    !isRecord(value.entities) ||
    !isStringArray(value.entityOrder) ||
    !Array.isArray(value.slotLinks) ||
    createdAt === null ||
    updatedAt === null
  ) {
    return null;
  }

  const migration = migrateBlueprintEntityDeviceIds(
    value.entities as BlueprintDocument["entities"],
    value.schemaVersion,
  );

  if (migration === null) {
    return null;
  }

  return {
    schemaVersion: migration.schemaVersion,
    blueprintId: value.blueprintId,
    version: value.version,
    name,
    description,
    baseId: value.baseId,
    initialGridPoint: value.initialGridPoint,
    entities: migration.entities,
    entityOrder: [...value.entityOrder],
    slotLinks: [...value.slotLinks] as BlueprintDocument["slotLinks"],
    createdAt,
    updatedAt,
  };
}

function createBlueprintKey(blueprintId: string): string {
  return `blueprint:${blueprintId}`;
}

function createFolderKey(folderId: string): string {
  return `folder:${folderId}`;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized === "" ? null : normalized;
}

function normalizeOptionalId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isNonEmptyString(value)) {
    return null;
  }

  return value;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function normalizeOptionalTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeTimestamp(value);
}

function isGridPoint(value: unknown): value is BlueprintDocument["initialGridPoint"] {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
