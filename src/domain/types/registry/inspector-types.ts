// ============================================================================
// Inspector 类型定义 — 每个 Inspector 管理一类正交的设备功能
//
// 本文档源自仿真运行原理（.docs/common/仿真运行原理.md）的派生抽象。
// 将文档中所有可配置点按正交性拆分为 7 个通用 Inspector，
// 每个设备在 Registry 中声明自己需要的 Inspector 子集。
//
// 文档对应关系详见每个字段的 @doc 注释。
//
// mutable 语义：
//   领域级（设备类型级）约束。mutable = true 表示该设备类型允许用户在
//   Editor 中修改此字段；mutable = false 表示该字段由系统/配方固定，只读展示。
//
// 文件结构：
//   1. 通用 FieldDef 包装
//   2. 7 个 Inspector 的类型定义（各含 @doc 文档对照）
//   3. Inspector 标识枚举
//   4. DeviceInspectorDeclarations 聚合接口
//
// 设备 → Inspector 映射概览：
//
//   设备              PortFilter RecipeConfig SlotConfig LinkConfig     Routing Structure Behavior
//   ───────────────── ───────── ──────────── ───────── ────────────── ─────── ───────── ────────
//   传送带 (直/弯)     ✅        ✅           —        ✅ share-cap   —       —         —
//   管道 (直/弯)       ✅        ✅           —        ✅ share-cap   —       —         —
//   分流器 / 汇流器    ✅        —            —        —              ✅      —         —
//   桥接器 / 连接器    ✅        ✅           —        —              —       —         —
//   准入口             ✅        —            —        —              —       —         —
//   反应池             ✅        ✅           —        —              ✅      ✅        —
//   普通生产设备       ✅        ✅           —        —              —       —         —
//   协议存储箱         —        —            ✅       —              —       —         —
//   仓库取货口         ✅        —            ✅       ✅ share-all   —       —         ✅
//   仓库存货口         ✅        —            ✅       —              —       —         —
//   抽水泵             ✅        —            ✅       —              —       —         —
//   已链接暗管进出口   ✅        —            ✅       ✅ share-all   —       —         —
//   协议核心(编辑态)   ✅        —            —        ✅ share-all   —       —         —
//   仓库(全局隐藏)     —        —            ✅       —              —       —         —
//   供电桩 / 存取线    —        —            —        —              —       —         —
// ============================================================================

// ---------------------------------------------------------------------------
// 通用字段定义包装
// ---------------------------------------------------------------------------

/**
 * 包装一个可配置字段，携带领域级的 mutable 开关和默认值。
 *
 * @doc 对应文档 §3 核心原语中每个设备可配置点的领域级约束。
 *      某类设备一旦在 Registry 中声明某字段 mutable = false，
 *      则该类型的所有实例对此字段只读。
 *
 * @param mutable - 此设备类型是否允许用户修改此字段
 * @param default - 实例创建时的默认值
 */
export interface FieldDef<T> {
  readonly mutable: boolean;
  readonly default: T;
}

// ---------------------------------------------------------------------------
// 引用类型
// ---------------------------------------------------------------------------

/** @doc 对应文档 §7.1 槽位属性表中的 itemType 字段 */
export type ItemId = string;

/** @doc 对应文档 §3.2 配方类型中引用的配方标识 */
export type RecipeId = string;

/**
 * 端口引用，格式 `"portGroupId.portId"`。
 * @doc 对应文档 §5.2 边的生成中 sourcePort / targetPort 的标识。
 *      一个 Port 可能是 input（接收）或 output（发送）方向。
 */
export type PortRef = string;

/**
 * 缓存引用，格式 `"entityId.cacheGroupId"`。
 * @doc 对应文档 §3.1 缓存类型中的 Cache 标识。
 *      一个 Cache 可能是 ingredient / product / universal 之一。
 */
export type CacheRef = string;

// ============================================================================
// 1. Port Filter Inspector（端口过滤器）
// ============================================================================
//
// @doc 对应文档 §3.1 每个 port 携带两个通用配置：
//      acceptRule { base, exclude } 控制端口允许通过的物品类型；
//      count 控制端口每 tick 允许通过的数量上限。
//
//      这些配置在 §5.2 建图时合并到边的 acceptRule / count 中，
//      求解阶段（§10.2、§10.3）仅查边属性，无需回查 port。
//
//      典型应用：
//      - 准入口（§5.1.5、§14.1）：acceptRule = itemId(X)，count = N
//      - 反应池输出（§14.2）：各输出端口 acceptRule 限定液体/固体类型
//      - 普通端口：acceptRule = any，count = unlimited
//
// 粒度：每个 Port 一份。
// 适用设备：传送带、管道、分流器、汇流器、桥接器、准入口、反应池、
//           仓库取货口、仓库存货口、抽水泵、已链接暗管、协议核心
// ----------------------------------------------------------------------------

export interface PortFilterAcceptRuleDef {
  /**
   * 基础物品类型。
   *
   * @doc 对应文档 §3.1 表格中的 acceptRule.base 字段。
   *      - 'any': 接受全部（§7.1 空槽且无锁时 entry.accept-rule.base = any）
   *      - 'solid': 仅固体（仓库取货口限固体，§14.6.2）
   *      - 'liquid': 仅液体（未链接暗管出口限液体，§14.6.2）
   *      - ItemId: 仅指定物品（准入口预设 itemId(X)，§5.1.5）
   *
   *      建图时此值与对端 port 的 acceptRule 做 AND 合并（§5.2.4）：
   *      base 取最严格交集，exclude 取并集。
   */
  base: FieldDef<'any' | 'solid' | 'liquid' | ItemId>;

  /**
   * 排除物品列表。
   *
   * @doc 对应文档 §3.1 中 acceptRule.exclude 字段。
   *      建图时取两端 port exclude 的并集（§5.2.4）。
   *      求解阶段入口选择时（§10.2.d）按 base + exclude 匹配 entry，
   *      若物品在 exclude 中则跳过该 entry。
   */
  exclude: FieldDef<ItemId[]>;
}

export interface PortFilterInspectorDef {
  /**
   * 领域级开关：此设备类型的 Port Filter 面板整体是否允许用户编辑。
   * 部分设备端口配置由系统固定（如仓库取货口的 port 约束不可变），
   * 此时此字段为 false。
   */
  mutable: boolean;

  /**
   * 端口通过规则。
   * @doc 对应文档 §3.1 中每个 port 的 acceptRule 配置，
   *      控制该端口允许接受哪些物品类型。
   */
  acceptRule: PortFilterAcceptRuleDef;

  /**
   * 每 tick 通过数量上限。
   *
   * @doc 对应文档 §3.1 中 port.count 配置，以及 §5.2.5 建图合并规则：
   *      边的 count = min(sourcePort.count, targetPort.count)。
   *      - 'unlimited': 不限数量（大多数端口默认值）
   *      - number: 如准入口 count = N（§5.1.5）
   *      在求解阶段出口选择（§10.3.2）时检查 edge.count 剩余。
   */
  count: FieldDef<number | 'unlimited'>;
}

// ============================================================================
// 2. Recipe Config Inspector（配方配置）
// ============================================================================
//
// @doc 对应文档 §3.2 配方类型和 §6 推进阶段中配方相关的所有配置。
//      每种设备可运行一个配方，配方定义其输入、输出、消耗类型和推进时长。
//
//      - immediate-consume（§6.1.2-3）：进度 0% 立即扣除原料，
//        进度 100% 写入产物；若产物空间不够则保持 100%。
//      - reserved-item（§6.1.4、§7.2）：进度期间锁定原料（预定），
//        进度 100% 时在二次结算阶段（§12.1）消耗原料、产生产物。
//        主要用于搬运类设备（传送带、管道）。
//
//      二次结算（§12.1）：进度 100% 的设备在此阶段尝试卸载产物、
//      消耗原料，并自动启动下一个配方。
//
// 粒度：每个 Device 一份。
// 适用设备：传送带、管道、桥接器、反应池、普通生产设备
// ----------------------------------------------------------------------------

export interface RecipeConfigInspectorDef {
  /** 领域级开关：此设备类型的 Recipe Config 面板整体是否允许用户编辑 */
  mutable: boolean;

  /**
   * 当前选中的配方 ID，null 表示未选择。
   *
   * @doc 对应文档 §3.2 配方类型中设备当前运行的配方。
   *      Registry 中配方由 RecipeDefinition 定义（recipe-definition.ts），
   *      包含 inputs[]、outputs[]、durationSeconds、machineId。
   *      用户在编辑器中从此设备的可用配方列表中选择。
   */
  recipeId: FieldDef<RecipeId | null>;

  /**
   * 配方消耗类型。
   *
   * @doc 对应文档 §3.2 表格：
   *      - 'immediate-consume'：进度 = 0% 时立即扣除原料，不占用存储。
   *        普通生产设备使用此类型。
   *      - 'reserved-item'：进度 = 100% 时消耗原料，占用存储，
   *        预定部分不可被他人使用（§7.2）。传送带、管道使用此类型。
   *      通常由配方定义决定，mutable 默认 false（用户不可改）。
   */
  recipeType: FieldDef<'immediate-consume' | 'reserved-item'>;

  /**
   * 配方进度时长（tick 数）。
   *
   * @doc 对应文档 §6.1 推进阶段中设备进度的推进速率。
   *      通常由 RecipeDefinition.durationSeconds 转换而来，
   *      mutable 默认 false（由配方数据决定，用户不可改）。
   */
  duration: FieldDef<number>;
}

// ============================================================================
// 3. Slot Config Inspector（槽位配置）
// ============================================================================
//
// @doc 对应文档 §7.1 槽位属性表中的持久属性，以及 §11.1 移动物品阶段的提交行为。
//      每个槽位都携带 capacity、count、itemType、lock 四个持久属性，
//      以及提交模式（不提交 / 每次提交 / 每 N 秒）。
//
//      槽位属性参与求解图初始化（§7.1）：
//      - lock = X 时，空槽 entry.accept-rule = itemId(X)
//      - lock = null 时，空槽 entry.accept-rule = any
//      - capacity 决定 entry.amount
//
//      提交模式在移动物品阶段（§11.1.3-4）影响结算：
//      - 'never'：物品留在缓存，不自动提交
//      - 'every-tick'：收到物品立刻提交到仓库（仓库存货口，§14.7）
//      - 'every-n-seconds'：按间隔提交（协议存储箱可选，§14.3）
//
// 粒度：每个 Slot 一份。
// 适用设备：协议存储箱、仓库取货口、仓库存货口、抽水泵、已链接暗管
// ----------------------------------------------------------------------------

export type SubmitMode = 'never' | 'every-tick' | 'every-n-seconds';

export interface SlotConfigInspectorDef {
  /** 领域级开关：此设备类型的 Slot Config 面板整体是否允许用户编辑 */
  mutable: boolean;

  /**
   * 持久物品锁定。
   *
   * @doc 对应文档 §7.1 槽位属性表中的 lock 字段。
   *      null 表示自由槽位，可接受任意物品。
   *      非 null 表示该槽位被持久锁定为指定物品类型：
   *      - 仓库槽位 lock = 系统物品类型（§7.6、§14.8），由系统预设，mutable = false
   *      - 协议存储箱可设置固定物品槽位（§14.3）
   *      - 空槽且 lock = X 时，entry.accept-rule.base = itemId(X)（§7.1）
   */
  lock: FieldDef<ItemId | null>;

  /**
   * 槽位容量上限。
   *
   * @doc 对应文档 §7.1 槽位属性表中的 capacity 字段。
   *      决定该槽位最多能存放多少个单位物品。
   *      - 传送带槽位 capacity = 1（§3.4 表格）
   *      - 反应池槽位 capacity = 50（可配置）
   *      - 容量满时（count = capacity），不生成 portInputCapacities entry（§7.1）
   */
  capacity: FieldDef<number>;

  /**
   * 槽位初始物品数量。
   *
   * @doc 对应文档 §7.1 中槽位的 count 初始值。
   *      编辑态有效，运行态从此值开始。
   *      仓库各物品初始库存由此设置（§7.6、§14.8）。
   */
  initialCount: FieldDef<number>;

  /**
   * 提交模式。
   *
   * @doc 对应文档 §11.1 移动物品阶段中提交到仓库的行为：
   *      - 'never': 不自动提交。物品留在设备缓存中（协议存储箱默认，§14.3）
   *      - 'every-tick': 每 tick 写入后立即提交（仓库存货口强制，§14.7）
   *      - 'every-n-seconds': 按 submitInterval 间隔提交（协议存储箱可选，§14.3）
   */
  submitMode: FieldDef<SubmitMode>;

  /**
   * 提交间隔秒数，仅当 submitMode = 'every-n-seconds' 时有效。
   * @doc 对应文档 §14.3 中协议存储箱的可选提交间隔（每10秒）。
   */
  submitInterval: FieldDef<number>;
}

// ============================================================================
// 4. Link Config Inspector（链接配置）
// ============================================================================
//
// @doc 对应文档 §3.3 缓存链接（Cache Link），在两个或多个缓存之间
//      建立容量共享约束。Link 不直接生成图节点或边，而是通过影响
//      缓存的 shadow 容量约束间接参与求解（§5.1）。
//
//      两种 Link 语义：
//      - share-cap（§3.3）：共享容量上限，累计到达上限后两侧都无法添加。
//        传送带的 ingredient ↔ product 使用此类型（§5.1.1、§7.3.2）。
//      - share-all（§3.3）：共享存储内容和上限，读写立即可见。
//        已链接暗管进出口（§14.4）、仓库取货口 ↔ 仓库槽位（§14.6）使用此类型。
//
//      初始化影响（§7.3）：
//      - share-cap 槽位的 portInputCapacities amount =
//        capacity − 对端当前物品数（§7.3.1-2）
//      - share-all 两端共享同一份存储视图（§7.3.3）
//
// 粒度：每个 Link（两个 Cache 之间）一份。
// 适用设备：传送带(内部 share-cap)、已链接暗管、仓库取货口、协议核心
// ----------------------------------------------------------------------------

export interface LinkConfigInspectorDef {
  /** 领域级开关：此设备类型的 Link Config 面板整体是否允许用户编辑 */
  mutable: boolean;

  /**
   * Link 类型。
   *
   * @doc 对应文档 §3.3 表格：
   *      - 'share-cap': 共享容量上限，存储各自独立。
   *        传送带使用此类型，ingredient ↔ product 共享容量 1（§3.4 表格）。
   *        多个槽位累计 count 不超过共享容量上限。
   *      - 'share-all': 共享存储内容和上限，任一侧读写对另一侧立即可见。
   *        已链接暗管进出口（§14.4）、仓库取货口 ↔ 仓库槽位（§14.6）。
   *      通常由设备类型决定，mutable 默认 false。
   */
  linkType: FieldDef<'share-cap' | 'share-all'>;

  /**
   * 对端缓存引用。
   *
   * @doc 对应文档 §3.3 中 Link 的多对多连接关系。
   *      指向另一个设备的缓存组，格式如 "entityId.cacheGroupId"。
   *      - 传送带：ingredient 缓存 ↔ product 缓存，同设备内部 Link
   *      - 仓库取货口：取货口 product 缓存 ↔ 仓库对应物品槽位
   *      - 已链接暗管：入口 ingredient ↔ 出口 product
   */
  peerCache: FieldDef<CacheRef>;

  /**
   * 共享容量上限，仅 share-cap 时有效。
   *
   * @doc 对应文档 §3.3 中 share-cap 的容量约束语义。
   *      双方累计物品数到达 shareLimit 后均无法再接收新物品。
   *      传送带 shareLimit = 1（§3.4 表格、§7.3.2）。
   *      对于 share-all，此字段无实际作用（share-all 两端 = 同一份存储）。
   */
  shareLimit: FieldDef<number>;
}

// ============================================================================
// 5. Routing / Priority Inspector（分流/优先级）
// ============================================================================
//
// @doc 对应文档 §13 优先级组与轮询更新，以及 §10.2 入口选择和
//      §10.3 出口选择中的优先级与轮询处理。
//
//      多端口设备（分流器 3 输出口、汇流器 3 输入口、反应池多输出口）
//      需要决定多条边之间的选择优先级：
//      - §13.1：组号越小优先级越高
//      - §13.2：同组内按轮询游标旋转，实现公平轮询
//      - §13.3：选取 N = edge.count 条边，unlimited 时不限制
//      - §13.4：轮询游标允许一次性前进多个位置
//
//      入口选择（§10.2.1）：按 priority 对入边排序
//      出口选择（§10.3.3）：按 priority 对出边排序
//
// 粒度：每个多端口设备的 Port 集合一份。
// 适用设备：分流器、汇流器、反应池
// ----------------------------------------------------------------------------

/**
 * 单条优先级条目。
 *
 * @doc 对应文档 §13 中对单个端口的 priority 配置。
 */
export interface PriorityEntryDef {
  /**
   * 端口引用。
   * @doc 对应文档 §5.2 中边的 sourcePort / targetPort 标识。
   */
  portRef: PortRef;

  /**
   * 优先级组号，越小优先级越高。
   *
   * @doc 对应文档 §13.1：组号越小优先级越高。
   *      入口选择（§10.2.1）和出口选择（§10.3.3）都按此排序候选边。
   *      group = 0 是最优先级别。
   */
  group: FieldDef<number>;

  /**
   * 同组内轮询游标。
   *
   * @doc 对应文档 §13.2：同组内按轮询游标旋转，实现公平分配。
   *      运行时由求解器维护（§13.4 游标可一次性前进多个位置），
   *      编辑态只读展示，mutable 默认 false。
   */
  roundRobinIndex: FieldDef<number>;
}

export interface RoutingInspectorDef {
  /** 领域级开关：此设备类型的 Routing 面板整体是否允许用户编辑 */
  mutable: boolean;

  /**
   * 优先级条目列表，每个条目描述一个端口的优先级设置。
   *
   * @doc 对应文档 §13 中对多条边排序的逻辑：
   *      先按 group 排序（组号越小越优先），
   *      同组内按 roundRobinIndex 轮询，
   *      最后取前 edge.count 条边（unlimited 则不限）。
   */
  entries: FieldDef<PriorityEntryDef[]>;
}

// ============================================================================
// 6. Structure Config Inspector（结构配置）
// ============================================================================
//
// @doc 对应文档 §3.4 缓存组（Cache Group）的设备参数化。
//      缓存组用于表达"缓存之间是否允许容纳相同物品"：
//      - §3.4.2 组内互斥：同一组内槽位不可容纳相同物品
//      - §3.4.3 跨组不互斥：不同组之间可以
//      - §3.4.1 一个设备可以有多个缓存组，每组若干个槽位
//
//      组内互斥由入口选择的 entry 遍历"命中即停"自然保证（§10.2），
//      无需求解阶段单独检查（§10.3.1）。
//
//      典型参数化（§3.4 表格）：
//      - 反应池普通：1 组 × 5 槽 → 扩容：1 组 × 8 槽
//      - 协议存储箱：6 组 × 1 槽（每组一个独立节点）
//      - 传送带：ingredient 组(1槽) + product 组(1槽)
//
// 粒度：每个 Device 一份。
// 适用设备：反应池
// ----------------------------------------------------------------------------

/**
 * 单个缓存组定义。
 *
 * @doc 对应文档 §3.4 缓存组概念，以及 §5.1 中一个缓存组 = 一个求解图节点。
 */
export interface CacheGroupDef {
  /**
   * 组标识。
   * @doc 对应文档 §5.1 中每个缓存组的唯一标识，用于节点与缓存组的对应。
   */
  groupId: string;

  /**
   * 缓存类型。
   *
   * @doc 对应文档 §3.1 三种缓存类型：
   *      - 'ingredient': 链接到输入端口的缓存，只计算 portInputCapacities（§7.1）。
   *        用于接收物品、作为配方原料。
   *      - 'product': 链接到输出端口的缓存，只计算 portOutputSupplies（§7.1）。
   *        用于存放配方产物、对外提供物品。
   *      - 'universal': 同时链接输入和输出端口（反应池共享槽位，§14.2）。
   *        同时计算两侧能力（§7.1）。
   *      由设备类型决定，mutable 默认 false（用户不可自由切换缓存类型）。
   */
  cacheType: FieldDef<'ingredient' | 'product' | 'universal'>;

  /**
   * 该组包含的槽位数量。
   *
   * @doc 对应文档 §3.4 每组槽数的配置。
   *      反应池普通 5 槽 ↔ 扩容 8 槽即通过此字段切换。
   *      组内所有槽位共享同一组互斥约束（§3.4.2）。
   */
  slotCount: FieldDef<number>;

  /**
   * 组内每个槽位的容量上限。
   *
   * @doc 对应文档 §7.1 槽位属性中的 capacity。
   *      每个槽位的容量上限决定了 entry.amount 的计算。
   *      组内所有槽位通常容量相同。
   */
  slotCapacity: FieldDef<number>;
}

export interface StructureInspectorDef {
  /** 领域级开关：此设备类型的 Structure 面板整体是否允许用户编辑 */
  mutable: boolean;

  /**
   * 缓存组定义列表。
   *
   * @doc 对应文档 §3.4 中设备的所有缓存组声明。
   *      每个缓存组在求解图中对应一个节点（§5.1），
   *      节点能力由组内所有槽位聚合而成（§5.3、§5.5）。
   */
  cacheGroups: FieldDef<CacheGroupDef[]>;
}

// ============================================================================
// 7. Behavior Toggle Inspector（行为开关）
// ============================================================================
//
// @doc 对应文档 §14.6 仓库取货口的特殊行为开关。
//      目前只有"无视库存"一个字段，但预留了扩展空间。
//
//      适用场景（§14.6）：
//      - 仓库取货口可配置"无视库存"开关
//      - 矿物或液体取货口强制开启（mutable = false），忽略仓库真实库存量
//      - 未开启时，shadow 扣减同步到仓库对应槽位（§14.6.4），
//        移动阶段真实扣减作用于仓库（§11.1.4）
//
// 粒度：每个需要特殊行为的 Slot / Device 一份。
// 适用设备：仓库取货口
// ----------------------------------------------------------------------------

export interface BehaviorToggleInspectorDef {
  /** 领域级开关：此设备类型的 Behavior Toggle 面板整体是否允许用户编辑 */
  mutable: boolean;

  /**
   * 无视库存开关。
   *
   * @doc 对应文档 §14.6 中"无视库存"行为：
   *      - true: 输出不受仓库真实库存限制，
   *        portOutputSupplies entry 的 amount 不受上限约束（§5.5.7）。
   *        矿物/液体取货口强制为此值（§14.6.3），mutable = false。
   *      - false: 输出受仓库库存约束，移动阶段扣减仓库真实库存（§11.1.4）。
   */
  ignoreStock: FieldDef<boolean>;
}

// ============================================================================
// Inspector 标识常量
// ============================================================================

/**
 * Inspector 类型标识，kebab-case 命名。
 *
 * @doc 对应文档中 7 个正交 Inspector 的标识。
 *      用于设备声明 requiredInspectors 和 UI 面板路由。
 */
export const INSPECTOR_TYPE = {
  /** 端口过滤器：acceptRule + count（§3.1、§5.2） */
  portFilter: 'port-filter',
  /** 配方配置：recipeId + recipeType + duration（§3.2、§6、§12） */
  recipeConfig: 'recipe-config',
  /** 槽位配置：lock + capacity + initialCount + submitMode（§7.1、§11.1） */
  slotConfig: 'slot-config',
  /** 链接配置：linkType + peerCache + shareLimit（§3.3、§7.3） */
  linkConfig: 'link-config',
  /** 分流/优先级：entries[] 含 portRef + group + roundRobinIndex（§13） */
  routing: 'routing',
  /** 结构配置：cacheGroups[] 含 cacheType + slotCount + slotCapacity（§3.4） */
  structure: 'structure',
  /** 行为开关：ignoreStock（§14.6） */
  behaviorToggle: 'behavior-toggle',
} as const;

export type InspectorType = (typeof INSPECTOR_TYPE)[keyof typeof INSPECTOR_TYPE];

// ============================================================================
// 设备 → Inspector 映射的 Registry 条目
// ============================================================================

/**
 * 设备在 Registry 中声明自身需要哪些 Inspector。
 * 每个 Inspector 携带领域级的字段 mutable 设置和默认值。
 *
 * @doc 对应文档中 §14 设备参数化：每个设备通过声明其需要的 Inspector
 *      来表达可配置能力。不需要的 Inspector 留空（undefined）即可。
 *
 *      求解器使用通用原语组合（§3），不按设备类型分支。
 *      Inspector 仅影响编辑器的 UI 面板，
 *      Sim 模式下变为只读信息显示器。
 */
export interface DeviceInspectorDeclarations {
  /** @doc §3.1、§5.2 — 端口通过规则与吞吐量 */
  portFilter?: PortFilterInspectorDef;

  /** @doc §3.2、§6、§12 — 配方选择与类型 */
  recipeConfig?: RecipeConfigInspectorDef;

  /** @doc §7.1、§11.1、§14.3 — 槽位持久属性与提交行为 */
  slotConfig?: SlotConfigInspectorDef;

  /** @doc §3.3、§7.3 — 缓存间容量共享约束 */
  linkConfig?: LinkConfigInspectorDef;

  /** @doc §13、§10.2-10.3 — 多端口优先级与轮询 */
  routing?: RoutingInspectorDef;

  /** @doc §3.4、§5.1 — 缓存组与槽位结构 */
  structure?: StructureInspectorDef;

  /** @doc §14.6 — 特殊行为开关 */
  behaviorToggle?: BehaviorToggleInspectorDef;
}
