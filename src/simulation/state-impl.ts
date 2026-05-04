import { makeAutoObservable } from "mobx";

import type {
  SimulationRuntimeStatus,
  SimulationState,
  SimulationTickSnapshot,
} from "@/domain/types/simulation";

export const DEFAULT_PLAYBACK_TICK_RATE_HZ = 1;

export function createInitialSimulationRuntimeStatus(): SimulationRuntimeStatus {
  return {
    mode: "idle",
    topologyId: null,
    documentHash: null,
    retainedFromTick: null,
    latestTickNumber: null,
    bufferSize: 0,
    maxBufferSize: 180,
    error: null,
  };
}

export interface SimulationStateReadWrite {
  state: SimulationState;
  playbackTickRateHz: number;
  hasStarted: boolean;
  runtimeStatus: SimulationRuntimeStatus;
  currentTickSnapshot: SimulationTickSnapshot | null;
  currentPlaybackTickNumber: number;
}

class SimulationStateReadWriteImpl implements SimulationStateReadWrite {
  state: SimulationState = "stop";
  playbackTickRateHz = DEFAULT_PLAYBACK_TICK_RATE_HZ;
  hasStarted = false;
  runtimeStatus: SimulationRuntimeStatus = createInitialSimulationRuntimeStatus();
  currentTickSnapshot: SimulationTickSnapshot | null = null;
  currentPlaybackTickNumber = 0;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createSimulationStateReadWrite(): SimulationStateReadWrite {
  return new SimulationStateReadWriteImpl();
}