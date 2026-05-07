import { makeAutoObservable } from "mobx";

import type { SimulationState } from "@/domain/contract/simulation-contract";

import { DEFAULT_SIMULATION_SPEED } from "./tick-rate";
import type {
  RuntimeTickSnapshot,
  SimulationRuntimeStatus,
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

export interface SimulationStateReadWrite extends SimulationState {
  runningState: SimulationState["runningState"];
  simulationSpeed: number;
  hasStarted: boolean;
  runtimeStatus: SimulationRuntimeStatus;
  currentSnapshot: RuntimeTickSnapshot | null;
  currentPlaybackTickNumber: number;
}

class SimulationStateReadWriteImpl implements SimulationStateReadWrite {
  public runningState: SimulationState["runningState"] = "stop";
  public simulationSpeed = DEFAULT_SIMULATION_SPEED;
  public hasStarted = false;
  public runtimeStatus: SimulationRuntimeStatus = createInitialSimulationRuntimeStatus();
  public currentSnapshot: RuntimeTickSnapshot | null = null;
  public currentPlaybackTickNumber = 0;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createSimulationStateReadWrite(): SimulationStateReadWrite {
  return new SimulationStateReadWriteImpl();
}
