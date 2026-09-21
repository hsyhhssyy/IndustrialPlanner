import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "./types/simulation-types";
import type {
  SimulationBlueprintRunRequest,
  SimulationBlueprintRunReport,
} from "./types/simulation-blueprint-types";

export interface SimulationAction {
  runBlueprint(request: SimulationBlueprintRunRequest, signal?: AbortSignal): Promise<SimulationBlueprintRunReport>;
  start(): Promise<void>;
  // AI-REMOVED 2026-09-20:
  // Reason: 区域多基地是 AppSettings 中的下一次会话设置，不是可由外部直接修改的 Simulation Action。
  // Trigger: ST2-RQ-035 要求 Simulation.start 从 AppContract 读取设置并固化内部 SimulationMode。
  // Evidence: main reaction 与 UI 写 Action 会让用户设置和运行会话模式形成两个可写事实源。
  // Replacement: AppSettings.regionalMultiBaseEnabled + 双引擎 start。
  // Risk: Medium；所有测试与调用方必须改为设置 AppContract 后启动新会话。
  // Human Review: Required
  //
  // Original code:
  // /**
  //  * 开启或关闭“同时运行所有基地”的区域多基地模式。
  //  * 只能在仿真 stop 状态修改；开启时拒绝与时间轴并存。
  //  */
  // setRegionalMultiBaseEnabled(enabled: boolean): void;
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
