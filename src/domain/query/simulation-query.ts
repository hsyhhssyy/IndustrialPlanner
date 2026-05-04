

import type {
  SimulationDeviceRuntimeStatus,
  SimulationRuntimeStatus,
  SimulationTickSnapshot,
} from "../types/simulation";

export interface SimulationQuery {
  getStatus(): SimulationRuntimeStatus;
  getCurrentTickSnapshot(): SimulationTickSnapshot | null;
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeStatus | null;
}
