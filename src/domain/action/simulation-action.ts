

import type {
  GetSimulationTickSnapshotResult,
  SimulationStartResult,
} from "../types/simulation";

export interface SimulationAction {
  start(): Promise<SimulationStartResult>;
  pause(): void;
  stop(): void;
  getTickSnapshot(tickNumber: number): Promise<GetSimulationTickSnapshotResult>;
  advancePlaybackByDeltaMs(deltaMs: number): Promise<GetSimulationTickSnapshotResult | null>;
}
