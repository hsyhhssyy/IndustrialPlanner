

import type { SimulationRuntimeStatus } from "../types/simulation";

export interface SimulationQuery {
  getStatus(): SimulationRuntimeStatus;
}
