import type { SimulationStartResult, SimulationTickPullStatus } from "./types";

export interface SimulationInternalAction {
  refreshFromCurrentDocument(): Promise<SimulationStartResult>;
  syncToTick(tickNumber: number, playbackTickNumberOnReady?: number): Promise<SimulationTickPullStatus>;
  // AI-REMOVED 2026-08-28:
  // Reason: 该代码仅服务已归档的 Playwright 区域蓝图 Runner，新 Blueprint Runner 直接驱动区域仿真 session。
  // Trigger: 用户明确要求当前及未来此类用例归入 Blueprint 测试组。
  // Evidence: SimulationInternalAction 中该方法已无 Active Code 调用。
  // Replacement: src/tests/simulation/regional-blueprint-runner.ts#runRegionalBlueprintSimulation
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // syncRegionalToTick(
  //   tickNumber: number,
  //   timeoutMs: number,
  // ): Promise<RegionalSimulationTickSyncResult>;
  /** 同步轻量 Worker 性能统计；不会开启完整 debugData。 */
  setDebugEnabled(value: boolean): void;
  /** 单独控制完整 debugData 的构造与传输。 */
  setDebugDataEnabled(value: boolean): void;
  setSimulationSpeed(value: number): void;
  reset(): void;
}
