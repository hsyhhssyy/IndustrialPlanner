import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "./types/simulation-types";

export interface SimulationAction {
  start(): Promise<void>;
  /**
   * 开启或关闭“同时运行所有基地”的区域多基地模式。
   * 只能在仿真 stop 状态修改；开启时拒绝与时间轴并存。
   */
  setRegionalMultiBaseEnabled(enabled: boolean): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setSimulationSpeed(value: number): void;
  advancePlaybackByDeltaMs(deltaMs: number): Promise<void>;
  patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): Promise<void>;
  resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<void>;
  enableTimeline(): Promise<void>;
  disableTimeline(): void;
  seekTimelineToTick(timelineTickNumber: number): Promise<boolean>;
}
