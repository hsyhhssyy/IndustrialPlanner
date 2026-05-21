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
  RenameBlueprintFolderInput,
  SaveBlueprintOptions,
} from "@/shared/storage/blueprint-storage";

export {
  createBlueprintFolder,
  deleteBlueprintFolder,
  deleteBlueprintDocument,
  listBlueprintDirectory,
  readBlueprintFolder,
  readBlueprintRecord,
  renameBlueprintFolder,
  saveBlueprintDocument,
  BLUEPRINT_STORE_LOCATION,
} from "@/shared/storage/blueprint-storage";

export type {
  ConvertLegacyBlueprintOptions,
  LegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

export {
  convertLegacyBlueprintJson,
  normalizeLegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

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

export type {
  PlannerFlowViewportState,
  PlannerPersistedState,
  PlannerSessionState,
} from "@/shared/storage/planner-storage";

export {
  createDefaultPlannerSessionState,
  loadPlannerState,
  normalizePlannerPersistedState,
  normalizePlannerSessionState,
  savePlannerState,
} from "@/shared/storage/planner-storage";