export {
  readFromIndexedDb,
  readFromLocalStorage,
  saveToIndexedDb,
  saveToLocalStorage,
} from "@/shared/storage/browser-storage";

export type {
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