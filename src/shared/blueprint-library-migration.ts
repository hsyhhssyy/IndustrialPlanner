import type { DataMigrationPlan } from "./data-migration";
import { BLUEPRINT_STORE_LOCATION, normalizeBlueprintStorageEntry } from "./storage/blueprint-storage";
import { prepareStoredJsonMigration } from "./storage/migration-records";
import { emitStorageChange } from "./storage/storage-change-event";

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: prepareStoredJsonMigration
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// export async function prepareBlueprintLibraryMigration(): Promise<DataMigrationPlan> {
//   const records = await readMigrationRecords(BLUEPRINT_STORE_LOCATION);
//   return { jobs: records.flatMap(record => {
//     const value = normalizeBlueprintStorageEntry(record.value);
//     return migratedRecordJob(BLUEPRINT_STORE_LOCATION, record, value, value?.name ?? "蓝图库").map(job => ({
//       ...job, run: async () => {
//         await job.run();
//         emitStorageChange({ assetType: value!.kind === "folder" ? "blueprint-folder" : "blueprint",
//           assetId: value!.kind === "folder" ? value!.folderId : value!.blueprintId,
//           origin: "local", timestamp: Date.now() });
//       },
//     }));
//   }) };
// }
export async function prepareBlueprintLibraryMigration(version = "blueprints-7"): Promise<DataMigrationPlan> {
  return prepareStoredJsonMigration(BLUEPRINT_STORE_LOCATION, normalizeBlueprintStorageEntry, "蓝图库", version, value => {
    emitStorageChange({ assetType: value.kind === "folder" ? "blueprint-folder" : "blueprint",
      assetId: value.kind === "folder" ? value.folderId : value.blueprintId, origin: "local", timestamp: Date.now() });
  });
}
