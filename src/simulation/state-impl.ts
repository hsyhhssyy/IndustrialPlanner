import { makeAutoObservable } from "mobx";

import type {
  SimulationState,
  SimulationRuntimeStatistics,
} from "@/domain/simulation/types/simulation-types";

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
  statistics: SimulationRuntimeStatistics;
  hasStarted: boolean;
  runtimeStatus: SimulationRuntimeStatus;
  currentSnapshot: RuntimeTickSnapshot | null;
  currentPlaybackTickNumber: number;
}

class SimulationStateReadWriteImpl implements SimulationStateReadWrite {
  public runningState: SimulationState["runningState"] = "stop";
  public simulationSpeed = DEFAULT_SIMULATION_SPEED;
  public statistics: SimulationRuntimeStatistics = { tickPerSecond: 0 };
  public hasStarted = false;
  public runtimeStatus: SimulationRuntimeStatus = createInitialSimulationRuntimeStatus();
  public currentSnapshot: RuntimeTickSnapshot | null = null;
  public currentPlaybackTickNumber = 0;

  public constructor() {
    // currentSnapshot 排除 MobX 跟踪：它是整体替换的不可变快照，体积大，深度 observable 纯浪费 CPU
    makeAutoObservable(this, { currentSnapshot: false }, { autoBind: true });
  }
}

export function createSimulationStateReadWrite(): SimulationStateReadWrite {
  return new SimulationStateReadWriteImpl();
}
