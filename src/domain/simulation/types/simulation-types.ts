export type SimulationRunState = "stop" | "start" | "pause";

export interface SimulationRuntimeStatistics {
  /** 实测 TPS（滑动窗口均值） */
  readonly tickPerSecond: number;
  /** 目标确定性 TPS = simulationSpeed × dynamicTickRate */
  readonly targetTickPerSecond: number;
}

export interface SimulationState{
  readonly runningState: SimulationRunState;
  /**
   * 仅作为 advancePlaybackByDeltaMs 的时间推进倍率使用。
   * 禁止在任何其他逻辑中直接消费该值；tick 和 second 的换算一律使用 standard tick rate。
   */
  readonly simulationSpeed: number;
  readonly statistics: SimulationRuntimeStatistics;
}

export interface SimulationDeviceRuntimeStatusReadModel {
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  readonly slotItems: readonly SimulationDeviceRuntimeSlotItemReadModel[];
}

// AI-CORRECTION 2026-05-14: slotType 字段已删除。
// viewRole alone determines slot role for display.
export interface SimulationDeviceRuntimeSlotItemReadModel {
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly viewRole: "single-view" | "input-view" | "output-view";
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
  readonly ignoreStock: boolean;
}

export interface SimulationRuntimeSlotPatch {
  readonly entityId: string;
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly ignoreStock: boolean;
}

/** 文档级仿真运行时只读视图 */
export interface SimulationDocumentRuntimeReadModel {
  /** 当前 tick 编号，仿真未启动时为 null */
  readonly tickNumber: number | null;
  /** 总电力需求（kW），拓扑未编译时为 null */
  readonly totalPowerDemand: number | null;
}
