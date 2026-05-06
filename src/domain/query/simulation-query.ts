import type { SimulationRuntimeStatus } from "../contract/simulation-contract-types";
import type {
  SimulationBeltCargoReadModel,
  SimulationCurrentTickReadModel,
  SimulationDeviceRuntimeReadModel,
} from "./simulation-read-model";

export interface SimulationQuery {
  getStatus(): SimulationRuntimeStatus;
  getCurrentTick(): SimulationCurrentTickReadModel | null;
  getBeltCargoEntries(): readonly SimulationBeltCargoReadModel[];
  getDeviceRuntimeStatus(deviceId: string): SimulationDeviceRuntimeReadModel | null;
}
