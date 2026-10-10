/**
 * 多设备 EDA 的通讯协议契约。
 *
 * 【状态】预留接口，尚未接入任何实现：本文件只定义信封语义与可行性边界，
 * 由后续实现层（Planner / App）提供编解码与传输。放在 Domain 是因为它描述的是
 * 「协调者 ↔ 计算节点」这一跨模块契约，而不是某个模块的内部细节。
 *
 * 【为什么是 Domain 却持有不透明载荷】
 * Domain 不得依赖 Planner 实现层，而续搜种子、候选蓝图、搜索统计都是 Planner 内部类型。
 * 因此这里只表达协议能跨模块表达的部分（请求、变体、面积上界、盒子、预算），
 * 其余一律封装为 `Uint8Array` 载荷，由 Planner 侧负责编解码。
 *
 * 【千兆局域网可行性（为何采用“粗粒度工作单元 + 节点主动领取”）】
 *   · 带宽：千兆以太网理论 1 Gbps ≈ 125 MB/s，实测可用约 100~110 MB/s。
 *     一次工作单元的载荷量级为：请求（plan + options，约 1~10 KB）
 *     + 种子载荷（network.nodes + wires + poses，约 10~200 KB）
 *     + 结果候选（蓝图实体 + 度量 + 统计，约 20~500 KB），合计通常 < 1 MB。
 *     按 100 MB/s 计，千兆网每秒可搬运约 100~500 个这样的单元，而单个单元的实际计算
 *     需要数秒到数十秒（一次搜索批次是数千到数十万次提案）。**带宽不是瓶颈，差距在三个数量级。**
 *   · 延迟：同一交换机下 RTT 通常 0.1~1 ms。若按“每个提案同步一次”设计，即使 1 ms RTT
 *     也只能支撑 1000 次同步/秒，而单机提案速率可达 10^4~10^5/秒 —— **这才是真正的瓶颈**。
 *     所以协议刻意让 `proposalBudget` 以“批次”为单位，把同步次数降到分钟级。
 *   · 负载均衡：单元耗时方差极大（不同种子与盒子的可行性差异），因此采用
 *     **节点主动领取（pull）** 而非协调者推送（push）：快的节点自然多领，无需估计耗时。
 *   · 容错：单元必须可重放（同一 unitId 重发得到同一结果，因为 variant 与种子决定随机序列），
 *     节点掉线后协调者只需回收其未完成单元。协议因此不要求可靠有序传输，只要求幂等。
 *
 * 【不属于本协议的部分】
 *   身份认证与加密：按项目既有的保密发布约定，Alpha/内网环境信任局域网边界，
 *   本协议不引入登录、令牌或 IP 允许列表；如未来需要，应在传输层（而非此信封）解决。
 */

import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "./blueprint-planner-types";

/** 协议版本；不兼容变更必须递增，节点与协调者版本不一致时应拒绝注册而不是降级。 */
export const PLANNER_DISTRIBUTED_PROTOCOL_VERSION = 1;

/**
 * 单个工作单元的载荷上限（字节）。
 * 超过该值应拆小单元或启用压缩，而不是让单次传输长时间占用链路；
 * 依据见文件头的带宽估算（千兆网下 1 MB 约 10 ms，已远超可接受的分发延迟）。
 */
export const PLANNER_LAN_UNIT_PAYLOAD_LIMIT_BYTES = 1024 * 1024;

/** 心跳间隔与失联判定；节点超过 3 个周期未心跳即视为掉线并回收其在途单元。 */
export const PLANNER_NODE_HEARTBEAT_INTERVAL_MS = 5_000;
export const PLANNER_NODE_MISSED_HEARTBEATS = 3;

/** 计算节点的身份与容量。容量是节点自己声明的，协调者不假设各机器同构。 */
export interface PlannerNodeDescriptor {
  readonly nodeId: string;
  /** 展示用标签，仅用于界面区分节点，不参与调度决策。 */
  readonly label: string;
  /** 该节点可并行运行的搜索通道数；应由本机容量标定给出，而不是核数公式。 */
  readonly workerCapacity: number;
  /** 是否具备可用于布线的 WebGPU；缺省按无 GPU 处理。 */
  readonly hasGpu: boolean;
  /** 该节点的 GPU 布线交叉规模（本机标定结果）；缺省表示未标定。 */
  readonly gpuCrossoverCells?: number;
}

export interface PlannerNodeRegistration {
  readonly type: "register";
  readonly protocolVersion: number;
  readonly descriptor: PlannerNodeDescriptor;
}

/** 心跳同时上报在途与已完成单元数，供协调者判断节点是否真的在工作。 */
export interface PlannerNodeHeartbeat {
  readonly type: "heartbeat";
  readonly nodeId: string;
  readonly activeUnits: number;
  readonly completedUnits: number;
  readonly failedUnits: number;
  readonly at: number;
}

/**
 * 一个工作单元 = 一次搜索批次。
 *
 * 刻意不包含“单次提案”的粒度：见文件头，逐提案同步会立刻撞上 RTT 上限。
 */
export interface PlannerWorkUnit {
  readonly unitId: string;
  /** 生产方案与选项；节点据此独立重建网络，不依赖协调者的内存状态。 */
  readonly request: BlueprintPlannerRequest;
  /** 搜索变体号；它决定初始盒子形状与随机序列，因此同一 unitId 重放结果可复现。 */
  readonly variant: number;
  /**
   * 本单元的面积上界。来自用户界面指定的 areaLimit、算法自身的收缩上限，
   * 或基地可放置面积，三者已由协调者取过最小值，节点不再二次放宽。
   *
   * 订正 2026-10-07（PR #34 评审）：来源之一「用户界面指定的 areaLimit」已不存在——
   * 面积上界不再暴露给用户，未指定时由 Host 取「设备面积 × 2」。其余来源与取最小值的规则不变。
   */
  readonly maximumArea?: number;
  /** 调度器指定的盒子；与 maximumArea 的“上限”语义分开（显式尺寸优先）。 */
  readonly targetOutline?: { readonly width: number; readonly height: number };
  /** 本单元的提案预算；这是控制同步频率的唯一旋钮。 */
  readonly proposalBudget: number;
  /**
   * 续搜种子（`PlannerSearchSeed`）与起点等实现层细节的序列化形式。
   * 缺省表示冷启动，节点按 request 自行构造初始布局。
   */
  readonly seedPayload?: Uint8Array;
}

/** 单元结果：成功携带候选载荷，失败携带可分类的拒绝原因。 */
export type PlannerWorkUnitResult =
  | {
    readonly type: "completed";
    readonly unitId: string;
    readonly nodeId: string;
    /** `PlannerCandidate` 的序列化形式（蓝图 + 度量 + 搜索统计）。 */
    readonly candidatePayload: Uint8Array;
    /** 真实核算时长，供协调者估计剩余预算；不接受节点上报的“预算”本身。 */
    readonly elapsedMs: number;
    readonly evaluations: number;
  }
  | {
    readonly type: "failed";
    readonly unitId: string;
    readonly nodeId: string;
    /** 拒绝发生在哪一关；与 PlannerSearchDiagnostics 的 rejectionCounts 对应。 */
    readonly kind: "candidate" | "routing" | "power" | "supply" | "circulation" | "timeout" | "cancelled" | "fatal";
    readonly message: string;
    readonly evaluations: number;
  };

/** 协调者 → 节点。 */
export type PlannerCoordinatorMessage =
  | { readonly type: "registered"; readonly heartbeatIntervalMs: number }
  | { readonly type: "assign"; readonly unit: PlannerWorkUnit }
  /** 取消单个在途单元；节点应停在最近的检查点并回传 cancelled。 */
  | { readonly type: "cancel"; readonly unitId: string }
  /** 停止接受新单元，跑完在途后退出。 */
  | { readonly type: "drain" }
  | { readonly type: "shutdown" };

/** 节点 → 协调者。 */
export type PlannerWorkerNodeMessage =
  | PlannerNodeRegistration
  | PlannerNodeHeartbeat
  | { readonly type: "result"; readonly result: PlannerWorkUnitResult }
  /** 进度仅用于展示；它不是调度依据，协调者不得据此估算剩余时间。 */
  | { readonly type: "progress"; readonly unitId: string; readonly phase: BlueprintPlannerPhase }
  | { readonly type: "request-unit"; readonly nodeId: string; readonly freeSlots: number };

/**
 * 编解码契约：由 Planner 实现层提供，Domain 只声明形状。
 * 实现方必须保证 `decode(encode(value))` 与原值在搜索语义上等价（可复现同一随机序列）。
 */
export interface PlannerPayloadCodec<TPayload> {
  encode(value: TPayload): Uint8Array;
  decode(payload: Uint8Array): TPayload;
}
