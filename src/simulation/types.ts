import type { LinkType } from "@/domain/document/world-document";
import type { GridEdge, GridPoint, GridRect, GridRectSize, GridRotation } from "@/domain/shared/grid";
import type { RecipeDefinition, RecipeType } from "@/domain/registry/types/recipe-definition";
import type { WaterPurifierOutputMode } from "@/shared/water-purifier-node";
import type { SimulationMutableRuntimeState } from "./runtime/runtime-state";

export type SimulationItemDomain = "solid" | "liquid" | "gas";
export type SimulationItemDomainFilter = SimulationItemDomain | "fluid";
export type SimulationPortKind = "item" | "fluid";
export type SimulationPortDirection = "input" | "output";
export type SimulationNodeViewRole = "input-view" | "output-view";
// AI-REMOVED 2026-06-12:
// Reason: 端口/边 per-tick count 是错误设计；准入口上限必须由跨 tick runtime counter 表达。
// Trigger: 用户确认 per tick count 应删除，文档中没有该概念。
// Evidence: .docs/common/模拟器/仿真运行原理.md 已改为 admissionRule + persistent counter。
// Replacement: SimulationAdmissionRule。
// Risk: Medium - topology 编译与 runtime 求解需同步迁移。
// Human Review: Required
//
// Original code:
// export type SimulationCountLimit = number | "unlimited";
export type SimulationPowerStatus = "no-power-needed" | "in-power-range" | "out-of-power-range";
/**
 * 仿真运输类别，决定设备在物流拓扑中的角色。
 *
 * - `strict-belt`：专用传送带（belt_straight_1x1 / belt_turn_cw_1x1 / belt_turn_ccw_1x1）。
 *   可混合运输多种物品，不建 TransportComponent（无需域锁）。
 *
 * - `strict-pipe`：专用管道（pipe_straight_1x1 / pipe_turn_cw_1x1 / pipe_turn_ccw_1x1）。
 *   独占一种液体，需要域锁。由 compileTransportComponents 构建连通分量，
 *   同一分量内管道共享 transportComponentDomain，确保不会混入第二种液体。
 *
 * - `anchor`：非专用物流设备。包括：
 *   - 生产设备（如 item_port_hydro_planter_1、item_port_furnance_1 等）
 *   - 通用物流设备（item_pipe_splitter、item_pipe_converger、item_pipe_connector、
 *     item_log_splitter、item_log_converger、item_log_connector、
 *     item_pipe_admission、item_log_admission）
 *   AI-CORRECTION 2026-07-19: 当前设备定义 ID 已移除 item_/item_port_ 前缀；上行保留迁移前名称。
 *   anchor 设备不参与 TransportComponent，且会**分割** strict-pipe 的连通分量：
 *   两个 strict-pipe 之间如果隔了一个 anchor 设备（如分流器），它们属于不同的 TransportComponent。
 *   这是有意设计——分流器/汇流器/桥接器自身有 buffer 和独立的搬运配方，不应被管道域锁约束。
 *
 * - `non-graph`：无端口且无存储槽的空壳设备，不进入求解图。
 */
export type SimulationTransportClass = "strict-belt" | "strict-pipe" | "anchor" | "non-graph";
// AI-REMOVED 2026-06-06:
// Reason: submitMode 运行时机制已按用户要求彻底移除；自动入仓改由动态 warehouse sink 或 r_warehouse_submit 配方处理。
// Trigger: RUN_ID 20260606-041337-509040 中旧蓝图 submitMode 被全局 tick 扫描消费，导致产线目标存储箱同 tick 被清空。
// Evidence: .docs/stages/stage1/requirements/REQ-087-warehouse-loader-and-storager-submit-semantics.md 明确不再使用 submitMode / submitIntervalSeconds。
// Replacement: WarehouseSink 设备标签 + runtime-slot-access 动态仓库槽写入；协议存储箱使用 r_warehouse_submit。
// Risk: Medium - domain 层字段仍作为旧配置数据残留，但 simulation 不再编译或消费。
// AI-CORRECTION 2026-06-06: domain 层 StorageSlotDefinition 字段也已注释化删除；旧蓝图同名 config 键仅作为外部遗留输入存在。
// Human Review: Required
//
// Original code:
// export type SimulationSubmitMode = "never" | "every-tick" | "every-n-seconds";
export type SimulationWorkerStatusMode = "idle" | "starting" | "running" | "stopped" | "error";
export type SimulationRecipeType = RecipeType;
export type SimulationLinkType = LinkType;

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "gas" }
    | { readonly kind: "fluid" }
    | { readonly kind: "item"; readonly itemId: string }
    | { readonly kind: "none" };
  readonly exclude: readonly string[];
}

export interface SimulationAdmissionRule {
  readonly itemId: string | null;
  readonly limit: number | null;
  readonly perMinuteLimit: number | null;
}

export interface SimulationCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
  readonly definitionId?: string;
}

export interface CompiledSimulationTopology {
  readonly schemaVersion: 4;
  readonly topologyId: string;
  readonly documentKey: string;
  readonly documentHash: string;
  readonly registryHash: string;
  readonly standardTickRate: number;
  readonly totalPowerDemand: number;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly recipeCatalog: Record<string, CompiledSimulationRecipeDefinition>;
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly nodes: Record<string, CompiledSimulationNode>;
  readonly slots: Record<string, CompiledSimulationSlot>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationSlotLink>;
  readonly physicalConnections: Record<string, CompiledSimulationPhysicalConnection>;
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  /** 编译期邻接索引。旧测试夹具可省略，运行时会回退到 edgeOrder 扫描。 */
  readonly edgeIdsByInputPortId?: Readonly<Record<string, readonly string[]>>;
  readonly edgeIdsByOutputPortId?: Readonly<Record<string, readonly string[]>>;
  /** 编译期设备顺序索引，避免热路径排序反复调用 indexOf。 */
  readonly deviceOrderIndexById?: Readonly<Record<string, number>>;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly nodeOrder: readonly string[];
    readonly slotOrder: readonly string[];
    readonly portOrder: readonly string[];
    readonly physicalConnectionOrder: readonly string[];
    readonly edgeOrder: readonly string[];
  };
  /** 相连的同类型严格运输设备构成的组件集合。键为组件 ID。 */
  readonly transportComponents: Record<string, CompiledTransportComponent>;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
}

export interface CompiledSimulationItem {
  readonly id: string;
  readonly domain: SimulationItemDomain;
  readonly tags: readonly string[];
}

export interface CompiledSimulationRecipeDefinition {
  readonly id: string;
  readonly nameKey: string;
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  readonly machineId: string;
  readonly recipeType: SimulationRecipeType;
  readonly tags: readonly string[];
  /** 配方运行时发电量（kW），默认 0。 */
  readonly powerOutput: number;
  /** 配方运行/启动所需气体扩散范围。值为气体物品 ID。 */
  readonly requiredGasDiffusion: string | null;
  /** 配方运行期间提供的气体扩散范围。 */
  readonly gasDiffusionOutput: CompiledSimulationGasDiffusionOutput | null;
}

export interface CompiledSimulationGasDiffusionOutput {
  readonly gasItemId: string;
  readonly range: number;
}

export interface CompiledSimulationMeteredConsumption {
  readonly inputPortId: string;
  readonly itemIds: readonly string[];
  readonly windowTicks: number;
  readonly startThreshold: number;
  readonly acceptanceLimit: number;
  readonly gasDiffusionRange: number | null;
}

export interface CompiledSimulationDevice {
  readonly id: string;
  readonly sourceEntityId: string | null;
  readonly definitionId: string;
  readonly position: GridPoint | null;
  readonly rotation: GridRotation | null;
  readonly footprint: GridRectSize | null;
  readonly tags: readonly string[];
  readonly powerStatus: SimulationPowerStatus;
  readonly powerDemand: number;
  /** 是否需要电力才能运行。对应 EntityDefinition.requiresPower。 */
  readonly requiresPower: boolean;
  readonly transportClass: SimulationTransportClass;
  /** 若属于 strict-belt/strict-pipe 运输组件，则为该组件的 ID；否则为 null。 */
  readonly transportComponentId: string | null;
  readonly nodeIds: readonly string[];
  readonly recipeChannels: readonly CompiledSimulationRecipeChannel[];
  /** 不同 channel 是否允许同时运行同一配方；缺失时按 false 处理。 */
  readonly allowDuplicateRecipesAcrossChannels?: boolean;
  readonly portIds: readonly string[];
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  readonly configHash: string;
  /** 编译期缓存：该设备是否有实质生产配方（非运输、非仓库提交）。运行时零开销判断。 */
  readonly isProducer: boolean;
  /** 显式声明的阻塞清理机制；未配置的设备运行时完全不生效。 */
  readonly blockageAutoClearance?: CompiledSimulationBlockageAutoClearance | null;
  /** 净水节点专用运行配置；其他设备为 null。 */
  readonly waterPurifierNode?: CompiledSimulationWaterPurifierNodeConfig | null;
  /** 销毁型计量入口及其窗口运行许可；未声明时为 null。 */
  readonly meteredConsumption?: CompiledSimulationMeteredConsumption | null;
}

export interface CompiledSimulationBlockageAutoClearanceSlotRef {
  readonly storageSlotGroupId: string;
  readonly slotId: string | null;
}

export interface CompiledSimulationBlockageAutoClearance {
  readonly enabled: boolean;
  readonly channelIds: readonly string[];
  readonly slotRefs: readonly CompiledSimulationBlockageAutoClearanceSlotRef[];
  readonly blockedChannelThreshold: number;
}

export interface CompiledSimulationWaterPurifierNodeConfig {
  readonly outputMode: WaterPurifierOutputMode;
  readonly manualOutputPerMinute: number;
  readonly outputStorageGroupId: string;
  readonly outputSlotId: string;
  readonly outputItemId: string;
}

export interface CompiledSimulationRecipeChannel {
  readonly id: string;
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
  readonly manualRecipeOnly: boolean;
  /** manualRecipeOnly channel 的用户预选配方 ID，null 表示未选择 */
  readonly defaultRecipeId: string | null;
}

export interface CompiledSimulationNode {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly viewRole: SimulationNodeViewRole;
  readonly slotIds: readonly string[];
  readonly inputPortIds: readonly string[];
  readonly outputPortIds: readonly string[];
  readonly groupOrder: number;
}

export interface CompiledSimulationSlot {
  readonly id: string;
  readonly nodeId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly sourceSlotId: string | null;
  readonly capacity: number;
  readonly domain: SimulationItemDomainFilter | "any";
  readonly lock: string | null;
  readonly initialItemType: string | null;
  readonly initialCount: number;
  readonly ignoreStock: boolean;
  // AI-REMOVED 2026-06-06:
  // Reason: submitMode 编译字段会诱导 runtime 继续按全局 slot 行为入仓；当前语义改为 sink/配方两条明确路径。
  // Trigger: 用户要求 submit mode 机制彻底删除，未来都用 warehouse sink 或配方交货。
  // Evidence: RUN_ID 20260606-041337-509040 的 premium-capsule-line / wuling-battery-line 因该字段被消费而失败。
  // Replacement: WarehouseSink tag + r_warehouse_submit recipe.
  // Risk: Medium - 旧配置仍可能存在于蓝图 JSON，但不再影响仿真。
  // Human Review: Required
  //
  // Original code:
  // readonly submitMode: SimulationSubmitMode;
  // readonly submitIntervalTicks: number | null;
}

export interface CompiledSimulationPort {
  readonly id: string;
  readonly deviceId: string;
  readonly portGroupId: string;
  readonly portDefinitionId: string;
  readonly kind: SimulationPortKind;
  readonly direction: SimulationPortDirection;
  readonly insideGridPoint: GridPoint;
  readonly outsideGridPoint: GridPoint;
  readonly edge: GridEdge;
  readonly boundNodeIds: readonly string[];
  readonly acceptRule: SimulationAcceptRule;
  /** 仅 admission 设备 input port 使用；计数存放于 runtime persistent state。 */
  readonly admissionRule: SimulationAdmissionRule | null;
  // AI-REMOVED 2026-06-12:
  // Reason: CompiledSimulationPort 不再携带 per-tick count。
  // Trigger: 用户要求彻底删除错误的通用 port count 设计。
  // Evidence: stage-3 求解将改为基于 admissionRule 的跨 tick counter。
  // Replacement: admissionRule。
  // Risk: Medium - 旧 topology fixture 需迁移。
  // Human Review: Required
  //
  // Original code:
  // readonly count: SimulationCountLimit;
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
  readonly order: number;
}

export interface CompiledSimulationPhysicalConnection {
  readonly id: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceInsideGridPoint: GridPoint;
  readonly targetInsideGridPoint: GridPoint;
}

/**
 * 运输组件：相连的 strict-belt 或 strict-pipe 设备构成的无向连通分量。
 * 组件内所有槽位共享同一个物品类型域锁（domain），确保管道/传送带链路不混合多种物品。
 */
export interface CompiledTransportComponent {
  /** 同组件内所有设备的 ID 集合。 */
  readonly deviceIds: readonly string[];
  /** 同组件内所有节点的 ID 集合。 */
  readonly nodeIds: readonly string[];
  /** 同组件内所有槽位的 ID 集合。 */
  readonly slotIds: readonly string[];
}

export interface CompiledSimulationTransferEdge {
  readonly id: string;
  readonly physicalConnectionId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly acceptRule: SimulationAcceptRule;
  // AI-REMOVED 2026-06-12:
  // Reason: TransferEdge 不再承载 per-tick count；准入口限制属于 target input port 的跨 tick 状态。
  // Trigger: 用户要求删除 per tick count。
  // Evidence: topology compiler 不再计算 min(sourcePort.count, targetPort.count)。
  // Replacement: targetPort.admissionRule + persistent admission counter。
  // Risk: Medium - runtime 求解逻辑需统一使用 targetPortId。
  // Human Review: Required
  //
  // Original code:
  // readonly count: SimulationCountLimit;
}

export interface CompiledSimulationSlotLink {
  readonly id: string;
  readonly linkType: SimulationLinkType;
  readonly sourceSlotIds: readonly string[];
  readonly targetSlotIds: readonly string[];
  readonly targetSlotIdBySourceSlotId: Readonly<Record<string, string>>;
}

export interface CompiledSimulationRecipePlan {
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
  readonly requiredGasDiffusion: string | null;
  readonly gasDiffusionOutput: CompiledSimulationGasDiffusionOutput | null;
}

export interface CompiledSimulationRecipeItem {
  readonly itemId: string | "any" | "same-as-input";
  readonly amount: number;
}

export interface CompiledSimulationRoutingEntry {
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
}

export type SimulationTickPullStatus =
  | {
      readonly status: "ready";
      readonly retainedFromTick: number;
      readonly latestTickNumber: number;
      readonly bufferSize: number;
    }
  | {
      readonly status: "not-ready";
      readonly requestedTickNumber: number;
      readonly retainedFromTick: number | null;
      readonly latestTickNumber: number | null;
      readonly bufferSize: number;
    }
  | {
      readonly status: "not-found";
      readonly reason: "cleared" | "missing-topology" | "unknown";
      readonly requestedTickNumber: number;
      readonly retainedFromTick: number | null;
      readonly latestTickNumber: number | null;
      readonly bufferSize: number;
    };

export interface SimulationRuntimeStatus {
  readonly mode: SimulationWorkerStatusMode;
  readonly topologyId: string | null;
  readonly documentHash: string | null;
  readonly retainedFromTick: number | null;
  readonly latestTickNumber: number | null;
  readonly bufferSize: number;
  readonly maxBufferSize: number;
  readonly dynamicTickRate: number | null;
  readonly error: string | null;
}

export interface SimulationStartResult {
  readonly status: "started" | "failed";
  readonly topologyId: string | null;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
  readonly error?: string;
  readonly runtimeTransition?: SimulationRuntimeTransition;
}

/**
 * 一次拓扑装载对运行时的实际影响。
 * 用于区分首次初始化、保留状态的热替换与无法迁移时的完整重置。
 */
export interface SimulationRuntimeTransition {
  readonly kind: "initialization" | "topology-hot-swap" | "full-reset" | "migration-rejected";
  readonly reason: string;
  readonly baseTickNumber: number;
  readonly invalidatedFromTickNumber: number;
  readonly resetDeviceIds: readonly string[];
}

export interface SimulationTopologyMigration {
  readonly baseTickNumber: number;
  readonly resetDeviceIds: readonly string[];
}

export interface SimulationTickSnapshotResult {
  readonly status: SimulationTickPullStatus;
  readonly currentTick: RuntimeTickSnapshot | null;
}

export interface SimulationRuntimeExport {
  readonly topology: CompiledSimulationTopology;
  readonly runtimeState: SimulationMutableRuntimeState;
  readonly snapshot: RuntimeTickSnapshot;
  readonly powerMode: "real" | "infinite";
  readonly powerConsumptionOverride: number | undefined;
}

export interface RuntimeTickSnapshot {
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  readonly status: "initial" | "running";
  /** 调试模式下为完整 Tick 与 Worker 可序列化内部状态的 JSON；非调试模式不传输该属性。 */
  /** AI-CORRECTION 2026-07-17：仅在“仿真Worker详细汇报”开启时构造并传输，普通调试模式不再生成。 */
  readonly debugData?: string;
  readonly totalPowerDemand: number;
  readonly currentPowerGeneration: number;
  /** 真实电力模式下发电量不足总需求时为 true；无限电力模式下始终为 false */
  readonly isPowerOutage: boolean;
  /** 基地电池当前电量（焦耳） */
  readonly baseBatteryJoules: number;
  /** 基地电池满容量（焦耳） */
  readonly baseBatteryCapacity: number;
  readonly slots: Record<string, RuntimeSlotSnapshot>;
  readonly devices: Record<string, RuntimeDeviceSnapshot>;
  readonly nodes: Record<string, RuntimeNodeSnapshot>;
  readonly transfers: readonly RuntimeTransferSnapshot[];
  readonly routingCursors: Record<string, number>;
  readonly transportComponentDomain: Record<string, string | null>;
  readonly diagnostics: readonly RuntimeDiagnosticSnapshot[];
  readonly gasDiffusions: readonly RuntimeGasDiffusionSnapshot[];
  /** 仓库统计快照：配方产出/消耗 per-min 与当前库存。仿真未启动时为 null。 */
  readonly warehouseStats: WarehouseStats | null;
}

export interface RuntimeGasDiffusionSnapshot {
  readonly sourceDeviceId: string;
  readonly gasItemId: string;
  readonly gridRect: GridRect;
}

/** 单种物品的仓库统计数据 */
export interface WarehouseItemStats {
  /** 1 分钟滑动窗口内产出速率（/min 仿真时间） */
  readonly producedPerMinute: number;
  /** 1 分钟滑动窗口内消耗速率（/min 仿真时间） */
  readonly consumedPerMinute: number;
  /** 当前仓库中该物品的数量 */
  readonly warehouseCount: number;
  /** 最后一次发生变化（产出或消耗）的 tick 号 */
  readonly lastChangedTick: number;
}

/** 仓库统计快照 */
export interface WarehouseStats {
  /** key 为 itemType */
  readonly items: Record<string, WarehouseItemStats>;
  /** 首个 1 分钟统计窗口是否已就绪（coveredStandardTicks >= windowCapacity） */
  readonly statsWindowReady: boolean;
}

export interface RuntimeSlotSnapshot {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
  readonly ignoreStock: boolean;
}

export interface RuntimeDeviceSnapshot {
  readonly deviceId: string;
  readonly block: boolean;
  // AI-CORRECTION 2026-05-29: recipe 保留兼容，channelRecipes 为新的多 channel 数据源。
  // 原 recipe 仍为第一个运行中 recipe 的快照投影。
  readonly recipe: RuntimeDeviceRecipeSnapshot | null;
  /** 每个 channel 的当前运行时配方状态，key 为 channel id，null 表示该 channel 空闲 */
  readonly channelRecipes: Record<string, RuntimeDeviceRecipeSnapshot | null>;
  /** 准入口 runtime 计数，key 为 `${portGroupId}:${portId}`。 */
  readonly admissionCounters: Record<string, RuntimeAdmissionCounterSnapshot>;
  readonly meteredConsumption: RuntimeMeteredConsumptionSnapshot | null;
}

export interface RuntimeMeteredConsumptionSnapshot {
  readonly windowStartTick: number;
  readonly currentCount: number;
  readonly currentItemId: string | null;
  readonly previousWindowItemId: string | null;
  readonly previousWindowCount: number;
  readonly authorizedUntilTick: number | null;
  readonly activeEffectItemId: string | null;
}

export interface RuntimeAdmissionCounterSnapshot {
  readonly portId: string;
  readonly portGroupId: string;
  readonly portDefinitionId: string;
  readonly itemId: string | null;
  readonly limit: number | null;
  readonly count: number;
  readonly perMinuteLimit: number | null;
  readonly perMinuteCount: number;
}

export interface RuntimeDeviceRecipeSnapshot {
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly progressTicks: number;
  readonly durationTicks: number;
  readonly state: "running" | "waiting-output";
}

export interface RuntimeNodeSnapshot {
  readonly nodeId: string;
  readonly result: "uncertain" | "solved-run" | "solved-block";
  readonly resolveState: "unresolved" | "visited" | "blocked-resolved";
  readonly acceptedInputEdgeIds: readonly string[];
  readonly acceptedOutputEdgeIds: readonly string[];
  readonly blockReason?: string;
}

export interface RuntimeTransferSnapshot {
  readonly edgeId: string;
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface RuntimeDiagnosticSnapshot {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}

export function compileRecipeDefinition(
  recipe: RecipeDefinition,
  durationTicks: number,
): CompiledSimulationRecipeDefinition {
  return {
    id: recipe.id,
    nameKey: recipe.nameKey,
    durationTicks,
    inputs: recipe.inputs.map((input) => ({ ...input })),
    outputs: recipe.outputs.map((output) => ({ ...output })),
    machineId: recipe.machineId,
    recipeType: recipe.recipeType,
    tags: [...recipe.tags].sort(),
    powerOutput: recipe.powerOutput ?? 0,
    requiredGasDiffusion: normalizeRecipeGasItemId(recipe.requiredGasDiffusion),
    gasDiffusionOutput: normalizeRecipeGasDiffusionOutput(recipe.gasDiffusionOutput),
  };
}

function normalizeRecipeGasItemId(itemId: string | undefined): string | null {
  return typeof itemId === "string" && itemId.length > 0 ? itemId : null;
}

function normalizeRecipeGasDiffusionOutput(
  output: RecipeDefinition["gasDiffusionOutput"],
): CompiledSimulationGasDiffusionOutput | null {
  if (output === undefined || output === null) {
    return null;
  }
  if (typeof output.gasItemId !== "string" || output.gasItemId.length === 0) {
    return null;
  }
  if (!Number.isFinite(output.range) || output.range <= 0) {
    return null;
  }
  return {
    gasItemId: output.gasItemId,
    range: output.range,
  };
}

// ============================================================
// Perf instrumentation types
// ============================================================

export interface TickPerfEntry {
  readonly tickNumber: number;
  readonly totalMs: number;
  readonly stages: {
    readonly advanceDevices: number;
    readonly buildSolveGraph: number;
    readonly solveTransferGraph: number;
    readonly rotateRoutingCursors: number;
    readonly settleRecipes: number;
    readonly maintainDomains: number;
    readonly createSnapshot: number;
  };
  readonly stage3?: TickPerfStage3Details;
  readonly hotPath?: TickPerfHotPathDetails;
}

export interface TickPerfStage3Details {
  readonly layerCount: number;
  readonly anchorCount: number;
  readonly outputNodeCount: number;
  readonly moveCount: number;
  readonly refreshBlockedMs: number;
  readonly refreshBlockedCalls: number;
  readonly getReservedCalls: number;
  readonly canOutputProvideCalls: number;
  readonly findInputSlotCalls: number;
  readonly getRemainingCapacityCalls: number;
  readonly selectSourceCalls: number;
  readonly solveOutputEdgeChecks: number;
}

export interface TickPerfHotPathDetails {
  readonly inputEdgeLookupCalls: number;
  readonly inputEdgeLookupMs: number;
  readonly outputEdgeLookupCalls: number;
  readonly outputEdgeLookupMs: number;
  readonly edgeIndexFallbackScans: number;
  readonly reservedLookupCalls: number;
  readonly reservedLookupMs: number;
  readonly reservedIndexBuilds: number;
  readonly reservedIndexBuildMs: number;
  readonly reservationAdjustCalls: number;
  readonly recipeFinishCalls: number;
  readonly recipeFinishSuccesses: number;
  readonly recipeFinishFailures: number;
  readonly recipeFinishPreflightMs: number;
  readonly recipeFinishCommitMs: number;
  readonly recipeFinishChangedSlots: number;
}

export interface SimulationPerfReport {
  readonly tickRange: { readonly from: number; readonly to: number };
  readonly entries: readonly TickPerfEntry[];
  readonly summary: {
    readonly avgMs: number;
    readonly maxMs: number;
    readonly avgStageMs: {
      readonly advanceDevices: number;
      readonly buildSolveGraph: number;
      readonly solveTransferGraph: number;
      readonly rotateRoutingCursors: number;
      readonly settleRecipes: number;
      readonly maintainDomains: number;
      readonly createSnapshot: number;
    };
  };
}
