import type { SimulationRuntimeSlotPatch } from "./types/simulation-types";

export interface SimulationAction {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  setSimulationSpeed(value: number): void;
  advancePlaybackByDeltaMs(deltaMs: number): Promise<void>;
  patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): Promise<void>;
}
