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
   * ## 设备问题面板
   *
   * **只读展示。** 不编辑任何 config 字段。
   *
   * 显示当前设备遭遇的所有问题，包括：
   * - 设备放置问题（来自 EntityPlacementValidationResult）
   * - 设备不在供电范围（powerStatus === "out-of-power-range"）
   * - 地图电力不足（基地级大停电）
   * - 产物堵塞（channel recipe state === "waiting-output"）
   *
   * 数据来源：EditorQuery.getEntityPlacementValidation +
   * SimulationQuery.getDeviceRuntimeStatus +
   * SimulationQuery.getDocumentRuntimeStatus。
   */
  problem: "problem",

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

  /**
   * ## 运行消耗面板
   *
   * **只读展示。** 显示计量消耗设备当前窗口与上一个完整分钟窗口消费量中的较大值。
   * 标尺左侧显示该较大值所属窗口锁定的计量物品图标。
   * 标尺范围来自 EntityDefinition.meteredConsumption，游标值来自
   * SimulationDeviceRuntimeStatusReadModel.meteredConsumption。
   * AI-CORRECTION 2026-07-23: 数据源已改为 consumption-channel 绑定的真实槽位；
   * 标尺游标显示槽位物品数量 × 6，不再读取已删除的计量窗口字段。
   */
  meteredConsumption: "metered-consumption",

  /**
   * ## 物流物品面板
   *
   * **只读展示。** 不编辑任何 config 或运行时字段。
   *
   * 显示物流设备共享槽位中当前容纳的物品：
   * - 物品图标
   * - 物品名称
   *
   * 物流共享槽位容量为 1，因此不显示数量。
   * 数据来源：SimulationDeviceRuntimeStatusReadModel.slotItems。
   */
  logisticsItem: "logistics-item",

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
   * **编辑目标**：portGroups[*].ports[*] 的 acceptRule。
   *
   * 绑定方式：`portRef` — 格式为 `"groupId:portId"` 或 `"groupIndex:portIndex"`。
   *
   * 编辑功能：
   * - **acceptRule 编辑**：设置端口允许通过的物品类型（base 规则 + exclude 列表）
   *
   * 语义：
   * - 输入口：不选物品 = 接受所有
   * - 输出口：不选物品 = 拒绝所有
   * - 这些语义由面板根据端口所在 group 的 direction 自行判断
   */
  portFilter: "port-filter",

  /**
   * ## 物品准入面板
   *
   * **编辑目标**：admission 设备 input port 的 acceptRule 与 admissionRule。
   *
   * 绑定方式：`portGroupId` + `portId` 直接引用 EntityDefinition.portGroups。
   *
   * 编辑功能：
   * - **选择物品**：只能选择一个准入物品，可清除或切换
   * - **总量上限**：设置跨 tick 总准入数量；达到上限后不再放行该物品
   * - **运行时计数**：显示已准入数量，并提供 reset 按钮将计数置 0
   *
   * 写入路径：
   * - `portGroups[${groupIndex}].ports[${portIndex}].acceptRule`
   * - `portGroups[${groupIndex}].ports[${portIndex}].admissionRule`
   */
  admissionRule: "admission-rule",

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
   * ## 定时提交到仓库面板
   *
   * **协议储存箱专用 Inspector**。
   *
   * **编辑目标**：为 manualRecipeOnly channel 选择定时提交配方，驱动槽位物品定时提交到仓库。
   *
   * 编辑功能：
   * - 选择一个外部配方（只显示 machineId 匹配当前设备的配方）
   * - 运行时显示提交倒计时
   *
   * 写入路径：entity.config.channelRecipes[channelId] = recipeId
   */
  submitToWarehouse: "submit-to-warehouse",

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
   * ## 净水节点面板
   *
   * **净水节点专用 Inspector。**
   *
   * 编辑功能：
   * - 切换产出模式：按污水输入 / 手动每分钟产出
   * - 手动模式下配置每分钟壤晶废液产出数量
   *
   * 写入路径：
   * - `waterPurifierOutputMode`
   * - `waterPurifierManualOutputPerMinute`
   */
  waterPurifierNode: "water-purifier-node",

  /**
   * ## 自动处理复数配方阻塞面板
   *
   * **编辑目标**：设备声明的 blockageAutoClearance 开关。
   *
   * 编辑功能：
   * - 开启 / 关闭当前设备的堵塞自动清除机制
   *
   * 写入路径：EntityDefinition.blockageAutoClearance.enabledConfigKey 指向的 config key。
   */
  blockageAutoClearance: "blockage-auto-clearance",

  /**
   * ## 输出端口配置面板
   *
   * **编辑目标**：portGroups[*].ports[*] 的 acceptRule。
   *
   * 绑定方式：`portGroupIds` 直接引用 EntityDefinition.portGroups 的 id。
   *
   * 编辑功能：
   * - **物品选择**：为端口组内所有输出端口选择一个输出物品
   * - **清除**：删除 config 中的 acceptRule 覆盖，恢复 Definition 默认值
   *
   * 写入路径：config["portGroups[${groupIndex}].ports[${portIndex}].acceptRule"]
   *
   * 过滤规则：item 型端口组只显示固体物品，fluid 型端口组只显示液体物品。
   *
   * 这是反应池（扩容反应池）专用的输出端口面板。
   */
  portOutputConfig: "port-output-config",

  /**
   * ## 仓库物品链接面板
   *
   * **编辑目标**：document.slotLinks 中的仓库物品链接 + entity.config 中的 slot ignoreStock。
   *
   * 绑定方式：`slotGroupIds` + `slotIds`，按声明顺序展开槽位。
   *
   * 编辑功能：
   * - 从百科全书选择物品
   * - 调用 EditorAction.createWarehouseSlotLink() 在 document.slotLinks 中创建 share-all Link
   * - 调用 EditorAction.removeWarehouseSlotLink() 从 document.slotLinks 中移除链接
   *
   * ### 数据契约
   *
   * 链接数据存放在 document.slotLinks 中：
   *
   * | 字段 | 值 | 说明 |
   * |------|-----|------|
   * | Link ID | `warehouse-link:${entityId}:${storageSlotGroupId}:${slotId}` | 唯一标识 |
   * | Link 类型 | `"share-all"` | |
   * | source 实体 | entityId | 当前设备实体 ID |
   * | source 存储组 | storageSlotGroupId | 如 `"unloader_buffer"` |
   * | source 槽位 | slotId | 如 `"slot_1"` |
   * | target 实体 | `"warehouse"` | 编译器运行时解析 baseId |
   * | target 存储组 | `"warehouse"` | |
   * | target 物品 | 选中的物品 ID | |
   *
   * ignoreStock 仍存放在 entity.config 中：
   *
   * | 字段 | config key | 说明 |
   * |------|-----------|------|
   * | 无限取货 | `storageSlotGroups[G].slots[S].ignoreStock` | `true` / `false` |
   *
   * 清除链接时：removeWarehouseSlotLink + ignoreStock 置 false。
   *
   * 这是仓储设备（取货口/出货口）专用的面板。
   * 与设计文档《仿真运行原理》§3.3 中的 share-all Link 对应。
   *
   * AI-CORRECTION 2026-06-09: EntityDefinition.links 已移除，仓库物品链接改为写入 document.slotLinks。
   */
  warehouseItemLink: "warehouse-item-link",

  /**
   * ## 暗管链接面板
   *
   * **编辑目标**：暗管入口与暗管出口之间的一对一 share-all 槽位链接。
   *
   * 编辑功能：
   * - 未链接时进入暗管链接选择工具；
   * - 已链接时断开当前暗管链接；
   * - 暗管入口只能选择暗管出口，暗管出口只能选择暗管入口；
   * - 单口和多口暗管可混合链接，但每个暗管设备最多参与一条链接。
   */
  darkPipeLink: "dark-pipe-link",
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

/** admissionRule 声明：编辑指定准入口端口的跨 tick 准入规则 */
export interface AdmissionRuleInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.admissionRule;
  /** 目标端口组 ID。 */
  readonly portGroupId: string;
  /** 目标端口 ID。 */
  readonly portId: string;
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

/** portOutputConfig 声明：为指定端口组配置输出物品 */
export interface PortOutputConfigInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.portOutputConfig;
  /**
   * 要进行输出配置的端口组 ID 列表。
   * 每个 ID 对应 EntityDefinition.portGroups 中的一项。
   * 组内所有 direction="output" 的端口共享一个物品筛选器。
   */
  readonly portGroupIds: readonly string[];
}

/** darkPipeLink 声明：创建或断开暗管入口/出口链接 */
export interface DarkPipeLinkInspectorDeclaration {
  readonly type: typeof INSPECTOR_TYPE.darkPipeLink;
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
  | AdmissionRuleInspectorDeclaration
  | RoutingInspectorDeclaration
  | LinkConfigInspectorDeclaration
  | { readonly type: typeof INSPECTOR_TYPE.genericDevice }
  | { readonly type: typeof INSPECTOR_TYPE.problem }
  | { readonly type: typeof INSPECTOR_TYPE.runtimeStatistics }
  | { readonly type: typeof INSPECTOR_TYPE.meteredConsumption }
  | { readonly type: typeof INSPECTOR_TYPE.logisticsItem }
  | { readonly type: typeof INSPECTOR_TYPE.storageManagement }
  | { readonly type: typeof INSPECTOR_TYPE.storageTypeFilter }
  | { readonly type: typeof INSPECTOR_TYPE.submitToWarehouse }
  | RecipeStatusInspectorDeclaration
  | PortOutputConfigInspectorDeclaration
  | DarkPipeLinkInspectorDeclaration
  | { readonly type: typeof INSPECTOR_TYPE.structure }
  | { readonly type: typeof INSPECTOR_TYPE.behaviorToggle }
  | { readonly type: typeof INSPECTOR_TYPE.waterPurifierNode }
  | { readonly type: typeof INSPECTOR_TYPE.blockageAutoClearance };
