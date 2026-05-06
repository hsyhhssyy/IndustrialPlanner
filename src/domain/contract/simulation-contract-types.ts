export type SimulationState = "stop" | "start" | "pause";

export interface SimulationRuntimeStatus {
  readonly mode: "idle" | "starting" | "running" | "stopped" | "error";
  readonly topologyId: string | null;
  readonly documentHash: string | null;
  readonly retainedFromTick: number | null;
  readonly latestTickNumber: number | null;
  readonly bufferSize: number;
  readonly maxBufferSize: number;
  readonly error: string | null;
}