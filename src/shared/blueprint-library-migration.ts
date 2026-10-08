import type { DataMigrationPlan } from "./data-migration";
import { BLUEPRINT_STORE_LOCATION, normalizeBlueprintStorageEntry } from "./storage/blueprint-storage";
import { readMigrationRecords, migratedRecordJob } from "./storage/migration-records";
import { emitStorageChange } from "./storage/storage-change-event";

export async function prepareBlueprintLibraryMigration(): Promise<DataMigrationPlan> {
  const records = await readMigrationRecords(BLUEPRINT_STORE_LOCATION);
  return { jobs: records.flatMap(record => {
    const value = normalizeBlueprintStorageEntry(record.value);
    return migratedRecordJob(BLUEPRINT_STORE_LOCATION, record, value, value?.name ?? "蓝图库").map(job => ({
      ...job, run: async () => {
        await job.run();
        emitStorageChange({ assetType: value!.kind === "folder" ? "blueprint-folder" : "blueprint",
          assetId: value!.kind === "folder" ? value!.folderId : value!.blueprintId,
          origin: "local", timestamp: Date.now() });
      },
    }));
  }) };
}
