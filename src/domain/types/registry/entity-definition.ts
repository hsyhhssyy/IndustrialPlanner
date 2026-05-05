import type { GridEdge, GridRectSize } from "../grid";
import type {
  SimulationCountLimit,
  SimulationLinkType,
  SimulationRecipeType,
  SimulationSubmitMode,
} from "../simulation";
import type { EntityInspectorDeclaration } from "./entity-inspector";

// ---------------------------------------------------------------------------
// UI 分组 — 决定设备在放置面板中属于哪个折叠组
// ---------------------------------------------------------------------------

export type UiGroup =
  | "beltLogistics"           // 传送带物流
  | "pipeLogistics"           // 管道物流
  | "resourcePower"           // 资源与电力
  | "warehouse"               // 仓库存取
  | "basicProduction"         // 基础生产
  | "advancedManufacturing"   // 合成制造
  | "hidden";                 // 隐藏设备（不在面板中显示，由绘制工具生成）

// =========================================================================
// EntityDefinition — 实体定义（对应设计文档《模拟器抽象方式》§2 Entity 定义层）
//
// 每个设备类型对应一个 EntityDefinition。它是所有属性的「默认值持有者」。
// 用户通过 entity.config（稀疏 JSON）覆盖其中字段，编译时由 Topology
// Compiler 执行 deepMerge(definitionDefaults, entityConfig) 得到最终值。
//
// 字段按设计文档的三大原语组织：
//   1. 缓存 (storageSlotGroups + portStorageBindings) → 对应 §3.1 缓存类型
//   2. 配方 (recipe)                                → 对应 §3.2 配方类型
//   3. 链接 (cacheLinks)                             → 对应 §3.3 缓存链接
//
// 求解图节点来源：每个存储槽组 (storageSlotGroup) 在编译时生成一个
// CacheGroup，每个 CacheGroup = 一个求解图节点（见《仿真运行原理》§5.1）。
// =========================================================================

export interface EntityDefinition {
  /** 设备定义唯一标识，如 "belt_straight_1x1" */
  id: string;
  /** i18n key，前端通过此 key 获取本地化设备名称 */
  nameKey: string;
  /** 精灵图 ID，渲染器据此查找设备纹理 */
  spriteId: string;
  /** 设备占地尺寸（宽度 × 高度，单位：格子），基于 rotation=0 */
  footprint: GridRectSize;
  /** 放置面板分组 */
  uiGroup: UiGroup;
  /** 语义标签，如 "BeltFamily"（传送带族）、"武陵"（场景限定） */
  tags: string[];

  // ---- 电力 ----
  /**
   * 是否需要电力才能运行。
   * 注意：即使 requiresPower=false，设备在电网中仍会消耗 powerDemand。
   * 区别在于 requiresPower=false 的设备可以在电网外运行。
   */
  requiresPower: boolean;
  /** 在电网中每 tick 消耗的电量 */
  powerDemand: number;

  // ---- 三大原语 ----

  /**
   * 配方配置（对应《仿真运行原理》§3.2 配方类型）。
   * null = 设备无配方（如纯仓储/纯物流设备可在定义层为 null）。
   * recipeType 取值：
   *   - "immediate-consume"：进度 0% 时立即扣除原料（生产设备用）
   *   - "reserved-item"：进度 100% 时消耗原料，占用存储（搬运设备用）
    * 订正（2026-05-05）：`reserved-item` 在推进阶段若输出缓存可接收，则立即写入产物、消耗原料并结束当前 run；仅在推进阶段无法完整输出时，才留待二次结算阶段处理。
   */
  recipe: EntityRecipeDefinition | null;

  /**
  * 缓存链接（对应《仿真运行原理》§3.3）。
  * 有向代理：source 端点的读写实际作用于 target 端点。
   */
  cacheLinks: CacheLinkDefinition[];

  /**
   * Inspector 面板声明（对应《模拟器抽象方式》§4 Inspector 层）。
   * Inspector 不持有数据，只声明"用哪个面板类型编辑哪个路径"。
   * 前端遍历此数组，按 type 挂载对应面板组件。
   */
  inspectors: EntityInspectorDeclaration[];

  // ---- 端口与存储槽组 ----

  /**
   * 端口组（对应《仿真运行原理》§3.1 缓存类型中 Port 与 Cache 的关系）。
   * 每个端口有 acceptRule（允许的物品类型）和 count（每 tick 通过上限），
   * 见《仿真运行原理》§3.1 表格。
   */
  portGroups: PortGroupDefinition[];

  /**
   * 存储槽组（对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组）。
   * role 决定该存储组的缓存类型：
   *   - "input"  → ingredient（连输入端口的缓存）
   *   - "output" → product（连输出端口的缓存）
   *   - "bidirectional" → universal（同时连输入输出）
   * 每个存储槽组编译为一个求解图节点（CacheGroup）。
   * 组内 slot 互斥（同物品不能出现在组内多个槽），跨组不互斥（见 §3.4）。
   */
  storageSlotGroups: StorageSlotGroupDefinition[];

  /**
   * 端口-存储绑定（对应《仿真运行原理》§5.1）。
   * 将 portGroup 与 storageSlotGroup 关联，决定物品从哪个端口流入哪个缓存组。
   * 无显式绑定时，编译器自动生成 synthetic-input/synthetic-output 缓存组。
   */
  portStorageBindings: PortStorageBindingDefinition[];
}

// ---------------------------------------------------------------------------
// 物品过滤器 — 决定槽位/端口可容纳的物品类型
// ---------------------------------------------------------------------------

export interface ItemFilterDefinition {
  /** 过滤模式 */
  itemFilter: "type" | "tag-whitelist" | "whitelist" | "blacklist";
  /** 白名单/黑名单物品 ID 列表 */
  itemFilterIds?: string[];
  /** 按域过滤：solid（固体）、liquid（液体）、any（任意） */
  itemFilterType?: "solid" | "liquid" | "any";
  /** 按标签过滤 */
  itemFilterTag?: string[];
}

// ---------------------------------------------------------------------------
// 端口组与端口（对应《仿真运行原理》§3.1 中的 Port 概念）
// ---------------------------------------------------------------------------

interface PortGroupDefinition {
  /** 端口组 ID，如 "item_input"、"fluid_output" */
  id: string;
  /** 物品域：item（固体物品）/ fluid（液体） */
  kind: "item" | "fluid";
  /**
   * 端口组方向：
   *   - "input"：接收方向，物品流入设备
   *   - "output"：发送方向，物品流出设备
   *   - "bidirectional"：双向，编译时自动分解为 input + output 两个方向
   */
  direction: "input" | "output" | "bidirectional";
  ports: PortDefinition[];
}

// ---------------------------------------------------------------------------
// 存储槽组（对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组）
//
// 存储槽组 = 设备内部的一个缓存区域，编译后对应一个 CacheGroup（求解图节点）。
// role 字段决定缓存类型（ingredient / product / universal）。
// ---------------------------------------------------------------------------

interface StorageSlotGroupDefinition {
  id: string;
  /** 物品域：item / fluid */
  kind: "item" | "fluid";
  /**
   * 存储角色 → 缓存类型映射：
   *   "input"         → ingredient（链接到输入端口的缓存，接收物品、作配方原料）
   *   "output"        → product（链接到输出端口的缓存，存放配方产物）
   *   "bidirectional" → universal（同时链接输入和输出，如反应池共享槽位）
   */
  role: "input" | "output" | "bidirectional";
  /**
   * 槽位列表。
   * 关键规则（《仿真运行原理》§3.4）：
   *   - 组内互斥：同一组内不同槽不可容纳相同物品
   *   - 跨组不互斥：不同组之间可以容纳相同物品
   * 每个存储槽组编译为一个求解图节点。
   */
  slots: StorageSlotDefinition[];
}

/**
 * 存储槽位定义。
 * 对应《仿真运行原理》§5.3 节点能力中的 entry：
 *   - ordered-port-input-capacities 的 entry 是 (slot, accept-rule, amount) 三元组
 *   - ordered-port-output-supplies 的 entry 是 (slot, item, amount) 三元组
 */
interface StorageSlotDefinition extends ItemFilterDefinition {
  id: string;
  /** 槽位最大容量 */
  capacity: number;
  /** 锁定物品 ID，null = 不锁定。对应 entity.config 中的 "slots[N].lock" */
  lock: string | null;
  /** 初始物品类型（创建时预填充的物品） */
  initialItemType: string | null;
  /** 初始物品数量 */
  initialCount: number;
  /**
   * 忽略库存检查。
   * true 时该槽位不受仓库库存限制（取货口/出货口常用）。
   * 对应 entity.config 中的 "slots[N].ignoreStock"
   */
  ignoreStock: boolean;
  /** 提交模式：never（不自动提交）/ every-tick（每 tick）/ every-n-seconds（定时） */
  submitMode: SimulationSubmitMode;
  /** 当 submitMode="every-n-seconds" 时的间隔秒数 */
  submitIntervalSeconds: number | null;
}

// ---------------------------------------------------------------------------
// 端口-存储绑定
// ---------------------------------------------------------------------------

interface PortStorageBindingDefinition {
  id: string;
  /** 绑定的端口组 ID */
  portGroupId: string;
  /** 绑定的存储槽组 ID */
  storageSlotGroupId: string;
}

// ---------------------------------------------------------------------------
// 端口定义（对应《仿真运行原理》§3.1 中 port 的两个通用配置）
// ---------------------------------------------------------------------------

interface PortDefinition {
  id: string;
  /** 设备内局部坐标 x（基于 rotation=0 的 footprint） */
  localCellX: number;
  /** 设备内局部坐标 y */
  localCellY: number;
  /**
   * 端口朝向（相对于 rotation=0 时的设备）。
   * 编译时根据实体实际旋转角做旋转变换。
   * Port 的 edge 描述的是边的方向——物品从 output port 流出、经边流入 input port。
   * 这与 Cache 的 ingredient/product 正交（见《仿真运行原理》§3.1 关键区分）。
   */
  edge: GridEdge;
  /**
   * 物品接收规则（对应《仿真运行原理》§3.1 表格中 port 的 acceptRule）。
   * base 取值：any（任意）/ solid（固体）/ liquid（液体）/ item:itemId（指定物品）
   * exclude 为排除列表。
   * 编译时 sourcePort.acceptRule AND targetPort.acceptRule 合并为边的 acceptRule（§5.2）。
   */
  acceptRule: EntityAcceptRuleDefinition;
  /**
   * 端口每 tick 允许通过的物品数量上限（对应《仿真运行原理》§3.1 表格中的 count）。
   * "unlimited" = 无上限，数字 = 上限值。
   * 编译时边的 count = min(sourcePort.count, targetPort.count)（§5.2）。
   */
  count: SimulationCountLimit;
  /** 优先级分组（用于分流器调度，对应《仿真运行原理》中 routing 概念） */
  priorityGroup: number;
  /** 轮询种子（同一 priorityGroup 内用于 round-robin 调度） */
  roundRobinSeed: number;
}

// ---------------------------------------------------------------------------
// 物品接收规则详情
// ---------------------------------------------------------------------------

export interface EntityAcceptRuleDefinition {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "item"; readonly itemId: string };
  readonly exclude: readonly string[];
}

// ---------------------------------------------------------------------------
// 配方定义（对应《仿真运行原理》§3.2 配方类型）
//
// 两种配方类型：
//   - "immediate-consume"：进度=0% 时立即扣除原料，不占用存储（生产设备）
//   - "reserved-item"：进度=100% 时消耗原料，占用存储（搬运设备如传送带）
// 订正（2026-05-05）：`reserved-item` 在推进阶段若输出缓存可接收，则立即写入产物、消耗原料并结束当前 run；仅在推进阶段无法完整输出时，才留待二次结算阶段处理。
//
// 在 EntityDefinition 层，配方可以是：
//   - null：无配方（纯仓储/物流设备）
//   - recipeId=null 但有 inputs/outputs：使用定义内联配方（传送带的搬运配方）
//   - recipeId 指向 RECIPE_DEFINITIONS 中的外部配方
// ---------------------------------------------------------------------------

export interface EntityRecipeDefinition {
  /** 外部配方 ID，null 表示使用内联 inputs/outputs */
  readonly recipeId: string | null;
  /** 配方类型 */
  readonly recipeType: SimulationRecipeType;
  /** 配方耗时（秒），编译时转换为 ticks */
  readonly durationSeconds: number;
  readonly inputs: readonly EntityRecipeItemDefinition[];
  readonly outputs: readonly EntityRecipeItemDefinition[];
}

/**
 * 配方物品条目。
 * itemId 特殊值：
 *   - "any"：任意物品（传送带搬运配方用）
 *   - "same-as-input"：与输入相同（传送带搬运配方输出用）
 */
export interface EntityRecipeItemDefinition {
  readonly itemId: string | "any" | "same-as-input";
  readonly amount: number;
}

// ---------------------------------------------------------------------------
// 缓存链接（对应《仿真运行原理》§3.3）。
// Link 是有向代理，source 端点自身不保存真实库存。
// 订正（2026-05-05）：`share-cap` 仅共享容量，不代理 source 的真实库存。
// ---------------------------------------------------------------------------

export interface CacheLinkDefinition {
  readonly id: string;
  readonly linkType: SimulationLinkType;
  readonly source: CacheLinkEndpointDefinition;
  readonly target: CacheLinkEndpointDefinition;
}

export interface CacheLinkEndpointDefinition {
  /** 端点绑定的存储槽组 ID */
  readonly storageSlotGroupId: string;
  /** 可选：精确到具体槽位 ID */
  readonly slotId?: string;
}
