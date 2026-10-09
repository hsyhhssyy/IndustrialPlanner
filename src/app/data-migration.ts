import { prepareLocalJsonMigration } from "@/shared/storage/migration-records";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { DataMigrationJob, DataMigrationPlan } from "@/shared/data-migration";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: prepareLocalJsonMigration
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { createStableJsonHash } from "@/shared/storage/hash-utils";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: prepareLocalJsonMigration
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage/browser-storage";
import { preparePlannerStorageMigration } from "@/shared/storage/planner-storage";
import { prepareModuleBalancingMigration } from "./storage/module-balancing-storage";
import { prepareRegionalSettingsMigration } from "./regional-settings/storage";
import { createUiStateReadWrite, type AppSettingsReadWrite } from "./state/state-impl";
import { APP_SETTINGS_LOCAL_STORAGE_KEY, WORKBENCH_STATE_LOCAL_STORAGE_KEY,
  normalizePersistedAppSettings, normalizePersistedWorkbenchState } from "./state/storage-hook";

export async function prepareAppDataMigration(registry: RegistryContract, version = "app-7"): Promise<DataMigrationPlan> {
  const jobs: DataMigrationJob[] = [];
  const defaults = createUiStateReadWrite();
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: prepareLocalJsonMigration 与 prepareVersionedStorageMigration 统一失败处理
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   const local = <T>(key: string, normalize: (value: T) => unknown, label: string) => {
//     const raw = readFromLocalStorage<T>(key);
//     if (raw === null) return;
//     const value = normalize(raw);
//     if (createStableJsonHash(raw) !== createStableJsonHash(value)) jobs.push({ label,
//       run: async () => { saveToLocalStorage(key, value); },
//     });
//   };
//   local<AppSettingsReadWrite>(APP_SETTINGS_LOCAL_STORAGE_KEY, value => normalizePersistedAppSettings(value, defaults.settings), "应用设置");
//   local<unknown>(WORKBENCH_STATE_LOCAL_STORAGE_KEY, value => normalizePersistedWorkbenchState(value, defaults.workbench), "工作台设置");
//   for (const plan of [await prepareModuleBalancingMigration(), await preparePlannerStorageMigration(),
//     await prepareRegionalSettingsMigration(registry.itemDefinitions)]) jobs.push(...plan.jobs);
//   return { jobs };
  const plans = [
    await prepareLocalJsonMigration(APP_SETTINGS_LOCAL_STORAGE_KEY,
      value => normalizePersistedAppSettings(value as AppSettingsReadWrite, defaults.settings), "应用设置", version),
    await prepareLocalJsonMigration(WORKBENCH_STATE_LOCAL_STORAGE_KEY,
      value => normalizePersistedWorkbenchState(value, defaults.workbench), "工作台设置", version),
    await prepareModuleBalancingMigration(version), await preparePlannerStorageMigration(version),
    await prepareRegionalSettingsMigration(registry.itemDefinitions, version),
  ];
  for (const plan of plans) jobs.push(...plan.jobs);
  return { jobs, get issues() { return plans.flatMap(plan => plan.issues ?? []); } };
}
