export { BlueprintPlannerDialogController } from "./blueprint-planner-dialog-state";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: None
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// export { pausePlannerStorageForMigration, refreshPlannerStorageAfterMigration } from "./production-planning/production-planning-persist";
