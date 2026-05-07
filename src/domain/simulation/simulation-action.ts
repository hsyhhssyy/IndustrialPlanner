export interface SimulationAction {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  advancePlaybackByDeltaMs(deltaMs: number): Promise<void>;
}
