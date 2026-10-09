// AI-REMOVED 2026-10-09:
// Reason: 启动迁移不允许创建仿真客户端或执行验收。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: blueprint-planner 用户继续任务时的 restorePlannerTaskFile
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import { BlueprintExecutionClient } from "./blueprint";
// import { createDenseBlueprintEngine } from "./dense";
//
// /** 升级前工作台尚未装配，验收使用独立客户端，不启动用户仿真。 */
// export function createMigrationVerification(registry: RegistryContract): BlueprintExecutionClient {
//   return new BlueprintExecutionClient(registry, "dense-v2", "auto", options => createDenseBlueprintEngine(registry, options), 2);
// }
