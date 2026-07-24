export type SimulationRunState = "stop" | "start" | "pause";

export interface SimulationRuntimeStatistics {
  /** 实测 TPS（滑动窗口均值） */
  readonly tickPerSecond: number;
  /** 目标确定性 TPS = simulationSpeed × dynamicTickRate */
  readonly targetTickPerSecond: number;
  /** 基地电池当前电量（焦耳） */
  readonly baseBatteryJoules: number;
  /** 基地电池满容量（焦耳） */
  readonly baseBatteryCapacity: number;
}

export interface SimulationState{
  readonly runningState: SimulationRunState;
  /**
   * 仅作为 advancePlaybackByDeltaMs 的时间推进倍率使用。
   * 禁止在任何其他逻辑中直接消费该值；tick 和 second 的换算一律使用 standard tick rate。
   */
  readonly simulationSpeed: number;
  readonly statistics: SimulationRuntimeStatistics;
  /** Worker 缓存中当前保留的 tick 快照数 */
  readonly bufferSize: number;
  readonly timeline: SimulationTimelineState;
}

export interface SimulationTimelineMark {
  readonly id: string;
  readonly tickNumber: number;
  readonly kind: "document-change" | "runtime-change" | "safety-resync";
}

export interface SimulationTimelineState {
  readonly enabled: boolean;
  readonly readiness: "idle" | "preparing" | "catching-up" | "ready";
  readonly tickDurationSeconds: number;
  readonly rulerDurationSeconds: number;
  readonly windowStartTickNumber: number;
  readonly cursorTickNumber: number;
  readonly availableFromTickNumber: number;
  readonly availableToTickNumber: number;
  readonly marks: readonly SimulationTimelineMark[];
  readonly isSeeking: boolean;
}

export interface SimulationDeviceRuntimeChannelRecipeStatus {
  readonly channelId: string;
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  /** 配方运行时状态，用于判断产物堵塞等 */
  readonly state: "running" | "waiting-output" | null;
}

// AI-REMOVED 2026-05-30:
// Reason: recipeId/progressSeconds/desiredSeconds 三个顶层字段已迁移到 channelRecipes 映射中，
//   每个 channel 独立持有 SimulationDeviceRuntimeChannelRecipeStatus，
//   旧调用方已全部改为使用 channelRecipes[n].recipeId / progressSeconds / desiredSeconds。
// Trigger: 用户需求 — 删除旧字段。
// Evidence: vscode_listCodeUsages 确认仅 simulation-host.ts 填充旧字段，inspector 已迁移至 channel 级。
// Replacement: SimulationDeviceRuntimeChannelRecipeStatus（通过 channelRecipes 访问）
// Risk: Low（所有调用方已迁移）
// Human Review: Not Required
//
// Original code:
//   // AI-CORRECTION 2026-05-29: 保留 recipeId/progressSeconds/desiredSeconds 兼容旧调用方。
//   // 新代码应使用 channelRecipes 获取每个 channel 的运行状态。
//   readonly recipeId: string | null;
//   readonly progressSeconds: number | null;
//   readonly desiredSeconds: number | null;
export interface SimulationDeviceRuntimeStatusReadModel {
  /** 每个 channel 的运行时配方状态，key 为 channel id */
  readonly channelRecipes: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
  readonly slotItems: readonly SimulationDeviceRuntimeSlotItemReadModel[];
  /** 准入口 runtime 计数，key 为 `${portGroupId}:${portId}`。非 admission 设备或旧测试 mock 可省略。 */
  readonly admissionCounters?: Record<string, SimulationAdmissionCounterStatusReadModel>;
  // AI-REMOVED 2026-07-23:
  // Reason: Inspector 改为直接读取真实消耗槽，运行时不再维护分钟计量快照。
  // Trigger: 用户要求去掉计数器机制并显示槽位物品数量 × 6。
  // Evidence: slotItems 已包含 storageGroupId、count 与 reserved，可完整表达当前消耗状态。
  // Replacement: slotItems 中 consumption-channel 原料槽对应项。
  // Risk: Low - 旧 Inspector 与测试 mock 需要同步迁移。
  // Human Review: Required
  //
  // Original code:
  // readonly meteredConsumption?: SimulationMeteredConsumptionStatusReadModel | null;
  /** 设备供电范围状态（编译期确定，非运行时变化） */
  readonly powerStatus: "no-power-needed" | "in-power-range" | "out-of-power-range" | null;
}

// AI-REMOVED 2026-07-23:
// Reason: 固定分钟窗口计量状态不再存在。
// Trigger: 用户要求以十秒 reserved-item 配方和真实容量 5 槽位表达消耗。
// Evidence: SimulationDeviceRuntimeSlotItemReadModel 与 channelRecipes 已覆盖 Inspector 所需状态。
// Replacement: SimulationDeviceRuntimeSlotItemReadModel + SimulationDeviceRuntimeChannelRecipeStatus。
// Risk: Low
// Human Review: Required
//
// Original code:
// export interface SimulationMeteredConsumptionStatusReadModel {
//   readonly currentWindowCount: number;
//   readonly currentWindowItemId: string | null;
//   readonly previousWindowCount: number;
//   readonly previousWindowItemId: string | null;
// }

export interface SimulationGasDiffusionRangeReadModel {
  readonly sourceDeviceId: string;
  readonly gasItemId: string;
  readonly gridRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface SimulationAdmissionCounterStatusReadModel {
  readonly portGroupId: string;
  readonly portId: string;
  readonly itemType: string | null;
  readonly limit: number | null;
  /** 已经从准入口输出口真实移动到下游的跨窗口累计数量。 */
  readonly count: number;
  /** UI 配置单位仍为每分钟；运行时按该值除以 6 作为每个 10 秒窗口的额度。 */
  readonly perMinuteLimit: number | null;
  /** 当前对齐的 10 秒速率窗口内，已由准入口搬运配方承诺放行的数量。 */
  /** AI-CORRECTION 2026-07-24: 只统计已经从准入口输出口真实移动到下游的数量；缓存和运行中配方不计入。 */
  readonly rateWindowCount: number;
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

/** 单种物品的仓库统计只读视图 */
export interface WarehouseItemStatsReadModel {
  /** 1 分钟滑动窗口内产出速率（/min 仿真时间） */
  readonly producedPerMinute: number;
  /** 1 分钟滑动窗口内消耗速率（/min 仿真时间） */
  readonly consumedPerMinute: number;
  /** 当前仓库中该物品的数量 */
  readonly warehouseCount: number;
  /** 最后一次发生变化（产出或消耗）的 tick 号 */
  readonly lastChangedTick: number;
}

/** 仓库统计快照只读视图 */
export interface WarehouseStatsReadModel {
  /** key 为 itemType */
  readonly items: Record<string, WarehouseItemStatsReadModel>;
  /** 首个 1 分钟统计窗口是否已就绪 */
  readonly statsWindowReady: boolean;
}

export interface SimulationRuntimeSlotPatch {
  readonly entityId: string;
  readonly storageGroupId: string;
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly ignoreStock: boolean;
}

export interface SimulationAdmissionCounterReset {
  readonly entityId: string;
  readonly portGroupId: string;
  readonly portId: string;
  /** 省略时重置累计计数；rate-window 只重置当前 10 秒速率窗口。 */
  readonly scope?: "total" | "rate-window";
}

/** 文档级仿真运行时只读视图 */
export interface SimulationDocumentRuntimeReadModel {
  /** 当前 tick 编号，仿真未启动时为 null */
  readonly tickNumber: number | null;
  /** 总电力需求（kW），拓扑未编译时为 null */
  readonly totalPowerDemand: number | null;
  /** 当前动态发电量（kW），拓扑未编译或无限电力模式下为 null */
  readonly currentPowerGeneration: number | null;
  /** 真实电力模式下发电量不足总需求时为 true，无限电力模式下始终为 false */
  readonly isPowerOutage: boolean;
}
