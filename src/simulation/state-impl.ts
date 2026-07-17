import { makeAutoObservable } from "mobx";

import type {
  SimulationState,
  SimulationRuntimeStatistics,
  SimulationTimelineMark,
  SimulationTimelineState,
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
    dynamicTickRate: null,
    error: null,
  };
}

export interface SimulationStateReadWrite extends SimulationState {
  runningState: SimulationState["runningState"];
  simulationSpeed: number;
  statistics: SimulationRuntimeStatistics;
  timeline: SimulationTimelineStateReadWrite;
  hasStarted: boolean;
  runtimeStatus: SimulationRuntimeStatus;
  currentSnapshot: RuntimeTickSnapshot | null;
  currentPlaybackTickNumber: number;
}

export interface SimulationTimelineStateReadWrite extends SimulationTimelineState {
  enabled: boolean;
  readiness: SimulationTimelineState["readiness"];
  tickDurationSeconds: number;
  rulerDurationSeconds: number;
  windowStartTickNumber: number;
  cursorTickNumber: number;
  availableFromTickNumber: number;
  availableToTickNumber: number;
  marks: SimulationTimelineMark[];
  isSeeking: boolean;
}

export function createInitialSimulationTimelineState(): SimulationTimelineStateReadWrite {
  return {
    enabled: false,
    readiness: "idle",
    tickDurationSeconds: 0.5,
    rulerDurationSeconds: 300,
    windowStartTickNumber: 0,
    cursorTickNumber: 0,
    availableFromTickNumber: 0,
    availableToTickNumber: 0,
    marks: [],
    isSeeking: false,
  };
}

class SimulationStateReadWriteImpl implements SimulationStateReadWrite {
  public runningState: SimulationState["runningState"] = "stop";
  public simulationSpeed = DEFAULT_SIMULATION_SPEED;
  public statistics: SimulationRuntimeStatistics = { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 };
  public timeline: SimulationTimelineStateReadWrite = createInitialSimulationTimelineState();
  public hasStarted = false;
  public runtimeStatus: SimulationRuntimeStatus = createInitialSimulationRuntimeStatus();
  public currentSnapshot: RuntimeTickSnapshot | null = null;
  public currentPlaybackTickNumber = 0;

  public get bufferSize(): number {
    return this.runtimeStatus.bufferSize;
  }

  public constructor() {
    // currentSnapshot 排除 MobX 跟踪：它是整体替换的不可变快照，体积大，深度 observable 纯浪费 CPU
    makeAutoObservable(this, { currentSnapshot: false }, { autoBind: true });
  }
}

export function createSimulationStateReadWrite(): SimulationStateReadWrite {
  return new SimulationStateReadWriteImpl();
}
