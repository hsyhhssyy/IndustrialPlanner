import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { applyRawIndexedDbTransactionMutations, listFromIndexedDb, saveToIndexedDb } from "./browser-storage";
import { readMigrationRecords } from "./migration-records";

// 计算检查点独立存储，不发布 storage-change 事件，不加入任何同步集合。
// AI-CORRECTION 2026-10-08: 活动任务迁入主库独立 store，复用快照与代际屏障；仍不发布同步事件。旧库由一次性迁入流程只读保留。
export const LEGACY_EDA_TASK_LOCATION = { databaseName: "industrial-planner-eda", storeName: "tasks" };
export const EDA_TASK_LOCATION = { databaseName: "v3-industrial-planner", storeName: "eda-tasks" };
export const EDA_TASK_QUARANTINE_LOCATION = { databaseName: EDA_TASK_LOCATION.databaseName, storeName: "eda-task-quarantine" };

/** 隔离记录保留磁盘原文与真实主键；不参与自动恢复、保存或同步。 */
export interface QuarantinedEdaTask {
  readonly taskId: string;
  readonly sourceKey: IDBValidKey;
  readonly sourceValue: unknown;
  readonly message: string;
  readonly migrationVersion: string;
}

const location = EDA_TASK_LOCATION;

export const edaTaskStorage = {
  load: () => listFromIndexedDb<BlueprintPlannerTaskFile>(location, { strict: true }),
  loadQuarantined: async (): Promise<QuarantinedEdaTask[]> => (await readMigrationRecords(EDA_TASK_QUARANTINE_LOCATION, { raw: true }))
    .map(record => record.value as QuarantinedEdaTask),
  save: async (file: BlueprintPlannerTaskFile): Promise<void> => {
    await saveToIndexedDb({ ...location, key: file.taskId }, file);
  },
  saveQuarantined: async (record: QuarantinedEdaTask): Promise<void> => {
    if (!await applyRawIndexedDbTransactionMutations(location, [
      { storeName: location.storeName, operations: [{ type: "delete", key: record.sourceKey }] },
      { storeName: EDA_TASK_QUARANTINE_LOCATION.storeName, operations: [{ type: "put", key: record.taskId, value: record }] },
    ])) throw new Error("无法保存计算任务原件。");
  },
  delete: async (taskId: string): Promise<void> => {
    if (!await applyRawIndexedDbTransactionMutations(location, [
      { storeName: location.storeName, operations: [{ type: "delete", key: taskId }] },
      { storeName: EDA_TASK_QUARANTINE_LOCATION.storeName, operations: [{ type: "delete", key: taskId }] },
    ])) throw new Error("删除计算任务失败。");
  },
};
