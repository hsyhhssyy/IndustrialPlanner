

import type {
  SimulationRuntimeStatus,
  SimulationTickSnapshot,
} from "../types/simulation";

export interface SimulationQuery {
  getStatus(): SimulationRuntimeStatus;
  getCurrentTickSnapshot(): SimulationTickSnapshot | null;
}
