// =========================================================================
// 仿真核心类型 — 编译后的仿真拓扑与运行时数据结构
//
// 对应《仿真运行原理》全部章节 + 《模拟器抽象方式》§5 编译期合并。
//
// 核心类型层级：
//   CompiledSimulationTopology         — 完整的编译产物（拓扑 + 排序 + 诊断）
//     ├── CompiledSimulationItem       — 物品（域 + 标签）
//     ├── CompiledSimulationDevice     — 设备（配方 + 路由 + 缓存组列表）
//     │   ├── CompiledSimulationCacheGroup — 缓存组（= 1 个求解图节点）
//     │   │   └── CompiledSimulationSlotTemplate — 槽位模板
//     │   ├── CompiledSimulationPort   — 端口
//     │   ├── CompiledSimulationCacheLink — 缓存链接（share-cap / share-all）
//     │   └── CompiledSimulationRecipePlan — 配方计划
//     ├── CompiledSimulationPhysicalConnection — 物理端口连接
//     └── CompiledSimulationTransferEdge — 求解图有向边
// =========================================================================

import type {
  GridEdge,
  GridPoint,
  GridRotation,
} from "./grid";

// =========================================================================
// 基础枚举/字面量类型
// =========================================================================

/** 物品物理域：solid=固体（传送带）、liquid=液体（管道） */
export type SimulationItemDomain = "solid" | "liquid";

/** 端口物品类型：item（固体物品端口）、fluid（液体端口） */
export type SimulationPortKind = "item" | "fluid";

/** 端口方向：input=物品流入、output=物品流出 */
export type SimulationPortDirection = "input" | "output";

/**
 * 缓存类型（对应《仿真运行原理》§3.1 缓存类型）。
 *   - ingredient：链接到输入端口的缓存，用于接收物品、作配方原料
 *   - product：链接到输出端口的缓存，用于存放产物
 *   - universal：同时链接输入/输出（如反应池共享槽位）
 */
export type SimulationCacheType = "ingredient" | "product" | "universal";

/**
 * Link 类型（对应《仿真运行原理》§3.3 缓存链接）。
 *   - "share-cap"：共享容量上限（shareLimit 有效），存储各自独立
 *   - "share-all"：共享存储内容和上限，读写立即可见
 */
export type SimulationLinkType = "share-cap" | "share-all";

/**
 * 端口吞吐量限制（对应《仿真运行原理》§3.1 表格中的 count）。
 *   - "unlimited"：无上限
 *   - number：每 tick 允许通过的物品数量上限
 */
export type SimulationCountLimit = number | "unlimited";

/**
 * 物流设备类型（用于渲染/行为分类，不影响求解规则）。
 *   - "strict-belt"：传送带类型
 *   - "strict-pipe"：管道类型
 *   - "anchor"：锚点设备（仓库等）
 *   - "non-graph"：不参与图求解的设备（总线源桩等）
 */
export type SimulationTransportClass =
  | "strict-belt"
  | "strict-pipe"
  | "anchor"
  | "non-graph";

/**
 * 配方类型（对应《仿真运行原理》§3.2 配方类型）。
 *   - "immediate-consume"：进度=0% 时立即扣除原料，不占用存储
 *   - "reserved-item"：进度=100% 时消耗原料，占用存储（搬运设备）
 */
export type SimulationRecipeType =
  | "immediate-consume"
  | "reserved-item";

/**
 * 槽位提交模式。
 *   - "never"：不自动提交
 *   - "every-tick"：每 tick 提交
 *   - "every-n-seconds"：每 n 秒提交一次
 */
export type SimulationSubmitMode =
  | "never"
  | "every-tick"
  | "every-n-seconds";

/** Worker 运行状态 */
export type SimulationWorkerStatusMode =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export type SimulationState = "stop" | "start" | "pause";

// =========================================================================
// 物品接收规则（对应《仿真运行原理》§3.1 中 port 的 acceptRule + §5.2 边的 acceptRule）
//
// base 决定端口/边允许的物品域：
//   - { kind: "any" }     — 任意物品
//   - { kind: "solid" }   — 仅固体
//   - { kind: "liquid" }  — 仅液体
//   - { kind: "item", itemId } — 指定物品 ID
// exclude 为排除列表（base 交集 + exclude 取并集）
// =========================================================================

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "item"; readonly itemId: string };
  readonly exclude: readonly string[];
}

// =========================================================================
// CompiledSimulationTopology — 编译后的仿真拓扑主结构
//
// 对应《仿真运行原理》§5 图模型。
// 编译后拓扑传递给 SimulationWorker 执行每 tick 求解。
//
// ordering 字段确保确定性：所有 Map/Record 按 ordering 中的顺序遍历，
// 保证相同输入产生相同仿真结果（确定性仿真）。
// =========================================================================

export interface CompiledSimulationTopology {
  readonly schemaVersion: 1;
  readonly topologyId: string;
  readonly documentKey: string;
  readonly documentHash: string;
  readonly registryHash: string;
  /**
   * 标准 tick rate，仅用于把定义层的秒制配置换算为编译后的 tick。
   * 它不是前端播放/展示时钟，也不约束 render 侧每帧展示哪个 tick。
   */
  readonly standardTickRate: number;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly devices: Record<string, CompiledSimulationDevice>;
  /** 缓存组 = 求解图节点（对应 §5.1 节点来源） */
  readonly cacheGroups: Record<string, CompiledSimulationCacheGroup>;
  /** 槽位模板 = 节点能力 entry 的来源（对应 §5.3 节点能力） */
  readonly slots: Record<string, CompiledSimulationSlotTemplate>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationCacheLink>;
  /** 物理端口连接 */
  readonly physicalConnections: Record<string, CompiledSimulationPhysicalConnection>;
  /** 求解图有向边（对应 §5.2 边来源） */
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly cacheGroupOrder: readonly string[];
    readonly slotOrder: readonly string[];
    readonly portOrder: readonly string[];
    readonly physicalConnectionOrder: readonly string[];
    readonly edgeOrder: readonly string[];
  };
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
}

// =========================================================================
// 编译后物品
// =========================================================================

export interface CompiledSimulationItem {
  readonly id: string;
  /** 物品域（solid/liquid），决定走传送带还是管道 */
  readonly domain: SimulationItemDomain;
  /** 语义标签（如 "武陵"、"矿石"） */
  readonly tags: readonly string[];
}

// =========================================================================
// 编译后设备
// =========================================================================

export interface CompiledSimulationDevice {
  readonly id: string;
  /** 源 WorldEntity ID，null=仓库虚拟设备 */
  readonly sourceEntityId: string | null;
  readonly definitionId: string;
  readonly position: GridPoint | null;
  readonly rotation: GridRotation | null;
  readonly tags: readonly string[];
  /** 物流设备分类（严格传送带/严格管道/锚点/非图） */
  readonly transportClass: SimulationTransportClass;
  /** 所属缓存组 ID 列表（= 求解图节点列表，对应 §5.1） */
  readonly cacheGroupIds: readonly string[];
  readonly portIds: readonly string[];
  readonly recipePlan: CompiledSimulationRecipePlan | null;
  /** 路由配置：portRef → { priorityGroup, roundRobinSeed }，用于多端口调度 */
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  /** 编译时生成的配置哈希（用于检测是否需要重新编译） */
  readonly configHash: string;
}

// =========================================================================
// 编译后缓存组（= 求解图节点，对应《仿真运行原理》§5.1 节点来源）
//
// 每个缓存组 = 1 个求解图节点。
// cacheType 决定其在求解中的行为：
//   - ingredient：接收物品、提供配方原料
//   - product：接收产物、对外提供物品
//   - universal：同时承担 ingredient 和 product 角色
//
// inputPortIds / outputPortIds 指向与该缓存组绑定的端口。
// slotIds 指向该组内所有槽位（组内互斥，跨组不互斥，§3.4）。
// =========================================================================

export interface CompiledSimulationCacheGroup {
  readonly id: string;
  readonly deviceId: string;
  /** 源 StorageSlotGroup ID，null=合成缓存组 */
  readonly sourceStorageSlotGroupId: string | null;
  /** 缓存类型（ingredient / product / universal，对应 §3.1） */
  readonly cacheType: SimulationCacheType;
  /** 组内槽位 ID 列表 */
  readonly slotIds: readonly string[];
// =========================================================================
// 槽位模板（对应《仿真运行原理》§5.3 节点能力中的 entry）
//
// 每个槽位提供节点能力的一个 entry：
//   - 作为输入时：entry = (slot, acceptRule, amount)
//   - 作为输出时：entry = (slot, item, amount)
// =========================================================================

export interface CompiledSimulationSlotTemplate {
  readonly id: string;
  /** 所属缓存组 ID */
  readonly cacheGroupId: string;
  /** 源 Slot ID（定义层 slot id），null=合成槽位 */
  readonly sourceSlotId: string | null;
  /** 槽位容量 */
  readonly capacity: number;
  /** 物品域（solid/liquid/any） */
  readonly domain: SimulationItemDomain | "any";
  /** 锁定物品 ID，null=不锁定 */
  readonly lock: string | null;
  readonly initialItemType: string | null;
  readonly initialCount: number;
  /** 忽略库存检查（取货口/出货口常用） */
  readonly ignoreStock: boolean;
  readonly submitMode: SimulationSubmitMode;
  readonly submitIntervalTicks: number | null;
}

// =========================================================================
// 端口（对应《仿真运行原理》§3.1 中 Port 的概念）
//
// 端口被编译为旋转后的实际位置（insideGridPoint/outsideGridPoint）。
// boundCacheGroupIds 关联到该端口绑定的缓存组。
// acceptRule 和 count 从定义层合并而来，后续在生成 transferEdge 时参与 AND 运算。
// =========================================================================

export interface CompiledSimulationPort {
  readonly id: string;
  readonly deviceId: string;
  readonly portGroupId: string;
  readonly portDefinitionId: string;
  readonly kind: SimulationPortKind;
  readonly direction: SimulationPortDirection;
  /** 设备内部网格位置 */
  readonly insideGridPoint: GridPoint;
  /** 设备外部网格位置（连线检查用） */
  readonly outsideGridPoint: GridPoint;
  readonly edge: GridEdge;
  /** 绑定的缓存组 ID 列表 */
  readonly boundCacheGroupIds: readonly string[];
  readonly acceptRule: SimulationAcceptRule;
  readonly count: SimulationCountLimit;
  /** 端口排序（EDGE_ORDER 顺序） */
  readonly order: number;
}

// =========================================================================
// 物理连接（两个相邻端口之间的物理配对）
// =========================================================================

export interface CompiledSimulationPhysicalConnection {
  readonly id: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceInsideGridPoint: GridPoint;
  readonly targetInsideGridPoint: GridPoint;
}

// =========================================================================
// 求解图有向边（对应《仿真运行原理》§5.2 边来源）
//
// 每条 transferEdge 连接两个 CacheGroup（求解图节点）。
// acceptRule = sourcePort.acceptRule AND targetPort.acceptRule（§5.2 规则 4）
// count = min(sourcePort.count, targetPort.count)（§5.2 规则 5）
// =========================================================================

export interface CompiledSimulationTransferEdge {
  readonly id: string;
  /** 对应的物理连接 ID */
  readonly physicalConnectionId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  /** 源缓存组（求解图节点的 source 端） */
  readonly sourceCacheGroupId: string;
  /** 目标缓存组（求解图节点的 target 端） */
  readonly targetCacheGroupId: string;
  readonly acceptRule: SimulationAcceptRule;
  readonly count: SimulationCountLimit;
}

// =========================================================================
// 缓存链接（对应《仿真运行原理》§3.3）
//
// endpointSlotIds 是链接端点解析后的具体槽位 ID 列表（多对多）。
// shareLimit 仅在 share-cap 时有效。
// =========================================================================

export interface CompiledSimulationCacheLink {
  readonly id: string;
  readonly linkType: SimulationLinkType;
  /** 链接端点的槽位 ID 列表 */
  readonly endpointSlotIds: readonly string[];
  readonly shareLimit: number | null;
}

// =========================================================================
// 配方计划（对应《仿真运行原理》§3.2 配方类型）
//
// 包含 recipeType、耗时、输入输出物品列表、以及 item 去向/来源缓存组。
// ingredientCacheGroupIds 告知求解器原料从哪些缓存组取。
// productCacheGroupIds 告知求解器产物写入哪些缓存组。
// =========================================================================

export interface CompiledSimulationRecipePlan {
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  /** 配方耗时（tick 数，从 durationSeconds 转换） */
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  /** 原料缓存组 ID 列表（ingredient + universal 类型） */
  readonly ingredientCacheGroupIds: readonly string[];
  /** 产物缓存组 ID 列表（product + universal 类型） */
  readonly productCacheGroupIds: readonly string[];
}

export interface CompiledSimulationRecipeItem {
  /** 物品 ID，"any"=任意，"same-as-input"=与输入相同（搬运配方用） */
  readonly itemId: string | "any" | "same-as-input";
  readonly amount: number;
}

// =========================================================================
// 路由配置（用于分流器/汇流器多端口调度）
// =========================================================================

export interface CompiledSimulationRoutingEntry {
  /** 优先级分组（低优先级的端口在高优先级端口被阻塞时才使用） */
  readonly priorityGroup: number;
  /** 轮询种子（同一 priorityGroup 内 round-robin 调度） */
  readonly roundRobinSeed: number;
}

// =========================================================================
// 编译诊断
// =========================================================================

export interface SimulationCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
  readonly definitionId?: string;
}

// =========================================================================
// 运行时状态（Worker 端返回给主线程的状态快照）
// =========================================================================

export interface SimulationRuntimeStatus {
  readonly mode: SimulationWorkerStatusMode;
  readonly topologyId: string | null;
  readonly documentHash: string | null;
  readonly retainedFromTick: number | null;
  readonly latestTickNumber: number | null;
  readonly bufferSize: number;
  readonly maxBufferSize: number;
  readonly error: string | null;
}

export interface SimulationStartResult {
  readonly status: "started" | "failed";
  readonly topologyId: string | null;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
  readonly error?: string;
}

export type GetSimulationTickSnapshotResult =
  | {
      readonly status: "ready";
      readonly snapshot: SimulationTickSnapshot;
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

export interface SimulationTickSnapshot {
  readonly schemaVersion: 1;
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  readonly status: "initial" | "running" | "paused" | "stopped";
  readonly slots: Record<string, SimulationSlotRuntimeSnapshot>;
  readonly devices: Record<string, SimulationDeviceRuntimeSnapshot>;
  readonly nodes: Record<string, SimulationNodeSolveSnapshot>;
  readonly transfers: readonly SimulationTickTransferSnapshot[];
  readonly routingCursors: Record<string, number>;
  readonly warehouse: Record<string, number>;
  readonly diagnostics: readonly SimulationTickDiagnostic[];
}

export interface SimulationSlotRuntimeSnapshot {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: readonly SimulationReservedItemSnapshot[];
}

export interface SimulationReservedItemSnapshot {
  readonly recipeRunId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface SimulationDeviceRuntimeSnapshot {
  readonly deviceId: string;
  readonly block: boolean;
  readonly recipe: SimulationDeviceRecipeRuntimeSnapshot | null;
}

export interface SimulationDeviceRecipeRuntimeSnapshot {
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly progressTicks: number;
  readonly durationTicks: number;
  readonly state: "running" | "waiting-output" | "idle";
}

export interface SimulationNodeSolveSnapshot {
  readonly cacheGroupId: string;
  readonly result: "uncertain" | "solved-run" | "solved-block";
  readonly acceptedInputEdgeIds: readonly string[];
  readonly acceptedOutputEdgeIds: readonly string[];
  readonly blockReason?: string;
}

export interface SimulationTickTransferSnapshot {
  readonly edgeId: string;
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface SimulationTickDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}
