// =========================================================================
// Inspector 面板类型定义（对应《模拟器抽象方式》§4 Inspector 层）
//
// Inspector 不持有数据，只声明三件事：
//   1. 面板类型（type）— 前端按此挂载对应 React 组件
//   2. 编辑目标路径（targetPath）— 写入 entity.config 的位置
//   3. 最少必要参数（slotIndex / portRef / cacheLinkIndex）— 面板绑定的具体元素
//
// 约束由面板实现通过领域知识处理，不进入类型系统。
// =========================================================================

/**
 * 所有 Inspector 面板类型枚举。
 *
 * 每个类型对应的面板功能详见下方注释。
 * 实体定义在 inspectors[] 中声明需要哪些面板，
 * 前端 SelectionInspectorSlot 遍历挂载，运行时（Sim 模式）变为只读。
 */
export const INSPECTOR_TYPE = {
  /**
   * 通用设备面板。
   * 显示设备 ID、定义 ID、位置、旋转、链接数、tags 等基础信息。
   * 对应 SelectionInspectorSummary 组件。
   * 不需要 targetPath——只读展示，不编辑 config。
   */
  genericDevice: "generic-device",

  /**
   * 运行时统计面板。
   * 在 Sim 模式下显示设备当前 tick 的生产/搬运进度、缓存占用率、
   * 电力消耗等运行时数据。只读。
   */
  runtimeStatistics: "runtime-statistics",

  /**
   * 缓存管理面板。
   * 编辑存储槽组的锁物品（lock）、是否忽略库存（ignoreStock）、
   * 初始物品/数量（initialItemType/initialCount）等配置。
   * targetPath 绑定到 storageSlotGroups[N].slots[M]。
   *
   * 对应 EntityDefinition 中 storageSlotGroups 的 slot 配置项，
   * 与设计文档《仿真运行原理》§3.1 缓存类型相关。
   */
  storageManagement: "storage-management",

  /**
   * 缓存类型过滤器面板。
   * 编辑槽位的 itemFilterType（solid/liquid/any），
   * 决定该槽位能接收什么域的物品。
   * 对应 StorageSlotDefinition.itemFilterType。
   */
  storageTypeFilter: "storage-type-filter",

  /**
   * 端口过滤器面板。
   * 编辑端口的 acceptRule（base + exclude 列表）和 count（每 tick 通过上限）。
   * portRef 绑定到具体端口，对应 PortDefinition.acceptRule / count，
   * 与设计文档《仿真运行原理》§3.1 中 Port 的两个通用配置直接对应：
   *   - acceptRule：允许通过的物品类型
   *   - count：每 tick 允许通过的物品数量上限
   * 也用于编辑准入口的预设 acceptRule=itemId(X) 和 count=N（见 §5.1.5）。
   */
  portFilter: "port-filter",

  /**
   * 配方配置面板。
   * 编辑设备的 recipe 配置——选择外部配方或配置内联配方的
   * 输入输出物品及数量、配方类型（immediate-consume/reserved-item）、
   * durationSeconds 等。
   * targetPath 绑定到 recipe 字段。
   *
   * 对应 EntityRecipeDefinition，与设计文档《仿真运行原理》§3.2 配方类型相关。
   */
  recipeConfig: "recipe-config",

  /**
   * 槽位配置面板。
   * 编辑单个槽位的 capacity、lock、ignoreStock、submitMode、
   * submitIntervalSeconds 等详细配置。
   * slotIndex 绑定到具体槽位。
   * targetPath 如 "storageSlotGroups[0].slots[0]"。
   *
   * 对应 StorageSlotDefinition，与设计文档《仿真运行原理》§3.4 缓存组相关。
   */
  slotConfig: "slot-config",

  /**
   * 链接配置面板。
  * 编辑 cacheLinks 的 linkType、shareLimit、endpoints 等。
  * 2026-05-04 订正：CacheLinkDefinition 现为 source -> target 的有向 share-all 代理，不再编辑 shareLimit/endpoints。
   * cacheLinkIndex 绑定到具体链接。
   *
   * 对应 CacheLinkDefinition，与设计文档《仿真运行原理》§3.3 缓存链接相关：
   *   - share-all：共享内容和上限
  *   - share-cap：仅共享容量上限
  *   - 2026-05-04 订正：share-cap 已删除，保留本行仅作历史语义说明。
  *   - 订正（2026-05-05）：share-cap 已恢复，用于库存分离但容量联动的场景。
   */
  linkConfig: "link-config",

  /**
   * 分流/优先级面板。
   * 编辑端口的 priorityGroup 和 roundRobinSeed。
   * portRef 绑定到具体端口。
   *
   * 对应 PortDefinition.priorityGroup / roundRobinSeed，
   * 用于分流器/汇流器的多输出/多输入调度策略。
   */
  routing: "routing",

  /**
   * 结构配置面板。
   * 编辑设备的结构性属性（footprint 相关约束等）。
   * 具体功能由面板实现自行定义。
   */
  structure: "structure",

  /**
   * 行为开关面板。
   * 编辑设备的布尔行为开关（如是否启用某种模式）。
   * 具体功能由面板实现自行定义。
   */
  behaviorToggle: "behavior-toggle",

  /**
   * 仓库物品链接面板。
   * 提供一个物品选择器，选择后将 slot[slotIndex] 通过 share-all Link
   * 连接到 warehouse 中对应物品的槽位。
   * 写入 entity.config.links[slotIndex].itemId。
   *
   * 这是仓储设备（取货口/出货口）专用的面板，
   * 与设计文档《仿真运行原理》§3.3 中的 share-all Link 对应。
   * 通过此 Link，取货口槽位直接共享仓库中对应物品的无限存储。
   */
  warehouseItemLink: "warehouse-item-link",
} as const;

export type EntityInspectorType =
  typeof INSPECTOR_TYPE[keyof typeof INSPECTOR_TYPE];

/**
 * Inspector 声明（对应《模拟器抽象方式》§4）
 *
 * EntityDefinition.inspectors[] 中的每一项都是一个 InspectorDeclaration。
 * 它不持有数据，只告诉前端：
 *   - type：用哪个面板组件
 *   - 其他字段：面板绑定的具体元素和编辑路径
 *
 * 例如仓储取货口：
 *   [
 *     { type: "warehouse-item-link", slotIndex: 0, targetPath: "links[0].itemId" }
 *   ]
 */
export interface EntityInspectorDeclaration {
  /** 面板类型，决定前端挂载哪个组件 */
  readonly type: EntityInspectorType;

  /**
   * 编辑目标路径。
   * 使用 entity.config 的 JSON 路径语法，如 "slots[0].lock"、"links[0].itemId"。
   * 面板 UI 的修改通过此路径写入 entity.config，
   * 编译时 deepMerge(definitionDefaults, entityConfig) 合并。
   */
  readonly targetPath?: string;

  /** 绑定的槽位索引（用于 slotConfig / warehouseItemLink 等） */
  readonly slotIndex?: number;

  /** 绑定的端口引用（用于 portFilter / routing 等） */
  readonly portRef?: string;

  /** 绑定的缓存链接索引（用于 linkConfig） */
  readonly cacheLinkIndex?: number;
}
