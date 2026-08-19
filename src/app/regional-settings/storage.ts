import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import {
  deleteFromIndexedDb,
  type IndexedDbStorageLocation,
} from "@/shared/storage/browser-storage";
import {
  readFromIndexedDbWithMigration,
  saveToIndexedDbWithVersion,
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
  databaseName: "v3-industrial-planner",
  storeName: "regional-settings",
  key: REGIONAL_SETTINGS_ASSET_ID,
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
  await saveToIndexedDbWithVersion(
    REGIONAL_SETTINGS_STORE_LOCATION,
    REGIONAL_SETTINGS_SCHEMA_VERSION,
    asset,
  );
  emitRegionalSettingsStorageChange(options);
}

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
