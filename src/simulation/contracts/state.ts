import { makeAutoObservable } from "mobx";

import type {
  SimulationState,
  SimulationTimelineMark,
  SimulationTimelineState,
} from "@/domain/simulation/types/simulation-types";
import { SIMULATION_MODE, type SimulationMode } from "@/domain/shared/simulation-mode";

import { DEFAULT_SIMULATION_SPEED } from "./tick-rate";
import type { SimulationRuntimeStatus } from "./types";

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
  simulationMode: SimulationMode;
  simulationSpeed: number;
  // AI-REMOVED 2026-09-12:
  // Reason: 性能诊断改为引擎私有采样器，不再触发公共 State 响应式更新。
  // Trigger: 用户确认 UI 每秒通过统一 Query 拉取性能快照。
  // Evidence: SimulationState 已移除 statistics，电池数据由文档级运行时 Query 返回。
  // Replacement: SimulationQuery.getPerformanceDiagnostics + getDocumentRuntimeStatus
  // Risk: Medium - Host 与播放控制器必须同步迁移。
  // Human Review: Required
  //
  // Original code:
  // statistics: SimulationRuntimeStatistics;
  timeline: SimulationTimelineStateReadWrite;
  hasStarted: boolean;
  runtimeStatus: SimulationRuntimeStatus;
  currentPlaybackTickNumber: number;
  /** 区域模式下的全基地总耗电；单基地模式为 null。 */
  regionalTotalPowerDemand: number | null;
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
  public simulationMode: SimulationMode = SIMULATION_MODE.singleBase;
  public simulationSpeed = DEFAULT_SIMULATION_SPEED;
  // AI-REMOVED 2026-09-12:
  // Reason: 高频引擎诊断和电池投影不再混入 MobX 公共状态。
  // Trigger: 用户确认仿真计数由 Query 每秒读取。
  // Evidence: Dense 曾按投影频率替换整个 statistics 对象，却只写入占位 TPS。
  // Replacement: 引擎私有性能采样器与 SimulationDocumentRuntimeReadModel
  // Risk: Medium
  // Human Review: Required
  //
  // Original code:
  // public statistics: SimulationRuntimeStatistics = { tickPerSecond: 0, targetTickPerSecond: 0, baseBatteryJoules: 0, baseBatteryCapacity: 0 };
  public timeline: SimulationTimelineStateReadWrite = createInitialSimulationTimelineState();
  public hasStarted = false;
  public runtimeStatus: SimulationRuntimeStatus = createInitialSimulationRuntimeStatus();
  public currentPlaybackTickNumber = 0;
  public regionalTotalPowerDemand: number | null = null;

  // AI-REMOVED 2026-09-12:
  // Reason: runtimeStatus.bufferSize 是引擎内部状态，双引擎并不共享“缓存帧”的同一含义。
  // Trigger: 用户确认把仿真缓存计数迁移到统一性能 Query。
  // Evidence: Dense 单基地固定为 1，区域模式却表示 playback delta 数量。
  // Replacement: SimulationPerformanceDiagnosticsReadModel.playbackBufferedFrameCount / runtimeRetainedStateCount
  // Risk: Medium
  // Human Review: Required
  //
  // Original code:
  // public get bufferSize(): number {
  //   return this.runtimeStatus.bufferSize;
  // }

  public constructor() {
    // currentSnapshot 排除 MobX 跟踪：它是整体替换的不可变快照，体积大，深度 observable 纯浪费 CPU
    // AI-CORRECTION 2026-09-09: 完整快照由 legacy 私有状态持有；公共状态不再定义 currentSnapshot。
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createSimulationStateReadWrite(): SimulationStateReadWrite {
  return new SimulationStateReadWriteImpl();
}
