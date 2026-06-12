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
  UpsertBlueprintFolderInput,
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
  upsertBlueprintFolder,
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
  LegacyV2BlueprintLinkSnapshot,
  LegacyV2BlueprintSnapshot,
  LegacyV2DeviceSnapshot,
  LegacyV2LayoutLinkSnapshot,
  LegacyV2LayoutSnapshot,
} from "@/shared/storage/legacy-v2-blueprint-migration";

export {
  convertLegacyV2LayoutToBlueprintDocument,
  convertLegacyV2LayoutToWorldDocument,
  createLegacyBlueprintJsonFromV2BlueprintSnapshot,
  createLegacyBlueprintJsonFromV2Layout,
  createWorldDocumentFromMigratedBlueprint,
  normalizeLegacyV2BlueprintSnapshotsStorage,
  normalizeLegacyV2LayoutsByBaseStorage,
} from "@/shared/storage/legacy-v2-blueprint-migration";

export type {
  IndexedDbStoreLocation,
  IndexedDbStorageLocation,
  JsonStorageCodec,
} from "@/shared/storage/browser-storage";

export type {
  EditorPersistState,
} from "@/shared/storage/editor-persist-state-storage";

export {
  EDITOR_PERSIST_STATE_LOCAL_STORAGE_KEY,
  normalizeEditorPersistState,
  readEditorPersistState,
  writeEditorPersistState,
} from "@/shared/storage/editor-persist-state-storage";

export {
  listLatestWorldDocumentsByBase,
  listWorldDocuments,
  normalizeWorldDocument,
  readWorldDocument,
  replaceWorldDocuments,
  resolveLatestWorldDocumentForBase,
  writeWorldDocument,
  WORLD_DOCUMENT_DATABASE_LOCATION,
} from "@/shared/storage/world-document-storage";

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
