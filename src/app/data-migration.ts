import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { DataMigrationJob, DataMigrationPlan } from "@/shared/data-migration";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage/browser-storage";
import { preparePlannerStorageMigration } from "@/shared/storage/planner-storage";
import { prepareModuleBalancingMigration } from "./storage/module-balancing-storage";
import { prepareRegionalSettingsMigration } from "./regional-settings/storage";
import { createUiStateReadWrite, type AppSettingsReadWrite } from "./state/state-impl";
import { APP_SETTINGS_LOCAL_STORAGE_KEY, WORKBENCH_STATE_LOCAL_STORAGE_KEY,
  normalizePersistedAppSettings, normalizePersistedWorkbenchState } from "./state/storage-hook";

export async function prepareAppDataMigration(registry: RegistryContract): Promise<DataMigrationPlan> {
  const jobs: DataMigrationJob[] = [];
  const defaults = createUiStateReadWrite();
  const local = <T>(key: string, normalize: (value: T) => unknown, label: string) => {
    const raw = readFromLocalStorage<T>(key);
    if (raw === null) return;
    const value = normalize(raw);
    if (createStableJsonHash(raw) !== createStableJsonHash(value)) jobs.push({ label,
      run: async () => { saveToLocalStorage(key, value); },
    });
  };
  local<AppSettingsReadWrite>(APP_SETTINGS_LOCAL_STORAGE_KEY, value => normalizePersistedAppSettings(value, defaults.settings), "应用设置");
  local<unknown>(WORKBENCH_STATE_LOCAL_STORAGE_KEY, value => normalizePersistedWorkbenchState(value, defaults.workbench), "工作台设置");
  for (const plan of [await prepareModuleBalancingMigration(), await preparePlannerStorageMigration(),
    await prepareRegionalSettingsMigration(registry.itemDefinitions)]) jobs.push(...plan.jobs);
  return { jobs };
}
