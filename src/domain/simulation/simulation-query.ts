import type {
  SimulationItemTransferReadModel,
  SimulationDeviceOperatingStatus,
  SimulationDeviceRuntimeStatusReadModel,
  SimulationDocumentRuntimeReadModel,
  SimulationEnvironmentRangeReadModel,
  SimulationPerformanceDiagnosticsReadModel,
  WarehouseStatsReadModel,
} from "./types/simulation-types";

export interface SimulationQuery {
  /** 仅返回当前公开 tick 的已完成物品交接；调用方按 tick 去重，不补播遗漏 tick。 */
  getCurrentTickItemTransfers(): readonly SimulationItemTransferReadModel[];
  getStatusRuntimeJson(): string;
  getDocumentRuntimeStatus(): SimulationDocumentRuntimeReadModel | null;
  /** 按需读取仿真引擎最近一个完整采样窗口的性能诊断。 */
  getPerformanceDiagnostics(): SimulationPerformanceDiagnosticsReadModel;
  /** 获取指定设备的轻量互斥运行状态；仿真停止时返回 closed。 */
  getDeviceOperatingStatus(deviceId: string): SimulationDeviceOperatingStatus | null;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
  getPipeFluidItemId(deviceId: string): string | null;
  /** 查询管道设备的 slot 是否当前有液体占用（O(1) 哈希查寻）。 */
  /** AI-CORRECTION 2026-07-10: 管道可承载液体或气体，此查询表示当前是否有任意 fluid 物品占用。 */
  isPipeDeviceSlotOccupied(deviceId: string): boolean;
  /** 获取当前 tick 正在生效的气体扩散范围。 */
  getActiveEnvironmentRanges(): readonly SimulationEnvironmentRangeReadModel[];
  /** 获取指定设备当前完全处于的气体 itemId 集合，无覆盖时返回 null。 */
  getDeviceActiveGasItemIds(deviceId: string): readonly string[] | null;
  /** 获取仓库统计数据（配方产出/消耗 + 仓库库存），仿真未启动时返回 null */
  getWarehouseStats(): WarehouseStatsReadModel | null;
}
