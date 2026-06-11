import type {
  SimulationDeviceRuntimeStatusReadModel,
  SimulationDocumentRuntimeReadModel,
  WarehouseStatsReadModel,
} from "./types/simulation-types";

export interface SimulationQuery {
  getStatusRuntimeJson(): string;
  getDocumentRuntimeStatus(): SimulationDocumentRuntimeReadModel | null;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
  getPipeFluidItemId(deviceId: string): string | null;
  /** 查询管道设备的 slot 是否当前有液体占用（O(1) 哈希查寻）。 */
  isPipeDeviceSlotOccupied(deviceId: string): boolean;
  /** 获取仓库统计数据（配方产出/消耗 + 仓库库存），仿真未启动时返回 null */
  getWarehouseStats(): WarehouseStatsReadModel | null;
}
