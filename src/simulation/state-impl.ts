import { makeAutoObservable } from "mobx";

import type { SimulationCurrentTickReadModel } from "@/domain/query/simulation-read-model";

import { DEFAULT_SIMULATION_SPEED } from "./tick-rate";
import type {
  SimulationRuntimeStatus,
  SimulationState,
} from "./types";

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
  currentTickReadModel: SimulationCurrentTickReadModel | null;
  currentPlaybackTickNumber: number;
}

class SimulationStateReadWriteImpl implements SimulationStateReadWrite {
  state: SimulationState = "stop";
  simulationSpeed = DEFAULT_SIMULATION_SPEED;
  hasStarted = false;
  runtimeStatus: SimulationRuntimeStatus = createInitialSimulationRuntimeStatus();
  currentTickReadModel: SimulationCurrentTickReadModel | null = null;
  currentPlaybackTickNumber = 0;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createSimulationStateReadWrite(): SimulationStateReadWrite {
  return new SimulationStateReadWriteImpl();
}