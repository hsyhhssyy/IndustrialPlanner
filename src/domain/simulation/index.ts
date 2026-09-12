export type { SimulationAction } from "./simulation-action";
export type { SimulationQuery } from "./simulation-query";
export type { SimulationContract } from "./simulation-contract";
export type { SimulationState } from "./types/simulation-types";
export type {
	SimulationEngineKind,
	SimulationRunState,
	// AI-REMOVED 2026-09-12:
	// Reason: SimulationRuntimeStatistics 已由按需性能 Query 读模型取代。
	// Trigger: 用户确认仿真计数从公共 State 移除。
	// Evidence: simulation-types.ts 已归档旧接口并定义统一诊断读模型。
	// Replacement: SimulationPerformanceDiagnosticsReadModel
	// Risk: Medium - 外部类型消费方需同步迁移。
	// Human Review: Required
	//
	// Original code:
	// SimulationRuntimeStatistics,
	SimulationPerformanceDiagnosticsReadModel,
	SimulationDeviceOperatingStatus,
	SimulationDeviceRuntimeStatusReadModel,
	// AI-REMOVED 2026-07-23:
	// Reason: domain 已删除固定窗口计量只读模型，公共出口不能继续导出不存在的类型。
	// Trigger: 用户逐项确认删除 SimulationMeteredConsumptionStatusReadModel。
	// Evidence: simulation-types.ts 已将原接口注释化归档。
	// Replacement: SimulationDeviceRuntimeSlotItemReadModel + channelRecipes。
	// Risk: Medium
	// Human Review: Required
	//
	// Original code:
	// SimulationMeteredConsumptionStatusReadModel,
	SimulationDeviceRuntimeChannelRecipeStatus,
	SimulationDeviceRuntimeSlotItemReadModel,
	SimulationDocumentRuntimeReadModel,
	WarehouseStatsReadModel,
	WarehouseItemStatsReadModel,
} from "./types/simulation-types";
