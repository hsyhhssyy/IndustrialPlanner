export {
  listFromIndexedDb,
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export type {
  BlueprintDirectoryListing,
  BlueprintFolderRecord,
  BlueprintReadOptions,
  BlueprintRecord,
  BlueprintStorageEntry,
  CreateBlueprintFolderInput,
  SaveBlueprintOptions,
} from "@/shared/storage/blueprint-storage";

export {
  createBlueprintFolder,
  deleteBlueprintDocument,
  listBlueprintDirectory,
  readBlueprintFolder,
  readBlueprintRecord,
  saveBlueprintDocument,
  BLUEPRINT_STORE_LOCATION,
} from "@/shared/storage/blueprint-storage";

export type {
  IndexedDbStoreLocation,
  IndexedDbStorageLocation,
  JsonStorageCodec,
} from "@/shared/storage/browser-storage";

export {
  readFromIndexedDbWithMigration,
  readFromLocalStorageWithMigration,
  saveToIndexedDbWithVersion,
  saveToLocalStorageWithVersion,
} from "@/shared/storage/migration";

export type {
  StorageMigration,
} from "@/shared/storage/migration";