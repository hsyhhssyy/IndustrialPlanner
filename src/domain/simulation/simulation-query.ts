import type { SimulationDeviceRuntimeStatusReadModel } from "./types/simulation-types";

export interface SimulationQuery {
  getStatusRuntimeJson(): string;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatusReadModel | null;
  getPipeFluidItemId(deviceId: string): string | null;
}
