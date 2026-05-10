import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { createUuid } from "@/domain/shared/uuid";

import {
  applyIndexedDbStoreMutations,
  deleteFromIndexedDb,
  listFromIndexedDb,
  readFromIndexedDb,
  trySaveToIndexedDb,
  type IndexedDbStoreLocation,
} from "./browser-storage";
// Reason: blueprint-storage writes entries through writeBlueprintEntry and no longer calls saveToIndexedDb directly.
// Trigger: ESLint reported an unused import.
// Evidence: npm run lint flagged saveToIndexedDb as unused.
// Replacement: writeBlueprintEntry and trySaveToIndexedDb in this module.
// Risk: Low.
// Human Review: Required.
//
// Original code:
// import { saveToIndexedDb } from "./browser-storage";

const BLUEPRINT_DATABASE_NAME = "industrial-planner";
const BLUEPRINT_STORE_NAME = "blueprints";
const BLUEPRINT_DELETED_RETENTION_DAYS = 30;
const BLUEPRINT_DELETED_RETENTION_MS = BLUEPRINT_DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const BLUEPRINT_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: BLUEPRINT_DATABASE_NAME,
  storeName: BLUEPRINT_STORE_NAME,
};

export interface BlueprintRecord extends BlueprintDocument {
  kind: "blueprint";
  parentFolderId: string | null;
  deletedAt: string | null;
}

export interface BlueprintFolderRecord {
  schemaVersion: number;
  kind: "folder";
  folderId: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type BlueprintStorageEntry = BlueprintRecord | BlueprintFolderRecord;

export interface BlueprintDirectoryListing {
  parentFolderId: string | null;
  folders: BlueprintFolderRecord[];
  blueprints: BlueprintRecord[];
}

export interface CreateBlueprintFolderInput {
  name: string;
  parentFolderId?: string | null;
}

export interface RenameBlueprintFolderInput {
  folderId: string;
  name: string;
}

export interface SaveBlueprintOptions {
  parentFolderId?: string | null;
}

export interface BlueprintReadOptions {
  includeDeleted?: boolean;
}

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
    deletedAt: null,
  };

  return await writeBlueprintEntry(createFolderKey(folderRecord.folderId), folderRecord);
}

export async function readBlueprintFolder(
  folderId: string,
  options: BlueprintReadOptions = {},
): Promise<BlueprintFolderRecord | null> {
  await purgeExpiredDeletedBlueprintLibraryEntries();

  const entry = await readBlueprintEntry(createFolderKey(folderId));

  if (entry?.kind !== "folder") {
    return null;
  }

  if (!options.includeDeleted && entry.deletedAt !== null) {
    return null;
  }

  return entry;
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
  const existingRecord = await readBlueprintRecord(document.blueprintId, {
    includeDeleted: true,
  });
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
    deletedAt: null,
    createdAt: existingRecord?.createdAt ?? normalizedDocument.createdAt,
  };

  return await writeBlueprintEntry(
    createBlueprintKey(blueprintRecord.blueprintId),
    blueprintRecord,
  );
}

export async function readBlueprintRecord(
  blueprintId: string,
  options: BlueprintReadOptions = {},
): Promise<BlueprintRecord | null> {
  await purgeExpiredDeletedBlueprintLibraryEntries();

  const entry = await readBlueprintEntry(createBlueprintKey(blueprintId));

  if (entry?.kind !== "blueprint") {
    return null;
  }

  if (!options.includeDeleted && entry.deletedAt !== null) {
    return null;
  }

  return entry;
}

export async function deleteBlueprintDocument(
  blueprintId: string,
): Promise<BlueprintRecord | null> {
  const record = await readBlueprintRecord(blueprintId, {
    includeDeleted: true,
  });

  if (record === null) {
    return null;
  }

  if (record.deletedAt !== null) {
    return record;
  }

  const deletedAt = new Date().toISOString();

  return await writeBlueprintEntry(createBlueprintKey(blueprintId), {
    ...record,
    deletedAt,
    updatedAt: deletedAt,
  });
}

export async function deleteBlueprintFolder(
  folderId: string,
): Promise<BlueprintFolderRecord | null> {
  const rootFolder = await readBlueprintFolder(folderId, {
    includeDeleted: true,
  });

  if (rootFolder === null) {
    return null;
  }

  if (rootFolder.deletedAt !== null) {
    return rootFolder;
  }

  const entries = await listBlueprintStorageEntries({ includeDeleted: true });
  const folderTreeIds = collectBlueprintFolderTreeIds(folderId, entries);
  const deletedAt = new Date().toISOString();
  const pendingEntries = entries.flatMap((entry) => {
    if (entry.kind === "folder") {
      if (!folderTreeIds.has(entry.folderId) || entry.deletedAt !== null) {
        return [];
      }

      return [{
        key: createFolderKey(entry.folderId),
        entry: {
          ...entry,
          deletedAt,
          updatedAt: deletedAt,
        } satisfies BlueprintFolderRecord,
      }];
    }

    if (!folderTreeIds.has(entry.parentFolderId ?? "") || entry.deletedAt !== null) {
      return [];
    }

    return [{
      key: createBlueprintKey(entry.blueprintId),
      entry: {
        ...entry,
        deletedAt,
        updatedAt: deletedAt,
      } satisfies BlueprintRecord,
    }];
  });

  const didWrite = await writeBlueprintEntries(pendingEntries);

  if (!didWrite) {
    return null;
  }

  return {
    ...rootFolder,
    deletedAt,
    updatedAt: deletedAt,
  };
}

export async function listBlueprintDirectory(
  parentFolderId: string | null = null,
  options: BlueprintReadOptions = {},
): Promise<BlueprintDirectoryListing> {
  const normalizedParentFolderId = normalizeOptionalId(parentFolderId);
  await purgeExpiredDeletedBlueprintLibraryEntries();
  const entries = await listBlueprintStorageEntries(options);

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

async function listBlueprintStorageEntries(
  options: BlueprintReadOptions,
): Promise<BlueprintStorageEntry[]> {
  const entries = await listFromIndexedDb<unknown>(BLUEPRINT_STORE_LOCATION);

  return entries
    .map((entry) => normalizeBlueprintStorageEntry(entry))
    .flatMap((entry) => {
      if (entry === null) {
        return [];
      }

      if (!options.includeDeleted && entry.deletedAt !== null) {
        return [];
      }

      return [entry];
    });
}

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

  return entry;
}

async function writeBlueprintEntries(
  entries: readonly {
    key: string;
    entry: BlueprintStorageEntry;
  }[],
): Promise<boolean> {
  return await applyIndexedDbStoreMutations(BLUEPRINT_STORE_LOCATION, entries.map((entry) => ({
    type: "put" as const,
    key: entry.key,
    value: entry.entry,
  })));
}

async function deleteBlueprintEntries(keys: readonly string[]): Promise<boolean> {
  return await applyIndexedDbStoreMutations(BLUEPRINT_STORE_LOCATION, keys.map((key) => ({
    type: "delete" as const,
    key,
  })));
}

async function purgeExpiredDeletedBlueprintLibraryEntries(): Promise<void> {
  const entries = await listFromIndexedDb<unknown>(BLUEPRINT_STORE_LOCATION);
  const now = Date.now();
  const expiredEntryKeys = entries
    .map((entry) => normalizeBlueprintStorageEntry(entry))
    .flatMap((entry) => {
      if (
        entry === null
        || entry.deletedAt === null
        || !isDeletedBlueprintLibraryEntryExpired(entry.deletedAt, now)
      ) {
        return [];
      }

      return [entry.kind === "blueprint"
        ? createBlueprintKey(entry.blueprintId)
        : createFolderKey(entry.folderId)];
    });

  if (expiredEntryKeys.length === 0) {
    return;
  }

  await deleteBlueprintEntries(expiredEntryKeys);
}

function isDeletedBlueprintLibraryEntryExpired(deletedAt: string, now: number): boolean {
  return now - Date.parse(deletedAt) >= BLUEPRINT_DELETED_RETENTION_MS;
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
  const deletedAt = normalizeOptionalTimestamp(value.deletedAt);

  if (
    document === null ||
    !isNullableString(value.parentFolderId) ||
    !isNullableString(value.deletedAt)
  ) {
    return null;
  }

  return {
    ...document,
    kind: "blueprint",
    parentFolderId,
    deletedAt,
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
  const deletedAt = normalizeOptionalTimestamp(value.deletedAt);

  if (
    typeof value.schemaVersion !== "number" ||
    value.kind !== "folder" ||
    !isNonEmptyString(value.folderId) ||
    name === null ||
    !isNullableString(value.parentFolderId) ||
    createdAt === null ||
    updatedAt === null ||
    !isNullableString(value.deletedAt)
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
    deletedAt,
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
    !isNonEmptyString(value.version) ||
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

  return {
    schemaVersion: value.schemaVersion,
    blueprintId: value.blueprintId,
    version: value.version,
    name,
    description,
    baseId: value.baseId,
    initialGridPoint: value.initialGridPoint,
    entities: value.entities as BlueprintDocument["entities"],
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