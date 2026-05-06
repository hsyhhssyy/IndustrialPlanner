// =========================================================================
// Topology Compiler — 将 WorldDocument + Registry 编译为 CompiledSimulationTopology
//
// 对应《模拟器抽象方式》§5 编译期合并 + 《仿真运行原理》§5 图模型。
//
// 编译流程：
//   1. compileItemCatalog()          — 物品目录
//   2. compileWarehouseDevice()      — 仓库虚拟设备
//   3. compileEntityDevice()         — 每个 WorldEntity → CompiledSimulationDevice
//      a. compileStorageSlotGroups() — 显式存储槽组 → CacheGroup + SlotTemplate
//      b. compileSyntheticCacheGroups() — 无显式存储时自动合成 ingredient/product 缓存组
//      c. compilePorts()            — 端口编译（计算旋转后位置、merge acceptRule、绑定缓存组）
//      d. compileRecipePlan()       — 配方计划（内联 vs 外部配方）
//      e. compileInternalLinks()    — 内部 Link（share-cap / share-all）
//      2026-05-04 订正：内部 Link 只编译为有向 share-all 代理，不再存在 share-cap。
//      订正（2026-05-05）：恢复 share-cap；share-all 共享库存，share-cap 只共享容量。
//   4. compileExplicitLinks()       — 显式连接（dark-pipe → share-all）
//   5. compilePhysicalConnections() — 物理端口连接 → CompiledSimulationPhysicalConnection
//   6. 对每条物理连接生成 CompiledSimulationTransferEdge（求解图的有向边）
//
// 编译时关键操作：
//   - deepMerge(definitionDefaults, entityConfig) — 配置覆盖（《模拟器抽象方式》§5）
//   - acceptRule 交集运算（《仿真运行原理》§5.2）
//   - count = min(sourcePort.count, targetPort.count)
//   - role → cacheType 映射（input→ingredient, output→product, bidirectional→universal）
//   - direction="bidirectional" 的端口自动分解为 input + output
// =========================================================================

import type { RegistryContract } from "@/domain/contract/registry-contracts";
import type { WorldDocument, WorldEntity } from "@/domain/entity/world-document";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/types/grid";
import type {
  CompiledSimulationCacheGroup,
  CompiledSimulationCacheLink,
  CompiledSimulationDevice,
  CompiledSimulationItem,
  CompiledSimulationPhysicalConnection,
  CompiledSimulationPort,
  CompiledSimulationRecipePlan,
  CompiledSimulationRoutingEntry,
  CompiledSimulationSlotTemplate,
  CompiledSimulationTopology,
  CompiledSimulationTransferEdge,
  SimulationAcceptRule,
  SimulationCacheType,
  SimulationCompileDiagnostic,
  SimulationCountLimit,
  SimulationItemDomain,
  SimulationPortDirection,
  SimulationPortKind,
  SimulationTransportClass,
} from "./types";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import type { RecipeDefinition } from "@/domain/types/registry/recipe-definition";
import { hashStable } from "./deterministic";
import { STANDARD_TICK_RATE_PER_SECOND } from "./tick-rate";

// 从 EntityDefinition 解构的子类型别名
type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];

interface CompileOptions {
  readonly document: WorldDocument;
  readonly registry: RegistryContract;
}

/** 单个设备编译产物的临时结构 */
interface DeviceCompileResult {
  readonly device: CompiledSimulationDevice;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly slots: readonly CompiledSimulationSlotTemplate[];
  readonly ports: readonly CompiledSimulationPort[];
  readonly links: readonly CompiledSimulationCacheLink[];
}

interface StorageGroupNodeBinding {
  readonly inputNodeIds: readonly string[];
  readonly outputNodeIds: readonly string[];
  readonly recipeNodeIds: readonly string[];
}

/** 端口朝向排序优先级：北→东→南→西 */
const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

/**
 * 编译仿真拓扑主入口。
 *
 * 对应《仿真运行原理》§2 总原则 + §5 图模型。
 *
 * 输出 CompiledSimulationTopology，包含：
 *   - devices/cacheGroups/slots/ports/links — 编译后的仿真数据模型
 *   - physicalConnections — 端口间的物理连接
 *   - transferEdges — 求解图的有向边（对应《仿真运行原理》§5.2 边来源）
 *   - ordering — 各集合的确定性遍历顺序（保证确定性仿真）
 *
 * 边的 acceptRule = sourcePort.acceptRule AND targetPort.acceptRule (§5.2)
 * 边的 count = min(sourcePort.count, targetPort.count) (§5.2)
 */
export function compileSimulationTopology(
  options: CompileOptions,
): CompiledSimulationTopology {
  const standardTickRate = STANDARD_TICK_RATE_PER_SECOND;
  const diagnostics: SimulationCompileDiagnostic[] = [];
  const entityDefinitionMap = new Map(
    options.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );
  const recipeDefinitionMap = new Map(
    options.registry.recipeDefinitions.map((definition) => [definition.id, definition]),
  );
  const itemCatalog = compileItemCatalog(options.registry);
  const deviceOrder: string[] = [];
  const cacheGroupOrder: string[] = [];
  const slotOrder: string[] = [];
  const portOrder: string[] = [];
  const physicalConnectionOrder: string[] = [];
  const edgeOrder: string[] = [];
  const devices: Record<string, CompiledSimulationDevice> = {};
  const cacheGroups: Record<string, CompiledSimulationCacheGroup> = {};
  const slots: Record<string, CompiledSimulationSlotTemplate> = {};
  const ports: Record<string, CompiledSimulationPort> = {};
  const links: Record<string, CompiledSimulationCacheLink> = {};
  const physicalConnections: Record<string, CompiledSimulationPhysicalConnection> = {};
  const transferEdges: Record<string, CompiledSimulationTransferEdge> = {};

  const warehouse = compileWarehouseDevice(options.document, itemCatalog);
  addDeviceCompileResult({
    result: warehouse,
    devices,
    cacheGroups,
    slots,
    ports,
    links,
    deviceOrder,
    cacheGroupOrder,
    slotOrder,
    portOrder,
  });

  for (const entityId of getOrderedEntityIds(options.document)) {
    const entity = options.document.entities[entityId];
    if (entity === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "missing-ordered-entity",
        message: `Document entityOrder references missing entity "${entityId}".`,
        entityId,
      });
      continue;
    }

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      diagnostics.push({
        severity: "error",
        code: "missing-entity-definition",
        message: `Missing entity definition "${entity.definitionId}".`,
        entityId: entity.id,
        definitionId: entity.definitionId,
      });
      continue;
    }

    addDeviceCompileResult({
      result: compileEntityDevice({
        entity,
        definition,
        registryQueries: options.registry.queries,
        recipeDefinitionMap,
        itemCatalog,
      }),
      devices,
      cacheGroups,
      slots,
      ports,
      links,
      deviceOrder,
      cacheGroupOrder,
      slotOrder,
      portOrder,
    });
  }

  for (const link of compileExplicitLinks({
    document: options.document,
    devices,
    cacheGroups,
    slots,
  })) {
    if (links[link.id] === undefined) {
      links[link.id] = link;
    }
  }

  for (const connection of compilePhysicalConnections(portOrder.map((portId) => ports[portId]))) {
    physicalConnections[connection.id] = connection;
    physicalConnectionOrder.push(connection.id);

    const sourcePort = ports[connection.sourcePortId];
    const targetPort = ports[connection.targetPortId];
    if (sourcePort === undefined || targetPort === undefined) {
      continue;
    }

    for (const sourceCacheGroupId of sourcePort.boundCacheGroupIds) {
      for (const targetCacheGroupId of targetPort.boundCacheGroupIds) {
        const acceptRule = intersectAcceptRules(
          sourcePort.acceptRule,
          targetPort.acceptRule,
          itemCatalog,
        );
        if (acceptRule === null) {
          diagnostics.push({
            severity: "info",
            code: "empty-edge-accept-rule",
            message: `Connection "${connection.id}" has no accepted item domain overlap.`,
          });
          continue;
        }

        const edge: CompiledSimulationTransferEdge = {
          id: [
            "edge",
            sourceCacheGroupId,
            targetCacheGroupId,
            connection.id,
          ].join(":"),
          physicalConnectionId: connection.id,
          sourcePortId: sourcePort.id,
          targetPortId: targetPort.id,
          sourceNodeId: sourceCacheGroupId,
          targetNodeId: targetCacheGroupId,
          sourceCacheGroupId,
          targetCacheGroupId,
          acceptRule,
          count: minCountLimit(sourcePort.count, targetPort.count),
        };
        transferEdges[edge.id] = edge;
        edgeOrder.push(edge.id);
      }
    }
  }

  const registryHash = hashStable({
    entities: options.registry.entityDefinitions,
    items: options.registry.itemDefinitions,
    recipes: options.registry.recipeDefinitions,
  });
  const documentHash = hashStable({
    baseId: options.document.baseId,
    entities: options.document.entities,
    entityOrder: options.document.entityOrder,
    explicitLinks: options.document.explicitLinks,
  });
  const topologyHashInput = {
    documentHash,
    registryHash,
    standardTickRate,
    devices,
    nodes: cacheGroups,
    cacheGroups,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
    ordering: {
      deviceOrder,
      nodeOrder: cacheGroupOrder,
      cacheGroupOrder,
      slotOrder,
      portOrder,
      physicalConnectionOrder,
      edgeOrder,
    },
  };

  return {
    schemaVersion: 2,
    topologyId: hashStable(topologyHashInput),
    documentKey: options.document.documentKey,
    documentHash,
    registryHash,
    standardTickRate,
    itemCatalog,
    devices,
    nodes: cacheGroups,
    cacheGroups,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
    ordering: {
      deviceOrder,
      nodeOrder: cacheGroupOrder,
      cacheGroupOrder,
      slotOrder,
      portOrder,
      physicalConnectionOrder,
      edgeOrder,
    },
    diagnostics,
  };
}

function convertSecondsToSimulationTicks(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds * STANDARD_TICK_RATE_PER_SECOND));
}

function addDeviceCompileResult(options: {
  readonly result: DeviceCompileResult;
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly cacheGroups: Record<string, CompiledSimulationCacheGroup>;
  readonly slots: Record<string, CompiledSimulationSlotTemplate>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationCacheLink>;
  readonly deviceOrder: string[];
  readonly cacheGroupOrder: string[];
  readonly slotOrder: string[];
  readonly portOrder: string[];
}): void {
  options.devices[options.result.device.id] = options.result.device;
  options.deviceOrder.push(options.result.device.id);

  for (const cacheGroup of options.result.cacheGroups) {
    options.cacheGroups[cacheGroup.id] = cacheGroup;
    options.cacheGroupOrder.push(cacheGroup.id);
  }

  for (const slot of options.result.slots) {
    options.slots[slot.id] = slot;
    options.slotOrder.push(slot.id);
  }

  for (const port of options.result.ports) {
    options.ports[port.id] = port;
    options.portOrder.push(port.id);
  }

  for (const link of options.result.links) {
    options.links[link.id] = link;
  }
}

/**
 * deepMerge 定义默认值与 entity.config 覆盖值。
 *
 * 对应《模拟器抽象方式》§5 编译期合并：
 *   - config 中存在的字段覆盖定义默认值
 *   - config 中不存在的字段保留定义默认值
 *   - 路径语法如 "slots[0].lock" 自动解析为嵌套对象路径
 *
 * 例如：
 *   EntityDefinition.slots[0].lock = null
 *   entity.config["slots[0].lock"] = "iron_plate"
 *   → 合并后 slots[0].lock = "iron_plate"
 */
function mergeEntityDefinitionConfig(
  definition: EntityDefinition,
  config: WorldEntity["config"],
): EntityDefinition {
  return deepMergeJson(
    cloneJson(definition),
    materializeConfigOverrides(config),
  ) as EntityDefinition;
}

function completeExternalRecipeMachineDefinition(options: {
  readonly definition: EntityDefinition;
  readonly recipeDefinitionMap: ReadonlyMap<string, RecipeDefinition>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
}): EntityDefinition {
  const recipes = [...options.recipeDefinitionMap.values()]
    .filter((recipe) => recipe.machineId === options.definition.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    recipes.length === 0
    || options.definition.portGroups.length > 0
    || options.definition.storageSlotGroups.length > 0
  ) {
    return options.definition;
  }

  const inputProfile = summarizeRecipeItems(recipes.map((recipe) => recipe.inputs), options.itemCatalog);
  const outputProfile = summarizeRecipeItems(recipes.map((recipe) => recipe.outputs), options.itemCatalog);
  const portGroups: EntityDefinition["portGroups"] = [];
  const storageSlotGroups: EntityDefinition["storageSlotGroups"] = [];
  const portStorageBindings: EntityDefinition["portStorageBindings"] = [];

  if (inputProfile.solidSlotCount > 0) {
    portGroups.push(createGeneratedPortGroup(options.definition, "item_input", "item", "input"));
    storageSlotGroups.push(createGeneratedStorageSlotGroup(
      "item_input_buffer",
      "item",
      "input",
      "input_slot",
      inputProfile.solidSlotCount,
      "solid",
    ));
    portStorageBindings.push({
      id: "bind_item_input",
      portGroupId: "item_input",
      storageSlotGroupId: "item_input_buffer",
    });
  }

  if (inputProfile.liquidSlotCount > 0) {
    portGroups.push(createGeneratedPortGroup(options.definition, "fluid_input", "fluid", "input"));
    storageSlotGroups.push(createGeneratedStorageSlotGroup(
      "fluid_input_buffer",
      "fluid",
      "input",
      "input_fluid_slot",
      inputProfile.liquidSlotCount,
      "liquid",
    ));
    portStorageBindings.push({
      id: "bind_fluid_input",
      portGroupId: "fluid_input",
      storageSlotGroupId: "fluid_input_buffer",
    });
  }

  if (outputProfile.solidSlotCount > 0) {
    portGroups.push(createGeneratedPortGroup(options.definition, "item_output", "item", "output"));
    storageSlotGroups.push(createGeneratedStorageSlotGroup(
      "item_output_buffer",
      "item",
      "output",
      "output_slot",
      outputProfile.solidSlotCount,
      "solid",
    ));
    portStorageBindings.push({
      id: "bind_item_output",
      portGroupId: "item_output",
      storageSlotGroupId: "item_output_buffer",
    });
  }

  if (outputProfile.liquidSlotCount > 0) {
    portGroups.push(createGeneratedPortGroup(options.definition, "fluid_output", "fluid", "output"));
    storageSlotGroups.push(createGeneratedStorageSlotGroup(
      "fluid_output_buffer",
      "fluid",
      "output",
      "output_fluid_slot",
      outputProfile.liquidSlotCount,
      "liquid",
    ));
    portStorageBindings.push({
      id: "bind_fluid_output",
      portGroupId: "fluid_output",
      storageSlotGroupId: "fluid_output_buffer",
    });
  }

  return {
    ...options.definition,
    recipe: options.definition.recipe ?? {
      recipeId: null,
      recipeType: "immediate-consume",
      durationSeconds: 1,
      inputs: [],
      outputs: [],
    },
    portGroups,
    storageSlotGroups,
    portStorageBindings,
  };
}

function summarizeRecipeItems(
  itemGroups: ReadonlyArray<RecipeDefinition["inputs"]>,
  itemCatalog: Record<string, CompiledSimulationItem>,
): {
  readonly solidSlotCount: number;
  readonly liquidSlotCount: number;
} {
  let solidSlotCount = 0;
  let liquidSlotCount = 0;
  for (const items of itemGroups) {
    const solidItems = new Set<string>();
    const liquidItems = new Set<string>();
    for (const item of items) {
      const domain = itemCatalog[item.itemId]?.domain ?? inferItemDomain(item.itemId, []);
      if (domain === "liquid") {
        liquidItems.add(item.itemId);
      } else {
        solidItems.add(item.itemId);
      }
    }
    solidSlotCount = Math.max(solidSlotCount, solidItems.size);
    liquidSlotCount = Math.max(liquidSlotCount, liquidItems.size);
  }
  return {
    solidSlotCount,
    liquidSlotCount,
  };
}

function createGeneratedPortGroup(
  definition: EntityDefinition,
  id: string,
  kind: PortGroupDefinition["kind"],
  direction: PortGroupDefinition["direction"],
): PortGroupDefinition {
  const isInput = direction === "input";
  const isFluid = kind === "fluid";
  const localCellX = isFluid
    ? (isInput ? definition.footprint.width - 1 : 0)
    : Math.floor((definition.footprint.width - 1) / 2);
  const localCellY = isFluid
    ? Math.floor((definition.footprint.height - 1) / 2)
    : (isInput ? definition.footprint.height - 1 : 0);
  const edge = isFluid
    ? (isInput ? "EAST" : "WEST")
    : (isInput ? "SOUTH" : "NORTH");

  return {
    id,
    kind,
    direction,
    ports: [{
      id: isInput ? "in_auto" : "out_auto",
      localCellX,
      localCellY,
      edge,
      acceptRule: acceptRuleFromPortKind(kind),
      count: "unlimited",
      priorityGroup: 0,
      roundRobinSeed: 0,
    }],
  };
}

function createGeneratedStorageSlotGroup(
  id: string,
  kind: StorageSlotGroupDefinition["kind"],
  role: StorageSlotGroupDefinition["role"],
  slotPrefix: string,
  slotCount: number,
  itemFilterType: "solid" | "liquid",
): StorageSlotGroupDefinition {
  return {
    id,
    kind,
    role,
    slots: Array.from({ length: Math.max(1, slotCount) }, (_, slotIndex) => ({
      id: `${slotPrefix}_${slotIndex + 1}`,
      capacity: 50,
      itemFilter: "type",
      itemFilterType,
      lock: null,
      initialItemType: null,
      initialCount: 0,
      ignoreStock: false,
      submitMode: "never",
      submitIntervalSeconds: null,
    })),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materializeConfigOverrides(config: WorldEntity["config"]): Record<string, unknown> {
  const materialized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (key.includes(".") || key.includes("[")) {
      assignPathValue(materialized, parseConfigPath(key), value);
      continue;
    }

    materialized[key] = value;
  }

  return materialized;
}

function parseConfigPath(path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(path)) !== null) {
    const property = match[1];
    const index = match[2];

    if (property !== undefined) {
      tokens.push(property);
      continue;
    }

    if (index !== undefined) {
      tokens.push(Number(index));
    }
  }

  return tokens;
}

function assignPathValue(
  target: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): void {
  let cursor: Record<string, unknown> | unknown[] = target;

  path.forEach((token, index) => {
    const isLast = index === path.length - 1;

    if (isLast) {
      cursor[token as keyof typeof cursor] = value as never;
      return;
    }

    const nextToken = path[index + 1];
    const currentValue = cursor[token as keyof typeof cursor];
    if (typeof currentValue === "object" && currentValue !== null) {
      cursor = currentValue as Record<string, unknown> | unknown[];
      return;
    }

    const nextValue: Record<string, unknown> | unknown[] =
      typeof nextToken === "number" ? [] : {};
    cursor[token as keyof typeof cursor] = nextValue as never;
    cursor = nextValue;
  });
}

function deepMergeJson(left: unknown, right: unknown): unknown {
  if (Array.isArray(left) && Array.isArray(right)) {
    const merged = [...left];
    right.forEach((rightValue, index) => {
      merged[index] = index in merged
        ? deepMergeJson(merged[index], rightValue)
        : rightValue;
    });
    return merged;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      merged[key] = key in merged
        ? deepMergeJson(merged[key], value)
        : value;
    }
    return merged;
  }

  return right;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compileItemCatalog(
  registry: RegistryContract,
): Record<string, CompiledSimulationItem> {
  const catalog: Record<string, CompiledSimulationItem> = {};

  for (const item of [...registry.itemDefinitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    catalog[item.id] = {
      id: item.id,
      domain: inferItemDomain(item.id, item.tags),
      tags: [...item.tags].sort(),
    };
  }

  return catalog;
}

/**
 * 编译仓库虚拟设备。
 *
 * 仓库不是世界中的实体，而是编译时自动生成的锚点设备。
 * 它为每个物品 ID 生成一个无限容量槽位（capacity=MAX_SAFE_INTEGER），
 * 所有槽位属于同一个 universal 缓存组。
 *
 * 仓储设备（取货口/出货口）通过 share-all Link（warehouse-item-link 面板）
 * 将自己的槽位连接到仓库对应物品的槽位，实现无限存取。
 */
function compileWarehouseDevice(
  document: WorldDocument,
  itemCatalog: Record<string, CompiledSimulationItem>,
): DeviceCompileResult {
  const deviceId = `device:warehouse:${document.baseId}`;
  const cacheGroupId = `${deviceId}/cache-group:warehouse`;
  const slots: CompiledSimulationSlotTemplate[] = Object.keys(itemCatalog).sort().map((itemId) => ({
    id: `${cacheGroupId}/slot:${itemId}`,
    cacheGroupId,
    nodeId: cacheGroupId,
    sourceSlotId: itemId,
    capacity: Number.MAX_SAFE_INTEGER,
    domain: itemCatalog[itemId]?.domain ?? "any",
    lock: itemId,
    initialItemType: itemId,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never" as const,
    submitIntervalTicks: null,
  }));
  const cacheGroup: CompiledSimulationCacheGroup = {
    id: cacheGroupId,
    deviceId,
    sourceStorageSlotGroupId: "warehouse",
    cacheType: "universal",
    slotIds: slots.map((slot) => slot.id),
    inputPortIds: [],
    outputPortIds: [],
    viewRole: "single-view",
    groupOrder: 0,
  };

  return {
    device: {
      id: deviceId,
      sourceEntityId: null,
      definitionId: "warehouse",
      position: null,
      rotation: null,
      tags: ["warehouse"],
      transportClass: "anchor",
      nodeIds: [cacheGroupId],
      cacheGroupIds: [cacheGroupId],
      portIds: [],
      recipePlan: null,
      recipePlans: [],
      routing: {},
      configHash: hashStable({ baseId: document.baseId, itemIds: Object.keys(itemCatalog).sort() }),
    },
    cacheGroups: [cacheGroup],
    slots,
    ports: [],
    links: [],
  };
}

/**
 * 编译单个世界实体为 CompiledSimulationDevice。
 *
 * 编译步骤（对应《仿真运行原理》§5 图模型）：
 *   1. mergeEntityDefinitionConfig() — 合并 config 覆盖
 *   2. compileStorageSlotGroups() — 显式存储槽组 → CacheGroup + SlotTemplate
 *   3. compileSyntheticCacheGroups() — 无显式存储时自动合成 ingredient/product 缓存组
 *   4. compilePorts() — 端口编译
 *   5. compileRecipePlan() — 配方计划
 *   6. compileInternalLinks() — 内部 Link
 */
function compileEntityDevice(options: {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly registryQueries: RegistryContract["queries"];
  readonly recipeDefinitionMap: ReadonlyMap<string, RecipeDefinition>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
}): DeviceCompileResult {
  const deviceId = `device:${options.entity.id}`;
  const definition = mergeEntityDefinitionConfig(completeExternalRecipeMachineDefinition({
    definition: options.definition,
    recipeDefinitionMap: options.recipeDefinitionMap,
    itemCatalog: options.itemCatalog,
  }), options.entity.config);
  const transportClass = resolveTransportClass(options.registryQueries, definition);
  const cacheGroups: CompiledSimulationCacheGroup[] = [];
  const slots: CompiledSimulationSlotTemplate[] = [];
  const ports: CompiledSimulationPort[] = [];
  const links: CompiledSimulationCacheLink[] = [];
  const nodeBindingsByStorageGroupId = new Map<string, StorageGroupNodeBinding>();

  compileStorageSlotGroups({
    deviceId,
    definition,
    cacheGroups,
    slots,
    links,
    nodeBindingsByStorageGroupId,
  });

  if (cacheGroups.length === 0) {
    compileSyntheticCacheGroups({
      deviceId,
      definition,
      cacheGroups,
      slots,
      nodeBindingsByStorageGroupId,
    });
  }

  compilePorts({
    deviceId,
    entity: options.entity,
    definition,
    nodeBindingsByStorageGroupId,
    itemCatalog: options.itemCatalog,
    ports,
  });

  for (const cacheGroup of cacheGroups) {
    const inputPortIds = ports
      .filter((port) =>
        port.direction === "input" && port.boundCacheGroupIds.includes(cacheGroup.id),
      )
      .map((port) => port.id);
    const outputPortIds = ports
      .filter((port) =>
        port.direction === "output" && port.boundCacheGroupIds.includes(cacheGroup.id),
      )
      .map((port) => port.id);

    cacheGroups[cacheGroups.indexOf(cacheGroup)] = {
      ...cacheGroup,
      inputPortIds,
      outputPortIds,
    };
  }

  const recipePlans = compileRecipePlans({
    deviceId,
    definition,
    recipeDefinitionMap: options.recipeDefinitionMap,
    cacheGroups,
    nodeBindingsByStorageGroupId,
  });

  const device: CompiledSimulationDevice = {
    id: deviceId,
    sourceEntityId: options.entity.id,
    definitionId: definition.id,
    position: { ...options.entity.position },
    rotation: options.entity.rotation,
    tags: [...definition.tags].sort(),
    transportClass,
    nodeIds: cacheGroups.map((cacheGroup) => cacheGroup.id),
    cacheGroupIds: cacheGroups.map((cacheGroup) => cacheGroup.id),
    portIds: ports.map((port) => port.id),
    recipePlan: recipePlans[0] ?? null,
    recipePlans,
    routing: compileRouting(definition),
    configHash: hashStable({
      entity: options.entity,
      definition,
    }),
  };

  compileInternalLinks({
    deviceId,
    definition,
    nodeBindingsByStorageGroupId,
    cacheGroups,
    slots,
    links,
  });

  return {
    device,
    cacheGroups,
    slots,
    ports,
    links,
  };
}

/**
 * 编译显式存储槽组。
 *
 * 对应《仿真运行原理》§3.1 缓存类型 + §3.4 缓存组：
 *   - 每个 storageSlotGroup 生成 1 个 CacheGroup（= 1 个求解图节点）
 *   - role → cacheType：input→ingredient, output→product, bidirectional→universal
 *   - 组内所有 slot 编译为 SlotTemplate
 *
 * 例如：
 *   协议存储箱：6 槽 universal 组 → 1 个 CacheGroup（1 个节点）
 *   订正（2026-05-04）：协议存储箱在仿真编译期按 6 个独立 CacheGroup 处理。
 *   反应池：5 槽 ingredient 组 → 1 个 CacheGroup（1 个节点）
 *   传送带：1 槽 ingredient 组 + 1 槽 product 组 → 2 个 CacheGroup（2 个节点）
 */
function compileStorageSlotGroups(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly slots: CompiledSimulationSlotTemplate[];
  readonly links: CompiledSimulationCacheLink[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
}): void {
  options.definition.storageSlotGroups.forEach((storageGroup, groupIndex) => {
    const portDirections = resolveStorageGroupPortDirections(options.definition, storageGroup.id);
    const inputNodeIds: string[] = [];
    const outputNodeIds: string[] = [];
    const recipeNodeIds: string[] = [];

    if (shouldTreatStorageSlotsAsIndependentGroups(options.definition, storageGroup)) {
      storageGroup.slots.forEach((slot, slotIndex) => {
        const nodeSet = compileStorageNodeSet({
          deviceId: options.deviceId,
          definition: options.definition,
          storageGroup,
          slots: [slot],
          slotStartIndex: slotIndex,
          baseNodeId: `${options.deviceId}/cache-group:${storageGroup.id}.${slot.id}`,
          groupOrder: groupIndex + slotIndex,
          hasInputBinding: portDirections.hasInput,
          hasOutputBinding: portDirections.hasOutput,
          cacheGroups: options.cacheGroups,
          compiledSlots: options.slots,
          links: options.links,
        });
        inputNodeIds.push(...nodeSet.inputNodeIds);
        outputNodeIds.push(...nodeSet.outputNodeIds);
        recipeNodeIds.push(...nodeSet.recipeNodeIds);
      });
      options.nodeBindingsByStorageGroupId.set(storageGroup.id, { inputNodeIds, outputNodeIds, recipeNodeIds });
      return;
    }

    const nodeSet = compileStorageNodeSet({
      deviceId: options.deviceId,
      definition: options.definition,
      storageGroup,
      slots: storageGroup.slots,
      slotStartIndex: 0,
      baseNodeId: `${options.deviceId}/cache-group:${storageGroup.id}`,
      groupOrder: groupIndex,
      hasInputBinding: portDirections.hasInput,
      hasOutputBinding: portDirections.hasOutput,
      cacheGroups: options.cacheGroups,
      compiledSlots: options.slots,
      links: options.links,
    });
    options.nodeBindingsByStorageGroupId.set(storageGroup.id, nodeSet);
  });
}

function compileStorageNodeSet(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly storageGroup: StorageSlotGroupDefinition;
  readonly slots: readonly StorageSlotDefinition[];
  readonly slotStartIndex: number;
  readonly baseNodeId: string;
  readonly groupOrder: number;
  readonly hasInputBinding: boolean;
  readonly hasOutputBinding: boolean;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly compiledSlots: CompiledSimulationSlotTemplate[];
  readonly links: CompiledSimulationCacheLink[];
}): StorageGroupNodeBinding {
  if (options.hasInputBinding && options.hasOutputBinding) {
    const inputNodeId = `${options.baseNodeId}.input-view`;
    const outputNodeId = `${options.baseNodeId}.output-view`;
    const inputSlotIds: string[] = [];
    const outputSlotIds: string[] = [];
    const targetSlotIdBySourceSlotId: Record<string, string> = {};

    options.slots.forEach((slot, slotOffset) => {
      const slotIndex = options.slotStartIndex + slotOffset;
      const inputSlot = compileSlotTemplate({
        slot,
        slotIndex,
        cacheGroupId: inputNodeId,
        storageGroup: options.storageGroup,
        definition: options.definition,
        slotIdSuffix: ".in-view",
        initialItemType: null,
        initialCount: 0,
      });
      const outputSlot = compileSlotTemplate({
        slot,
        slotIndex,
        cacheGroupId: outputNodeId,
        storageGroup: options.storageGroup,
        definition: options.definition,
        slotIdSuffix: ".out-view",
      });
      options.compiledSlots.push(inputSlot, outputSlot);
      inputSlotIds.push(inputSlot.id);
      outputSlotIds.push(outputSlot.id);
      targetSlotIdBySourceSlotId[inputSlot.id] = outputSlot.id;
    });

    options.cacheGroups.push(createCompiledNode({
      id: inputNodeId,
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: options.storageGroup.id,
      cacheType: resolveCacheType(options.storageGroup.role),
      slotIds: inputSlotIds,
      groupOrder: options.groupOrder,
      viewRole: "input-view",
    }));
    options.cacheGroups.push(createCompiledNode({
      id: outputNodeId,
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: options.storageGroup.id,
      cacheType: resolveCacheType(options.storageGroup.role),
      slotIds: outputSlotIds,
      groupOrder: options.groupOrder + 0.5,
      viewRole: "output-view",
    }));
    options.links.push({
      id: ["link", options.deviceId, options.storageGroup.id, "input-view-to-output-view", inputNodeId, outputNodeId].join(":"),
      linkType: "share-all",
      sourceSlotIds: inputSlotIds,
      targetSlotIds: outputSlotIds,
      targetSlotIdBySourceSlotId,
    });

    return {
      inputNodeIds: [inputNodeId],
      outputNodeIds: [outputNodeId],
      recipeNodeIds: [outputNodeId],
    };
  }

  const nodeId = options.baseNodeId;
  const slotIds: string[] = [];
  options.slots.forEach((slot, slotOffset) => {
    const slotTemplate = compileSlotTemplate({
      slot,
      slotIndex: options.slotStartIndex + slotOffset,
      cacheGroupId: nodeId,
      storageGroup: options.storageGroup,
      definition: options.definition,
    });
    options.compiledSlots.push(slotTemplate);
    slotIds.push(slotTemplate.id);
  });
  options.cacheGroups.push(createCompiledNode({
    id: nodeId,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.storageGroup.id,
    cacheType: resolveCacheType(options.storageGroup.role),
    slotIds,
    groupOrder: options.groupOrder,
  }));
  return {
    inputNodeIds: options.hasInputBinding ? [nodeId] : [],
    outputNodeIds: options.hasOutputBinding ? [nodeId] : [],
    recipeNodeIds: [nodeId],
  };
}

function createCompiledNode(options: {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly cacheType: SimulationCacheType;
  readonly slotIds: readonly string[];
  readonly groupOrder: number;
  readonly viewRole?: "single-view" | "input-view" | "output-view";
}): CompiledSimulationCacheGroup {
  return {
    id: options.id,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.sourceStorageSlotGroupId,
    cacheType: options.cacheType,
    viewRole: options.viewRole ?? "single-view",
    slotIds: options.slotIds,
    inputPortIds: [],
    outputPortIds: [],
    groupOrder: options.groupOrder,
  };
}

function resolveStorageGroupPortDirections(
  definition: EntityDefinition,
  storageGroupId: string,
): { readonly hasInput: boolean; readonly hasOutput: boolean } {
  let hasInput = false;
  let hasOutput = false;
  for (const binding of definition.portStorageBindings) {
    if (binding.storageSlotGroupId !== storageGroupId) {
      continue;
    }
    const portGroup = definition.portGroups.find((candidate) => candidate.id === binding.portGroupId);
    if (portGroup === undefined) {
      continue;
    }
    if (portGroup.direction === "input" || portGroup.direction === "bidirectional") {
      hasInput = true;
    }
    if (portGroup.direction === "output" || portGroup.direction === "bidirectional") {
      hasOutput = true;
    }
  }
  return { hasInput, hasOutput };
}

function shouldTreatStorageSlotsAsIndependentGroups(
  definition: EntityDefinition,
  storageGroup: StorageSlotGroupDefinition,
): boolean {
  return definition.id === "item_port_storager_1"
    && storageGroup.id === "item_storage"
    && storageGroup.slots.length > 1;
}

/**
 * 合成缓存组（无显式 storageSlotGroup 时自动生成）。
 *
 * 对应《仿真运行原理》§5.1 中"无显式存储组"的设备（分流器、汇流器、管道等）。
 * 这些设备只需要 ingredient + product 行为而不需要持久存储。
 *
 * 规则：
 *   - 有 input 方向端口 → 合成 1 个 ingredient 缓存组（capacity=1）
 *   - 有 output 方向端口 → 合成 1 个 product 缓存组（capacity=1）
 *   - 设备级别 share-cap(1) Link 在 compileInternalLinks 中连接两端
 *   - 2026-05-04 订正：合成缓存组使用有向 share-all 代理 Link 连接 source/target。
 *   - 订正（2026-05-05）：搬运设备重新使用 share-cap；仅仓库/双视图等场景继续使用 share-all。
 */
function compileSyntheticCacheGroups(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly slots: CompiledSimulationSlotTemplate[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
}): void {
  const hasInput = options.definition.portGroups.some((portGroup) =>
    portGroup.direction === "input" || portGroup.direction === "bidirectional",
  );
  const hasOutput = options.definition.portGroups.some((portGroup) =>
    portGroup.direction === "output" || portGroup.direction === "bidirectional",
  );

  if (hasInput) {
    addSyntheticCacheGroup({
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: "synthetic-input",
      cacheType: "ingredient",
      groupOrder: options.cacheGroups.length,
      cacheGroups: options.cacheGroups,
      slots: options.slots,
      nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
      domain: inferStorageDomainFromPortGroups(options.definition.portGroups, "input"),
      bindDirection: "input",
    });
  }

  if (hasOutput) {
    addSyntheticCacheGroup({
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: "synthetic-output",
      cacheType: "product",
      groupOrder: options.cacheGroups.length,
      cacheGroups: options.cacheGroups,
      slots: options.slots,
      nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
      domain: inferStorageDomainFromPortGroups(options.definition.portGroups, "output"),
      bindDirection: "output",
    });
  }
}

function addSyntheticCacheGroup(options: {
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string;
  readonly cacheType: SimulationCacheType;
  readonly groupOrder: number;
  readonly cacheGroups: CompiledSimulationCacheGroup[];
  readonly slots: CompiledSimulationSlotTemplate[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
  readonly domain: SimulationItemDomain | "any";
  readonly bindDirection: SimulationPortDirection;
}): void {
  const cacheGroupId = `${options.deviceId}/cache-group:${options.sourceStorageSlotGroupId}`;
  const slotId = `${cacheGroupId}/slot:slot_1`;
  options.cacheGroups.push({
    id: cacheGroupId,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.sourceStorageSlotGroupId,
    cacheType: options.cacheType,
    slotIds: [slotId],
    inputPortIds: [],
    outputPortIds: [],
    viewRole: "single-view",
    groupOrder: options.groupOrder,
  });
  options.slots.push({
    id: slotId,
    cacheGroupId,
    nodeId: cacheGroupId,
    sourceSlotId: "slot_1",
    capacity: 1,
    domain: options.domain,
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never",
    submitIntervalTicks: null,
  });
  options.nodeBindingsByStorageGroupId.set(options.sourceStorageSlotGroupId, {
    inputNodeIds: options.bindDirection === "input" ? [cacheGroupId] : [],
    outputNodeIds: options.bindDirection === "output" ? [cacheGroupId] : [],
    recipeNodeIds: [cacheGroupId],
  });
}

function compileSlotTemplate(options: {
  readonly slot: StorageSlotDefinition;
  readonly slotIndex: number;
  readonly cacheGroupId: string;
  readonly storageGroup: StorageSlotGroupDefinition;
  readonly definition: EntityDefinition;
  readonly slotIdSuffix?: string;
  readonly initialItemType?: string | null;
  readonly initialCount?: number;
}): CompiledSimulationSlotTemplate {
  const submitMode = options.slot.submitMode;
  const submitInterval = submitMode === "every-n-seconds"
    ? convertSecondsToSimulationTicks(options.slot.submitIntervalSeconds ?? 10)
    : null;
  const initialCount = options.initialCount ?? options.slot.initialCount;
  const lock = options.slot.lock;
  const hasInitialItemTypeOverride = Object.prototype.hasOwnProperty.call(options, "initialItemType");
  const itemType = hasInitialItemTypeOverride
    ? options.initialItemType ?? null
    : options.slot.initialItemType ?? lock;

  return {
    id: `${options.cacheGroupId}/slot:${options.slot.id}${options.slotIdSuffix ?? ""}`,
    cacheGroupId: options.cacheGroupId,
    nodeId: options.cacheGroupId,
    sourceSlotId: options.slot.id,
    capacity: options.slot.capacity,
    domain: resolveSlotDomain(options.storageGroup, options.slot),
    lock,
    initialItemType: itemType,
    initialCount,
    ignoreStock: options.slot.ignoreStock,
    submitMode,
    submitIntervalTicks: submitInterval,
  };
}

/**
 * 对应《仿真运行原理》§3.1 中 Port 的两个通用配置 + §5.2 边来源。
 *
 * 关键操作：
 *   - 根据 entity.rotation 旋转端口局部坐标和朝向
 *   - 计算 insideGridPoint（设备内部位置）和 outsideGridPoint（外部连接位置）
 *   - 解析 boundCacheGroupIds（端口绑定到哪些缓存组）
 *   - merge acceptRule：portGroup.kind 推导的默认规则 AND port 显式 acceptRule
 *   - direction="bidirectional" 的端口组自动分解为 input + output
 *
 * 端口编译结果在后续 compilePhysicalConnections 中匹配生成物理连接，
 * 物理连接再生成 CompiledSimulationTransferEdge（求解图有向边）。
 */
function compilePorts(options: {
  readonly deviceId: string;
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly ports: CompiledSimulationPort[];
}): void {
  const bindingByPortGroupId = new Map<string, PortStorageBindingDefinition[]>();
  for (const binding of options.definition.portStorageBindings) {
    const bindings = bindingByPortGroupId.get(binding.portGroupId) ?? [];
    bindings.push(binding);
    bindingByPortGroupId.set(binding.portGroupId, bindings);
  }

  let order = 0;
  for (const portGroup of options.definition.portGroups) {
    for (const direction of resolvePortGroupDirections(portGroup.direction)) {
      for (const port of portGroup.ports) {
        const localCell = rotateLocalPortCell({
          footprint: options.definition.footprint,
          port,
          rotation: options.entity.rotation,
        });
        const edge = rotateGridEdge(port.edge, options.entity.rotation);
        const insideGridPoint = {
          x: options.entity.position.x + localCell.x,
          y: options.entity.position.y + localCell.y,
        };
        const delta = resolveEdgeDelta(edge);
        const outsideGridPoint = {
          x: insideGridPoint.x + delta.x,
          y: insideGridPoint.y + delta.y,
        };
        const portId = [
          options.deviceId,
          `port:${portGroup.id}.${port.id}.${direction}`,
        ].join("/");
        const acceptRule = intersectAcceptRules(
          acceptRuleFromPortKind(portGroup.kind),
          readPortAcceptRule(port),
          options.itemCatalog,
        ) ?? acceptRuleFromPortKind(portGroup.kind);

        const boundNodeIds = resolveBoundCacheGroupIds({
          portGroup,
          direction,
          bindingByPortGroupId,
          nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
        });

        options.ports.push({
          id: portId,
          deviceId: options.deviceId,
          portGroupId: portGroup.id,
          portDefinitionId: port.id,
          kind: portGroup.kind,
          direction,
          insideGridPoint,
          outsideGridPoint,
          edge,
          boundNodeIds,
          boundCacheGroupIds: boundNodeIds,
          acceptRule,
          count: port.count,
          order,
        });
        order += 1;
      }
    }
  }
}

function resolveBoundCacheGroupIds(options: {
  readonly portGroup: PortGroupDefinition;
  readonly direction: SimulationPortDirection;
  readonly bindingByPortGroupId: ReadonlyMap<string, readonly PortStorageBindingDefinition[]>;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
}): readonly string[] {
  const bindings = options.bindingByPortGroupId.get(options.portGroup.id) ?? [];
  const boundFromBindings = bindings.flatMap((binding) =>
    resolveBindingNodeIds(options.nodeBindingsByStorageGroupId.get(binding.storageSlotGroupId), options.direction),
  );
  if (boundFromBindings.length > 0) {
    return boundFromBindings;
  }

  const syntheticGroupId = options.direction === "input"
    ? "synthetic-input"
    : "synthetic-output";
  return resolveBindingNodeIds(options.nodeBindingsByStorageGroupId.get(syntheticGroupId), options.direction);
}

function resolveBindingNodeIds(
  binding: StorageGroupNodeBinding | undefined,
  direction: SimulationPortDirection,
): readonly string[] {
  if (binding === undefined) {
    return [];
  }
  return direction === "input" ? binding.inputNodeIds : binding.outputNodeIds;
}

function compileRouting(
  definition: EntityDefinition,
): Record<string, CompiledSimulationRoutingEntry> {
  const routing: Record<string, CompiledSimulationRoutingEntry> = {};

  for (const portGroup of definition.portGroups) {
    for (const port of portGroup.ports) {
      const portRef = `${portGroup.id}.${port.id}`;
      routing[portRef] = {
        priorityGroup: port.priorityGroup,
        roundRobinSeed: port.roundRobinSeed,
      };
    }
  }

  return routing;
}

/**
 * 编译设备配方计划。
 *
 * 对应《仿真运行原理》§3.2 配方类型。
 *
 * 三种情况：
 *   1. recipe=null → 无配方，返回 null
 *   2. recipeId=null 且有内联 inputs/outputs → 使用定义内联配方（如传送带的搬运配方）
 *   3. recipeId 指向外部 RecipeDefinition → 使用外部配方（如生产设备的粉碎/熔炼配方）
 *
 * recipeType 决定求解行为：
 *   - "immediate-consume"：0% 时扣原料（生产设备）
 *   - "reserved-item"：100% 时消耗（搬运设备）
 * 订正（2026-05-05）：`reserved-item` 在推进阶段若输出缓存可接收，则立即写入产物、消耗原料并结束当前 run；仅在推进阶段无法完整输出时，才留待二次结算阶段处理。
 *
 * ingredientCacheGroupIds 和 productCacheGroupIds 告知求解器
 * 配方原料从哪些缓存组取、产物写入哪些缓存组。
 */
function compileRecipePlans(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly recipeDefinitionMap: ReadonlyMap<string, RecipeDefinition>;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
}): readonly CompiledSimulationRecipePlan[] {
  const recipeConfig = options.definition.recipe;
  const ingredientCacheGroupIds = resolveRecipeCacheGroupIds({
    definition: options.definition,
    cacheGroups: options.cacheGroups,
    nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
    recipeSide: "ingredient",
  });
  const productCacheGroupIds = resolveRecipeCacheGroupIds({
    definition: options.definition,
    cacheGroups: options.cacheGroups,
    nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
    recipeSide: "product",
  });
  const machineRecipes = [...options.recipeDefinitionMap.values()]
    .filter((recipe) => recipe.machineId === options.definition.id)
    .sort((left, right) => left.id.localeCompare(right.id));

  if (recipeConfig === null) {
    return [];
  }

  const selectedRecipeId = recipeConfig.recipeId;
  if (selectedRecipeId === null) {
    if (recipeConfig.inputs.length > 0 || recipeConfig.outputs.length > 0) {
      return [{
        recipeId: `${options.definition.id}:definition-recipe`,
        recipeType: recipeConfig.recipeType,
        durationTicks: convertSecondsToSimulationTicks(recipeConfig.durationSeconds),
        inputs: recipeConfig.inputs,
        outputs: recipeConfig.outputs,
        ingredientCacheGroupIds,
        productCacheGroupIds,
      }];
    }

    return machineRecipes.map((recipe) => ({
      recipeId: recipe.id,
      recipeType: recipeConfig.recipeType,
      durationTicks: convertSecondsToSimulationTicks(recipe.durationSeconds),
      inputs: recipe.inputs,
      outputs: recipe.outputs,
      ingredientCacheGroupIds,
      productCacheGroupIds,
    }));
  }

  const recipe = options.recipeDefinitionMap.get(selectedRecipeId);
  if (recipe === undefined) {
    return [];
  }

  return [{
    recipeId: recipe.id,
    recipeType: recipeConfig.recipeType,
    durationTicks: convertSecondsToSimulationTicks(recipe.durationSeconds),
    inputs: recipe.inputs,
    outputs: recipe.outputs,
    ingredientCacheGroupIds,
    productCacheGroupIds,
  }];
}

function resolveRecipeCacheGroupIds(options: {
  readonly definition: EntityDefinition;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
  readonly recipeSide: "ingredient" | "product";
}): readonly string[] {
  const knownCacheGroupIds = new Set(options.cacheGroups.map((cacheGroup) => cacheGroup.id));
  const cacheGroupIds: string[] = [];

  for (const storageGroup of options.definition.storageSlotGroups) {
    const cacheType = resolveCacheType(storageGroup.role);
    if (!cacheTypeParticipatesInRecipeSide(cacheType, options.recipeSide)) {
      continue;
    }

    const binding = options.nodeBindingsByStorageGroupId.get(storageGroup.id);
    if (binding !== undefined) {
      cacheGroupIds.push(...binding.recipeNodeIds);
    }
  }

  const syntheticStorageGroupIds = options.recipeSide === "ingredient"
    ? ["synthetic-input"]
    : ["synthetic-output"];
  for (const storageGroupId of syntheticStorageGroupIds) {
    const binding = options.nodeBindingsByStorageGroupId.get(storageGroupId);
    if (binding !== undefined) {
      cacheGroupIds.push(...binding.recipeNodeIds);
    }
  }

  return [...new Set(cacheGroupIds)].filter((cacheGroupId) => knownCacheGroupIds.has(cacheGroupId));
}

function cacheTypeParticipatesInRecipeSide(
  cacheType: SimulationCacheType,
  recipeSide: "ingredient" | "product",
): boolean {
  if (cacheType === "universal") {
    return true;
  }
  return recipeSide === "ingredient"
    ? cacheType === "ingredient"
    : cacheType === "product";
}

/** 编译设备内部有向 Cache Link。 */
function compileInternalLinks(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
  readonly slots: readonly CompiledSimulationSlotTemplate[];
  readonly links: CompiledSimulationCacheLink[];
}): void {
  for (const link of options.definition.cacheLinks) {
    const sourceSlotIds = resolveCacheLinkEndpointSlotIds({
      endpoint: link.source,
      direction: "input",
      nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
      cacheGroups: options.cacheGroups,
    }).filter((slotId) => options.slots.some((slot) => slot.id === slotId));
    const targetSlotIds = resolveCacheLinkEndpointSlotIds({
      endpoint: link.target,
      direction: "output",
      nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
      cacheGroups: options.cacheGroups,
    }).filter((slotId) => options.slots.some((slot) => slot.id === slotId));

    const targetSlotIdBySourceSlotId = pairSourceSlotsToTargetSlots(sourceSlotIds, targetSlotIds);
    const linkedSourceSlotIds = Object.keys(targetSlotIdBySourceSlotId).sort();
    const linkedTargetSlotIds = [...new Set(Object.values(targetSlotIdBySourceSlotId))].sort();
    if (linkedSourceSlotIds.length === 0 || linkedTargetSlotIds.length === 0) {
      continue;
    }

    options.links.push({
      id: [
        "link",
        options.deviceId,
        link.id,
        linkedSourceSlotIds.join("->"),
        linkedTargetSlotIds.join("->"),
      ].join(":"),
      linkType: link.linkType,
      sourceSlotIds: linkedSourceSlotIds,
      targetSlotIds: linkedTargetSlotIds,
      targetSlotIdBySourceSlotId,
    });
  }
}

function resolveCacheLinkEndpointSlotIds(options: {
  readonly endpoint: EntityDefinition["cacheLinks"][number]["source"];
  readonly direction: SimulationPortDirection;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
  readonly cacheGroups: readonly CompiledSimulationCacheGroup[];
}): readonly string[] {
  const binding = options.nodeBindingsByStorageGroupId.get(options.endpoint.storageSlotGroupId);
  const directionalNodeIds = resolveBindingNodeIds(binding, options.direction);
  const cacheGroupIds = directionalNodeIds.length > 0
    ? directionalNodeIds
    : binding?.recipeNodeIds ?? [];

  return cacheGroupIds.flatMap((cacheGroupId) => {
    const cacheGroup = options.cacheGroups.find((candidate) =>
      candidate.id === cacheGroupId,
    );
    if (cacheGroup === undefined) {
      return [];
    }

    if (options.endpoint.slotId === undefined) {
      return [...cacheGroup.slotIds];
    }

    return cacheGroup.slotIds.filter((slotId) =>
      slotId.includes(`/slot:${options.endpoint.slotId}`),
    );
  });
}

function pairSourceSlotsToTargetSlots(
  sourceSlotIds: readonly string[],
  targetSlotIds: readonly string[],
): Record<string, string> {
  const targetSlotIdBySourceSlotId: Record<string, string> = {};
  if (targetSlotIds.length === 0) {
    return targetSlotIdBySourceSlotId;
  }
  sourceSlotIds.forEach((sourceSlotId, index) => {
    targetSlotIdBySourceSlotId[sourceSlotId] = targetSlotIds[Math.min(index, targetSlotIds.length - 1)] ?? targetSlotIds[0] ?? sourceSlotId;
  });
  return targetSlotIdBySourceSlotId;
}

/**
 * 编译显式链接（暗管 dark-pipe）。
 *
 * 对应《仿真运行原理》§5.1.3 桥接器概念，但此处是显式的跨设备 share-all Link。
 *
 * 暗管连接两个设备的 product→ingredient 缓存组，
 * 通过 share-all Link 使源设备的 product 槽位与目标设备的 ingredient 槽位
 * 共享存储内容和上限。
 */
function compileExplicitLinks(options: {
  readonly document: WorldDocument;
  readonly devices: Readonly<Record<string, CompiledSimulationDevice>>;
  readonly cacheGroups: Readonly<Record<string, CompiledSimulationCacheGroup>>;
  readonly slots: Readonly<Record<string, CompiledSimulationSlotTemplate>>;
}): CompiledSimulationCacheLink[] {
  const links: CompiledSimulationCacheLink[] = [];

  for (const link of [...options.document.explicitLinks].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (link.kind !== "dark-pipe") {
      continue;
    }

    const sourceDevice = options.devices[`device:${link.sourceEntityId}`];
    const targetDevice = options.devices[`device:${link.targetEntityId}`];
    if (sourceDevice === undefined || targetDevice === undefined) {
      continue;
    }

    const sourceSlotId = findFirstSlotIdByCacheType(sourceDevice, options.cacheGroups, "product");
    const targetSlotId = findFirstSlotIdByCacheType(targetDevice, options.cacheGroups, "ingredient");
    if (sourceSlotId === null || targetSlotId === null) {
      continue;
    }

    if (options.slots[sourceSlotId] === undefined || options.slots[targetSlotId] === undefined) {
      continue;
    }

    links.push({
      id: ["link", "share-all", link.id, sourceSlotId, targetSlotId].join(":"),
      linkType: "share-all",
      sourceSlotIds: [sourceSlotId],
      targetSlotIds: [targetSlotId],
      targetSlotIdBySourceSlotId: {
        [sourceSlotId]: targetSlotId,
      },
    });
  }

  return links;
}

/**
 * 编译物理连接。
 *
 * 对应《仿真运行原理》§5.2 边来源：
 *   - 布局中相邻端口之间自动建立物理连接
 *   - sourcePort.direction="output" && targetPort.direction="input"
 *   - sourcePort.outsideGridPoint === targetPort.insideGridPoint
 *   - 同设备端口不自连
 *
 * 每条物理连接后续拆解为多条 transferEdge（每对 source/target cacheGroup 一条边）。
 */
function compilePhysicalConnections(
  maybePorts: readonly (CompiledSimulationPort | undefined)[],
): CompiledSimulationPhysicalConnection[] {
  const sourcePorts = maybePorts.filter((port): port is CompiledSimulationPort =>
    port !== undefined && port.direction === "output",
  );
  const targetPorts = maybePorts.filter((port): port is CompiledSimulationPort =>
    port !== undefined && port.direction === "input",
  );
  const connections: CompiledSimulationPhysicalConnection[] = [];

  for (const sourcePort of sourcePorts) {
    for (const targetPort of targetPorts) {
      if (sourcePort.kind !== targetPort.kind || sourcePort.deviceId === targetPort.deviceId) {
        continue;
      }
      if (
        areGridPointsEqual(sourcePort.outsideGridPoint, targetPort.insideGridPoint)
        && areGridPointsEqual(sourcePort.insideGridPoint, targetPort.outsideGridPoint)
      ) {
        connections.push({
          id: `connection:${sourcePort.id}->${targetPort.id}`,
          sourcePortId: sourcePort.id,
          targetPortId: targetPort.id,
          sourceInsideGridPoint: sourcePort.insideGridPoint,
          targetInsideGridPoint: targetPort.insideGridPoint,
        });
      }
    }
  }

  return connections;
}

function getOrderedEntityIds(document: WorldDocument): string[] {
  const ordered = document.entityOrder.filter((entityId, index, array) =>
    document.entities[entityId] !== undefined && array.indexOf(entityId) === index,
  );
  const missingFromOrder = Object.keys(document.entities)
    .filter((entityId) => !ordered.includes(entityId))
    .sort();

  return [...ordered, ...missingFromOrder];
}

/**
 * role → cacheType 映射。
 *
 * 对应《仿真运行原理》§3.1 缓存类型：
 *   "input"         → "ingredient"（链接到输入端口的缓存）
 *   "output"        → "product"（链接到输出端口的缓存）
 *   "bidirectional" → "universal"（同时链接输入和输出）
 */
function resolveCacheType(role: StorageSlotGroupDefinition["role"]): SimulationCacheType {
  switch (role) {
    case "input":
      return "ingredient";
    case "output":
      return "product";
    case "bidirectional":
      return "universal";
  }
}

function resolveSlotDomain(
  storageGroup: StorageSlotGroupDefinition,
  slot: StorageSlotDefinition,
): SimulationItemDomain | "any" {
  if (slot.itemFilterType === "solid" || slot.itemFilterType === "liquid") {
    return slot.itemFilterType;
  }
  if (storageGroup.kind === "fluid") {
    return "liquid";
  }
  if (storageGroup.kind === "item") {
    return "solid";
  }
  return "any";
}

function inferStorageDomainFromPortGroups(
  portGroups: readonly PortGroupDefinition[],
  direction: SimulationPortDirection,
): SimulationItemDomain | "any" {
  const matchingKinds = new Set(portGroups
    .filter((portGroup) =>
      portGroup.direction === direction || portGroup.direction === "bidirectional",
    )
    .map((portGroup) => portGroup.kind));
  if (matchingKinds.size !== 1) {
    return "any";
  }
  return matchingKinds.has("fluid") ? "liquid" : "solid";
}

function resolvePortGroupDirections(
  direction: PortGroupDefinition["direction"],
): readonly SimulationPortDirection[] {
  if (direction === "bidirectional") {
    return ["input", "output"];
  }
  return [direction];
}

function acceptRuleFromPortKind(kind: SimulationPortKind): SimulationAcceptRule {
  return {
    base: kind === "fluid" ? { kind: "liquid" } : { kind: "solid" },
    exclude: [],
  };
}

function readPortAcceptRule(
  port: PortDefinition,
): SimulationAcceptRule {
  return {
    base: port.acceptRule.base,
    exclude: [...port.acceptRule.exclude].sort(),
  };
}

/**
 * acceptRule 交集运算（AND）。
 *
 * 对应《仿真运行原理》§5.2 边来源中的规则：
 *   边的 acceptRule = sourcePort.acceptRule AND targetPort.acceptRule
 *
 * AND 规则：
 *   - base 取两端口最严格交集：
 *       itemId(A) ∩ itemId(B) → 只有 A=B 时有效，否则返回 null（边不生成）
 *       itemId(A) ∩ solid → 只有 A 是固体时有效
 *       any ∩ solid → solid
 *       solid ∩ liquid → 空（返回 null）
 *   - exclude 取两端口排除列表的并集
 *
 * 若 AND 后无有效物品，返回 null，该边不生成。
 */
function intersectAcceptRules(
  left: SimulationAcceptRule,
  right: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): SimulationAcceptRule | null {
  const leftCandidates = resolveAcceptRuleCandidateDomains(left, itemCatalog);
  const rightCandidates = resolveAcceptRuleCandidateDomains(right, itemCatalog);
  const sharedDomains = leftCandidates.domains.filter((domain) =>
    rightCandidates.domains.includes(domain),
  );
  const exclude = [...new Set([...left.exclude, ...right.exclude])].sort();

  if (leftCandidates.itemId !== null && rightCandidates.itemId !== null) {
    if (leftCandidates.itemId !== rightCandidates.itemId || exclude.includes(leftCandidates.itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId: leftCandidates.itemId },
      exclude,
    };
  }

  const itemId = leftCandidates.itemId ?? rightCandidates.itemId;
  if (itemId !== null) {
    const domain = itemCatalog[itemId]?.domain ?? inferItemDomain(itemId, []);
    if (!sharedDomains.includes(domain) || exclude.includes(itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId },
      exclude,
    };
  }

  if (sharedDomains.length === 0) {
    return null;
  }

  if (sharedDomains.length === 1) {
    return {
      base: { kind: sharedDomains[0] ?? "solid" },
      exclude,
    };
  }

  return {
    base: { kind: "any" },
    exclude,
  };
}

function resolveAcceptRuleCandidateDomains(
  rule: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): {
  readonly domains: SimulationItemDomain[];
  readonly itemId: string | null;
} {
  switch (rule.base.kind) {
    case "any":
      return { domains: ["solid", "liquid"], itemId: null };
    case "solid":
      return { domains: ["solid"], itemId: null };
    case "liquid":
      return { domains: ["liquid"], itemId: null };
    case "item":
      return {
        domains: [itemCatalog[rule.base.itemId]?.domain ?? inferItemDomain(rule.base.itemId, [])],
        itemId: rule.base.itemId,
      };
  }
}

function minCountLimit(
  left: SimulationCountLimit,
  right: SimulationCountLimit,
): SimulationCountLimit {
  if (left === "unlimited") {
    return right;
  }
  if (right === "unlimited") {
    return left;
  }
  return Math.min(left, right);
}

function resolveTransportClass(
  registryQueries: RegistryContract["queries"],
  definition: EntityDefinition,
): SimulationTransportClass {
  const dedicatedLogisticsKind = registryQueries.resolveDedicatedLogisticsKind(definition.id);

  if (dedicatedLogisticsKind === "belt") {
    return "strict-belt";
  }

  if (dedicatedLogisticsKind === "pipe") {
    return "strict-pipe";
  }

  if (definition.portGroups.length === 0 && definition.storageSlotGroups.length === 0) {
    return "non-graph";
  }
  return "anchor";
}

function rotateLocalPortCell(options: {
  readonly footprint: { readonly width: number; readonly height: number };
  readonly port: PortDefinition;
  readonly rotation: GridRotation;
}): GridPoint {
  switch (options.rotation) {
    case 0:
      return { x: options.port.localCellX, y: options.port.localCellY };
    case 90:
      return {
        x: options.footprint.height - 1 - options.port.localCellY,
        y: options.port.localCellX,
      };
    case 180:
      return {
        x: options.footprint.width - 1 - options.port.localCellX,
        y: options.footprint.height - 1 - options.port.localCellY,
      };
    case 270:
      return {
        x: options.port.localCellY,
        y: options.footprint.width - 1 - options.port.localCellX,
      };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const rotationSteps = rotation / 90;
  const edgeIndex = EDGE_ORDER.indexOf(edge);
  return EDGE_ORDER[(edgeIndex + rotationSteps) % EDGE_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}

function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function inferItemDomain(
  itemId: string,
  tags: readonly string[],
): SimulationItemDomain {
  if (
    itemId.includes("_liquid")
    || itemId.startsWith("liquid_")
    || tags.includes("liquid")
    || tags.includes("fluid")
  ) {
    return "liquid";
  }

  return "solid";
}

function findFirstSlotIdByCacheType(
  device: CompiledSimulationDevice,
  cacheGroups: Readonly<Record<string, CompiledSimulationCacheGroup>>,
  cacheType: SimulationCacheType,
): string | null {
  for (const cacheGroupId of device.cacheGroupIds) {
    const cacheGroup = cacheGroups[cacheGroupId];
    if (cacheGroup?.cacheType === cacheType) {
      return cacheGroup.slotIds[0] ?? null;
    }
  }

  return null;
}
