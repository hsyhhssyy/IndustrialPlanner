// =========================================================================
// Inspector 面板类型定义（对应《模拟器抽象方式》§4 Inspector 层）
//
// Inspector 声明采用可辨识联合（discriminated union），
// 每种 type 只携带自己需要的参数，不使用泛化的 targetPath。
// UI 组件根据 type 收窄到具体声明，自行从 EntityDefinition 中定位数据。
//
// 每个 INSPECTOR_TYPE 的注释是该 Inspector 的 UI 契约，
// 描述面板需要实现的编辑功能。UI 开发者据此实现组件。
// =========================================================================

/**
 * 所有 Inspector 面板类型枚举。
 *
 * 每个类型的注释即为 UI 契约——描述该面板需要实现的编辑功能、
 * 绑定的领域对象和写入 config 的字段。
 *
 * 实体定义在 inspectors[] 中声明需要哪些面板，
 * 前端 SelectionInspectorSlot 按 type 挂载对应 React 组件。
 * 运行时（Sim 模式）面板变为只读。
 */
export const INSPECTOR_TYPE = {
  // ========================================================================
  // 只读展示类
  // ========================================================================

  /**
   * ## 通用设备面板
   *
   * **只读展示。** 不编辑任何 config 字段。
   *
   * 显示内容：
   * - 设备 id、definitionId
   * - 世界坐标 (x, y)、旋转角度
   * - 端口数量、链接数量
   * - tags 列表
   *
   * 对应 SelectionInspectorSummary 组件。
   */
  genericDevice: "generic-device",

  /**
   * ## 运行时统计面板
   *
   * **只读展示，仅在 Sim 模式下出现。**
   *
   * 显示内容：
   * - 当前 tick 的配方执行进度（recipeId、progressSeconds）
   * - 各槽位缓存占用率（当前数量 / 容量）
   * - 电力消耗
   * - 传输速率
   *
   * 数据来源：SimulationDeviceRuntimeStatusReadModel。
   */
  runtimeStatistics: "runtime-statistics",

  // ========================================================================
  // 槽位编辑类
  // ========================================================================

  /**
   * ## 槽位配置面板
   *
   * **编辑目标**：`storageSlotGroups[*].slots[*]` 的各项属性。
   *
   * 绑定方式：`slotGroupIds` 直接引用 EntityDefinition.storageSlotGroups 的 id。
   *
   * 编辑功能：
   * - **物品选择**：为槽位设置 initialItemType（从百科全书选择物品）
   * - **数量编辑**：编辑 initialCount（步进器 + 直接输入，范围 0~capacity）
   * - **锁定检查**：若槽位定义了 `lock`，则物品不可更改，显示锁定标签
   * - **清除**：将 initialItemType 置 null、initialCount 置 0
   *
   * 写入路径：`storageSlotGroups[${groupIndex}].slots[${slotIndex}].initialItemType`
   *          `storageSlotGroups[${groupIndex}].slots[${slotIndex}].initialCount`
   *
   * 互斥规则：同一 storageSlotGroup 内的多个槽位不能选择相同物品。
   *
   * 渲染模式：
   * - 单组：面板内直接列出该组所有槽位
   * - 多组（slotGroupIds.length > 1）：每组一个 section，标注 group id
   */
  slotConfig: "slot-config",

  /**
   * ## 缓存管理面板
   *
   * **编辑目标**：storageSlotGroups[*].slots[*] 的通用属性。
   *
   * 绑定方式：待定（slotGroupIds 或 slotIds）。
   *
   * 编辑功能：
   * - lock：锁定槽位物品
   * - ignoreStock：忽略库存
   * - initialItemType / initialCount：初始物品与数量
   * - itemFilterType：类型过滤器（solid/liquid/any）
   *
   * 与 slotConfig 的区别：slotConfig 聚焦物品选择与数量，storageManagement 聚焦更多结构属性。
   */
  storageManagement: "storage-management",

  /**
   * ## 缓存类型过滤器面板
   *
   * **编辑目标**：storageSlotGroups[*].slots[*].itemFilterType。
   *
   * 编辑功能：
   * - 切换槽位的 itemFilterType（solid / liquid / any）
   *
   * 该值决定槽位能接收什么域（domain）的物品。
   */
  storageTypeFilter: "storage-type-filter",

  // ========================================================================
  // 端口编辑类
  // ========================================================================

  /**
   * ## 端口过滤器面板
   *
   * **编辑目标**：portGroups[*].ports[*] 的 acceptRule 和 count。
   *
   * 绑定方式：`portRef` — 格式为 `"groupId:portId"` 或 `"groupIndex:portIndex"`。
   *
   * 编辑功能：
   * - **acceptRule 编辑**：设置端口允许通过的物品类型（base 规则 + exclude 列表）
   * - **count 编辑**：设置每 tick 允许通过的物品数量上限
   *
   * 语义：
   * - 输入口（准入口）：不选物品 = 接受所有，可编辑 count
   * - 输出口：不选物品 = 拒绝所有，不可编辑 count
   * - 这些语义由面板根据端口所在 group 的 direction 自行判断
   */
  portFilter: "port-filter",

  /**
   * ## 分流/优先级面板
   *
   * **编辑目标**：portGroups[*].ports[*] 的 priorityGroup 和 roundRobinSeed。
   *
   * 绑定方式：`portRef`。
   *
   * 编辑功能：
   * - priorityGroup：设置端口所属的优先级组
   * - roundRobinSeed：设置轮询种子
   *
   * 用于分流器/汇流器的多输出/多输入调度策略。
   */
  routing: "routing",

  // ========================================================================
  // 设备级编辑类
  // ========================================================================

  /**
   * ## 配方配置面板
   *
   * **编辑目标**：设备的 recipe 配置。
   *
   * 编辑功能：
   * - 选择外部配方（从 recipeDefinitions 中选择）
   * - 或配置内联配方：输入输出物品及数量、配方类型（immediate-consume/reserved-item）、durationSeconds
   *
   * 对应 EntityDefinition 中的 recipe 字段。
   */
  recipeConfig: "recipe-config",

  /**
   * ## 配方状态面板
   *
   * **显示目标**：运行时配方进度条，展示当前 channel 中配方的名称、进度百分比。
   *
   * 绑定方式：`channelIds`。
   *
   * 显示功能：
   * - 仅仿真运行时可见
   * - 每个声明的 channel 渲染一个 RecipeDisplay + 进度条
   *
   * 注意：内部合成配方（如 warehouse_submit）不应在此声明，否则会在 inspector 中暴露无意义的进度条。
   */
  recipeStatus: "recipe-status",

  /**
   * ## 链接配置面板
   *
   * **编辑目标**：cacheLinks[*] 的属性。
   *
   * 绑定方式：`cacheLinkIndex`。
   *
   * 编辑功能：
   * - 查看/编辑 cacheLink 的 linkType、shareLimit、endpoints 等
   *
   * 对应 CacheLinkDefinition。share-all：共享内容和上限；share-cap：仅共享容量上限。
   */
  linkConfig: "link-config",

  /**
   * ## 结构配置面板
   *
   * **编辑目标**：设备的结构性属性（footprint 相关约束等）。
   *
   * 编辑功能：待定（由具体设备需求驱动）。
   */
  structure: "structure",

  /**
   * ## 行为开关面板
   *
   * **编辑目标**：设备的布尔行为开关。
   *
   * 编辑功能：待定（如是否启用某种模式）。
   */
  behaviorToggle: "behavior-toggle",

  /**
   * ## 仓库物品链接面板
   *
   * **编辑目标**：entity.config.links[N]（完整 SlotLinkDefinition 结构）+ slot ignoreStock。
   *
   * 绑定方式：`slotGroupIds` + `slotIds`，按声明顺序展开为索引 N（0-based）。
   *
   * 编辑功能：
   * - 从百科全书选择物品
   * - 调用 RegistryQuery.buildWarehouseSlotLinkForEntity() 构造完整 SlotLinkDefinition
   * - 将完整 Link 写入 config，通过 share-all Link 将设备槽位连接到 warehouse 对应物品槽位
   *
   * ### Config Contract（编译器直接消费，不得修改路径）
   *
   * 选择物品时写入：
   *
   * | 字段 | config key | 说明 |
   * |------|-----------|------|
   * | Link ID | `links[N].id` | 空字符串 |
   * | Link 类型 | `links[N].linkType` | `"share-all"` |
   * | source 实体 | `links[N].source.entityId` | 当前设备实体 ID（placement 时由 apply 重写） |
   * | source 存储组 | `links[N].source.storageSlotGroupId` | 如 `"unloader_buffer"` |
   * | source 槽位 | `links[N].source.slotId` | 如 `"slot_1"` |
   * | target 实体 | `links[N].target.entityId` | `"warehouse"`（编译器运行时解析 baseId） |
   * | target 存储组 | `links[N].target.storageSlotGroupId` | `"warehouse"` |
   * | target 物品 | `links[N].target.slotId` | 选中的物品 ID |
   * | 无限取货 | `storageSlotGroups[G].slots[S].ignoreStock` | `true` / `false`（slot 属性） |
   *
   * 清除链接时：`links[N]` 整体置 null，`ignoreStock` 置 false。
   *
   * 这是仓储设备（取货口/出货口）专用的面板。
   * 与设计文档《仿真运行原理》§3.3 中的 share-all Link 对应。
   */
  warehouseItemLink: "warehouse-item-link",
} as const;

export type EntityInspectorType =
  typeof INSPECTOR_TYPE[keyof typeof INSPECTOR_TYPE];

// =========================================================================
// Inspector 声明 — 可辨识联合（discriminated union）
//
// 每种 type 只携带自己需要的参数。UI 组件根据 type 收窄后，
// 从 EntityDefinition 中自行定位数据、构建 config 路径。
// =========================================================================

/** slotConfig 声明：编辑指定存储槽组的槽位配置 */
export interface SlotConfigInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.slotConfig;
  /**
   * 要编辑的存储槽组 ID 列表。
   * 每个 ID 对应 EntityDefinition.storageSlotGroups 中的一项。
   * UI 通过 ID 在 storageSlotGroups 中定位槽组，
   * 自行构建 config 路径 `storageSlotGroups[${index}].slots[${slotIndex}]`。
   */
  readonly slotGroupIds: readonly string[];
}

/** warehouseItemLink 声明：为指定槽位选择仓库物品 */
export interface WarehouseItemLinkInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.warehouseItemLink;
  /**
   * 要链接的存储槽组 ID 列表。
   * 每个 ID 对应 EntityDefinition.storageSlotGroups 中的一项。
   * 组内所有 slotIds 展开后按顺序分配 link 索引。
   */
  readonly slotGroupIds: readonly string[];
  /**
   * 要链接的具体槽位 ID 列表（对应 StorageSlotDefinition.id）。
   * 若省略则展开 slotGroupIds 中所有组的全部槽位。
   */
  readonly slotIds?: readonly string[];
}

/** portFilter 声明：编辑指定端口的过滤器 */
export interface PortFilterInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.portFilter;
  /**
   * 端口引用。
   * 格式待 UI 实现时确定（建议 `"groupId:portId"`）。
   */
  readonly portRef: string;
}

/** routing 声明：编辑指定端口的调度策略 */
export interface RoutingInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.routing;
  /** 端口引用 */
  readonly portRef: string;
}

/** linkConfig 声明：编辑指定缓存链接 */
export interface LinkConfigInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.linkConfig;
  /** 绑定的缓存链接索引 */
  readonly cacheLinkIndex: number;
}

/** recipeStatus 声明：显示指定 channel 的配方进度 */
export interface RecipeStatusInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.recipeStatus;
  /** 要显示配方进度的 channel ID 列表 */
  readonly channelIds: readonly string[];
}

/**
 * EntityInspectorDeclaration — 可辨识联合。
 *
 * 每种 Inspector type 对应一个成员，携带该类型专属的参数。
 * 无参数的类型使用内联 `{ readonly type: T }`。
 *
 * 例：
 * ```ts
 * // Registry 声明
 * inspectors: [
 *   { type: "slot-config", slotGroupIds: ["item_input_buffer", "item_output_buffer"] },
 *   { type: "generic-device" },
 * ]
 *
 * // UI 消费
 * function renderInspector(decl: EntityInspectorDeclaration) {
 *   switch (decl.type) {
 *     case "slot-config":    decl.slotGroupIds;  // ✅ 类型收窄，可直接访问
 *     case "generic-device":                      // 无额外参数
 *   }
 * }
 * ```
 */
export type EntityInspectorDeclaration =
  | SlotConfigInspectorDeclaration
  | WarehouseItemLinkInspectorDeclaration
  | PortFilterInspectorDeclaration
  | RoutingInspectorDeclaration
  | LinkConfigInspectorDeclaration
  | { readonly type: typeof INSPECTOR_TYPE.genericDevice }
  | { readonly type: typeof INSPECTOR_TYPE.runtimeStatistics }
  | { readonly type: typeof INSPECTOR_TYPE.storageManagement }
  | { readonly type: typeof INSPECTOR_TYPE.storageTypeFilter }
  | { readonly type: typeof INSPECTOR_TYPE.recipeConfig }
  | RecipeStatusInspectorDeclaration
  | { readonly type: typeof INSPECTOR_TYPE.structure }
  | { readonly type: typeof INSPECTOR_TYPE.behaviorToggle };
