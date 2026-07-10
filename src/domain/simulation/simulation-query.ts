import type {
  SimulationDeviceRuntimeStatusReadModel,
  SimulationDocumentRuntimeReadModel,
  SimulationGasDiffusionRangeReadModel,
  WarehouseStatsReadModel,
} from "./types/simulation-types";

export interface SimulationQuery {
  getStatusRuntimeJson(): string;
  getDocumentRuntimeStatus(): SimulationDocumentRuntimeReadModel | null;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
  getPipeFluidItemId(deviceId: string): string | null;
  /** 查询管道设备的 slot 是否当前有液体占用（O(1) 哈希查寻）。 */
  /** AI-CORRECTION 2026-07-10: 管道可承载液体或气体，此查询表示当前是否有任意 fluid 物品占用。 */
  isPipeDeviceSlotOccupied(deviceId: string): boolean;
  /** 获取当前 tick 正在生效的气体扩散范围。 */
  getActiveGasDiffusionRanges(): readonly SimulationGasDiffusionRangeReadModel[];
  /** 获取仓库统计数据（配方产出/消耗 + 仓库库存），仿真未启动时返回 null */
  getWarehouseStats(): WarehouseStatsReadModel | null;
}
