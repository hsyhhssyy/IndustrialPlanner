// =========================================================================
// 实体定义注册表（Entity Definitions Registry）
//
// 本文件包含所有设备类型的完整定义。每个设备通过 createEntityDefinition()
// ／ createEmptyEntityDefinition() 构建，声明其端口、存储槽组、缓存链接、
// 配方和 Inspector 面板。
//
// 对应设计文档：
//   - 《模拟器抽象方式》§2 Entity 定义层 — EntityDefinition 的结构与默认值
//   - 《仿真运行原理》§3 核心原语 — 缓存类型 / 配方类型 / 缓存链接
//   - 《仿真运行原理》§5 图模型 — 节点来源与能力
//
// 设备分为两类：
//   1. 完整定义设备 — 声明了全部 portGroups/storageSlotGroups/
//      portStorageBindings/recipe/cacheLinks（如传送带、仓库、反应池等）。
//      这些设备直接参与仿真求解。
//   2. 空壳设备 — 通过 createEmptyEntityDefinition() 创建，
//      只声明 id/nameKey/spriteId/footprint/uiGroup/tags。
//      用于放置面板展示，其端口/槽位/配方由外部配方注册表（recipe-definition.ts）
//      中的 machineId 对应关系在编译时注入。标记 "v2 metadata sync"。
//
// Inspector 声明规则（对应《模拟器抽象方式》§4）：
//   每个设备的 inspectors[] 声明"用哪个面板编辑哪个路径"。
//   Inspector 不持有数据，只声明 type + targetPath + 最少必要参数。
// =========================================================================

import type {
  EntityDefinition,
  ItemFilterDefinition,
} from "@/domain/registry/types/entity-definition";
import type { SlotLinkDefinition } from "@/domain/shared/slot-link";
import {
  INSPECTOR_TYPE,
  type EntityInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";

import { RECIPE_DEFINITIONS } from "./recipe-definition";

// ---------------------------------------------------------------------------
// 类型别名 — 从 EntityDefinition 中提取子类型
// ---------------------------------------------------------------------------

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];
type RecipeChannelDefinition = EntityDefinition["recipeChannels"][number];

/** 端口朝向简写：N=北 S=南 W=西 E=东（相对于设备 rotation=0） */
type PortEdgeInput = "N" | "S" | "W" | "E";

/** 槽位物品过滤类型：solid（固体）/ liquid（液体）/ any（任意） */
type FilterType = NonNullable<ItemFilterDefinition["itemFilterType"]>;

/** createPort() 的输入类型 — 必填字段 + 可选覆盖字段 */
type PortDefinitionInput = Pick<
  PortDefinition,
  "id" | "localCellX" | "localCellY" | "edge"
> & Partial<Pick<
  PortDefinition,
  "acceptRule" | "count" | "priorityGroup" | "roundRobinSeed"
>>;

/** createEntityDefinition() 的输入类型 — inspectors / recipeChannels / links 可选，由工厂补全默认值 */
type EntityDefinitionInput = Omit<EntityDefinition, "inspectors" | "recipeChannels" | "links"> & {
  readonly inspectors?: readonly EntityInspectorDeclaration[];
  readonly recipeChannels?: readonly EntityDefinition["recipeChannels"][number][];
  readonly links?: readonly SlotLinkDefinition[];
};

/** createEmptyEntityDefinition() 的输入类型 — 基础字段必填，电力字段可选 */
type EmptyEntityDefinitionInput = Pick<
  EntityDefinitionInput,
  "id" | "nameKey" | "spriteId" | "footprint" | "uiGroup" | "tags"
> & Partial<Pick<EntityDefinitionInput, "requiresPower" | "powerDemand">>;

const RECIPE_MACHINE_IDS = new Set(
  RECIPE_DEFINITIONS.map((recipe) => recipe.machineId),
);

// =========================================================================
// 工厂函数
// =========================================================================

/**
 * 创建完整实体定义。
 * 确保 recipeChannels/inspectors/links 始终为非 null/undefined 的规范化值。
 * 对应《模拟器抽象方式》§2 — Entity 定义层的完整属性默认值。
 * 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks，当前仅在此规范化 inspectors 与 links。
 * 订正（2026-05-15）：新增 links 归一化为 []，支持设备级 SlotLink 预配置。
 */
function createEntityDefinition(definition: EntityDefinitionInput): EntityDefinition {
  const declaredInspectors = [...(definition.inspectors ?? [])];
  const recipeMachineInspectors = createRecipeMachineIngredientSlotInspectors(definition);

  return {
    ...definition,
    recipeChannels: [...(definition.recipeChannels ?? [])],
    links: [...(definition.links ?? [])],
    inspectors: appendMissingInspectors(declaredInspectors, recipeMachineInspectors),
  };
}

function createRecipeMachineIngredientSlotInspectors(
  definition: EntityDefinitionInput,
): EntityInspectorDeclaration[] {
  if (!RECIPE_MACHINE_IDS.has(definition.id)) {
    return [];
  }

  // 找出所有绑定了端口的存储槽组（即参与实际物流的槽组）
  const boundStorageSlotGroupIds = definition.storageSlotGroups
    .filter((storageSlotGroup) =>
      definition.portStorageBindings.some(b => b.storageSlotGroupId === storageSlotGroup.id),
    )
    .map(g => g.id);

  if (boundStorageSlotGroupIds.length === 0) {
    return [];
  }

  return [{
    type: INSPECTOR_TYPE.slotConfig,
    slotGroupIds: boundStorageSlotGroupIds,
  }];
}

function appendMissingInspectors(
  declaredInspectors: EntityInspectorDeclaration[],
  generatedInspectors: readonly EntityInspectorDeclaration[],
): EntityInspectorDeclaration[] {
  const inspectors = [...declaredInspectors];

  for (const generatedInspector of generatedInspectors) {
    // 该 type 是否已有声明（手写声明优先于自动生成）
    if (inspectors.some((inspector) => inspector.type === generatedInspector.type)) {
      continue;
    }

    inspectors.push(generatedInspector);
  }

  return inspectors;
}

/**
 * 创建空壳实体定义。
 * 只声明 id/nameKey/spriteId/footprint/uiGroup/tags + 电力字段。
 * inspectors/portGroups/storageSlotGroups/recipeChannels/portStorageBindings/links 均为空数组。
 * 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks，空壳定义仅补齐仍存在的静态字段。
 * 订正（2026-05-15）：新增 links: []。
 *
 * 空壳设备的实际端口/槽位/配方由外部配方注册表（recipe-definition.ts）中
 * machineId 对应关系在 Topology Compiler 编译时注入。
 * 标记 "v2 metadata sync" 的都属于此类。
 */
function createEmptyEntityDefinition(
  definition: EmptyEntityDefinitionInput,
): EntityDefinition {
  return createEntityDefinition({
    ...definition,
    requiresPower: definition.requiresPower ?? false,
    powerDemand: definition.powerDemand ?? 0,
    inspectors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
    links: [],
  });
}

/**
 * 将简写朝向转为标准 GridEdge 枚举。
 * N→NORTH  S→SOUTH  W→WEST  E→EAST
 */
function resolveEdge(edge: PortEdgeInput): PortDefinition["edge"] {
  switch (edge) {
    case "N":
      return "NORTH";
    case "S":
      return "SOUTH";
    case "W":
      return "WEST";
    case "E":
      return "EAST";
  }
}

/**
 * 创建端口定义。
 * acceptRule 默认按 portGroup.kind 推导（item→solid, fluid→liquid），
 * 可通过 options 覆盖。
 * count 默认 "unlimited"。
 * priorityGroup 默认 0。
 * roundRobinSeed 默认等于端口在组内的 index。
 */
function createPort(
  id: string,
  localCellX: number,
  localCellY: number,
  edge: PortEdgeInput,
  options: Partial<Pick<
    PortDefinition,
    "acceptRule" | "count" | "priorityGroup" | "roundRobinSeed"
  >> = {},
): PortDefinitionInput {
  return {
    id,
    localCellX,
    localCellY,
    edge: resolveEdge(edge),
    ...options,
  };
}

/**
 * 创建端口组。
 * kind：item（固体物品端口）/ fluid（液体端口）——决定默认 acceptRule。
 * direction：input（物品流入）/ output（物品流出）/ bidirectional（编译时分解为 input+output）。
 * 每个端口的 acceptRule 默认按 kind 推导，count 默认 "unlimited"，
 * priorityGroup 默认 0，roundRobinSeed 默认按 index 递增。
 *
 * 对应《仿真运行原理》§3.1 中 Port 的两个通用配置（acceptRule, count）。
 */
function createPortGroup(
  id: string,
  kind: PortGroupDefinition["kind"],
  direction: PortGroupDefinition["direction"],
  ports: PortDefinitionInput[],
): PortGroupDefinition {
  return {
    id,
    kind,
    direction,
    ports: ports.map((port, index) => ({
      ...port,
      acceptRule: port.acceptRule ?? acceptRuleFromPortKind(kind),
      count: port.count ?? "unlimited",
      priorityGroup: port.priorityGroup ?? 0,
      roundRobinSeed: port.roundRobinSeed ?? index,
    })),
  };
}

/**
 * 创建单个存储槽位。
 *
 * 对应《仿真运行原理》§3.1 缓存类型中 slot 的概念。
 * - capacity：槽位最大容量
 * - itemFilterType：solid/liquid/any — 决定可存放的物品域
 * - lock：锁定物品 ID，null=不锁定。用户可通过 entity.config["slots[N].lock"] 覆盖
 * - ignoreStock：忽略仓库库存检查，取货口/出货口常用
 * - submitMode：never（不自动提交）/ every-tick（每 tick）/ every-n-seconds（定时提交）
 */
function createSlot(
  id: string,
  capacity: number,
  itemFilterType: FilterType,
  options: Partial<Pick<
  StorageSlotDefinition,
  "lock" | "initialItemType" | "initialCount" | "ignoreStock" | "submitMode" | "submitIntervalSeconds"
  >> = {},
): StorageSlotDefinition {
  return {
    id,
    capacity,
    itemFilter: "type",
    itemFilterType,
    lock: options.lock ?? null,
    initialItemType: options.initialItemType ?? null,
    initialCount: options.initialCount ?? 0,
    ignoreStock: options.ignoreStock ?? false,
    submitMode: options.submitMode ?? "never",
    submitIntervalSeconds: options.submitIntervalSeconds ?? null,
  };
}

/**
 * 批量创建同质槽位（相同 itemFilterType，不同 capacity）。
 * 槽位 ID 格式为 "${prefix}_1", "${prefix}_2", ...
 */
function createSlots(
  prefix: string,
  capacities: number[],
  itemFilterType: FilterType,
): StorageSlotDefinition[] {
  return capacities.map((capacity, index) =>
    createSlot(`${prefix}_${index + 1}`, capacity, itemFilterType),
  );
}

/**
 * 创建存储槽组。
 *
 * 对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组。
 * 存储组的输入/输出能力由绑定的端口方向决定；
 * 配方原料/产物角色由 Recipe Channel 声明。
 *
 * AI-CORRECTION 2026-05-13: role 参数已删除。
 * 原 role 推导 slotType → ingredientNodeIds/productNodeIds 的职责已由 Recipe Channel 接管。
 *
 * 每个存储槽组编译后对应一个求解图节点。
 * 组内 slot 互斥（同物品不能出现在多槽），跨组不互斥（§3.4）。
 */
function createStorageSlotGroup(
  id: string,
  kind: StorageSlotGroupDefinition["kind"],
  slots: StorageSlotDefinition[],
  splitLinkType: StorageSlotGroupDefinition["splitLinkType"] = "share-all",
): StorageSlotGroupDefinition {
  return {
    id,
    kind,
    slots,
    splitLinkType,
  };
}

/**
 * 创建端口-存储绑定。
 *
 * 将 portGroup 与 storageSlotGroup 关联，
 * 决定物品从哪个端口流入哪个缓存组。
 * 无显式绑定时，编译器自动生成 synthetic-input/synthetic-output 缓存组。
 *
 * 对应《仿真运行原理》§5.1 节点来源中的 port-cache 绑定关系。
 */
function createBinding(
  id: string,
  portGroupId: string,
  storageSlotGroupId: string,
): PortStorageBindingDefinition {
  return {
    id,
    portGroupId,
    storageSlotGroupId,
  };
}

function createRecipeChannel(
  id: string,
  ingredientStorageGroupIds: string[],
  productStorageGroupIds: string[],
): RecipeChannelDefinition {
  return { id, ingredientStorageGroupIds, productStorageGroupIds };
}

type DirectionalBufferLayoutInput = {
  kind: StorageSlotGroupDefinition["kind"];
  direction: "input" | "output";
  capacities: number[];
};

function resolveSlotFilterType(kind: DirectionalBufferLayoutInput["kind"]): FilterType {
  return kind === "fluid" ? "liquid" : "solid";
}

function createDirectionalBuffers(
  layouts: readonly DirectionalBufferLayoutInput[],
): Pick<EntityDefinition, "storageSlotGroups" | "portStorageBindings" | "recipeChannels"> {
  const ingGroupIds = layouts.filter(l => l.direction === "input").map(l => `${l.kind}_${l.direction}_buffer`);
  const prodGroupIds = layouts.filter(l => l.direction === "output").map(l => `${l.kind}_${l.direction}_buffer`);
  return {
    recipeChannels: (ingGroupIds.length > 0 || prodGroupIds.length > 0)
      ? [createRecipeChannel("default", ingGroupIds, prodGroupIds)]
      : [],
    storageSlotGroups: layouts.map((layout) => createStorageSlotGroup(
      `${layout.kind}_${layout.direction}_buffer`,
      layout.kind,
      createSlots(
        `${layout.direction}_${layout.kind}_slot`,
        layout.capacities,
        resolveSlotFilterType(layout.kind),
      ),
    )),
    portStorageBindings: layouts.map((layout) => createBinding(
      `bind_${layout.kind}_${layout.direction}`,
      `${layout.kind}_${layout.direction}`,
      `${layout.kind}_${layout.direction}_buffer`,
    )),
  };
}

/**
 * 从端口 kind 推导默认 acceptRule。
 * item → { base: { kind: "solid" }, exclude: [] }
 * fluid → { base: { kind: "liquid" }, exclude: [] }
 *
 * 对应《仿真运行原理》§3.1 表格中 Port 的 acceptRule 默认值。
 */
function acceptRuleFromPortKind(kind: PortGroupDefinition["kind"]): PortDefinition["acceptRule"] {
  return {
    base: kind === "fluid" ? { kind: "liquid" } : { kind: "solid" },
    exclude: [],
  };
}

/**
 * 创建搬运配方（传送带/管道用）。
 *
 * 对应《仿真运行原理》§3.2 配方类型中的 "reserved-item"：
 *   - 进度=100% 时消耗原料，占用存储
 *   - 原料在搬运过程中被"预定"，不可被他人使用
 *   - inputs: any(1) — 接受任意物品
 *   - outputs: same-as-input(1) — 输出与输入相同物品
 * 订正（2026-05-04）：传送带默认 2 秒；管道类设备在定义处显式传入 0.5 秒。
 * 订正（2026-05-05）：推进阶段若输出缓存可接收，则立即写入产物、消耗原料并结束当前 run；仅在推进阶段无法完整输出时，才留待二次结算阶段处理。
 */
// 订正（2026-05-06）：domain EntityDefinition 已移除 recipe 字段，createTransportRecipe 已删除。

/**
 * 创建空配方壳（生产设备初始配方占位）。
 *
 * 对应《仿真运行原理》§3.2 配方类型中的 "immediate-consume"：
 *   - 进度=0% 时立即扣除原料，不占用存储
 *   - inputs/outputs 初始为空，由用户在 Inspector 中选择外部配方后填充
 *
 * recipeId=null 时表示使用内联配方；
 * 用户在 recipeConfig 面板中选择外部配方后 recipeId 被设置为实际配方 ID。
 */
// 订正（2026-05-06）：domain EntityDefinition 已移除 recipe 字段，createRecipeShell 已删除。

/** 创建有向缓存代理链接定义。 */
// 订正（2026-05-06）：domain EntityDefinition 已移除 cacheLinks 字段，createCacheLink 已删除。

/** 创建传送带/管道标准有向代理链接。 */
// 订正（2026-05-06）：domain EntityDefinition 已移除 cacheLinks 字段，createTransportCacheLink 已删除。

// =========================================================================
// ENTITY_DEFINITIONS — 全部设备定义注册表
//
// 设备按 uiGroup 分组：
//   1. warehouse              — 仓库存取设备
//   2. beltLogistics          — 传送带物流设备
//   3. pipeLogistics          — 管道物流设备
//   4. basicProduction        — 基础生产设备
//   5. advancedManufacturing  — 高级合成制造
//   6. resourcePower          — 资源与电力
//   7. hidden                 — 隐藏设备（不显示在放置面板）
//
// 每个设备的注释标注了：
//   - 对应的游戏设备名称
//   - 缓存组数量与类型（ingredient/product/universal）
//   - 求解图节点数（每个 storageSlotGroup = 1 个节点，见《仿真运行原理》§5.1）
//   - 配方类型
//   - Link 类型
// =========================================================================

export const ENTITY_DEFINITIONS: EntityDefinition[] = [

  // =========================================================================
  // 仓库存取设备 (uiGroup: "warehouse")
  //
  // 仓储类设备的特点：
  //   - 大容量存储槽组（50+）
  //   - role="bidirectional" → universal 缓存类型
  //   - 通常 requiresPower=false（可在电网外运行）
  //   - 通过 warehouse-item-link 面板将槽位连接到仓库
  // =========================================================================

  /**
   * item_port_storager_1 — 协议存储箱（3×3）
   *
   * 缓存组：1 个 universal（6 槽 × 50 容量）
   * 求解图节点：1 个（所有槽位聚合到一个节点）
   * 端口：3 input(南) + 3 output(北)
   *
   * 对比《模拟器抽象方式》§2 的仓库取货口示例，
   * 本设备 slot.lock=null（未锁定），用户可通过 storageManagement 面板锁定。
   */
  createEntityDefinition({
    id: "item_port_storager_1",
    nameKey: "registry.entity.item_port_storager_1.name",
    spriteId: "item_port_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: [],
    requiresPower: false,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_storage",
        "item",
        createSlots("slot", [50, 50, 50, 50, 50, 50], "solid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_storage"], ["item_storage"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_storage"),
      createBinding("bind_item_output", "item_output", "item_storage"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["item_storage"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["item_storage"],
        slotIds: ["slot_1"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["item_storage"],
        slotIds: ["slot_2"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["item_storage"],
        slotIds: ["slot_3"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["item_storage"],
        slotIds: ["slot_4"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["item_storage"],
        slotIds: ["slot_5"],
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["item_storage"],
        slotIds: ["slot_6"],
      },
    ],
  }),

  /**
   * item_port_log_hongs_bus — 物流洪斯总线（4×8）
   * 空壳设备，仅用于放置面板展示。不参与仿真求解。
   */
  createEntityDefinition({
    id: "item_port_log_hongs_bus",
    nameKey: "registry.entity.item_port_log_hongs_bus.name",
    spriteId: "item_port_log_hongs_bus",
    footprint: { width: 4, height: 8 },
    uiGroup: "warehouse",
    tags: ["武陵", "bus"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),

  /**
   * item_port_log_hongs_bus_source — 物流洪斯总线源桩（4×4）
   * 空壳设备，仅用于放置面板展示。
   */
  createEntityDefinition({
    id: "item_port_log_hongs_bus_source",
    nameKey: "registry.entity.item_port_log_hongs_bus_source.name",
    spriteId: "item_port_log_hongs_bus_source",
    footprint: { width: 4, height: 4 },
    uiGroup: "warehouse",
    tags: ["武陵", "bus"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),

  /**
   * item_port_unloader_1 — 取货口（3×1）
   *
   * 缓存组：1 个 universal（单槽 × 1 容量）
   * 求解图节点：1 个
   * 端口：1 output(南)
   *
   * 通过 warehouse-item-link 面板将槽位连接到仓库。
   * ignoreStock 可设为 true 实现无限取货。
   */
  createEntityDefinition({
    id: "item_port_unloader_1",
    nameKey: "registry.entity.item_port_unloader_1.name",
    spriteId: "item_port_unloader_1",
    footprint: { width: 3, height: 1 },
    uiGroup: "warehouse",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("p_out_mid", 1, 0, "S")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "unloader_buffer",
        "item",
        createSlots("slot", [1], "solid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_output", "item_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
    ],
  }),

  /**
   * item_port_mix_pool_1 — 反应池（5×5）
   *
   * 缓存组：2 个 — 1 ingredient（5 槽 × 50 容量）+ 1 product（1 槽 × 1 容量）
   * 求解图节点：2 个
   * 端口：2 item-input(南) + 2 item-output(北) + 2 fluid-input(东) + 2 fluid-output(西)
   *      注意：item 和 fluid 端口都绑定到同一组存储槽组（shared_input_buffer / shared_output_buffer）
   *      因为 itemFilterType="any"，该缓存组可接收固体和液体。
   *
   * 对应《仿真运行原理》§3.4 缓存组示例：
   *   - 1 个缓存组，5 个槽位（反应池普通版）
   *   - 组内互斥：同物品只能出现在一个槽
   *   - 输入缓存组同时接收 item 和 fluid 端口
   *
   * 配方：immediate-consume（进度 0% 时立即扣除原料）
   */
  createEntityDefinition({
    id: "item_port_mix_pool_1",
    nameKey: "registry.entity.item_port_mix_pool_1.name",
    spriteId: "item_port_mix_pool_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
      createPortGroup(
        "item_input",
        "item",
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [1, 3].map((y) => createPort(`out_w_${y}`, 0, y, "W")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [1, 3].map((y) => createPort(`in_e_${y}`, 4, y, "E")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "shared_input_buffer",
        "item",
        createSlots("input_slot", [50, 50, 50, 50, 50], "any"),
      ),
      createStorageSlotGroup(
        "shared_output_buffer",
        "item",
        createSlots("output_slot", [1], "any"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["shared_input_buffer", "shared_output_buffer"], ["shared_input_buffer", "shared_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_output_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "shared_output_buffer"),
    ],
  }),
  // =========================================================================
  // 基础生产设备 (uiGroup: "basicProduction")
  //
  // 生产设备的特点（对应《仿真运行原理》§3.2）：
  //   - immediate-consume 配方：进度 0% 时立即扣除原料
  //   - 独立的 ingredient 缓存组（输入缓冲）+ product 缓存组（输出缓冲）
  //   - recipe 通过 recipeConfig 面板选择外部配方
  // 订正（2026-05-06）：domain EntityDefinition 已移除 recipe 字段，本注册表仅保留静态端口与缓存结构。
  // =========================================================================

  /**
   * item_port_grinder_1 — 粉碎机（3×3）
   *
   * 缓存组：2 个 — 1 ingredient（1 槽 × 50）+ 1 product（1 槽 × 50）
   * 端口：3 input(南) + 3 output(北)
   * 配方：immediate-consume + recipeShell（选择外部配方 "r_crusher_*"）
   */
  createEntityDefinition({
    id: "item_port_grinder_1",
    nameKey: "registry.entity.item_port_grinder_1.name",
    spriteId: "item_port_grinder_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "item_output_buffer"], ["item_input_buffer", "item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  /**
   * item_port_liquid_filling_pd_mc_1 — 液体填充器（6×4，液体变体）
   *
   * 缓存组：3 个 — 1 ingredient-item（1 槽 × 50）+ 1 ingredient-fluid（1 槽 × 50）+ 1 product（1 槽 × 50）
   * 端口：6 item-input(南) + 1 fluid-input(东) + 6 item-output(北)
   *
   * 本设备是 item_port_filling_pd_mc_1 的液体变体（alter-variant:liquid），
   * 增加了 fluid_input 端口和对应的 fluid 输入缓冲。
   */
  createEntityDefinition({
    id: "item_port_liquid_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_liquid_filling_pd_mc_1.name",
    spriteId: "item_port_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "basicProduction",
    tags: ["alter:item_port_filling_pd_mc_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e_2", 5, 2, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "fluid_input_buffer",
        "fluid",
        createSlots("input_fluid_slot", [50], "liquid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer", "item_output_buffer"], ["item_input_buffer", "fluid_input_buffer", "item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_port_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_filling_pd_mc_1.name",
    spriteId: "item_port_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_item_slot", [50,50], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "item_output_buffer"], ["item_input_buffer", "item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
  }),
  // =========================================================================
  // 传送带物流设备 (uiGroup: "beltLogistics" 或 "hidden")
  //
  // 传送带设备的特点（对应《仿真运行原理》§5.1.1-5.1.3）：
  //   - 2 个缓存组：ingredient + product（各 1 槽 × 1 容量）
  // 订正（2026-05-07）：传送带现定义为 1 个 bidirectional 缓存组（1 槽 × 1 容量），编译时按 share-cap 分解为 ingredient 输入视图 + product 输出视图。
  //   - 2 个求解图节点
  //   - Cache Link 约束两端累计容量上限=1
  //   - reserved-item 搬运配方：any × 1s → same-as-input
  // 订正（2026-05-04）：传送带搬运配方时间为 2 秒。
  //   - 分流器/汇流器/连接器：多端口绑定到同一组节点
  //   - uiGroup="hidden" 的设备不显示在放置面板（由传送带绘制工具自动生成）
  // 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks 字段，本注册表不再内联这些运行时配置。
  // =========================================================================

  /**
   * belt_straight_1x1 — 传送带直段（1×1）
   * 端口：W→E 流向
   */
  createEntityDefinition({
    id: "belt_straight_1x1",
    nameKey: "registry.entity.belt_straight_1x1.name",
    spriteId: "belt_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        "item",
        createSlots("slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
  }),

  /**
   * belt_turn_cw_1x1 — 传送带顺时针转弯（1×1）
   * 端口：W→S 流向
   * 订正（2026-05-10）：当前端口基准改为 E→N 流向。
   */
  createEntityDefinition({
    id: "belt_turn_cw_1x1",
    nameKey: "registry.entity.belt_turn_cw_1x1.name",
    spriteId: "belt_turn_cw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_n", 0, 0, "N")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        "item",
        createSlots("slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
  }),

  /**
   * belt_turn_ccw_1x1 — 传送带逆时针转弯（1×1）
   * 端口：W→N 流向
   * 订正（2026-05-10）：当前端口基准改为 N→E 流向。
   */
  createEntityDefinition({
    id: "belt_turn_ccw_1x1",
    nameKey: "registry.entity.belt_turn_ccw_1x1.name",
    spriteId: "belt_turn_ccw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        "item",
        createSlots("slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
  }),
  /**
   * item_log_splitter — 分流器（1×1）
   *
   * 缓存组：2 个 — ingredient + product（自动合成，各 1 槽 × 1 容量）
   * 求解图节点：2 个
   * 端口：1 input(东) + 3 output(北/南/西)
   *
   * 对应《仿真运行原理》§5.1.2：
   *   1 个 input port → ingredient 组节点，3 个 output port → product 组节点
   *   多个端口连接到同一个组节点是合法且预期的。
   *   调度由 port 的 priorityGroup 和 roundRobinSeed 控制。
   */
  createEntityDefinition({
    id: "item_log_splitter",
    nameKey: "registry.entity.item_log_splitter.name",
    spriteId: "item_log_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
        ],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原"无显式存储组 → 编译器自动合成"已失效。
    // 现改为显式 bidirectional+share-cap，与 belt_straight_1x1 结构一致，
    // 使编译器生成 input-view/output-view 节点 + share-cap link + reserved-item 搬运配方。
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        "item",
        createSlots("slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
  }),

  /**
   * item_log_converger — 汇流器（1×1）
   *
   * 对应《仿真运行原理》§5.1.2：
   *   3 个 input port → ingredient 组节点，1 个 output port → product 组节点
   */
  createEntityDefinition({
    id: "item_log_converger",
    nameKey: "registry.entity.item_log_converger.name",
    spriteId: "item_log_converger",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_e", 0, 0, "E"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_w", 0, 0, "W")],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 storageSlotGroups: [] 已失效。
    // 现改为显式 bidirectional+share-cap，与 belt_straight_1x1 结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        "item",
        createSlots("slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
  }),

  /**
   * item_log_connector — 连接器/十字路口（1×1）
   * 4 方向双通道独立运输：N↔S 与 W↔E 互不干扰。
   * 对应《仿真运行原理》§5.1 桥类设备双通道双槽位模型。
   * AI-CORRECTION 2026-05-16: 从单通道 synthetic 节点重构为 NS/EW 双通道。
   *   - ns_buffer: N+S 端口绑定，share-cap 拆分 input-view/output-view
   *   - ew_buffer: W+E 端口绑定，share-cap 拆分 input-view/output-view
   *   - NS channel: ns_buffer → ns_buffer（同通道搬运）
   *   - EW channel: ew_buffer → ew_buffer（同通道搬运）
   *   禁止 N↔E、N↔W 等跨方向输送。
   */
  createEntityDefinition({
    id: "item_log_connector",
    nameKey: "registry.entity.item_log_connector.name",
    spriteId: "item_log_connector",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input_ns",
        "item",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "item_output_ns",
        "item",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "item_input_ew",
        "item",
        "input",
        [
          createPort("in_w", 0, 0, "W"),
          createPort("in_e", 0, 0, "E"),
        ],
      ),
      createPortGroup(
        "item_output_ew",
        "item",
        "output",
        [
          createPort("out_w", 0, 0, "W"),
          createPort("out_e", 0, 0, "E"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "ns_buffer",
        "item",
        createSlots("ns_slot", [1], "solid"),
        "share-cap",
      ),
      createStorageSlotGroup(
        "ew_buffer",
        "item",
        createSlots("ew_slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("NS", ["ns_buffer"], ["ns_buffer"]),
      createRecipeChannel("EW", ["ew_buffer"], ["ew_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input_ns", "item_input_ns", "ns_buffer"),
      createBinding("bind_item_output_ns", "item_output_ns", "ns_buffer"),
      createBinding("bind_item_input_ew", "item_input_ew", "ew_buffer"),
      createBinding("bind_item_output_ew", "item_output_ew", "ew_buffer"),
    ],
  }),
  // =========================================================================
  // 管道物流设备 (uiGroup: "pipeLogistics" 或 "hidden")
  //
  // 管道设备与传送带结构相同（对应《仿真运行原理》§5.1.4）：
  //   - 2 个缓存组：ingredient + product（自动合成，kind="fluid"）
  //   - Cache Link
  //   - reserved-item 搬运配方
  // 订正（2026-05-04）：管道类搬运配方时间为 0.5 秒。
  //   - 仅物品域为 liquid
  // 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks 字段，本注册表不再内联这些运行时配置。
  // =========================================================================

  /**
   * pipe_straight_1x1 — 管道直段（1×1）
   * 端口：W→E 流向
   */
  createEntityDefinition({
    id: "pipe_straight_1x1",
    nameKey: "registry.entity.pipe_straight_1x1.name",
    spriteId: "pipe_straight_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [],
    recipeChannels: [
      createRecipeChannel("default", ["synthetic-input"], ["synthetic-output"]),
    ],
    portStorageBindings: [],
  }),

  /**
   * pipe_turn_cw_1x1 — 管道顺时针转弯（1×1）
   * 订正（2026-05-10）：当前端口基准为 E→N 流向。
   */
  createEntityDefinition({
    id: "pipe_turn_cw_1x1",
    nameKey: "registry.entity.pipe_turn_cw_1x1.name",
    spriteId: "pipe_turn_cw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_n", 0, 0, "N")],
      ),
    ],
    storageSlotGroups: [],
    recipeChannels: [
      createRecipeChannel("default", ["synthetic-input"], ["synthetic-output"]),
    ],
    portStorageBindings: [],
  }),

  /**
   * pipe_turn_ccw_1x1 — 管道逆时针转弯（1×1）
   * 订正（2026-05-10）：当前端口基准为 N→E 流向。
   */
  createEntityDefinition({
    id: "pipe_turn_ccw_1x1",
    nameKey: "registry.entity.pipe_turn_ccw_1x1.name",
    spriteId: "pipe_turn_ccw_1x1",
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_n", 0, 0, "N")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    storageSlotGroups: [],
    recipeChannels: [
      createRecipeChannel("default", ["synthetic-input"], ["synthetic-output"]),
    ],
    portStorageBindings: [],
  }),

  /**
   * item_pipe_splitter — 管道分流器（1×1）
   * 与 item_log_splitter 结构相同，kind 为 fluid。
   */
  createEntityDefinition({
    id: "item_pipe_splitter",
    nameKey: "registry.entity.item_pipe_splitter.name",
    spriteId: "item_pipe_splitter",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e", 0, 0, "E")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
          createPort("out_w", 0, 0, "W"),
        ],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 storageSlotGroups: [] 已失效。
    // 现改为显式 bidirectional+share-cap（fluid），与 pipe 直段结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_buffer",
        "fluid",
        createSlots("slot", [1], "liquid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_buffer"], ["fluid_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_buffer"),
    ],
  }),

  /**
   * item_pipe_converger — 管道汇流器（1×1）
   */
  createEntityDefinition({
    id: "item_pipe_converger",
    nameKey: "registry.entity.item_pipe_converger.name",
    spriteId: "item_pipe_converger",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_e", 0, 0, "E"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_w", 0, 0, "W")],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 storageSlotGroups: [] 已失效。
    // 现改为显式 bidirectional+share-cap（fluid），与 pipe 直段结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_buffer",
        "fluid",
        createSlots("slot", [1], "liquid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_buffer"], ["fluid_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_buffer"),
    ],
  }),

  /**
   * item_pipe_connector — 管道连接器/十字路口（1×1）
   * 4 方向双通道独立运输：N↔S 与 W↔E 互不干扰，ChevronHidden=不显示方向箭头。
   * 对应《仿真运行原理》§5.1 桥类设备双通道双槽位模型。
   * AI-CORRECTION 2026-05-16: 从单通道 synthetic 节点重构为 NS/EW 双通道。
   *   - ns_buffer: N+S 端口绑定，share-cap 拆分 input-view/output-view
   *   - ew_buffer: W+E 端口绑定，share-cap 拆分 input-view/output-view
   *   - NS channel: ns_buffer → ns_buffer（同通道搬运）
   *   - EW channel: ew_buffer → ew_buffer（同通道搬运）
   *   禁止 N↔E、N↔W 等跨方向输送。
   */
  createEntityDefinition({
    id: "item_pipe_connector",
    nameKey: "registry.entity.item_pipe_connector.name",
    spriteId: "item_pipe_connector",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed", "ChevronHidden"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input_ns",
        "fluid",
        "input",
        [
          createPort("in_n", 0, 0, "N"),
          createPort("in_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "fluid_output_ns",
        "fluid",
        "output",
        [
          createPort("out_n", 0, 0, "N"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
      createPortGroup(
        "fluid_input_ew",
        "fluid",
        "input",
        [
          createPort("in_w", 0, 0, "W"),
          createPort("in_e", 0, 0, "E"),
        ],
      ),
      createPortGroup(
        "fluid_output_ew",
        "fluid",
        "output",
        [
          createPort("out_w", 0, 0, "W"),
          createPort("out_e", 0, 0, "E"),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "ns_buffer",
        "fluid",
        createSlots("ns_slot", [1], "liquid"),
        "share-cap",
      ),
      createStorageSlotGroup(
        "ew_buffer",
        "fluid",
        createSlots("ew_slot", [1], "liquid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("NS", ["ns_buffer"], ["ns_buffer"]),
      createRecipeChannel("EW", ["ew_buffer"], ["ew_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input_ns", "fluid_input_ns", "ns_buffer"),
      createBinding("bind_fluid_output_ns", "fluid_output_ns", "ns_buffer"),
      createBinding("bind_fluid_input_ew", "fluid_input_ew", "ew_buffer"),
      createBinding("bind_fluid_output_ew", "fluid_output_ew", "ew_buffer"),
    ],
  }),

  /**
   * item_port_udpipe_loader_1 — 地下管道装载口（3×3）
   * 流体输入方向。仅 1 个 input port(西)。
   */
  createEntityDefinition({
    id: "item_port_udpipe_loader_1",
    nameKey: "registry.entity.item_port_udpipe_loader_1.name",
    spriteId: "item_port_udpipe_loader_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
    ],
    storageSlotGroups: [],
    portStorageBindings: [],
  }),

  /**
   * item_port_udpipe_unloader_1 — 暗管出口（3×3）
   *
   * 缓存组：1 个 universal（单槽 × 1 容量）
   * 求解图节点：1 个
   * 端口：1 fluid output(东)
   *
   * 通过 warehouse-item-link 面板将槽位连接到仓库。
   * 与取货口结构一致，区别在于 kind="fluid" 限制仅可选液体。
   * ignoreStock 可设为 true 实现无限取货。
   */
  createEntityDefinition({
    id: "item_port_udpipe_unloader_1",
    nameKey: "registry.entity.item_port_udpipe_unloader_1.name",
    spriteId: "item_port_udpipe_unloader_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e_1", 2, 1, "E")],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "unloader_buffer",
        "fluid",
        createSlots("slot", [1], "liquid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
    ],
  }),

  // =========================================================================
  // 空壳设备 (v2 metadata sync)
  //
  // 以下设备仅保留 name, footprint, sprite, tags 和基础放置组信息。
  // 其端口组、存储槽组、端口绑定、配方均在编译时通过外部配方注册表
  // (recipe-definition.ts) 中的 machineId 对应关系注入。
  //
  // 对应《模拟器抽象方式》§5 编译期合并：
  //   编译时 EntityDefinition + 外部 RecipeDefinition → 完整 CompiledSimulationDevice
  //
  // 这些设备属于"未完成迁移"的设备，等待在后续 v2 迭代中
  // 补全 portGroups/storageSlotGroups/portStorageBindings/recipe 定义。
  // =========================================================================
  // 订正（2026-05-09）：本区块中的大部分设备已按 v2 静态端口补齐为完整定义；
  // 目前仍保留为空壳的仅有 v2 本身未提供静态端口的设备。

  createEntityDefinition({
    id: "item_port_loader_1",
    nameKey: "registry.entity.item_port_loader_1.name",
    spriteId: "item_port_loader_1",
    footprint: { width: 3, height: 1 },
    uiGroup: "warehouse",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("p_in_mid", 1, 0, "N")],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [1] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_furnance_1",
    nameKey: "registry.entity.item_port_furnance_1.name",
    spriteId: "item_port_furnance_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_liquid_furnance_1",
    nameKey: "registry.entity.item_port_liquid_furnance_1.name",
    spriteId: "item_port_liquid_furnance_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: ["武陵", "alter:item_port_furnance_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 5,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e_1", 2, 1, "E")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_w_1", 0, 1, "W")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "fluid", direction: "input", capacities: [50] },
      { kind: "fluid", direction: "output", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_cmpt_mc_1",
    nameKey: "registry.entity.item_port_cmpt_mc_1.name",
    spriteId: "item_port_cmpt_mc_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_shaper_1",
    nameKey: "registry.entity.item_port_shaper_1.name",
    spriteId: "item_port_shaper_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2].map((x) => createPort(`in_s_${x}`, x, 2, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_seedcol_1",
    nameKey: "registry.entity.item_port_seedcol_1.name",
    spriteId: "item_port_seedcol_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_planter_1",
    nameKey: "registry.entity.item_port_planter_1.name",
    spriteId: "item_port_planter_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    tags: [],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_hydro_planter_1",
    nameKey: "registry.entity.item_port_hydro_planter_1.name",
    spriteId: "item_port_planter_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    tags: ["武陵", "alter:item_port_planter_1", "alter-variant:liquid"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e_2", 4, 2, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "fluid", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_winder_1",
    nameKey: "registry.entity.item_port_winder_1.name",
    spriteId: "item_port_winder_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: [],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50, 50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_tools_asm_mc_1",
    nameKey: "registry.entity.item_port_tools_asm_mc_1.name",
    spriteId: "item_port_tools_asm_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: [],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50, 50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_thickener_1",
    nameKey: "registry.entity.item_port_thickener_1.name",
    spriteId: "item_port_thickener_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: [],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50, 50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_power_sta_1",
    nameKey: "registry.entity.item_port_power_sta_1.name",
    spriteId: "item_port_power_sta_1",
    footprint: { width: 2, height: 2 },
    uiGroup: "resourcePower",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1].map((x) => createPort(`in_s_${x}`, x, 1, "S")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_mix_pool_large_1",
    nameKey: "registry.entity.item_port_mix_pool_large_1.name",
    spriteId: "item_port_mix_pool_large_1",
    footprint: { width: 6, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
      createPortGroup(
        "item_input",
        "item",
        "input",
        [1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [1, 3].map((y) => createPort(`out_w_${y}`, 0, y, "W")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [1, 3].map((y) => createPort(`in_e_${y}`, 5, y, "E")),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "shared_input_buffer",
        "item",
        createSlots("input_slot", [50, 50, 50, 50, 50], "any"),
      ),
      createStorageSlotGroup(
        "shared_output_buffer",
        "item",
        createSlots("output_slot", [1], "any"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["shared_input_buffer", "shared_output_buffer"], ["shared_input_buffer", "shared_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_output_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "shared_output_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_port_liquid_purifier_1",
    nameKey: "registry.entity.item_port_liquid_purifier_1.name",
    spriteId: "item_port_liquid_purifier_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "fluid", direction: "input", capacities: [50] },
      { kind: "fluid", direction: "output", capacities: [50, 50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_xiranite_oven_1",
    nameKey: "registry.entity.item_port_xiranite_oven_1.name",
    spriteId: "item_port_xiranite_oven_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_e_2", 4, 2, "E")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "fluid", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_dismantler_1",
    nameKey: "registry.entity.item_port_dismantler_1.name",
    spriteId: "item_port_dismantler_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    tags: ["武陵"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`in_s_${x}`, x, 3, "S")),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [0, 1, 2, 3, 4, 5].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_w_2", 0, 2, "W")],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
      { kind: "fluid", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_sp_hub_1",
    nameKey: "registry.entity.item_port_sp_hub_1.name",
    spriteId: "item_port_sp_hub_1",
    footprint: { width: 9, height: 9 },
    uiGroup: "hidden",
    tags: [],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [
          ...[1, 2, 3, 4, 5, 6, 7].map((x) => createPort(`in_n_${x + 1}`, x, 0, "N")),
          ...[1, 2, 3, 4, 5, 6, 7].map((x) => createPort(`in_s_${x + 1}`, x, 8, "S")),
        ],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [
          ...[1, 4, 7].map((y) => createPort(`out_w_${y + 1}`, 0, y, "W")),
          ...[1, 4, 7].map((y) => createPort(`out_e_${y + 1}`, 8, y, "E")),
        ],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_water_pump_1",
    nameKey: "registry.entity.item_port_water_pump_1.name",
    spriteId: "item_port_water_pump_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e_1", 2, 1, "E")],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "fluid", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_udpipe_loader_2",
    nameKey: "registry.entity.item_port_udpipe_loader_2.name",
    spriteId: "item_port_udpipe_loader_2",
    footprint: { width: 3, height: 5 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [
          createPort("in_w_1", 0, 1, "W"),
          createPort("in_w_2", 0, 3, "W"),
        ],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "fluid", direction: "input", capacities: [1] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_udpipe_unloader_2",
    nameKey: "registry.entity.item_port_udpipe_unloader_2.name",
    spriteId: "item_port_udpipe_unloader_2",
    footprint: { width: 3, height: 5 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [
          createPort("out_e_1", 0, 1, "W"),
          createPort("out_e_2", 0, 3, "W"),
        ],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "fluid", direction: "output", capacities: [1] },
    ]),
  }),
  createEntityDefinition({
    id: "item_liquid_cleaner_1",
    nameKey: "registry.entity.item_liquid_cleaner_1.name",
    spriteId: "item_liquid_cleaner_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: true,
    powerDemand: 20,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "fluid", direction: "input", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_liquid_storager_1",
    nameKey: "registry.entity.item_port_liquid_storager_1.name",
    spriteId: "item_port_liquid_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    tags: ["武陵", "OuterRingAllowed", "alter:item_port_storager_1", "alter-variant:liquid"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e_1", 2, 1, "E")],
      ),
    ],
    ...createDirectionalBuffers([
      { kind: "fluid", direction: "input", capacities: [50] },
      { kind: "fluid", direction: "output", capacities: [50] },
    ]),
  }),
  createEmptyEntityDefinition({
    id: "item_port_power_diffuser_1",
    nameKey: "registry.entity.item_port_power_diffuser_1.name",
    spriteId: "item_port_power_diffuser_1",
    footprint: { width: 2, height: 2 },
    uiGroup: "resourcePower",
    tags: [],
  }),
  createEntityDefinition({
    id: "item_log_admission",
    nameKey: "registry.entity.item_log_admission.name",
    spriteId: "item_log_admission",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    tags: ["BeltFamily"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 createDirectionalBuffers（分离 input+output 组）已失效。
    // 现改为 bidirectional+share-cap，与 belt_straight_1x1 结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_buffer",
        "item",
        createSlots("slot", [1], "solid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_buffer"], ["item_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_buffer"),
      createBinding("bind_item_output", "item_output", "item_buffer"),
    ],
  }),
  createEntityDefinition({
    id: "item_pipe_admission",
    nameKey: "registry.entity.item_pipe_admission.name",
    spriteId: "item_pipe_admission",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w", 0, 0, "W")],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 createDirectionalBuffers（分离 input+output 组）已失效。
    // 现改为 bidirectional+share-cap，与 pipe 直段结构一致。
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_buffer",
        "fluid",
        createSlots("slot", [1], "liquid"),
        "share-cap",
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_buffer"], ["fluid_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_buffer"),
    ],
  }),
];
