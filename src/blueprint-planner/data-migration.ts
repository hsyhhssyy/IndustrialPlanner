import { migrateTaskBlueprintSchemas } from "./task-blueprint-migration";
// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: task-blueprint-migration.ts
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// import type { BlueprintDocument } from "@/domain/document/blueprint-document";

// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: task-blueprint-migration.ts
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";

import type { BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: migrateTaskBlueprintSchemas；算法恢复由用户操作触发
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: migrateTaskBlueprintSchemas；算法恢复由用户操作触发
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import type { SimulationBlueprintRunReport, SimulationBlueprintRunRequest } from "@/domain/simulation";
import type { DataMigrationPlan } from "@/shared/data-migration";
// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: task-blueprint-migration.ts
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: migrateTaskBlueprintSchemas；算法恢复由用户操作触发
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { EDA_TASK_LOCATION, LEGACY_EDA_TASK_LOCATION, EDA_TASK_QUARANTINE_LOCATION, type QuarantinedEdaTask } from "@/shared/storage/eda-task-storage";
import { DATA_MIGRATION_STORE } from "@/shared/storage/data-migration-state";
import { readFromIndexedDb, applyRawIndexedDbTransactionMutations } from "@/shared/storage/browser-storage";
import { readMigrationRecords, type MigrationRecord } from "@/shared/storage/migration-records";
import { createUuid } from "@/domain/shared/uuid";
import { createStableJsonHash } from "@/shared/storage/hash-utils";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: migrateTaskBlueprintSchemas；算法恢复由用户操作触发
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { PLANNER_ALGORITHM_VERSION, restorePlannerTaskFile, parsePlannerTaskFile } from "./task-checkpoint";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: migrateTaskBlueprintSchemas；算法恢复由用户操作触发
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { BLUEPRINT_RECOGNITION_VERSION, parseRecognitionTaskFile } from "./blueprint-recognition-task";
// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: task-blueprint-migration.ts
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// import { plannerRequestKey, type PlannerSearchSeed } from "./search-seed";

// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: task-blueprint-migration.ts
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// import type { PlannerCandidate } from "./candidate";


export const EDA_MIGRATION_VERSION = "eda-store-3:json-1";
const transferLocation = { databaseName: EDA_TASK_LOCATION.databaseName, storeName: DATA_MIGRATION_STORE, key: "eda-store" };

// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: task-blueprint-migration.ts
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
// /** 内嵌蓝图有自己的版本；空升级不重置算法状态，也不执行旧算法的几何转换。 */
// export function migrateTaskBlueprintSchemas(value: BlueprintPlannerTaskFile): BlueprintPlannerTaskFile {
//   const file: { -readonly [K in keyof BlueprintPlannerTaskFile]: BlueprintPlannerTaskFile[K] } = structuredClone(value);
//   const upgrade = (blueprint: BlueprintDocument): BlueprintDocument => {
//     if (blueprint.schemaVersion === BLUEPRINT_SCHEMA_VERSION) return blueprint;
//     const next = normalizeBlueprintDocument(blueprint);
//     if (next === null) throw new Error("计算任务中的蓝图版本无法升级，原始任务已保留。");
//     return next;
//   };
//   if (isBlueprintRecognitionRequest(file.request)) {
//     file.request = { ...file.request, input: { ...file.request.input, blueprint: upgrade(file.request.input.blueprint) } };
//     return file;
//   }
//   const upgradeRequest = (request: BlueprintPlannerRequest): BlueprintPlannerRequest => request.blueprintSource
//     ? { ...request, blueprintSource: { ...request.blueprintSource, blueprint: upgrade(request.blueprintSource.blueprint) } } : request;
//   file.request = upgradeRequest(file.request);
//   const seed = (value: PlannerSearchSeed): PlannerSearchSeed => {
//     const request = upgradeRequest(value.network.request);
//     return { ...value, network: { ...value.network, request }, requestKey: plannerRequestKey(request) };
//   };
//   const candidate = (value: PlannerCandidate | null | undefined): PlannerCandidate | null => value == null ? null : ({
//     ...value, execution: { ...value.execution, blueprint: upgrade(value.execution.blueprint) },
//     seed: value.seed ? seed(value.seed) : value.seed,
//   });
//   const point = file.checkpoint as PlannerCheckpoint;
//   if (!point) return file;
//   const pools = (portfolio: PlannerCheckpoint["portfolio"] | undefined) => portfolio === undefined ? portfolio : ({
//     ...portfolio, pools: portfolio.pools.map(pool => ({ ...pool, entries: pool.entries.map(entry => ({ ...entry, seed: seed(entry.seed) })) })),
//   });
//   file.checkpoint = { ...point,
//     ...(point.blueprintBaseline ? { blueprintBaseline: { ...point.blueprintBaseline, candidate: candidate(point.blueprintBaseline.candidate)! } } : {}),
//     best: point.best ? { ...point.best, candidate: candidate(point.best.candidate)! } : point.best,
//     pendingCandidate: candidate(point.pendingCandidate),
//     result: point.result ? { ...point.result, blueprint: upgrade(point.result.blueprint) } : point.result,
//     portfolio: pools(point.portfolio),
//     ...(point.parallel ? { parallel: { ...point.parallel, requestKey: plannerRequestKey(file.request),
//       shards: point.parallel.shards.map(shard => ({ ...shard, portfolio: pools(shard.portfolio), pendingCandidate: candidate(shard.pendingCandidate) })) } } : {}),
//   };
//   return file;
// }
//

export async function prepareEdaDataMigration(version = EDA_MIGRATION_VERSION): Promise<DataMigrationPlan> {
  const imported = await readFromIndexedDb<number>(transferLocation, { strict: true }) === 1;
  // AI-REMOVED 2026-10-09:
  // Reason: 单条任务转换失败不应阻止整个仿真工作台启动。
  // Trigger: 刷新后 EDA 检查点迁移失败导致页面不可访问；用户要求保留原件并排除失败任务。
  // Evidence: schema 6→7 种子指纹与池 key 不一致的最小复现；原 flatMap 与 run 直接向全局抛错。
  // Replacement: 下方逐项转换、持久隔离与原子提交。
  // Risk: 隔离任务不能自动续算，原文仍可导出；存储提交失败仍保留未完成状态。
  // Human Review: Required
  // Original code:
  //   const source = await readMigrationRecords(imported ? EDA_TASK_LOCATION : LEGACY_EDA_TASK_LOCATION);
  //   const converted: BlueprintPlannerTaskFile[] = [];
  //   const jobs = source.flatMap(record => {
  //     const original = record.value as BlueprintPlannerTaskFile;
  //     if (!original || original.taskId !== record.key) throw new Error("计算任务主键无效，原件已保留。");
  //     const normalized = migrateTaskBlueprintSchemas(original);
  //     const recognition = isBlueprintRecognitionRequest(normalized.request);
  //     const algorithm = recognition ? BLUEPRINT_RECOGNITION_VERSION : PLANNER_ALGORITHM_VERSION;
  //     if (imported && original.algorithmVersion === algorithm && createStableJsonHash(original) === createStableJsonHash(normalized)) return [];
  //     return [{ label: `计算任务：${original.taskId}`, run: async () => {
  //       converted.push(recognition ? parseRecognitionTaskFile(normalized, registry) : await restorePlannerTaskFile(normalized, registry, verify));
  //     } }];
  //   });
  const source = await readMigrationRecords(imported ? EDA_TASK_LOCATION : LEGACY_EDA_TASK_LOCATION, { raw: true });
  const retained = (await readMigrationRecords(EDA_TASK_QUARANTINE_LOCATION, { raw: true })).map(record => record.value as QuarantinedEdaTask);
  const retry = retained.filter(record => record.migrationVersion !== version && !source.some(active => active.key === record.sourceKey));
  source.push(...retry.map(record => ({ key: record.sourceKey, value: record.sourceValue })));
  const converted: BlueprintPlannerTaskFile[] = [];
  const quarantined: QuarantinedEdaTask[] = [];
  const quarantine = (record: MigrationRecord, error: unknown) => {
    quarantined.push({ taskId: typeof record.key === "string" && record.key.length > 0 && record.key.length <= 200
      ? record.key : createUuid(), sourceKey: record.key, sourceValue: record.value,
      message: error instanceof Error ? error.message : String(error), migrationVersion: version });
  };
  const jobs = source.flatMap(record => {
    let normalized: BlueprintPlannerTaskFile;
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: None
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     let recognition: boolean;
    const label = `计算任务：${String(record.key)}`;
    try {
      const original = (typeof record.value === "string" ? JSON.parse(record.value) : record.value) as BlueprintPlannerTaskFile;
      if (!original || original.taskId !== record.key) throw new Error("计算任务主键无效，原件已保留。");
      normalized = migrateTaskBlueprintSchemas(original);
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 仅比较 JSON，算法版本与业务有效性留给继续计算
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//       recognition = isBlueprintRecognitionRequest(normalized.request);
//       const algorithm = recognition ? BLUEPRINT_RECOGNITION_VERSION : PLANNER_ALGORITHM_VERSION;
//       if (imported && original.algorithmVersion === algorithm && createStableJsonHash(original) === createStableJsonHash(normalized)) {
//         // 不变的任务仍须通过校验，不能用“无需升级”掩盖损坏记录。
//         if (recognition) parseRecognitionTaskFile(normalized, registry);
//         else parsePlannerTaskFile(normalized, registry);
//         return [];
//       }
      if (imported && !retry.some(retained => retained.sourceKey === record.key) && createStableJsonHash(original) === createStableJsonHash(normalized)) return [];
    } catch (error) {
      return [{ label, run: async () => { quarantine(record, error); } }];
    }
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: 转换异常已在 prepare 捕获，run 仅提交已转换 JSON
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     return [{ label, run: async () => {
//       try {
//         converted.push(normalized);
//       } catch (error) { quarantine(record, error); }
//     } }];
    return [{ label, run: async () => { converted.push(normalized); } }];
  });
  return { jobs, finish: async () => {
    if (imported && converted.length === 0 && quarantined.length === 0) return;
    // 所有转换／验收成功才原子写入活动任务与迁入状态；旧库始终保持原样。
    // AI-CORRECTION 2026-10-09: 此处只提交 JSON 转换，不检查算法可用性，不做仿真验收。
    // AI-CORRECTION 2026-10-09：逐条迁移成功或原件已安全隔离才算处理完成；活动移除、原文隔离与迁入标记同事务提交。
    if (!await applyRawIndexedDbTransactionMutations<unknown>(EDA_TASK_LOCATION, [
      { storeName: EDA_TASK_LOCATION.storeName, operations: [
        ...converted.map(file => ({ type: "put" as const, key: file.taskId, value: JSON.stringify(file) })),
        ...(imported ? quarantined.map(record => ({ type: "delete" as const, key: record.sourceKey })) : []),
      ] },
      { storeName: EDA_TASK_QUARANTINE_LOCATION.storeName, operations: [
        ...retry.filter(record => converted.some(file => file.taskId === record.sourceKey)).map(record => ({ type: "delete" as const, key: record.taskId })),
        ...quarantined.map(record => ({ type: "put" as const, key: record.taskId, value: record })),
      ] },
      { storeName: DATA_MIGRATION_STORE, operations: [{ type: "put", key: transferLocation.key, value: JSON.stringify(1) }] },
    ])) throw new Error("计算任务升级未能保存，原件已保留。");
  } };
}
