import { makeAutoObservable } from "mobx";

import type {
  SimulationRuntimeStatus,
  SimulationState,
  SimulationTickSnapshot,
} from "@/domain/types/simulation";
import { DEFAULT_SIMULATION_SPEED } from "./tick-rate";

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
  simulationSpeed: number;
  hasStarted: boolean;
  runtimeStatus: SimulationRuntimeStatus;
  currentTickSnapshot: SimulationTickSnapshot | null;
  currentPlaybackTickNumber: number;
}

class SimulationStateReadWriteImpl implements SimulationStateReadWrite {
  state: SimulationState = "stop";
  simulationSpeed = DEFAULT_SIMULATION_SPEED;
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