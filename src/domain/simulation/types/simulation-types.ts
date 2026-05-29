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

export interface SimulationDeviceRuntimeChannelRecipeStatus {
  readonly channelId: string;
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
}

export interface SimulationDeviceRuntimeStatusReadModel {
  // AI-CORRECTION 2026-05-29: 保留 recipeId/progressSeconds/desiredSeconds 兼容旧调用方。
  // 新代码应使用 channelRecipes 获取每个 channel 的运行状态。
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  /** 每个 channel 的运行时配方状态，key 为 channel id */
  readonly channelRecipes: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
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
  /** 当前动态发电量（kW），拓扑未编译或无限电力模式下为 null */
  readonly currentPowerGeneration: number | null;
}
