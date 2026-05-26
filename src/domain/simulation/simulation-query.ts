import type {
  SimulationDeviceRuntimeStatusReadModel,
  SimulationDocumentRuntimeReadModel,
} from "./types/simulation-types";

export interface SimulationQuery {
  getStatusRuntimeJson(): string;
  getDocumentRuntimeStatus(): SimulationDocumentRuntimeReadModel | null;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
  getPipeFluidItemId(deviceId: string): string | null;
  /** 查询管道设备的 slot 是否当前有液体占用（O(1) 哈希查寻）。 */
  isPipeDeviceSlotOccupied(deviceId: string): boolean;
}
