

import type {
  GetSimulationTickSnapshotResult,
  SimulationStartResult,
} from "../types/simulation";

export interface SimulationAction {
  start(): Promise<SimulationStartResult>;
  getTickSnapshot(tickNumber: number): Promise<GetSimulationTickSnapshotResult>;
}
