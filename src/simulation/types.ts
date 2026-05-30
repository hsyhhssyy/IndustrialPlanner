import type { LinkType } from "@/domain/document/world-document";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type { RecipeDefinition, RecipeType } from "@/domain/registry/types/recipe-definition";

export type SimulationItemDomain = "solid" | "liquid";
export type SimulationPortKind = "item" | "fluid";
export type SimulationPortDirection = "input" | "output";
export type SimulationNodeViewRole = "input-view" | "output-view";
export type SimulationCountLimit = number | "unlimited";
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
 *   anchor 设备不参与 TransportComponent，且会**分割** strict-pipe 的连通分量：
 *   两个 strict-pipe 之间如果隔了一个 anchor 设备（如分流器），它们属于不同的 TransportComponent。
 *   这是有意设计——分流器/汇流器/桥接器自身有 buffer 和独立的搬运配方，不应被管道域锁约束。
 *
 * - `non-graph`：无端口且无存储槽的空壳设备，不进入求解图。
 */
export type SimulationTransportClass = "strict-belt" | "strict-pipe" | "anchor" | "non-graph";
export type SimulationSubmitMode = "never" | "every-tick" | "every-n-seconds";
export type SimulationWorkerStatusMode = "idle" | "starting" | "running" | "stopped" | "error";
export type SimulationRecipeType = RecipeType;
export type SimulationLinkType = LinkType;

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "item"; readonly itemId: string };
  readonly exclude: readonly string[];
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
}

export interface CompiledSimulationDevice {
  readonly id: string;
  readonly sourceEntityId: string | null;
  readonly definitionId: string;
  readonly position: GridPoint | null;
  readonly rotation: GridRotation | null;
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
  readonly portIds: readonly string[];
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  readonly configHash: string;
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
  readonly domain: SimulationItemDomain | "any";
  readonly lock: string | null;
  readonly initialItemType: string | null;
  readonly initialCount: number;
  readonly ignoreStock: boolean;
  readonly submitMode: SimulationSubmitMode;
  readonly submitIntervalTicks: number | null;
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
  readonly count: SimulationCountLimit;
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
  readonly count: SimulationCountLimit;
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
}

export interface SimulationTopologyMigration {
  readonly baseTickNumber: number;
  readonly resetDeviceIds: readonly string[];
}

export interface SimulationTickSnapshotResult {
  readonly status: SimulationTickPullStatus;
  readonly currentTick: RuntimeTickSnapshot | null;
}

export interface RuntimeTickSnapshot {
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  readonly status: "initial" | "running";
  readonly totalPowerDemand: number;
  readonly currentPowerGeneration: number;
  /** 真实电力模式下发电量不足总需求时为 true；无限电力模式下始终为 false */
  readonly isPowerOutage: boolean;
  readonly slots: Record<string, RuntimeSlotSnapshot>;
  readonly devices: Record<string, RuntimeDeviceSnapshot>;
  readonly nodes: Record<string, RuntimeNodeSnapshot>;
  readonly transfers: readonly RuntimeTransferSnapshot[];
  readonly routingCursors: Record<string, number>;
  readonly transportComponentDomain: Record<string, string | null>;
  readonly diagnostics: readonly RuntimeDiagnosticSnapshot[];
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
