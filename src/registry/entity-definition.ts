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
  EntityBlockageAutoClearanceDefinition,
  ItemFilterType,
  EntityPlacementDefaults,
} from "@/domain/registry/types/entity-definition";
import {
  INSPECTOR_TYPE,
  type EntityInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import {
  PLACEMENT_BEHAVIOR_TYPE,
  type EntityPlacementBehaviorDeclaration,
} from "@/domain/registry/types/entity-placement-behavior";
import { DEFAULT_PORT_PRIORITY_GROUP } from "@/shared/port-priority-groups";
import {
  BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
  WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
  WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
  WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS,
  WATER_PURIFIER_INTAKE_CHANNEL_IDS,
  WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY,
  WATER_PURIFIER_NODE_ENTITY_ID,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
  WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY,
  WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
  WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
} from "@/shared/water-purifier-node";

import { ITEM_DEFINITIONS } from "./item-definition";
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
type StorageSlotOptionsInput = Partial<Pick<
  StorageSlotDefinition,
  "lock" | "initialItemType" | "initialCount" | "ignoreStock"
>>;

/** 端口朝向简写：N=北 S=南 W=西 E=东（相对于设备 rotation=0） */
type PortEdgeInput = "N" | "S" | "W" | "E";

/** 槽位物品过滤类型：solid（固体）/ liquid（液体）/ any（任意） */
/** AI-CORRECTION 2026-07-10: 过滤类型新增 gas 与 fluid；fluid 表示液体或气体，仅管道基础设施默认使用。 */
type FilterType = ItemFilterType;

/** createPort() 的输入类型 — 必填字段 + 可选覆盖字段 */
type PortDefinitionInput = Pick<
  PortDefinition,
  "id" | "localCellX" | "localCellY" | "edge"
> & Partial<Pick<
  PortDefinition,
  "acceptRule" | "admissionRule" | "priorityGroup" | "roundRobinSeed"
>>;

/** createEntityDefinition() 的输入类型 — inspectors / placementBehaviors / recipeChannels / displayOrder 可选，由工厂补全默认值 */
type EntityDefinitionInput = Omit<EntityDefinition, "inspectors" | "placementBehaviors" | "recipeChannels" | "displayOrder"> & {
  readonly inspectors?: readonly EntityInspectorDeclaration[];
  readonly placementBehaviors?: readonly EntityPlacementBehaviorDeclaration[];
  readonly recipeChannels?: readonly EntityDefinition["recipeChannels"][number][];
  readonly displayOrder?: number;
};

/** createEmptyEntityDefinition() 的输入类型 — 基础字段必填，电力字段可选 */
type EmptyEntityDefinitionInput = Pick<
  EntityDefinitionInput,
  "id" | "nameKey" | "spriteId" | "footprint" | "uiGroup" | "tags"
> & Partial<Pick<EntityDefinitionInput, "requiresPower" | "powerDemand" | "powerRange" | "displayOrder">>;

const RECIPE_MACHINE_IDS = new Set(
  RECIPE_DEFINITIONS.map((recipe) => recipe.machineId),
);

const LIQUID_PURIFIER_LEFT_OUTPUT_ITEM_IDS = [
  "item_liquid_water",
  "item_liquid_acid",
] as const;

const LIQUID_PURIFIER_RIGHT_OUTPUT_ITEM_IDS = [
  "item_liquid_xiranite_poly",
  "item_liquid_copper_enr",
] as const;

function createLiquidPurifierOutputAcceptRule(
  itemIds: readonly string[],
): PortDefinition["acceptRule"] {
  const allowedItemIds = new Set<string>(itemIds);
  return {
    base: { kind: "fluid" },
    exclude: ITEM_DEFINITIONS
      .filter((item) => item.tags.includes("liquid") && !allowedItemIds.has(item.id))
      .map((item) => item.id)
      .sort(),
  };
}

const ALLOW_PIPE_OVERLAP_PLACEMENT_BEHAVIORS = [
  { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
] as const satisfies readonly EntityPlacementBehaviorDeclaration[];

const DEDICATED_BELT_PLACEMENT_BEHAVIORS = [
  { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
  { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
] as const satisfies readonly EntityPlacementBehaviorDeclaration[];

const WAREHOUSE_BUS_SEGMENT_PLACEMENT_BEHAVIORS = [
  { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
  { type: PLACEMENT_BEHAVIOR_TYPE.mustConnectToHub },
  { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
] as const satisfies readonly EntityPlacementBehaviorDeclaration[];

const WAREHOUSE_BUS_SOURCE_PLACEMENT_BEHAVIORS = [
  { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
  { type: PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase },
] as const satisfies readonly EntityPlacementBehaviorDeclaration[];

const WAREHOUSE_PORT_PLACEMENT_BEHAVIORS = [
  { type: PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap },
  { type: PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge },
] as const satisfies readonly EntityPlacementBehaviorDeclaration[];

const WAREHOUSE_SINK_TAG = "WarehouseSink";
const PRODUCER_TAG = "Producer";

// AI-REMOVED 2026-06-06:
// Reason: 协议核心输入缓存不再通过 submitMode 每 tick 入仓；统一走 WarehouseSink 动态入仓。
// Trigger: 用户要求 submit mode 机制彻底删除，未来都用 warehouse sink 或配方交货。
// Evidence: RUN_ID 20260606-041337-509040 中 every-tick 全局提交导致产线目标箱库存被清空。
// Replacement: WAREHOUSE_SINK_TAG + simulation/runtime/runtime-slot-access.ts 动态仓库槽写入。
// Risk: Medium
// Human Review: Required
//
// Original code:
// const AUTO_SUBMIT_EVERY_TICK_SLOT_OPTIONS = {
//   submitMode: "every-tick",
// } as const satisfies StorageSlotOptionsInput;

// =========================================================================
// 工厂函数
// =========================================================================

/**
 * 创建完整实体定义。
 * 确保 recipeChannels/inspectors 始终为非 null/undefined 的规范化值。
 * 对应《模拟器抽象方式》§2 — Entity 定义层的完整属性默认值。
 * 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks。
 * AI-CORRECTION 2026-06-09: links 字段已从 EntityDefinition 移除，所有槽位链接统一存于 document.slotLinks。
 */
function createEntityDefinition(definition: EntityDefinitionInput): EntityDefinition {
  const normalizedDefinition = normalizePipeFamilyFluidDefinition(definition);
  const declaredInspectors = [...(normalizedDefinition.inspectors ?? [])];
  const recipeMachineInspectors = createRecipeMachineIngredientSlotInspectors(normalizedDefinition);

  // 所有设备默认追加问题面板，用于展示放置/电力/堵塞等问题
  declaredInspectors.unshift({ type: INSPECTOR_TYPE.problem });
  if (
    normalizedDefinition.meteredConsumption !== undefined
    && !declaredInspectors.some((inspector) => inspector.type === INSPECTOR_TYPE.meteredConsumption)
  ) {
    declaredInspectors.push({ type: INSPECTOR_TYPE.meteredConsumption });
  }

  return {
    ...normalizedDefinition,
    displayOrder: normalizedDefinition.displayOrder ?? 100,
    recipeChannels: [...(normalizedDefinition.recipeChannels ?? [])],
    placementBehaviors: normalizePlacementBehaviors(normalizedDefinition.placementBehaviors ?? []),
    inspectors: appendMissingInspectors(declaredInspectors, recipeMachineInspectors),
  };
}

function normalizePipeFamilyFluidDefinition(definition: EntityDefinitionInput): EntityDefinitionInput {
  if (!definition.tags.includes("PipeFamily")) {
    return definition;
  }

  return {
    ...definition,
    portGroups: definition.portGroups.map((portGroup) =>
      portGroup.kind === "fluid"
        ? {
            ...portGroup,
            ports: portGroup.ports.map((port) => ({
              ...port,
              acceptRule: normalizePipeFamilyAcceptRule(port.acceptRule),
            })),
          }
        : portGroup,
    ),
    storageSlotGroups: definition.storageSlotGroups.map((storageSlotGroup) =>
      storageSlotGroup.kind === "fluid"
        ? {
            ...storageSlotGroup,
            slots: storageSlotGroup.slots.map((slot) => ({
              ...slot,
              itemFilterType: slot.itemFilterType === "liquid" ? "fluid" : slot.itemFilterType,
            })),
          }
        : storageSlotGroup,
    ),
  };
}

function normalizePipeFamilyAcceptRule(
  acceptRule: PortDefinition["acceptRule"],
): PortDefinition["acceptRule"] {
  return acceptRule.base.kind === "liquid" && acceptRule.exclude.length === 0
    ? { base: { kind: "fluid" }, exclude: [] }
    : acceptRule;
}

function normalizePlacementBehaviors(
  behaviors: readonly EntityPlacementBehaviorDeclaration[],
): EntityPlacementBehaviorDeclaration[] {
  const normalized: EntityPlacementBehaviorDeclaration[] = [];
  const seenTypes = new Set<string>();

  for (const behavior of [
    { type: PLACEMENT_BEHAVIOR_TYPE.defaultPlacement } as const,
    ...behaviors,
  ]) {
    if (seenTypes.has(behavior.type)) {
      continue;
    }

    seenTypes.add(behavior.type);
    normalized.push(behavior);
  }

  return normalized;
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
 * inspectors/portGroups/storageSlotGroups/recipeChannels/portStorageBindings 均为空数组。
 * 订正（2026-05-06）：domain EntityDefinition 已移除 recipe/cacheLinks。
 * AI-CORRECTION 2026-06-09: EntityDefinition.links 已移除，空壳定义不再设置 links: []。
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
 * admissionRule 仅由准入口 input port 显式声明。
 * priorityGroup 默认 5。
 * roundRobinSeed 默认等于端口在组内的 index。
 */
function createPort(
  id: string,
  localCellX: number,
  localCellY: number,
  edge: PortEdgeInput,
  options: Partial<Pick<
    PortDefinition,
    "acceptRule" | "admissionRule" | "priorityGroup" | "roundRobinSeed"
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
 * 每个端口的 acceptRule 默认按 kind 推导，
 * priorityGroup 默认 5，roundRobinSeed 默认按 index 递增。
 *
 * 对应《仿真运行原理》§3.1 中 Port 的 accept-rule 配置。
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
      // AI-REMOVED 2026-06-12:
      // Reason: createPortGroup 不再为端口补 count 默认值，per-tick count 已从设计中删除。
      // Trigger: 用户确认 per tick count 应删除。
      // Evidence: PortDefinition.count 已注释化删除。
      // Replacement: admissionRule 只在 admission input port 上显式声明。
      // Risk: Medium - 旧依赖 count 的测试或配置需要迁移。
      // Human Review: Required
      //
      // Original code:
      // count: port.count ?? "unlimited",
      priorityGroup: port.priorityGroup ?? DEFAULT_PORT_PRIORITY_GROUP,
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
 * AI-CORRECTION 2026-07-10: itemFilterType 现在还支持 gas 与 fluid；fluid 表示 liquid/gas。
 * AI-CORRECTION 2026-06-06: submitMode 不再作为可配置运行时语义；槽位仅保留 domain 默认字段，入仓改用 WarehouseSink 或配方。
 * AI-CORRECTION 2026-06-06: domain 默认 submitMode 字段也已删除；createSlot 不再生成旧提交字段。
 */
function createSlot(
  id: string,
  capacity: number,
  itemFilterType: FilterType,
  options: StorageSlotOptionsInput = {},
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
    // AI-REMOVED 2026-06-06:
    // Reason: StorageSlotDefinition 已删除 submitMode / submitIntervalSeconds，registry 不再生成默认提交字段。
    // Trigger: 用户要求 submit mode 机制彻底删除。
    // Evidence: simulation 编译槽位和 runtime 全局提交扫描已删除对应字段。
    // Replacement: WarehouseSink tag / r_warehouse_submit recipe.
    // Risk: Medium - 旧 config 同名键仅作为蓝图遗留数据存在，不进入实体定义默认值。
    // Human Review: Required
    //
    // Original code:
    // submitMode: "never",
    // submitIntervalSeconds: null,
  };
}

/**
 * 批量创建同质槽位（相同 itemFilterType，不同 capacity）。
 * AI-CORRECTION 2026-06-06: 支持传入同质槽位共享 options，用于批量设置 submitMode 等槽位行为。
 * AI-CORRECTION 2026-06-06: submitMode 已删除，options 仅用于 lock / initial / ignoreStock 等静态槽位属性。
 * 槽位 ID 格式为 "${prefix}_1", "${prefix}_2", ...
 */
function createSlots(
  prefix: string,
  capacities: number[],
  itemFilterType: FilterType,
  options: StorageSlotOptionsInput = {},
): StorageSlotDefinition[] {
  return capacities.map((capacity, index) =>
    createSlot(`${prefix}_${index + 1}`, capacity, itemFilterType, options),
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
  manualRecipeOnly?: boolean,
): RecipeChannelDefinition {
  return { id, ingredientStorageGroupIds, productStorageGroupIds, manualRecipeOnly };
}

/**
 * 创建放置默认值。
 * 供设备定义在 placementDefaults 字段中使用，声明放置时自动写入的
 * entity.config 覆盖和自动创建的 slotLinks。
 */
function createPlacementDefaults(options: {
  config?: Record<string, unknown>;
  slotLinks?: EntityPlacementDefaults["slotLinks"];
}): EntityPlacementDefaults {
  return options;
}

function createBlockageAutoClearance(
  options: EntityBlockageAutoClearanceDefinition,
): EntityBlockageAutoClearanceDefinition {
  return options;
}

type DirectionalBufferLayoutInput = {
  kind: StorageSlotGroupDefinition["kind"];
  direction: "input" | "output";
  capacities: number[];
  // AI-REMOVED 2026-07-16:
  // Reason: 用户要求拆解机不再通过 helper 生成定义，注册表保持显式字典声明；该覆盖字段因此没有保留价值。
  // Trigger: 用户明确希望持续去除 helper，直接写入设备定义。
  // Evidence: itemFilterType 覆盖仅由 item_port_dismantler_1 使用；拆解机已在下方展开完整定义。
  // Replacement: item_port_dismantler_1.storageSlotGroups 中显式声明 fluid_output_buffer。
  // Risk: Low - 其他 createSimpleProductionDevice 调用仍使用既有默认物态推导。
  // Human Review: Required
  //
  // Original code:
  // itemFilterType?: FilterType;
};

function resolveSlotFilterType(kind: DirectionalBufferLayoutInput["kind"]): FilterType {
  return kind === "fluid" ? "liquid" : "solid";
}

/**
 * 简易生产设备工厂：批量生成 storageSlotGroups、portStorageBindings、recipeChannels 和 inspectors。
 *
 * 每个 layout 声明一个方向性缓冲（input/output, item/fluid, 多容量），
 * 函数自动生成对应的定义片段，减少样板代码。
 * AI-CORRECTION 2026-07-16: layout 可显式覆盖 itemFilterType，用于声明兼容液体与气体的生产设备缓存。
 * AI-CORRECTION 2026-07-16: 上述覆盖机制已按用户要求撤回；特殊设备改用显式字典声明。
 */
function createSimpleProductionDevice(
  layouts: readonly DirectionalBufferLayoutInput[],
): Pick<EntityDefinition, "storageSlotGroups" | "portStorageBindings" | "recipeChannels" | "inspectors"> {
  const ingGroupIds = layouts.filter(l => l.direction === "input").map(l => `${l.kind}_${l.direction}_buffer`);
  const prodGroupIds = layouts.filter(l => l.direction === "output").map(l => `${l.kind}_${l.direction}_buffer`);
  const hasChannel = ingGroupIds.length > 0 || prodGroupIds.length > 0;
  return {
    recipeChannels: hasChannel
      ? [createRecipeChannel("default", ingGroupIds, prodGroupIds)]
      : [],
    inspectors: hasChannel
      ? [
          {
            type: INSPECTOR_TYPE.recipeStatus,
            channelIds: ["default"],
          },
        ]
      : [],
    storageSlotGroups: layouts.map((layout) => createStorageSlotGroup(
      `${layout.kind}_${layout.direction}_buffer`,
      layout.kind,
      createSlots(
        `${layout.direction}_${layout.kind}_slot`,
        layout.capacities,
        // AI-REMOVED 2026-07-16:
        // Reason: itemFilterType 覆盖字段已撤回，helper 恢复原有默认物态推导。
        // Trigger: 用户要求拆解机脱离 createSimpleProductionDevice，避免为单个设备扩展 helper。
        // Evidence: item_port_dismantler_1 已显式声明气液兼容缓存。
        // Replacement: resolveSlotFilterType(layout.kind)。
        // Risk: Low
        // Human Review: Required
        //
        // Original code:
        // layout.itemFilterType ?? resolveSlotFilterType(layout.kind),
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
 * AI-CORRECTION 2026-07-10: fluid 端口默认仍是 liquid；仅 PipeFamily 定义会归一化为 fluid 以允许液体/气体共用管道。
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
// AI-REMOVED 2026-05-29:
// Reason: createRecipeShell JSDoc 块描述的代码已删除，其引用的 inspector 概念已另行重构为 submitToWarehouse。
// Replacement: 无（被删除代码无替代者）。
// Risk: Low
// Human Review: Not Required
//
// Original JSDoc:
// /**
//  * 创建空配方壳（生产设备初始配方占位）。
//  * ... recipeId=null 时表示使用内联配方；
//  * 用户在 submitToWarehouse 面板中选择外部配方后 recipeId 被设置为实际配方 ID。
//  */

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
   * 缓存组：6 个 universal（每组 1 槽 × 50 容量）
   * 编译节点：12 个（6 个输入视图节点 + 6 个输出视图节点）
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
    displayOrder: 401,
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
        "storage_slot_1",
        "item",
        createSlots("slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "storage_slot_2",
        "item",
        createSlots("slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "storage_slot_3",
        "item",
        createSlots("slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "storage_slot_4",
        "item",
        createSlots("slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "storage_slot_5",
        "item",
        createSlots("slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "storage_slot_6",
        "item",
        createSlots("slot", [50], "solid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("warehouse_submit", [], [], true),
    ],
    portStorageBindings: [
      createBinding("bind_item_input_1", "item_input", "storage_slot_1"),
      createBinding("bind_item_output_1", "item_output", "storage_slot_1"),
      createBinding("bind_item_input_2", "item_input", "storage_slot_2"),
      createBinding("bind_item_output_2", "item_output", "storage_slot_2"),
      createBinding("bind_item_input_3", "item_input", "storage_slot_3"),
      createBinding("bind_item_output_3", "item_output", "storage_slot_3"),
      createBinding("bind_item_input_4", "item_input", "storage_slot_4"),
      createBinding("bind_item_output_4", "item_output", "storage_slot_4"),
      createBinding("bind_item_input_5", "item_input", "storage_slot_5"),
      createBinding("bind_item_output_5", "item_output", "storage_slot_5"),
      createBinding("bind_item_input_6", "item_input", "storage_slot_6"),
      createBinding("bind_item_output_6", "item_output", "storage_slot_6"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["storage_slot_1", "storage_slot_2", "storage_slot_3", "storage_slot_4", "storage_slot_5", "storage_slot_6"],
      },
      {
        type: INSPECTOR_TYPE.submitToWarehouse,
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
    displayOrder: 405,
    tags: ["武陵", "bus"],
    placementBehaviors: WAREHOUSE_BUS_SEGMENT_PLACEMENT_BEHAVIORS,
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
    displayOrder: 406,
    tags: ["武陵", "bus"],
    placementBehaviors: WAREHOUSE_BUS_SOURCE_PLACEMENT_BEHAVIORS,
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
    spriteOffset: {
      topView: { x: 0, y: -1, width: 3, height: 2 },
    },
    uiGroup: "warehouse",
    displayOrder: 403,
    tags: ["AvatarHidden"],
    placementBehaviors: WAREHOUSE_PORT_PLACEMENT_BEHAVIORS,
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
   * 缓存组：1 个（shared_input_buffer，5 槽 × 50 容量），共享承担输入与输出。
   *   - 输入/输出端口全部绑定到该组，compiler 检测双向绑定后自动展开为
   *     input-view / output-view 双 Node + share-all Slot Link。
   * 求解图节点：2 个（输入视图 + 输出视图，共享同一组真实槽位）
   * 端口：2 item-input(南) + 2 item-output(北) + 2 fluid-input(东) + 2 fluid-output(西)
   *      因为 itemFilterType="any"，该缓存组可接收固体和液体。
   *
   * 对应《仿真运行原理》§3.3 缓存组示例：
   *   - 1 个槽位组，5 个槽位（反应池普通版）
   *   - 组内互斥：同物品只能出现在一个槽
   *
   * AI-CORRECTION 2026-05-30: 移除 shared_output_buffer；输入输出端口全部绑定 shared_input_buffer；
   * recipeChannel 的 ingredient/product 都只引用 shared_input_buffer。
   * 配方：immediate-consume（进度 0% 时立即扣除原料）
   */
  createEntityDefinition({
    id: "item_port_mix_pool_1",
    nameKey: "registry.entity.item_port_mix_pool_1.name",
    spriteId: "item_port_mix_pool_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 606,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 50,
    // AI-REMOVED 2026-07-16:
    // Reason: 首轮机械定位误把固气转化机的计量配置写入反应池；反应池没有 consume_input。
    // Trigger: 注册表补充 meteredConsumption 时命中了相邻的 powerDemand: 50 定义。
    // Evidence: item_port_mix_pool_1 的端口组不包含 consume_input，编译后配置必然失效。
    // Replacement: transmuter_2_gastrans.meteredConsumption。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // meteredConsumption: {
    //   inputPortGroupId: "consume_input",
    //   itemIds: ["item_gas_inert"],
    //   windowSeconds: 60,
    //   startThreshold: 6,
    //   acceptanceLimit: 30,
    //   gasDiffusionRange: null,
    // },
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, x, 0, "N", { acceptRule: { base: { kind: "none" }, exclude: [] } })),
      ),
      createPortGroup(
        "item_input",
        "item",
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_output_a",
        "fluid",
        "output",
        [createPort(`out_w_1`, 0, 1, "W", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
      ),
      createPortGroup(
        "fluid_output_b",
        "fluid",
        "output",
        [createPort(`out_w_3`, 0, 3, "W", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
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
    ],
    recipeChannels: [
      createRecipeChannel("ch1", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch2", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch3", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch4", ["shared_input_buffer"], ["shared_input_buffer"], true),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_input_buffer"),
      createBinding("bind_fluid_output_a", "fluid_output_a", "shared_input_buffer"),
      createBinding("bind_fluid_output_b", "fluid_output_b", "shared_input_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["ch1", "ch2", "ch3", "ch4"],
      },
      {
        type: INSPECTOR_TYPE.portOutputConfig,
        portGroupIds: ["item_output", "fluid_output_a", "fluid_output_b"],
      },
    ],
  }),
  // =========================================================================
  // 基础生产设备 (uiGroup: "basicProduction")
  //
  // 生产设备的特点（对应《仿真运行原理》§3.2）：
  //   - immediate-consume 配方：进度 0% 时立即扣除原料
  //   - 独立的 ingredient 缓存组（输入缓冲）+ product 缓存组（输出缓冲）
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
    displayOrder: 503,
    tags: [PRODUCER_TAG],
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
      // AI-REMOVED 2026-06-06:
      // Reason: 粉碎机产物不应写回原料槽；配方输入/产出槽位应由 Recipe Channel 精确声明。
      // Trigger: 用户指出 Recipe Channel 本应决定产物槽位，并要求先修正错误设备定义。
      // Evidence: 《仿真运行原理》§3.5 明确 productStorageGroupIds 表示配方产物写入哪些存储组；旧写法依赖 compiler 用端口方向过滤多余角色。
      // Replacement: 下方 default channel：ingredient=item_input_buffer，product=item_output_buffer。
      // Risk: Low - 当前 compiler 仍做端口方向过滤，修正后现有运行行为应保持不变；后续改为 channel-based 时避免产物回填输入槽。
      // Human Review: Required
      //
      // Original code:
      // createRecipeChannel("default", ["item_input_buffer", "item_output_buffer"], ["item_input_buffer", "item_output_buffer"]),
      createRecipeChannel("default", ["item_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      // AI-REMOVED 2026-07-16:
      // Reason: 首次批量补丁误将物流物品 Inspector 挂载到粉碎机，粉碎机不是物流设备。
      // Trigger: 用户要求仅对所有物流设备挂载“物流物品”Inspector。
      // Evidence: item_port_grinder_1 的 uiGroup 为 basicProduction，且不在 GENERAL_LOGISTICS_DEVICE_IDS 注册集合中。
      // Replacement: belt_straight_1x1 等 14 个物流设备的显式 inspectors 声明。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // {
      //   type: INSPECTOR_TYPE.logisticsItem,
      // },
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
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
   * AI-CORRECTION 2026-07-16: fluid_input 及其输入缓冲现兼容 liquid/gas。
   */
  createEntityDefinition({
    id: "item_port_liquid_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_liquid_filling_pd_mc_1.name",
    spriteId: "item_port_liquid_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    displayOrder: 603,
    tags: [PRODUCER_TAG, "alter:item_port_filling_pd_mc_1", "alter-variant:liquid"],
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
        [createPort("in_e_2", 5, 2, "E", {
          acceptRule: { base: { kind: "fluid" }, exclude: [] },
        })],
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
        createSlots("input_fluid_slot", [50], "fluid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_slot", [50], "solid"),
      ),
    ],
    recipeChannels: [
      // AI-REMOVED 2026-06-06:
      // Reason: 液体填充器产物不应写回物品/液体原料槽，原料槽也不应参与产物落槽。
      // Trigger: 用户指出 Recipe Channel 本应决定产物槽位，并要求先修正错误设备定义。
      // Evidence: 《仿真运行原理》§3.5 明确 ingredientStorageGroupIds / productStorageGroupIds 分别声明配方原料与产物存储组。
      // Replacement: 下方 default channel：ingredient=item_input_buffer+fluid_input_buffer，product=item_output_buffer。
      // Risk: Low - 当前 compiler 仍做端口方向过滤，修正后现有运行行为应保持不变；后续改为 channel-based 时避免产物回填输入槽。
      // Human Review: Required
      //
      // Original code:
      // createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer", "item_output_buffer"], ["item_input_buffer", "fluid_input_buffer", "item_output_buffer"]),
      createRecipeChannel("default", ["item_input_buffer", "fluid_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_filling_pd_mc_1",
    nameKey: "registry.entity.item_port_filling_pd_mc_1.name",
    spriteId: "item_port_filling_pd_mc_1",
    footprint: { width: 6, height: 4 },
    uiGroup: "advancedManufacturing",
    displayOrder: 602,
    tags: [PRODUCER_TAG],
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
      // AI-REMOVED 2026-06-06:
      // Reason: 填充器产物不应写回原料槽；配方输入/产出槽位应由 Recipe Channel 精确声明。
      // Trigger: 用户指出 Recipe Channel 本应决定产物槽位，并要求先修正错误设备定义。
      // Evidence: 《仿真运行原理》§3.5 明确 productStorageGroupIds 表示配方产物写入哪些存储组；旧写法依赖 compiler 用端口方向过滤多余角色。
      // Replacement: 下方 default channel：ingredient=item_input_buffer，product=item_output_buffer。
      // Risk: Low - 当前 compiler 仍做端口方向过滤，修正后现有运行行为应保持不变；后续改为 channel-based 时避免产物回填输入槽。
      // Human Review: Required
      //
      // Original code:
      // createRecipeChannel("default", ["item_input_buffer", "item_output_buffer"], ["item_input_buffer", "item_output_buffer"]),
      createRecipeChannel("default", ["item_input_buffer"], ["item_output_buffer"]),
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
    placementBehaviors: DEDICATED_BELT_PLACEMENT_BEHAVIORS,
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
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
    placementBehaviors: DEDICATED_BELT_PLACEMENT_BEHAVIORS,
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
    placementBehaviors: DEDICATED_BELT_PLACEMENT_BEHAVIORS,
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
    displayOrder: 102,
    tags: ["BeltFamily", "OuterRingAllowed"],
    placementBehaviors: ALLOW_PIPE_OVERLAP_PLACEMENT_BEHAVIORS,
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
        [
          createPort("out_e", 0, 0, "E"),
          createPort("out_w", 0, 0, "W"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
    ],
    // AI-CORRECTION 2026-05-18: 原端口 input=E, outputs=N/S/W。
    // 现改为 input=N, outputs=E/W/S，使得 rotation=0 时入口朝北。
    // 旧 v2 蓝图通过 LEGACY_DEVICE_REMAPPERS rotationOffset=90 兼容。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
    displayOrder: 103,
    tags: ["BeltFamily", "OuterRingAllowed"],
    placementBehaviors: ALLOW_PIPE_OVERLAP_PLACEMENT_BEHAVIORS,
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
          createPort("in_w", 0, 0, "W"),
        ],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_s", 0, 0, "S")],
      ),
    ],
    // AI-CORRECTION 2026-05-18: 原端口 inputs=N/E/S, output=W。
    // 现改为 inputs=N/E/W, output=S，使得 rotation=0 时出口朝南。
    // 旧 v2 蓝图通过 LEGACY_DEVICE_REMAPPERS rotationOffset=90 兼容。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
    displayOrder: 101,
    tags: ["BeltFamily", "ChevronHidden"],
    placementBehaviors: ALLOW_PIPE_OVERLAP_PLACEMENT_BEHAVIORS,
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
  // AI-CORRECTION 2026-07-10: 管道默认接受 fluid（liquid/gas），普通设备 fluid 槽位仍默认 liquid。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
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
    displayOrder: 202,
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
        [
          createPort("out_e", 0, 0, "E"),
          createPort("out_w", 0, 0, "W"),
          createPort("out_s", 0, 0, "S"),
        ],
      ),
    ],
    // AI-CORRECTION 2026-05-18: 与 item_log_splitter 同步：原 input=E, outputs=N/S/W → input=N, outputs=E/W/S。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
    displayOrder: 203,
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
          createPort("in_w", 0, 0, "W"),
        ],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_s", 0, 0, "S")],
      ),
    ],
    // AI-CORRECTION 2026-05-18: 与 item_log_converger 同步：原 inputs=N/E/S, output=W → inputs=N/E/W, output=S。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
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
    displayOrder: 201,
    tags: ["武陵", "PipeFamily", "ChevronHidden"],
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
    ],
  }),

  /**
   * item_port_udpipe_loader_1 — 地下管道装载口（3×3）
   * 流体输入方向。仅 1 个 input port(西)。
   * AI-CORRECTION 2026-06-06: 默认行为改为销毁模式；进入 loader_buffer 的液体由隐藏配方消耗。
   */
  createEntityDefinition({
    id: "item_port_udpipe_loader_1",
    nameKey: "registry.entity.item_port_udpipe_loader_1.name",
    spriteId: "item_port_udpipe_loader_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    displayOrder: 407,
    // AI-REMOVED 2026-06-06:
    // Reason: 暗管入口默认销毁进入液体，不能再由 WarehouseSink 直接写入仓库槽。
    // Trigger: 用户要求未链接暗管入口销毁所有进入液体，并明确默认摆放为销毁模式。
    // Evidence: runtime-slot-access.findInputSlotForItem 会优先将 WarehouseSink 输入写入仓库槽，导致本地隐藏销毁配方拿不到输入。
    // Replacement: 本定义的 loader_buffer + r_udpipe_loader_void_liquid_any_internal。
    // Risk: Medium - 已保存蓝图若依赖暗管入口入仓行为，运行结果会改为销毁液体。
    // Human Review: Required
    //
    // Original code:
    // tags: ["武陵", "OuterRingAllowed", WAREHOUSE_SINK_TAG],
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
    ],
    // AI-REMOVED 2026-06-06:
    // Reason: 暗管入口需要本地液体槽位供隐藏销毁配方消费。
    // Trigger: 用户要求默认销毁模式使用 0.5 秒销毁 1 液体的隐藏配方实现。
    // Evidence: 无本地 storageSlotGroups/portStorageBindings 时，入口只能依赖 synthetic 输入节点或 WarehouseSink，无法稳定挂载槽位配置面板与销毁配方通道。
    // Replacement: 下方 loader_buffer、void_liquid recipeChannel 和 bind_fluid_input。
    // Risk: Medium - 编译拓扑节点从无显式缓存变为显式缓存。
    // Human Review: Required
    //
    // Original code:
    // storageSlotGroups: [],
    storageSlotGroups: [
      createStorageSlotGroup(
        "loader_buffer",
        "fluid",
        createSlots("slot", [500], "liquid"),
      ),
    ],
    recipeChannels: [
      // AI-CORRECTION 2026-06-07: loader_buffer 同时声明为产物槽，仅用于表达槽位配置的混合归属；销毁配方本身仍没有 outputs。
      createRecipeChannel("void_liquid", ["loader_buffer"], ["loader_buffer"]),
    ],
    // AI-REMOVED 2026-06-06:
    // Reason: 暗管入口端口必须绑定到本地销毁槽位。
    // Trigger: 用户要求未链接暗管入口销毁进入液体，并要求槽位挂载 Slot 配置 behavior。
    // Evidence: 空绑定会让编译器创建 synthetic 输入槽，隐藏销毁配方无法绑定该自动槽组。
    // Replacement: 下方 bind_fluid_input 绑定 fluid_input -> loader_buffer。
    // Risk: Medium - 显式绑定改变拓扑节点 id。
    // Human Review: Required
    //
    // Original code:
    // portStorageBindings: [],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "loader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["loader_buffer"],
      },
    ],
  }),

  /**
   * item_port_udpipe_unloader_1 — 暗管出口（3×3）
   *
   * 缓存组：1 个 universal（单槽 × 1 容量）
   * AI-CORRECTION 2026-06-06: 暗管系列槽位容量统一改为 500。
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
    displayOrder: 408,
    // AI-REMOVED 2026-06-06:
    // Reason: 暗管出口是生成/取货语义，WarehouseSink 只应表达输入入仓语义。
    // Trigger: 用户明确默认暗管出口是生成模式，但没有选择任何物品。
    // Evidence: runtime-slot-access 只在 input-view 节点识别 WarehouseSink；出口保留该 tag 无运行收益且会误导语义。
    // Replacement: warehouseItemLink inspector + unloader_buffer。
    // Risk: Low - 当前出口只有 output port，移除该 tag 不改变实际输送路径。
    // Human Review: Required
    //
    // Original code:
    // tags: ["武陵", "OuterRingAllowed", WAREHOUSE_SINK_TAG],
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
        createSlots("slot", [500], "liquid"),
      ),
    ],
    // AI-CORRECTION 2026-06-07: 暗管出口保留仓库取货式生成语义，但槽位在 channel 中同时作为原料/产物以显示为混合槽位。
    recipeChannels: [
      createRecipeChannel("default", ["unloader_buffer"], ["unloader_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
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
    spriteOffset: {
      topView: { x: 0, y: 0, width: 3, height: 2 },
    },
    uiGroup: "warehouse",
    displayOrder: 402,
    tags: ["AvatarHidden", WAREHOUSE_SINK_TAG],
    placementBehaviors: WAREHOUSE_PORT_PLACEMENT_BEHAVIORS,
    requiresPower: false,
    powerDemand: 0,
    // AI-CORRECTION 2026-06-06: 仓库存货口旋转 180°。
    // 原端口朝北(N)，现改为朝南(S)，使 rotation=0 方向与显示 sprite 对齐。
    // AI-CORRECTION 2026-06-06: 撤销上述旋转，恢复端口朝北(N)。
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("p_in_mid", 1, 0, "N")],
      ),
    ],
    ...createSimpleProductionDevice([
      { kind: "item", direction: "input", capacities: [1] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_furnance_1",
    nameKey: "registry.entity.item_port_furnance_1.name",
    spriteId: "item_port_furnance_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    displayOrder: 501,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 502,
    tags: [PRODUCER_TAG, "武陵", "alter:item_port_furnance_1", "alter-variant:liquid"],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 504,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 505,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "shaper_1_gas",
    nameKey: "registry.entity.shaper_1_gas.name",
    spriteId: "shaper_1_gas",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    displayOrder: 506,
    tags: [
      PRODUCER_TAG,
      "alter:item_port_shaper_1",
      "alter-variant:gas",
    ],
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
      createPortGroup(
        "gas_input",
        "fluid",
        "input",
        [
          createPort("in_w_1", 0, 1, "W", {
            acceptRule: { base: { kind: "gas" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "gas_input_buffer",
        "fluid",
        createSlots("input_gas_slot", [50], "gas"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["item_input_buffer", "gas_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_seedcol_1",
    nameKey: "registry.entity.item_port_seedcol_1.name",
    spriteId: "item_port_seedcol_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    displayOrder: 507,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 508,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
      { kind: "item", direction: "input", capacities: [50] },
      { kind: "item", direction: "output", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_hydro_planter_1",
    nameKey: "registry.entity.item_port_hydro_planter_1.name",
    spriteId: "item_port_hydro_planter_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "basicProduction",
    displayOrder: 509,
    tags: [PRODUCER_TAG, "武陵", "alter:item_port_planter_1", "alter-variant:liquid"],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 601,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 604,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 605,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 303,
    tags: [PRODUCER_TAG],
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
    ...createSimpleProductionDevice([
      { kind: "item", direction: "input", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: "item_port_mix_pool_2",
    nameKey: "registry.entity.item_port_mix_pool_2.name",
    spriteId: "item_port_mix_pool_2",
    footprint: { width: 6, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 607,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 100,
    portGroups: [
      createPortGroup(
        "item_output",
        "item",
        "output",
        [1, 2, 3, 4].map((x) => createPort(`out_n_${x}`, x, 0, "N", { acceptRule: { base: { kind: "none" }, exclude: [] } })),
      ),
      createPortGroup(
        "item_input",
        "item",
        "input",
        [1, 2, 3, 4].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "fluid_output_a",
        "fluid",
        "output",
        [createPort(`out_w_1`, 0, 1, "W", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
      ),
      createPortGroup(
        "fluid_output_b",
        "fluid",
        "output",
        [createPort(`out_w_3`, 0, 3, "W", { acceptRule: { base: { kind: "none" }, exclude: [] } })],
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
        createSlots("input_slot", [50, 50, 50, 50, 50, 50, 50, 50], "any"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("ch1", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch2", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch3", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch4", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch5", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch6", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch7", ["shared_input_buffer"], ["shared_input_buffer"], true),
      createRecipeChannel("ch8", ["shared_input_buffer"], ["shared_input_buffer"], true),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "shared_input_buffer"),
      createBinding("bind_fluid_input", "fluid_input", "shared_input_buffer"),
      createBinding("bind_item_output", "item_output", "shared_input_buffer"),
      createBinding("bind_fluid_output_a", "fluid_output_a", "shared_input_buffer"),
      createBinding("bind_fluid_output_b", "fluid_output_b", "shared_input_buffer"),
    ],
    blockageAutoClearance: createBlockageAutoClearance({
      enabledByDefault: true,
      enabledConfigKey: BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
      channelIds: ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"],
      slotRefs: [{ storageSlotGroupId: "shared_input_buffer" }],
      blockedChannelThreshold: 2,
    }),
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"],
      },
      {
        type: INSPECTOR_TYPE.portOutputConfig,
        portGroupIds: ["item_output", "fluid_output_a", "fluid_output_b"],
      },
      {
        type: INSPECTOR_TYPE.blockageAutoClearance,
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_liquid_purifier_1",
    nameKey: "registry.entity.item_port_liquid_purifier_1.name",
    spriteId: "item_port_liquid_purifier_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 609,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, x, 4, "S", {
          acceptRule: { base: { kind: "fluid" }, exclude: [] },
        })),
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [
          createPort("out_n_1", 1, 0, "N", {
            acceptRule: createLiquidPurifierOutputAcceptRule(LIQUID_PURIFIER_LEFT_OUTPUT_ITEM_IDS),
          }),
          createPort("out_n_3", 3, 0, "N", {
            acceptRule: createLiquidPurifierOutputAcceptRule(LIQUID_PURIFIER_RIGHT_OUTPUT_ITEM_IDS),
          }),
        ],
      ),
    ],
    // AI-REMOVED 2026-07-11:
    // Reason: createSimpleProductionDevice 会把 kind="fluid" 的槽位过滤器固定为 liquid；
    //   提纯机现在是首个非管道的 fluid 设备，四个管道出入口和对应缓存都必须允许 liquid/gas。
    // Trigger: 用户要求提纯机四个管道出入口可以同时接受气体和液体。
    // Evidence: resolveSlotFilterType("fluid") 返回 "liquid"，仅改端口 acceptRule 会导致气体仍被缓存槽拒绝。
    // Replacement: 下方显式 storageSlotGroups / recipeChannels / portStorageBindings / inspectors。
    // Risk: Low - 保留原 storage group id 与 channel id，旧蓝图路径不变。
    // Human Review: Required
    //
    // Original code:
    // ...createSimpleProductionDevice([
    //   { kind: "fluid", direction: "input", capacities: [50] },
    //   { kind: "fluid", direction: "output", capacities: [50, 50] },
    //   { kind: "item", direction: "input", capacities: [50] },
    // ]),
    storageSlotGroups: [
      createStorageSlotGroup(
        "fluid_input_buffer",
        "fluid",
        createSlots("input_fluid_slot", [50], "fluid"),
      ),
      createStorageSlotGroup(
        "fluid_output_buffer",
        "fluid",
        createSlots("output_fluid_slot", [50, 50], "fluid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["fluid_input_buffer"], ["fluid_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "fluid_input_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "liquid_purifier_1_gas",
    nameKey: "registry.entity.liquid_purifier_1_gas.name",
    spriteId: "liquid_purifier_1_gas",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 610,
    tags: [
      PRODUCER_TAG,
      "武陵",
      "alter:item_port_liquid_purifier_1",
      "alter-variant:gas",
    ],
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
        "gas_input",
        "fluid",
        "input",
        [
          createPort("in_w_2", 0, 2, "W", {
            acceptRule: { base: { kind: "gas" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "gas_output",
        "fluid",
        "output",
        [1, 3].map((z) => createPort(`out_e_${z}`, 4, z, "E", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        "fluid",
        createSlots("input_gas_slot", [50], "gas"),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        "fluid",
        createSlots("output_gas_slot", [50, 50], "gas"),
      ),
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_item_slot", [50], "solid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["gas_input_buffer", "item_input_buffer"], ["gas_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_xiranite_oven_1",
    nameKey: "registry.entity.item_port_xiranite_oven_1.name",
    spriteId: "item_port_xiranite_oven_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 608,
    tags: [PRODUCER_TAG, "武陵"],
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
    ...createSimpleProductionDevice([
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
    displayOrder: 611,
    tags: [PRODUCER_TAG, "武陵"],
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
        [createPort("out_w_2", 0, 2, "W", {
          acceptRule: { base: { kind: "fluid" }, exclude: [] },
        })],
      ),
    ],
    // AI-REMOVED 2026-07-16:
    // Reason: 用户要求拆解机注册表使用显式字典声明，不再由 helper 隐式生成缓存、通道和绑定。
    // Trigger: 用户持续推进注册表去 helper 化，并明确要求 item_port_dismantler_1 脱离 createSimpleProductionDevice。
    // Evidence: 下方显式定义保持原 group/slot/channel/binding ID，并将管道输出缓存声明为 fluid。
    // Replacement: 下方 storageSlotGroups / recipeChannels / portStorageBindings / inspectors。
    // Risk: Low - 标识符和容量保持不变，仅定义方式从 helper 展开为显式字段。
    // Human Review: Required
    //
    // Original code:
    // ...createSimpleProductionDevice([
    //   { kind: "item", direction: "input", capacities: [50] },
    //   { kind: "item", direction: "output", capacities: [50] },
    //   { kind: "fluid", direction: "output", capacities: [50], itemFilterType: "fluid" },
    // ]),
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "fluid_output_buffer",
        "fluid",
        createSlots("output_fluid_slot", [50], "fluid"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel(
        "default",
        ["item_input_buffer"],
        ["item_output_buffer", "fluid_output_buffer"],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_2_gastrans",
    nameKey: "registry.entity.transmuter_2_gastrans.name",
    spriteId: "transmuter_2_gastrans",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 612,
    tags: [PRODUCER_TAG, "武陵", "alter:transmuter_2", "alter-variant:gastrans"],
    requiresPower: true,
    powerDemand: 50,
    meteredConsumption: {
      inputPortGroupId: "consume_input",
      itemIds: ["item_gas_inert"],
      windowSeconds: 60,
      startThreshold: 6,
      acceptanceLimit: 30,
      gasDiffusionRange: null,
    },
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [1, 3].map((x) => createPort(`in_s_${x}`, x, 4, "S")),
      ),
      createPortGroup(
        "gas_output",
        "fluid",
        "output",
        [1, 3].map((z) => createPort(`out_e_${z}`, 4, z, "E", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
      createPortGroup(
        "consume_input",
        "fluid",
        "input",
        [
          createPort("in_s_2", 2, 4, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_gas_inert" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "item_input_buffer",
        "item",
        createSlots("input_item_slot", [50], "solid"),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        "fluid",
        createSlots("output_gas_slot", [50], "gas"),
      ),
      // AI-REMOVED 2026-07-16:
      // Reason: 计量材料抵达 consume_input 后立即销毁，不应占用可配置的真实存储槽。
      // Trigger: 用户要求删除消耗槽位并验证 synthetic sink 求解。
      // Evidence: compiler 会为未绑定的 metered input port 生成内部 synthetic-input node/slot。
      // Replacement: topology-compiler.compileSyntheticNodesForUnboundPorts。
      // Risk: Low - 目标 synthetic slot 仅作求解锚点，consumeAtTarget 不会写入库存。
      // Human Review: Required
      //
      // Original code:
      // createStorageSlotGroup(
      //   "consume_buffer",
      //   "fluid",
      //   createSlots("consume_slot", [50], "gas"),
      // ),
    ],
    recipeChannels: [
      createRecipeChannel(
        "default",
        ["item_input_buffer"],
        ["gas_output_buffer"],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_item_input", "item_input", "item_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
      // AI-REMOVED 2026-07-16:
      // Reason: consume_input 改由 compiler 绑定内部 synthetic sink，不再绑定真实 consume_buffer。
      // Trigger: 用户要求删除消耗槽位并验证求解。
      // Evidence: meteredConsumption.inputPortGroupId 仍指向 consume_input，计量配置不依赖 storage binding。
      // Replacement: synthetic-input node binding。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // createBinding("bind_consume", "consume_input", "consume_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_2_solidtrans",
    nameKey: "registry.entity.transmuter_2_solidtrans.name",
    spriteId: "transmuter_2_solidtrans",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 613,
    tags: [PRODUCER_TAG, "武陵", "alter:transmuter_2", "alter-variant:solidtrans"],
    requiresPower: true,
    powerDemand: 50,
    meteredConsumption: {
      inputPortGroupId: "consume_input",
      itemIds: ["item_gas_inert"],
      windowSeconds: 60,
      startThreshold: 6,
      acceptanceLimit: 30,
      gasDiffusionRange: null,
    },
    portGroups: [
      createPortGroup(
        "gas_input",
        "fluid",
        "input",
        [1, 3].map((z) => createPort(`in_w_${z}`, 0, z, "W", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [1, 3].map((x) => createPort(`out_n_${x}`, x, 0, "N")),
      ),
      createPortGroup(
        "consume_input",
        "fluid",
        "input",
        [
          createPort("in_s_2", 2, 4, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_gas_inert" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        "fluid",
        createSlots("input_gas_slot", [50], "gas"),
      ),
      createStorageSlotGroup(
        "item_output_buffer",
        "item",
        createSlots("output_item_slot", [50], "solid"),
      ),
      // AI-REMOVED 2026-07-16:
      // Reason: 计量材料抵达 consume_input 后立即销毁，不应占用可配置的真实存储槽。
      // Trigger: 用户要求删除消耗槽位并验证 synthetic sink 求解。
      // Evidence: compiler 会为未绑定的 metered input port 生成内部 synthetic-input node/slot。
      // Replacement: topology-compiler.compileSyntheticNodesForUnboundPorts。
      // Risk: Low - 目标 synthetic slot 仅作求解锚点，consumeAtTarget 不会写入库存。
      // Human Review: Required
      //
      // Original code:
      // createStorageSlotGroup(
      //   "consume_buffer",
      //   "fluid",
      //   createSlots("consume_slot", [50], "gas"),
      // ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["gas_input_buffer"], ["item_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_item_output", "item_output", "item_output_buffer"),
      // AI-REMOVED 2026-07-16:
      // Reason: consume_input 改由 compiler 绑定内部 synthetic sink，不再绑定真实 consume_buffer。
      // Trigger: 用户要求删除消耗槽位并验证求解。
      // Evidence: meteredConsumption.inputPortGroupId 仍指向 consume_input，计量配置不依赖 storage binding。
      // Replacement: synthetic-input node binding。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // createBinding("bind_consume", "consume_input", "consume_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_gas_reactor_1",
    nameKey: "registry.entity.item_port_gas_reactor_1.name",
    spriteId: "item_port_gas_reactor_1",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 614,
    tags: [PRODUCER_TAG, "武陵"],
    requiresPower: true,
    powerDemand: 50,
    // AI-REMOVED 2026-07-16:
    // Reason: 首轮机械定位误把液气转化机的计量配置写入气体反应机；该设备没有 consume_input。
    // Trigger: 注册表补充 meteredConsumption 时命中了相邻的 powerDemand: 50 定义。
    // Evidence: item_port_gas_reactor_1 的端口组只有 gas_input/gas_output。
    // Replacement: transmuter_1_gastrans.meteredConsumption。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // meteredConsumption: {
    //   inputPortGroupId: "consume_input",
    //   itemIds: ["item_liquid_water"],
    //   windowSeconds: 60,
    //   startThreshold: 6,
    //   acceptanceLimit: 30,
    //   gasDiffusionRange: null,
    // },
    portGroups: [
      createPortGroup(
        "gas_input",
        "fluid",
        "input",
        [1, 3].map((x) => createPort(`in_n_${x}`, x, 0, "N", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
      createPortGroup(
        "gas_output",
        "fluid",
        "output",
        [1, 3].map((x) => createPort(`out_s_${x}`, x, 4, "S", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        "fluid",
        createSlots("input_gas_slot", [50], "gas"),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        "fluid",
        createSlots("output_gas_slot", [50], "gas"),
      ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["gas_input_buffer"], ["gas_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_1_gastrans",
    nameKey: "registry.entity.transmuter_1_gastrans.name",
    spriteId: "transmuter_1_gastrans",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 615,
    tags: [PRODUCER_TAG, "武陵", "alter:transmuter_1", "alter-variant:gastrans"],
    requiresPower: true,
    powerDemand: 50,
    meteredConsumption: {
      inputPortGroupId: "consume_input",
      itemIds: ["item_liquid_water"],
      windowSeconds: 60,
      startThreshold: 6,
      acceptanceLimit: 30,
      gasDiffusionRange: null,
    },
    portGroups: [
      createPortGroup(
        "liquid_input",
        "fluid",
        "input",
        [1, 3].map((z) => createPort(`in_w_${z}`, 0, z, "W")),
      ),
      createPortGroup(
        "gas_output",
        "fluid",
        "output",
        [1, 3].map((z) => createPort(`out_e_${z}`, 4, z, "E", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
      createPortGroup(
        "consume_input",
        "fluid",
        "input",
        [
          createPort("in_s_2", 2, 4, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_water" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "liquid_input_buffer",
        "fluid",
        createSlots("input_liquid_slot", [50], "liquid"),
      ),
      createStorageSlotGroup(
        "gas_output_buffer",
        "fluid",
        createSlots("output_gas_slot", [50], "gas"),
      ),
      // AI-REMOVED 2026-07-16:
      // Reason: 计量材料抵达 consume_input 后立即销毁，不应占用可配置的真实存储槽。
      // Trigger: 用户要求删除消耗槽位并验证 synthetic sink 求解。
      // Evidence: compiler 会为未绑定的 metered input port 生成内部 synthetic-input node/slot。
      // Replacement: topology-compiler.compileSyntheticNodesForUnboundPorts。
      // Risk: Low - 目标 synthetic slot 仅作求解锚点，consumeAtTarget 不会写入库存。
      // Human Review: Required
      //
      // Original code:
      // createStorageSlotGroup(
      //   "consume_buffer",
      //   "fluid",
      //   createSlots("consume_slot", [50], "liquid"),
      // ),
    ],
    recipeChannels: [
      createRecipeChannel(
        "default",
        ["liquid_input_buffer"],
        ["gas_output_buffer"],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_liquid_input", "liquid_input", "liquid_input_buffer"),
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
      // AI-REMOVED 2026-07-16:
      // Reason: consume_input 改由 compiler 绑定内部 synthetic sink，不再绑定真实 consume_buffer。
      // Trigger: 用户要求删除消耗槽位并验证求解。
      // Evidence: meteredConsumption.inputPortGroupId 仍指向 consume_input，计量配置不依赖 storage binding。
      // Replacement: synthetic-input node binding。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // createBinding("bind_consume", "consume_input", "consume_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  createEntityDefinition({
    id: "transmuter_1_liquidtrans",
    nameKey: "registry.entity.transmuter_1_liquidtrans.name",
    spriteId: "transmuter_1_liquidtrans",
    footprint: { width: 5, height: 5 },
    uiGroup: "advancedManufacturing",
    displayOrder: 616,
    tags: [PRODUCER_TAG, "武陵", "alter:transmuter_1", "alter-variant:liquidtrans"],
    requiresPower: true,
    powerDemand: 50,
    meteredConsumption: {
      inputPortGroupId: "consume_input",
      itemIds: ["item_liquid_water"],
      windowSeconds: 60,
      startThreshold: 6,
      acceptanceLimit: 30,
      gasDiffusionRange: null,
    },
    portGroups: [
      createPortGroup(
        "gas_input",
        "fluid",
        "input",
        [1, 3].map((z) => createPort(`in_w_${z}`, 0, z, "W", {
          acceptRule: { base: { kind: "gas" }, exclude: [] },
        })),
      ),
      createPortGroup(
        "liquid_output",
        "fluid",
        "output",
        [1, 3].map((z) => createPort(`out_e_${z}`, 4, z, "E")),
      ),
      createPortGroup(
        "consume_input",
        "fluid",
        "input",
        [
          createPort("in_s_2", 2, 4, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_water" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_input_buffer",
        "fluid",
        createSlots("input_gas_slot", [50], "gas"),
      ),
      createStorageSlotGroup(
        "liquid_output_buffer",
        "fluid",
        createSlots("output_liquid_slot", [50], "liquid"),
      ),
      // AI-REMOVED 2026-07-16:
      // Reason: 计量材料抵达 consume_input 后立即销毁，不应占用可配置的真实存储槽。
      // Trigger: 用户要求删除消耗槽位并验证 synthetic sink 求解。
      // Evidence: compiler 会为未绑定的 metered input port 生成内部 synthetic-input node/slot。
      // Replacement: topology-compiler.compileSyntheticNodesForUnboundPorts。
      // Risk: Low - 目标 synthetic slot 仅作求解锚点，consumeAtTarget 不会写入库存。
      // Human Review: Required
      //
      // Original code:
      // createStorageSlotGroup(
      //   "consume_buffer",
      //   "fluid",
      //   createSlots("consume_slot", [50], "liquid"),
      // ),
    ],
    recipeChannels: [
      createRecipeChannel("default", ["gas_input_buffer"], ["liquid_output_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
      createBinding("bind_liquid_output", "liquid_output", "liquid_output_buffer"),
      // AI-REMOVED 2026-07-16:
      // Reason: consume_input 改由 compiler 绑定内部 synthetic sink，不再绑定真实 consume_buffer。
      // Trigger: 用户要求删除消耗槽位并验证求解。
      // Evidence: meteredConsumption.inputPortGroupId 仍指向 consume_input，计量配置不依赖 storage binding。
      // Replacement: synthetic-input node binding。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // createBinding("bind_consume", "consume_input", "consume_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: ["default"],
      },
    ],
  }),
  /**
   * item_port_sp_hub_1 — 协议核心（9×9）
   *
   * 14 个独立输入端口（7N + 7S），各挂独立接收缓存。
   * 6 个独立输出端口（3W + 3E），各挂独立取货缓存 + warehouseItemLink inspector。
   * AI-CORRECTION 2026-06-05: 输出端口仍独立配置，但 warehouseItemLink 声明合并为一个 inspector，在面板内展开为 P1-P6 六行。
   * AI-CORRECTION 2026-06-06: 输入端走 WarehouseSink 动态入仓，支持输出绕回任一入口后继续出货。
   * 每个输出端口等价于一个独立仓库取货口。
   *
   * 输入缓存组：14 个（各 1 槽 × 1 容量）
   * 输出缓存组：6 个（各 1 槽 × 1 容量）
   * 编译节点：20 个（14 input-view + 6 output-view）
   */
  createEntityDefinition({
    id: "item_port_sp_hub_1",
    nameKey: "registry.entity.item_port_sp_hub_1.name",
    spriteId: "item_port_sp_hub_1",
    footprint: { width: 9, height: 9 },
    uiGroup: "hidden",
    tags: [WAREHOUSE_SINK_TAG],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      // ---- 输出端口：W 侧 3 个 ----
      createPortGroup(
        "item_output_w2",
        "item",
        "output",
        [createPort("out_w_2", 0, 1, "W")],
      ),
      createPortGroup(
        "item_output_w5",
        "item",
        "output",
        [createPort("out_w_5", 0, 4, "W")],
      ),
      createPortGroup(
        "item_output_w8",
        "item",
        "output",
        [createPort("out_w_8", 0, 7, "W")],
      ),
      // ---- 输出端口：E 侧 3 个 ----
      createPortGroup(
        "item_output_e2",
        "item",
        "output",
        [createPort("out_e_2", 8, 1, "E")],
      ),
      createPortGroup(
        "item_output_e5",
        "item",
        "output",
        [createPort("out_e_5", 8, 4, "E")],
      ),
      createPortGroup(
        "item_output_e8",
        "item",
        "output",
        [createPort("out_e_8", 8, 7, "E")],
      ),
      // ---- 输入端口：N 侧 7 个 ----
      createPortGroup(
        "item_input_n2",
        "item",
        "input",
        [createPort("in_n_2", 1, 0, "N")],
      ),
      createPortGroup(
        "item_input_n3",
        "item",
        "input",
        [createPort("in_n_3", 2, 0, "N")],
      ),
      createPortGroup(
        "item_input_n4",
        "item",
        "input",
        [createPort("in_n_4", 3, 0, "N")],
      ),
      createPortGroup(
        "item_input_n5",
        "item",
        "input",
        [createPort("in_n_5", 4, 0, "N")],
      ),
      createPortGroup(
        "item_input_n6",
        "item",
        "input",
        [createPort("in_n_6", 5, 0, "N")],
      ),
      createPortGroup(
        "item_input_n7",
        "item",
        "input",
        [createPort("in_n_7", 6, 0, "N")],
      ),
      createPortGroup(
        "item_input_n8",
        "item",
        "input",
        [createPort("in_n_8", 7, 0, "N")],
      ),
      // ---- 输入端口：S 侧 7 个 ----
      createPortGroup(
        "item_input_s2",
        "item",
        "input",
        [createPort("in_s_2", 1, 8, "S")],
      ),
      createPortGroup(
        "item_input_s3",
        "item",
        "input",
        [createPort("in_s_3", 2, 8, "S")],
      ),
      createPortGroup(
        "item_input_s4",
        "item",
        "input",
        [createPort("in_s_4", 3, 8, "S")],
      ),
      createPortGroup(
        "item_input_s5",
        "item",
        "input",
        [createPort("in_s_5", 4, 8, "S")],
      ),
      createPortGroup(
        "item_input_s6",
        "item",
        "input",
        [createPort("in_s_6", 5, 8, "S")],
      ),
      createPortGroup(
        "item_input_s7",
        "item",
        "input",
        [createPort("in_s_7", 6, 8, "S")],
      ),
      createPortGroup(
        "item_input_s8",
        "item",
        "input",
        [createPort("in_s_8", 7, 8, "S")],
      ),
    ],
    storageSlotGroups: [
      // ---- 输出缓存 ----
      createStorageSlotGroup("unbuffer_w2", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("unbuffer_w5", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("unbuffer_w8", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("unbuffer_e2", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("unbuffer_e5", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("unbuffer_e8", "item", createSlots("slot", [1], "solid")),
      // ---- 输入缓存 ----
      createStorageSlotGroup("inbuffer_n2", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_n3", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_n4", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_n5", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_n6", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_n7", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_n8", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s2", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s3", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s4", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s5", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s6", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s7", "item", createSlots("slot", [1], "solid")),
      createStorageSlotGroup("inbuffer_s8", "item", createSlots("slot", [1], "solid")),
    ],
    portStorageBindings: [
      // ---- 输出绑定 ----
      createBinding("bind_output_w2", "item_output_w2", "unbuffer_w2"),
      createBinding("bind_output_w5", "item_output_w5", "unbuffer_w5"),
      createBinding("bind_output_w8", "item_output_w8", "unbuffer_w8"),
      createBinding("bind_output_e2", "item_output_e2", "unbuffer_e2"),
      createBinding("bind_output_e5", "item_output_e5", "unbuffer_e5"),
      createBinding("bind_output_e8", "item_output_e8", "unbuffer_e8"),
      // ---- 输入绑定 ----
      createBinding("bind_input_n2", "item_input_n2", "inbuffer_n2"),
      createBinding("bind_input_n3", "item_input_n3", "inbuffer_n3"),
      createBinding("bind_input_n4", "item_input_n4", "inbuffer_n4"),
      createBinding("bind_input_n5", "item_input_n5", "inbuffer_n5"),
      createBinding("bind_input_n6", "item_input_n6", "inbuffer_n6"),
      createBinding("bind_input_n7", "item_input_n7", "inbuffer_n7"),
      createBinding("bind_input_n8", "item_input_n8", "inbuffer_n8"),
      createBinding("bind_input_s2", "item_input_s2", "inbuffer_s2"),
      createBinding("bind_input_s3", "item_input_s3", "inbuffer_s3"),
      createBinding("bind_input_s4", "item_input_s4", "inbuffer_s4"),
      createBinding("bind_input_s5", "item_input_s5", "inbuffer_s5"),
      createBinding("bind_input_s6", "item_input_s6", "inbuffer_s6"),
      createBinding("bind_input_s7", "item_input_s7", "inbuffer_s7"),
      createBinding("bind_input_s8", "item_input_s8", "inbuffer_s8"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: [
          "unbuffer_w2",
          "unbuffer_w5",
          "unbuffer_w8",
          "unbuffer_e2",
          "unbuffer_e5",
          "unbuffer_e8",
        ],
      },
      /*
        AI-REMOVED 2026-06-05:
        Reason: 六个独立 warehouseItemLink inspector 会让每个面板都从 links[0] 开始写入，无法独立配置六个输出。
        Trigger: 用户明确协议核心是该功能目标场景，要求每个输出可独立配置。
        Evidence: WarehouseItemLinkInspector 按单个 declaration 展开 slotGroupIds 并分配 linkIndex；拆成六个 declaration 时 linkIndex 全部为 0。
        Replacement: 上方单个 warehouseItemLink declaration，slotGroupIds 按输出端口顺序展开为 links[0..5]。
        Risk: Medium - 已保存旧蓝图若依赖重复 inspector 写入同一 links[0]，打开后面板行为会变为按六个槽位分别展示。
        Human Review: Required

        Original code:
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unbuffer_w2"] },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unbuffer_w5"] },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unbuffer_w8"] },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unbuffer_e2"] },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unbuffer_e5"] },
        { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["unbuffer_e8"] },
      */
    ],
  }),
  createEntityDefinition({
    id: "item_port_water_pump_1",
    nameKey: "registry.entity.item_port_water_pump_1.name",
    spriteId: "item_port_water_pump_1",
    footprint: { width: 3, height: 3 },
    spriteOffset: {
      topView: { x: -2, y: 0, width: 5, height: 3 },
    },
    uiGroup: "resourcePower",
    displayOrder: 301,
    tags: ["武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge },
    ],
    requiresPower: true,
    powerDemand: 10,
    portGroups: [
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e_1", 2, 1, "E")],
      ),
    ],

    // AI-CORRECTION 2026-06-15: 移除 createSimpleProductionDevice 和 recipeChannels。
    // 改用 warehouseItemLink 模式从仓库获取液体，放置时默认链接清水并开启无限供应。
    // r_pump_water_basic / r_pump_acid_basic 配方保留在 recipe-definition.ts（见 4）。

    storageSlotGroups: [
      createStorageSlotGroup("fluid_output_buffer", "fluid",
        createSlots("output_fluid_slot", [50], "liquid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "fluid_output_buffer"),
    ],
    recipeChannels: [],

    inspectors: [
      { type: INSPECTOR_TYPE.warehouseItemLink, slotGroupIds: ["fluid_output_buffer"] },
      { type: INSPECTOR_TYPE.slotConfig, slotGroupIds: ["fluid_output_buffer"] },
    ],

    placementDefaults: createPlacementDefaults({
      config: {
        "storageSlotGroups[0].slots[0].ignoreStock": true,
      },
      slotLinks: [
        {
          id: "warehouse-link:[Self]:fluid_output_buffer:output_fluid_slot_1",
          linkType: "share-all",
          source: {
            entityId: "[Self]",
            storageSlotGroupId: "fluid_output_buffer",
            slotId: "output_fluid_slot_1",
          },
          target: {
            entityId: "warehouse",
            storageSlotGroupId: "warehouse",
            slotId: "item_liquid_water",
          },
        },
      ],
    }),
  }),
  createEntityDefinition({
    id: "item_port_udpipe_loader_2",
    nameKey: "registry.entity.item_port_udpipe_loader_2.name",
    spriteId: "item_port_udpipe_loader_2",
    footprint: { width: 3, height: 5 },
    uiGroup: "warehouse",
    displayOrder: 409,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
    // AI-REMOVED 2026-06-06:
    // Reason: 多口暗管入口需要两个端口共享一个槽位，且两个销毁 channel 绑定同一个槽位以满足最大销毁速度。
    // Trigger: 用户明确“多口暗管入口只需要一个存储槽位，两个端口都对接这一个槽位，两个 channel 绑定一个槽位”。
    // Evidence: createSimpleProductionDevice 只能生成单个默认 channel 和默认 recipeStatus inspector，不适合隐藏销毁配方。
    // Replacement: 下方 loader_buffer、void_liquid_1/2 recipeChannels 和 bind_fluid_input。
    // Risk: Medium - 旧 synthetic 风格槽组 id 改为 loader_buffer。
    // Human Review: Required
    //
    // Original code:
    // ...createSimpleProductionDevice([
    //   { kind: "fluid", direction: "input", capacities: [1] },
    // ]),
    storageSlotGroups: [
      createStorageSlotGroup(
        "loader_buffer",
        "fluid",
        createSlots("slot", [500], "liquid"),
      ),
    ],
    recipeChannels: [
      // AI-CORRECTION 2026-06-07: loader_buffer 同时声明为产物槽，仅用于表达槽位配置的混合归属；销毁配方本身仍没有 outputs。
      createRecipeChannel("void_liquid_1", ["loader_buffer"], ["loader_buffer"]),
      createRecipeChannel("void_liquid_2", ["loader_buffer"], ["loader_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "loader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["loader_buffer"],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_udpipe_unloader_2",
    nameKey: "registry.entity.item_port_udpipe_unloader_2.name",
    spriteId: "item_port_udpipe_unloader_2",
    footprint: { width: 3, height: 5 },
    uiGroup: "warehouse",
    displayOrder: 410,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
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
    // AI-REMOVED 2026-06-06:
    // Reason: 多口暗管出口需要两个端口共享一个槽位，并保持默认生成/取货配置为空。
    // Trigger: 用户明确“出口也一样，一个存储槽位，两个端口都对接这一个槽位”。
    // Evidence: createSimpleProductionDevice 会生成生产配方通道和 recipeStatus inspector，不能表达仓库取货式生成语义。
    // Replacement: 下方 unloader_buffer、bind_fluid_output 和 warehouseItemLink/slotConfig inspectors。
    // Risk: Medium - 旧 fluid_output_buffer 槽组 id 改为 unloader_buffer。
    // Human Review: Required
    //
    // Original code:
    // ...createSimpleProductionDevice([
    //   { kind: "fluid", direction: "output", capacities: [1] },
    // ]),
    storageSlotGroups: [
      createStorageSlotGroup(
        "unloader_buffer",
        "fluid",
        createSlots("slot", [500], "liquid"),
      ),
    ],
    // AI-CORRECTION 2026-06-07: 暗管出口保留仓库取货式生成语义，但槽位在 channel 中同时作为原料/产物以显示为混合槽位。
    recipeChannels: [
      createRecipeChannel("default", ["unloader_buffer"], ["unloader_buffer"]),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_output", "fluid_output", "unloader_buffer"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.darkPipeLink,
      },
      {
        type: INSPECTOR_TYPE.warehouseItemLink,
        slotGroupIds: ["unloader_buffer"],
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["unloader_buffer"],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_liquid_cleaner_1",
    nameKey: "registry.entity.item_liquid_cleaner_1.name",
    spriteId: "item_liquid_cleaner_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "basicProduction",
    displayOrder: 510,
    tags: [PRODUCER_TAG, "武陵", "OuterRingAllowed"],
    requiresPower: true,
    powerDemand: 50,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w_1", 0, 1, "W")],
      ),
    ],
    ...createSimpleProductionDevice([
      { kind: "fluid", direction: "input", capacities: [50] },
    ]),
  }),
  createEntityDefinition({
    id: WATER_PURIFIER_NODE_ENTITY_ID,
    nameKey: "registry.entity.item_water_purifier_node_1.name",
    spriteId: "item_water_purifier_node_1",
    footprint: { width: 27, height: 3 },
    spriteOffset: {
      topView: { x: 0, y: -5, width: 27, height: 8 },
    },
    uiGroup: "resourcePower",
    displayOrder: 305,
    tags: [PRODUCER_TAG, "武陵", "OuterRingAllowed", "InnerRingNotAllowed"],
    placementBehaviors: [
      { type: PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge },
    ],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input_1",
        "fluid",
        "input",
        [
          createPort("in_s_1", 1, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_sewage" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "fluid_input_2",
        "fluid",
        "input",
        [
          createPort("in_s_9", 9, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_sewage" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "fluid_input_3",
        "fluid",
        "input",
        [
          createPort("in_s_17", 17, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: "item_liquid_sewage" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [
          createPort("out_s_25", 25, 2, "S", {
            acceptRule: { base: { kind: "item", itemId: WATER_PURIFIER_OUTPUT_ITEM_ID }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0],
        "fluid",
        createSlots("slot", [2], "liquid", { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1],
        "fluid",
        createSlots("slot", [2], "liquid", { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2],
        "fluid",
        createSlots("slot", [2], "liquid", { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID,
        "fluid",
        createSlots("slot", [500], "liquid", { lock: "item_liquid_sewage" }),
      ),
      createStorageSlotGroup(
        WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
        "fluid",
        createSlots("slot", [50], "liquid", { lock: WATER_PURIFIER_OUTPUT_ITEM_ID }),
      ),
    ],
    recipeChannels: [
      createRecipeChannel(
        WATER_PURIFIER_INTAKE_CHANNEL_IDS[0],
        [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0]],
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
      ),
      createRecipeChannel(
        WATER_PURIFIER_INTAKE_CHANNEL_IDS[1],
        [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1]],
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
      ),
      createRecipeChannel(
        WATER_PURIFIER_INTAKE_CHANNEL_IDS[2],
        [WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2]],
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
      ),
      createRecipeChannel(
        WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
        [WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID],
        [WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID],
      ),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input_1", "fluid_input_1", WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[0]),
      createBinding("bind_fluid_input_2", "fluid_input_2", WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[1]),
      createBinding("bind_fluid_input_3", "fluid_input_3", WATER_PURIFIER_INPUT_STORAGE_GROUP_IDS[2]),
      createBinding("bind_fluid_output", "fluid_output", WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID),
    ],
    placementDefaults: createPlacementDefaults({
      config: {
        [WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY]: WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
        [WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY]:
          WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE,
      },
    }),
    blockageAutoClearance: createBlockageAutoClearance({
      enabledByDefault: true,
      enabledConfigKey: BLOCKAGE_AUTO_CLEARANCE_ENABLED_CONFIG_KEY,
      channelIds: WATER_PURIFIER_INTAKE_CHANNEL_IDS,
      slotRefs: [{ storageSlotGroupId: WATER_PURIFIER_SEWAGE_BUFFER_STORAGE_GROUP_ID }],
      blockedChannelThreshold: 1,
    }),
    inspectors: [
      {
        type: INSPECTOR_TYPE.waterPurifierNode,
      },
      {
        type: INSPECTOR_TYPE.recipeStatus,
        channelIds: [
          ...WATER_PURIFIER_INTAKE_CHANNEL_IDS,
          WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
        ],
      },
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: [WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID],
      },
    ],
  }),
  createEntityDefinition({
    id: "item_port_liquid_storager_1",
    nameKey: "registry.entity.item_port_liquid_storager_1.name",
    spriteId: "item_port_liquid_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    displayOrder: 404,
    tags: ["武陵", "OuterRingAllowed"],
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
    // AI-CORRECTION 2026-05-17: 储液罐从 createSimpleProductionDevice（管道/缓冲器模式）改为
    //   单槽储存组模式（与协议储存箱的单槽分组原则对齐），仅储存液体。
    //   - 移除 createSimpleProductionDevice（含自动生成的 input/output 分离缓冲组和 channel）。
    //   - 改为一个 liquid_storage 储存组：1 槽，容量 500，液体过滤器。
    //   - portStorageBindings：input 和 output 端口均绑定到同一储存组。
    //   - 移除 recipeChannels：纯储存设备无需配方通道。
    storageSlotGroups: [
      createStorageSlotGroup(
        "liquid_storage",
        "fluid",
        createSlots("slot", [500], "liquid"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_fluid_input", "fluid_input", "liquid_storage"),
      createBinding("bind_fluid_output", "fluid_output", "liquid_storage"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["liquid_storage"],
      },
    ],
  }),
  createEntityDefinition({
    id: "gas_storager_1",
    nameKey: "registry.entity.gas_storager_1.name",
    spriteId: "gas_storager_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "warehouse",
    displayOrder: 411,
    tags: ["武陵", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "gas_input",
        "fluid",
        "input",
        [
          createPort("in_w_1", 0, 1, "W", {
            acceptRule: { base: { kind: "gas" }, exclude: [] },
          }),
        ],
      ),
      createPortGroup(
        "gas_output",
        "fluid",
        "output",
        [
          createPort("out_e_1", 2, 1, "E", {
            acceptRule: { base: { kind: "gas" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_storage",
        "fluid",
        createSlots("slot", [500], "gas"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_gas_input", "gas_input", "gas_storage"),
      createBinding("bind_gas_output", "gas_output", "gas_storage"),
    ],
    inspectors: [
      {
        type: INSPECTOR_TYPE.slotConfig,
        slotGroupIds: ["gas_storage"],
      },
    ],
  }),
  createEmptyEntityDefinition({
    id: "item_port_power_diffuser_1",
    nameKey: "registry.entity.item_port_power_diffuser_1.name",
    spriteId: "item_port_power_diffuser_1",
    footprint: { width: 2, height: 2 },
    uiGroup: "resourcePower",
    displayOrder: 302,
    powerRange: 12,
    tags: [],
  }),
  createEntityDefinition({
    id: "vaporizer_1",
    nameKey: "registry.entity.vaporizer_1.name",
    spriteId: "vaporizer_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    displayOrder: 304,
    tags: [PRODUCER_TAG],
    requiresPower: true,
    powerDemand: 5,
    meteredConsumption: {
      inputPortGroupId: "gas_input",
      itemIds: [
        "item_gas_acid",
        "item_gas_inert",
        "item_gas_water",
        "item_gas_xiranite",
      ],
      windowSeconds: 60,
      startThreshold: 6,
      acceptanceLimit: 30,
      gasDiffusionRange: 13,
    },
    portGroups: [
      createPortGroup(
        "gas_input",
        "fluid",
        "input",
        [
          createPort("in_w_1", 0, 1, "W", {
            acceptRule: { base: { kind: "gas" }, exclude: [] },
          }),
        ],
      ),
    ],
    // AI-REMOVED 2026-07-16:
    // Reason: vaporizer 输入气体由 metered sink 立即销毁，真实 gas_input_buffer 不再保存任何物品。
    // Trigger: 用户要求删除消耗槽位并现场验证求解。
    // Evidence: 未绑定 gas_input 会由 compiler 生成内部 synthetic-input node/slot。
    // Replacement: topology-compiler.compileSyntheticNodesForUnboundPorts。
    // Risk: Low - synthetic slot 保持空槽，仅用于 Stage 3 目标定位。
    // Human Review: Required
    //
    // Original code:
    // storageSlotGroups: [
    //   createStorageSlotGroup(
    //     "gas_input_buffer",
    //     "fluid",
    //     createSlots("gas_input_slot", [500], "gas"),
    //   ),
    // ],
    storageSlotGroups: [],
    // AI-REMOVED 2026-07-16:
    // Reason: 气体散布机改由计量消费窗口直接销毁输入并产生气体环境，不再运行计时配方。
    // Trigger: 用户确认下限 6、上限 30 的整分钟计量机制适用于 vaporizer_1。
    // Evidence: meteredConsumption 已声明 gas_input 为销毁型入口，配方通道无法再从该虚拟槽取得输入。
    // Replacement: vaporizer_1.meteredConsumption + simulation/runtime/metered-consumption.ts。
    // Risk: Medium - 旧蓝图中的 channelRecipes.default 配置将保留为无效配置。
    // Human Review: Required
    //
    // Original code:
    // recipeChannels: [
    //   createRecipeChannel("default", ["gas_input_buffer"], []),
    // ],
    recipeChannels: [],
    // AI-REMOVED 2026-07-16:
    // Reason: gas_input 改由 compiler 绑定内部 synthetic sink，不再绑定真实 gas_input_buffer。
    // Trigger: 用户要求删除消耗槽位并验证求解。
    // Evidence: meteredConsumption 通过 inputPortGroupId 定位 compiled port，不依赖 storage binding。
    // Replacement: synthetic-input node binding。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // portStorageBindings: [
    //   createBinding("bind_gas_input", "gas_input", "gas_input_buffer"),
    // ],
    portStorageBindings: [],
    inspectors: [
      // AI-REMOVED 2026-07-16:
      // Reason: vaporizer_1 不再运行配方，配方状态面板没有有效 channel 可展示。
      // Trigger: 气体环境生命周期迁移到 meteredConsumption 运行许可。
      // Evidence: recipeChannels 已清空；气体效果由计量状态决定。
      // Replacement: None；计量状态通过仿真快照提供。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // {
      //   type: INSPECTOR_TYPE.recipeStatus,
      //   channelIds: ["default"],
      // },
      // AI-REMOVED 2026-07-16:
      // Reason: gas_input_buffer 已删除，内部 synthetic sink 不应暴露为可配置库存。
      // Trigger: 用户要求删除消耗槽位；若不能删除则至少从 inspector 隐藏。
      // Evidence: vaporizer 的计量状态由 runtime snapshot 表达，不再由 slotConfig 表达。
      // Replacement: None。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // {
      //   type: INSPECTOR_TYPE.slotConfig,
      //   slotGroupIds: ["gas_input_buffer"],
      // },
    ],
  }),
  createEntityDefinition({
    id: "item_log_admission",
    nameKey: "registry.entity.item_log_admission.name",
    spriteId: "item_log_admission",
    footprint: { width: 1, height: 1 },
    uiGroup: "beltLogistics",
    displayOrder: 104,
    tags: ["BeltFamily"],
    placementBehaviors: ALLOW_PIPE_OVERLAP_PLACEMENT_BEHAVIORS,
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "item_input",
        "item",
        "input",
        [createPort("in_w", 0, 0, "W", {
          admissionRule: { itemId: null, limit: null, perMinuteLimit: null },
        })],
      ),
      createPortGroup(
        "item_output",
        "item",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 createSimpleProductionDevice（分离 input+output 组）已失效。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
      {
        type: INSPECTOR_TYPE.admissionRule,
        portGroupId: "item_input",
        portId: "in_w",
      },
    ],
  }),
  createEntityDefinition({
    id: "item_pipe_admission",
    nameKey: "registry.entity.item_pipe_admission.name",
    spriteId: "item_pipe_admission",
    footprint: { width: 1, height: 1 },
    uiGroup: "pipeLogistics",
    displayOrder: 204,
    tags: ["武陵", "PipeFamily", "OuterRingAllowed"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "fluid_input",
        "fluid",
        "input",
        [createPort("in_w", 0, 0, "W", {
          admissionRule: { itemId: null, limit: null, perMinuteLimit: null },
        })],
      ),
      createPortGroup(
        "fluid_output",
        "fluid",
        "output",
        [createPort("out_e", 0, 0, "E")],
      ),
    ],
    // AI-CORRECTION 2026-05-13: 原 createSimpleProductionDevice（分离 input+output 组）已失效。
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
    inspectors: [
      {
        type: INSPECTOR_TYPE.logisticsItem,
      },
      {
        type: INSPECTOR_TYPE.admissionRule,
        portGroupId: "fluid_input",
        portId: "in_w",
      },
    ],
  }),
  // =========================================================================
  // 不可摆放设备（tag: "不可摆放"）
  //
  // uiGroup 归属正常分组以在百科中按分类检索，
  // placement-panel 通过 tag 筛掉，不在放置面板中显示。
  // =========================================================================

  /**
   * item_port_dumper_1 — 给水器（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   * 仅作为倾倒配方的目标设备，产出的物品直接消失。
   */
  createEmptyEntityDefinition({
    id: "item_port_dumper_1",
    nameKey: "registry.entity.item_port_dumper_1.name",
    spriteId: "item_port_dumper_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
  }),

  /**
   * gas_pump_1 — 气体收集泵（3×3）
   *
   * 仅作为气体采集设备，1 个管道输出口在东侧。
   * AI-CORRECTION 2026-07-16: 根据导出数据新增端口定义，从 createEmptyEntityDefinition 改为 createEntityDefinition。
   *   导出数据: outputPorts[0]=(x:2,y:3,z:1), rotation Y=90(E)
   */
  createEntityDefinition({
    id: "gas_pump_1",
    nameKey: "registry.entity.gas_pump_1.name",
    spriteId: "gas_pump_1",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
    requiresPower: false,
    powerDemand: 0,
    portGroups: [
      createPortGroup(
        "gas_output",
        "fluid",
        "output",
        [
          createPort("out_e_1", 2, 1, "E", {
            acceptRule: { base: { kind: "gas" }, exclude: [] },
          }),
        ],
      ),
    ],
    storageSlotGroups: [
      createStorageSlotGroup(
        "gas_output_buffer",
        "fluid",
        createSlots("output_gas_slot", [50], "gas"),
      ),
    ],
    portStorageBindings: [
      createBinding("bind_gas_output", "gas_output", "gas_output_buffer"),
    ],
  }),

  /**
   * item_port_miner_2 — 电驱矿机（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   */
  createEmptyEntityDefinition({
    id: "item_port_miner_2",
    nameKey: "registry.entity.item_port_miner_2.name",
    spriteId: "item_port_miner_2",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
  }),

  /**
   * item_port_miner_3 — 二型电驱矿机（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   */
  createEmptyEntityDefinition({
    id: "item_port_miner_3",
    nameKey: "registry.entity.item_port_miner_3.name",
    spriteId: "item_port_miner_3",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
  }),

  /**
   * item_port_miner_4 — 水驱矿机（3×3）
   *
   * 不可摆放设备，无精灵定义，无端口/槽位/配方。
   */
  createEmptyEntityDefinition({
    id: "item_port_miner_4",
    nameKey: "registry.entity.item_port_miner_4.name",
    spriteId: "item_port_miner_4",
    footprint: { width: 3, height: 3 },
    uiGroup: "resourcePower",
    tags: ["不可摆放"],
  }),
];
