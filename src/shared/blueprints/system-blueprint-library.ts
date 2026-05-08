import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type {
  BlueprintLibraryDirectoryListing,
  BlueprintLibraryFolder,
  BlueprintLibraryRecord,
} from "@/shared/blueprints/blueprint-library";

const SYSTEM_BLUEPRINT_ROOT = "blueprints";
const SYSTEM_BLUEPRINT_INDEX_PATH = `${SYSTEM_BLUEPRINT_ROOT}/index.json`;

export interface SystemBlueprintIndex {
  readonly version: string;
  readonly folders: readonly SystemBlueprintIndexFolder[];
}

export interface SystemBlueprintIndexFolder {
  readonly name: string;
  readonly blueprints: readonly string[];
  readonly subfolders?: readonly SystemBlueprintIndexFolder[];
}

export type SystemBlueprintFolderEntry = BlueprintLibraryFolder;

export interface SystemBlueprintRecord extends BlueprintLibraryRecord {
  readonly sourcePath: string;
}

export type SystemBlueprintDirectoryListing = BlueprintLibraryDirectoryListing;

export interface SystemBlueprintLibrarySnapshot {
  readonly version: string;
  readonly rootListing: SystemBlueprintDirectoryListing;
  readonly directoriesByFolderId: ReadonlyMap<string, SystemBlueprintDirectoryListing>;
}

export async function readSystemBlueprintLibrary(): Promise<SystemBlueprintLibrarySnapshot> {
  const index = await readSystemBlueprintIndex();
  const { rootListing, directoriesByFolderId } = await buildRootListing(index);

  return {
    version: index.version,
    rootListing,
    directoriesByFolderId,
  };
}

export function listSystemBlueprintDirectory(
  snapshot: SystemBlueprintLibrarySnapshot,
  parentFolderId: string | null,
): SystemBlueprintDirectoryListing {
  if (parentFolderId === null) {
    return snapshot.rootListing;
  }

  return snapshot.directoriesByFolderId.get(parentFolderId) ?? {
    parentFolderId,
    folders: [],
    blueprints: [],
  };
}

async function buildRootListing(
  index: SystemBlueprintIndex,
): Promise<{
  readonly rootListing: SystemBlueprintDirectoryListing;
  readonly directoriesByFolderId: ReadonlyMap<string, SystemBlueprintDirectoryListing>;
}> {
  const directoriesByFolderId = new Map<string, SystemBlueprintDirectoryListing>();
  const entries = await Promise.all(index.folders.map((folder, folderIndex) => {
    return buildFolderDirectoryListing({
      folder,
      folderIndex,
      parentFolderId: null,
      directoriesByFolderId,
    });
  }));

  return {
    rootListing: {
      parentFolderId: null,
      folders: entries.map((entry) => entry.folder),
      blueprints: [],
    },
    directoriesByFolderId,
  };
}

async function buildFolderDirectoryListing(options: {
  readonly folder: SystemBlueprintIndexFolder;
  readonly folderIndex: number;
  readonly parentFolderId: string | null;
  readonly directoriesByFolderId: Map<string, SystemBlueprintDirectoryListing>;
}): Promise<{
  readonly folder: SystemBlueprintFolderEntry;
  readonly directory: SystemBlueprintDirectoryListing;
}> {
  const folderId = createSystemFolderId(
    options.parentFolderId,
    options.folder.name,
    options.folderIndex,
  );
  const blueprints = await Promise.all(
    options.folder.blueprints.map((blueprintFileName) => {
      return readSystemBlueprintRecord({
        blueprintFileName,
        folderId,
      });
    }),
  );
  const childFolders = await Promise.all(
    (options.folder.subfolders ?? []).map((subfolder, subfolderIndex) => {
      return buildFolderDirectoryListing({
        folder: subfolder,
        folderIndex: subfolderIndex,
        parentFolderId: folderId,
        directoriesByFolderId: options.directoriesByFolderId,
      });
    }),
  );
  const updatedAt = [
    ...blueprints.map((record) => record.updatedAt),
    ...childFolders.map((entry) => entry.folder.updatedAt),
  ].filter((value) => value.length > 0).sort().at(-1) ?? "";
  const folderEntry: SystemBlueprintFolderEntry = {
    folderId,
    parentFolderId: options.parentFolderId,
    name: options.folder.name,
    updatedAt,
  };
  const directory: SystemBlueprintDirectoryListing = {
    parentFolderId: folderId,
    folders: childFolders.map((entry) => entry.folder),
    blueprints,
  };

  options.directoriesByFolderId.set(folderId, directory);

  return {
    folder: folderEntry,
    directory,
  };
}

async function readSystemBlueprintIndex(): Promise<SystemBlueprintIndex> {
  const response = await fetch(createPublicAssetUrl(SYSTEM_BLUEPRINT_INDEX_PATH));

  if (!response.ok) {
    throw new Error(`Failed to load system blueprint index: ${response.status}`);
  }

  const payload: unknown = await response.json();
  const index = normalizeSystemBlueprintIndex(payload);

  if (index === null) {
    throw new Error("Invalid system blueprint index payload.");
  }

  return index;
}

async function readSystemBlueprintRecord(options: {
  readonly blueprintFileName: string;
  readonly folderId: string;
}): Promise<SystemBlueprintRecord> {
  const response = await fetch(
    createPublicAssetUrl(`${SYSTEM_BLUEPRINT_ROOT}/${options.blueprintFileName}.json`),
  );

  if (!response.ok) {
    throw new Error(`Failed to load system blueprint file: ${response.status}`);
  }

  const payload: unknown = await response.json();
  const blueprintDocument = normalizeBlueprintDocument(payload);

  if (blueprintDocument === null) {
    throw new Error(`Invalid system blueprint document: ${options.blueprintFileName}`);
  }

  return {
    ...blueprintDocument,
    parentFolderId: options.folderId,
    updatedAt: blueprintDocument.updatedAt,
    sourcePath: `${options.blueprintFileName}.json`,
  };
}

function normalizeSystemBlueprintIndex(value: unknown): SystemBlueprintIndex | null {
  if (!isRecord(value) || !isNonEmptyString(value.version) || !Array.isArray(value.folders)) {
    return null;
  }

  const folders = value.folders
    .map((entry) => normalizeSystemBlueprintIndexFolder(entry))
    .flatMap((entry) => (entry === null ? [] : [entry]));

  if (folders.length !== value.folders.length) {
    return null;
  }

  return {
    version: value.version,
    folders,
  };
}

function normalizeSystemBlueprintIndexFolder(value: unknown): SystemBlueprintIndexFolder | null {
  if (!isRecord(value) || !isNonEmptyString(value.name) || !Array.isArray(value.blueprints)) {
    return null;
  }

  const blueprints = value.blueprints.filter(isNonEmptyString);

  if (blueprints.length !== value.blueprints.length) {
    return null;
  }

  const subfoldersValue = value.subfolders;

  if (subfoldersValue === undefined) {
    return {
      name: value.name,
      blueprints,
    };
  }

  if (!Array.isArray(subfoldersValue)) {
    return null;
  }

  const subfolders = subfoldersValue
    .map((entry) => normalizeSystemBlueprintIndexFolder(entry))
    .flatMap((entry) => (entry === null ? [] : [entry]));

  if (subfolders.length !== subfoldersValue.length) {
    return null;
  }

  return {
    name: value.name,
    blueprints,
    subfolders,
  };
}

function normalizeBlueprintDocument(value: unknown): BlueprintDocument | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.schemaVersion !== "number" ||
    !isNonEmptyString(value.blueprintId) ||
    !isNonEmptyString(value.version) ||
    !isNonEmptyString(value.name) ||
    typeof value.description !== "string" ||
    !isNonEmptyString(value.baseId) ||
    !isGridPoint(value.initialGridPoint) ||
    !isRecord(value.entities) ||
    !isStringArray(value.entityOrder) ||
    !Array.isArray(value.slotLinks) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt)
  ) {
    return null;
  }

  return {
    schemaVersion: value.schemaVersion,
    blueprintId: value.blueprintId,
    version: value.version,
    name: value.name,
    description: value.description,
    baseId: value.baseId,
    initialGridPoint: value.initialGridPoint,
    entities: value.entities as BlueprintDocument["entities"],
    entityOrder: [...value.entityOrder],
    slotLinks: value.slotLinks as BlueprintDocument["slotLinks"],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function createPublicAssetUrl(path: string): string {
  const baseUrl = import.meta.env.BASE_URL;
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return new URL(path, `https://placeholder.local${normalizedBaseUrl}`).pathname;
}

function createSystemFolderId(
  parentFolderId: string | null,
  folderName: string,
  folderIndex: number,
): string {
  const normalizedName = folderName.trim();
  const encodedName = normalizedName.length > 0 ? encodeURIComponent(normalizedName) : `folder-${folderIndex + 1}`;

  return parentFolderId === null ? encodedName : `${parentFolderId}/${encodedName}`;
}

function isGridPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}